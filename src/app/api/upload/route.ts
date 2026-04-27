import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

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
  let videoUrl: string

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    // Production (Vercel) — upload to Vercel Blob
    const { put } = await import('@vercel/blob')
    const blob = await put(`videos/${filename}`, videoFile, { access: 'public' })
    videoUrl = blob.url
  } else {
    // Local development — save to public/uploads/videos/
    const { writeFile } = await import('fs/promises')
    const { join } = await import('path')
    const bytes = await videoFile.arrayBuffer()
    const buffer = Buffer.from(bytes)
    await writeFile(join(process.cwd(), 'public', 'uploads', 'videos', filename), buffer)
    videoUrl = `/uploads/videos/${filename}`
  }

  const video = await prisma.video.create({
    data: {
      title,
      description: description || '',
      blobUrl: videoUrl,
      userId: session.user.id,
    },
  })

  return NextResponse.json(video, { status: 201 })
}
