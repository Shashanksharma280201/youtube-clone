import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { exists } from '@/lib/s3'
import { parseStorageUrl } from '@/lib/storage/parseUrl'
import { start } from 'workflow/api'
import { transcribeVideoWorkflow } from '@/workflows/transcribe-video'
import { buildExtractionResponse } from '@/lib/videoExtractionResponse'

// Ingest a video by its blob URL and extract its chunks.
//
// ASYNCHRONOUS: the call kicks off the durable pipeline and returns immediately.
// It never holds the request open waiting for the work — a long video (hours) is
// processed in the background and the caller learns it is done by asking again.
//
// The contract:
//   - First call for a new resourceId → 202 with status PROCESSING (work started).
//   - Call again with the SAME resourceId while it runs → 202 (still PROCESSING).
//   - Call again once finished → 200 with the full result (chunks + guide + transcript).
//   - Failed → 409.
// So the caller polls this endpoint (or a dedicated GET /status) until status is
// DONE, then reads the body. Processing is idempotent per resourceId: an existing
// resource is never reprocessed — the call attaches to the in-flight run or returns
// the finished result straight away.
//
// Status codes:
//   200 — done, full result in the body
//   202 — accepted / still running (poll again with the same resourceId)
//   409 — processing failed
//   400 / 404 — bad request / blob not in storage
export const dynamic = 'force-dynamic'
// The request only validates input and starts the durable job, so it returns in
// seconds — it no longer needs a long timeout to hold the connection open.
export const maxDuration = 60

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

  // Existing resource: never reprocess. Return its current state (finished result,
  // or PROCESSING if a run is already in flight).
  const existing = await prisma.video.findUnique({ where: { externalId: resourceId } })
  if (existing) return respond(existing)

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
    // the externalId unique constraint let exactly one win. The loser attaches to
    // the winner's run rather than erroring.
    if (isUniqueViolation(err)) {
      const winner = await prisma.video.findUnique({ where: { externalId: resourceId } })
      if (winner) return respond(winner)
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

  // Work has started and runs in the background — answer 202 right away.
  return respond(video)
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
}

type Row = NonNullable<Awaited<ReturnType<typeof prisma.video.findUnique>>>

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
