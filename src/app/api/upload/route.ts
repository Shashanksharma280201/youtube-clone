import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getPresignedUploadUrl, s3Url } from '@/lib/s3'

export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { title, description, filename, contentType, sam3Enabled } = await request.json()
  if (!title || !filename) {
    return NextResponse.json({ error: 'Title and filename are required' }, { status: 400 })
  }

  const key = `videos/${Date.now()}-${filename.replace(/\s+/g, '-')}`

  try {
    const uploadUrl = await getPresignedUploadUrl(key, contentType || 'video/mp4')

    const video = await prisma.video.create({
      data: {
        title,
        description: description || '',
        blobUrl: s3Url(key),
        userId: session.user.id,
        transcriptStatus: 'PENDING',
        sam3Enabled: sam3Enabled === true,
      },
    })

    return NextResponse.json({ id: video.id, uploadUrl }, { status: 201 })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    const isFkViolation = msg.includes('Foreign key') || (err as { code?: string })?.code === 'P2003'
    return NextResponse.json(
      { error: isFkViolation ? 'Session expired — please sign out and sign in again' : 'Upload failed' },
      { status: 500 }
    )
  }
}
