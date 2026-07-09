import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { deleteVideoCompletely } from '@/lib/deleteVideo'

// Full video record (including domainData — the Machine Guide).
export async function GET(_: Request, { params }: { params: { id: string } }) {
  const video = await prisma.video.findUnique({ where: { id: params.id } })
  if (!video) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(video)
}

// Permanently delete a video + all derived data (S3 blob, audio, thumbnails, row).
// Access is gated by the API key (middleware) / same-origin UI.
export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  const deleted = await deleteVideoCompletely(params.id)
  if (!deleted) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ deleted: true })
}
