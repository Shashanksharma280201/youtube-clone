import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { writeFile } from 'fs/promises'
import { join } from 'path'

export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const formData = await request.formData()
  const title = formData.get('title') as string
  const description = formData.get('description') as string
  const videoFile = formData.get('video') as File

  if (!title || !videoFile) {
    return NextResponse.json({ error: 'Title and video are required' }, { status: 400 })
  }

  const filename = `${Date.now()}-${videoFile.name.replace(/\s+/g, '-')}`
  const bytes = await videoFile.arrayBuffer()
  await writeFile(
    join(process.cwd(), 'public', 'uploads', 'videos', filename),
    Buffer.from(bytes)
  )
  const videoUrl = `/uploads/videos/${filename}`

  const video = await prisma.video.create({
    data: {
      title,
      description: description || '',
      blobUrl: videoUrl,
      userId: session.user.id,
      transcriptStatus: 'PENDING',
    },
  })

  return NextResponse.json({ id: video.id }, { status: 201 })
}
