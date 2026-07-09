import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getPresignedUploadUrl, s3Url } from '@/lib/s3'

// Create a video record + return a presigned S3 URL to PUT the file to.
// Access is gated by the API key (middleware) for external callers; the internal
// UI reaches it same-origin. No user/ownership — this is an internal service.
export async function POST(request: Request) {
  const { title, description, filename, contentType } = await request.json()
  if (!title || !filename) {
    return NextResponse.json({ error: 'Title and filename are required' }, { status: 400 })
  }

  const key = `videos/${Date.now()}-${filename.replace(/\s+/g, '-')}`

  try {
    const { url: uploadUrl, headers: uploadHeaders } = await getPresignedUploadUrl(
      key,
      contentType || 'video/mp4',
    )

    const video = await prisma.video.create({
      data: {
        title,
        description: description || '',
        blobUrl: s3Url(key),
        transcriptStatus: 'PENDING',
      },
    })

    // uploadHeaders carries any headers the client must send on the PUT
    // (Azure needs x-ms-blob-type; empty for S3).
    return NextResponse.json({ id: video.id, uploadUrl, uploadHeaders }, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}
