import { NextResponse } from 'next/server'
import { resolveVideo } from '@/lib/video'
import { signThumbnails } from '@/lib/signUrls'
import { deleteVideoCompletely } from '@/lib/deleteVideo'

// Full video record (including domainData — the Machine Guide).
// `id` may be our cuid or the ingesting service's externalId.
export async function GET(_: Request, { params }: { params: { id: string } }) {
  const video = await resolveVideo(params.id)
  if (!video) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(await signThumbnails(video))
}

// Permanently delete a video + all derived data (blob, audio, thumbnails, row).
// Access is gated by the API key (middleware) / same-origin UI.
export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  const video = await resolveVideo(params.id)
  if (!video) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const deleted = await deleteVideoCompletely(video.id)
  if (!deleted) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ deleted: true })
}
