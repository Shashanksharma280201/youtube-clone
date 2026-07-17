import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildExtractionResponse } from '@/lib/videoExtractionResponse'

// Poll a video's processing status by its resourceId.
//
// This is the read-only companion to POST /videoExtraction (which STARTS the job):
// the caller polls here until the work finishes, then reads the result.
//
// HTTP status answers "did the status check work", NOT the job state:
//   200 — resource found; the JOB state is in the body's `status` field
//         (PROCESSING | DONE | FAILED). On DONE the full result is returned inline,
//         so one poll loop yields everything — no second call.
//   404 — no video for this resourceId
//   400 — resourceId missing
// This deliberately avoids the "202 looks like success" trap: a caller reads
// `body.status`, never the HTTP code, to decide whether to keep polling.
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const resourceId = (searchParams.get('resourceId') ?? '').trim()

  if (!resourceId) {
    return NextResponse.json({ error: 'resourceId is required' }, { status: 400 })
  }

  const video = await prisma.video.findUnique({ where: { externalId: resourceId } })
  if (!video) {
    return NextResponse.json({ resourceId, status: 'NOT_FOUND' }, { status: 404 })
  }

  const s = video.transcriptStatus

  // Done — hand back the complete result inline (chapters, transcript, guide).
  if (s === 'DONE') {
    return NextResponse.json(await buildExtractionResponse(video), { status: 200 })
  }

  // Failed — surface it as a 200 with status FAILED so the poll loop can stop
  // cleanly (the status check itself succeeded).
  if (s === 'FAILED') {
    return NextResponse.json(
      {
        resourceId: video.externalId ?? video.id,
        machineId: video.machineId,
        tenantId: video.tenantId,
        status: 'FAILED',
        error: 'processing failed',
      },
      { status: 200 },
    )
  }

  // Still running (PROCESSING / NONE) — tell the caller to poll again.
  return NextResponse.json(
    {
      resourceId: video.externalId ?? video.id,
      machineId: video.machineId,
      tenantId: video.tenantId,
      status: video.transcriptStatus,
      pollAfterMs: 5000,
    },
    { status: 200 },
  )
}
