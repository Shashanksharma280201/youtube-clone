import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { videoWhere } from '@/lib/videoWhere'

// `id` may be our cuid or the ingesting service's externalId.
export async function GET(_: Request, { params }: { params: { id: string } }) {
  const video = await prisma.video.findFirst({
    where: videoWhere(params.id),
    select: {
      transcriptStatus: true,
      transcript: true,
      transcriptSegments: true,
      topicSegments: true,
    },
  })

  if (!video) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({
    status: video.transcriptStatus,
    transcript: video.transcript,
    segments: video.transcriptSegments,
    topicSegments: video.topicSegments,
  })
}
