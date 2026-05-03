import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const video = await prisma.video.findUnique({
    where: { id: params.id },
    select: {
      transcriptStatus: true,
      transcript: true,
      transcriptSegments: true,
    },
  })

  if (!video) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({
    status: video.transcriptStatus,
    transcript: video.transcript,
    segments: video.transcriptSegments,
  })
}
