import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { exists } from '@/lib/s3'
import { parseStorageUrl } from '@/lib/storage/parseUrl'
import { start } from 'workflow/api'
import { transcribeVideoWorkflow } from '@/workflows/transcribe-video'
import { buildExtractionResponse } from '@/lib/videoExtractionResponse'

// Ingest a video by its blob URL and return the extracted chunks. Poll-based:
// the first call starts the pipeline and returns 202; repeat calls return 202
// while processing, 200 when DONE, 409 when FAILED. Idempotent on resourceId
// (stored as externalId). Gated by the API-key middleware.
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

  // Existing resource: return current state, never reprocess.
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

  const video = await prisma.video.create({
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

  try {
    await start(transcribeVideoWorkflow, [video.id])
  } catch (err) {
    console.error('[videoExtraction] failed to start workflow:', err)
    await prisma.video.update({ where: { id: video.id }, data: { transcriptStatus: 'FAILED' } })
    return NextResponse.json({ error: 'Failed to start processing' }, { status: 500 })
  }

  return NextResponse.json(
    { resourceId, machineId, tenantId, status: 'PROCESSING', chunks: [], chunkCount: 0 },
    { status: 202 },
  )
}

type Row = Awaited<ReturnType<typeof prisma.video.findUnique>>

async function respond(video: NonNullable<Row>) {
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
