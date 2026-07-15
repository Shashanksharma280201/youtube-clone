import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { exists } from '@/lib/s3'
import { parseStorageUrl } from '@/lib/storage/parseUrl'
import { start } from 'workflow/api'
import { transcribeVideoWorkflow } from '@/workflows/transcribe-video'
import { buildExtractionResponse } from '@/lib/videoExtractionResponse'
import { waitForTerminal, isTerminal } from '@/lib/waitForTerminal'

// Ingest a video by its blob URL and return the extracted chunks.
//
// SYNCHRONOUS: one call in, the chunks out. The handler starts the pipeline and
// then holds the request open until it finishes, so a caller never has to know
// about polling. This is deliberate — the previous poll-based contract returned
// 202 with `chunks: []`, and because 202 is a 2xx an `if (response.ok)` check
// passes, so callers recorded "success, zero chunks" and shipped an empty result
// downstream. A response that means "not ready" must not look like an answer.
//
// The pipeline itself is unchanged and still durable: it runs outside the request
// and survives a pod restart, which the open connection does not. So the wait is a
// convenience layered on top, never the thing keeping the work alive. If the caller
// disconnects, processing continues; calling again with the same resourceId returns
// the finished result immediately rather than redoing it.
//
// Status codes:
//   200 — done, chunks in the body
//   202 — still running after WAIT_MS (rare; caller may poll, as before)
//   409 — processing failed
//   400 / 404 — bad request / blob not in storage
export const dynamic = 'force-dynamic'
export const maxDuration = 1800 // seconds; matches the ingress proxy-read-timeout

// Capped below the ingress's 1800s proxy-read-timeout, so we answer before nginx
// gives up on us — a 504 would tell the caller nothing about the job's real state.
const WAIT_MS = Number(process.env.EXTRACTION_WAIT_MS ?? 25 * 60 * 1000)
const POLL_MS = Number(process.env.EXTRACTION_POLL_MS ?? 3000)

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const machineId = typeof body.machineId === 'string' ? body.machineId.trim() : ''
  const resourceId = typeof body.resourceId === 'string' ? body.resourceId.trim() : ''
  const tenantId = typeof body.tenantId === 'string' ? body.tenantId.trim() : ''
  const videoURL = typeof body.videoURL === 'string' ? body.videoURL.trim() : ''

  if (!machineId || !resourceId || !tenantId || !videoURL) {
    return NextResponse.json(
      { error: 'machineId, resourceId, tenantId and videoURL are required' },
      { status: 400 },
    )
  }

  // Existing resource: never reprocess. Attach to the run already in flight (or
  // return its finished result straight away).
  const existing = await prisma.video.findUnique({ where: { externalId: resourceId } })
  if (existing) return settle(existing)

  let parsed: { container: string; key: string }
  try {
    parsed = parseStorageUrl(videoURL)
  } catch {
    return NextResponse.json(
      { error: 'videoURL must point at the configured storage account' },
      { status: 400 },
    )
  }

  if (!(await exists(parsed.key, parsed.container))) {
    return NextResponse.json({ error: 'Video file not found in storage' }, { status: 404 })
  }

  let video
  try {
    video = await prisma.video.create({
      data: {
        externalId: resourceId,
        machineId,
        tenantId,
        title: parsed.key.split('/').pop() || parsed.key,
        description: '',
        blobUrl: videoURL,
        transcriptStatus: 'PROCESSING',
      },
    })
  } catch (err) {
    // Two callers raced past the findUnique above and both tried to create the row;
    // the externalId unique constraint let exactly one win. The loser must attach to
    // the winner's run, not error — otherwise a duplicate request (which a sync API
    // invites, since a slow response looks like a hang) would 500. Rare before the
    // request started taking minutes; routine now.
    if (isUniqueViolation(err)) {
      const winner = await prisma.video.findUnique({ where: { externalId: resourceId } })
      if (winner) return settle(winner)
    }
    throw err
  }

  try {
    await start(transcribeVideoWorkflow, [video.id])
  } catch (err) {
    console.error('[videoExtraction] failed to start workflow:', err)
    await prisma.video.update({ where: { id: video.id }, data: { transcriptStatus: 'FAILED' } })
    return NextResponse.json({ error: 'Failed to start processing' }, { status: 500 })
  }

  return settle(video)
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
}

type Row = NonNullable<Awaited<ReturnType<typeof prisma.video.findUnique>>>

// Hold the request until the row reaches DONE/FAILED, then answer. Falls back to
// the old 202 if the wait is exhausted, so a pathologically slow video degrades to
// poll-based instead of hanging until the ingress kills the connection.
async function settle(video: Row) {
  if (isTerminal(video.transcriptStatus)) return respond(video)

  const final = await waitForTerminal(
    () => prisma.video.findUnique({ where: { id: video.id } }),
    { timeoutMs: WAIT_MS, pollMs: POLL_MS },
  )

  return respond(final ?? video)
}

async function respond(video: Row) {
  const s = video.transcriptStatus
  if (s === 'DONE') {
    return NextResponse.json(await buildExtractionResponse(video), { status: 200 })
  }
  if (s === 'FAILED') {
    return NextResponse.json(
      { resourceId: video.externalId ?? video.id, status: 'FAILED', error: 'processing failed' },
      { status: 409 },
    )
  }
  return NextResponse.json(
    {
      resourceId: video.externalId ?? video.id,
      machineId: video.machineId,
      tenantId: video.tenantId,
      status: video.transcriptStatus,
      chunks: [],
      chunkCount: 0,
    },
    { status: 202 },
  )
}
