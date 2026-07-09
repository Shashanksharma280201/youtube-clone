import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { exists, s3Url } from '@/lib/s3'
import { start } from 'workflow/api'
import { transcribeVideoWorkflow } from '@/workflows/transcribe-video'

// Register a video that another service has already written into our storage
// container, then start the durable pipeline. `videoName` is a blob key inside
// AZURE_STORAGE_CONTAINER (or the S3 bucket, whichever backend is active).
// Access is gated by the API key (middleware).
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const videoId = typeof body.videoId === 'string' ? body.videoId.trim() : ''
  const videoName = typeof body.videoName === 'string' ? body.videoName.trim() : ''

  if (!videoId || !videoName) {
    return NextResponse.json({ error: 'videoId and videoName are required' }, { status: 400 })
  }

  // Idempotent: re-ingesting the same externalId returns the existing record
  // rather than creating a duplicate or restarting the pipeline.
  const existing = await prisma.video.findUnique({ where: { externalId: videoId } })
  if (existing) {
    return NextResponse.json({
      id: existing.id,
      externalId: videoId,
      status: existing.transcriptStatus,
    })
  }

  if (!(await exists(videoName))) {
    return NextResponse.json({ error: 'Video file not found in storage' }, { status: 404 })
  }

  const video = await prisma.video.create({
    data: {
      externalId: videoId,
      title: typeof body.title === 'string' && body.title.trim() ? body.title.trim() : videoName,
      description: typeof body.description === 'string' ? body.description : '',
      blobUrl: s3Url(videoName),
      transcriptStatus: 'PROCESSING',
    },
  })

  try {
    const run = await start(transcribeVideoWorkflow, [video.id])
    return NextResponse.json(
      { id: video.id, externalId: videoId, status: 'PROCESSING', runId: run.runId },
      { status: 202 },
    )
  } catch (err) {
    console.error('[ingest] failed to start workflow:', err)
    await prisma.video.update({
      where: { id: video.id },
      data: { transcriptStatus: 'FAILED' },
    })
    return NextResponse.json({ error: 'Failed to start processing' }, { status: 500 })
  }
}
