import { prisma } from './prisma'
import { s3Key, deleteFromS3, deleteS3Prefix } from './s3'

// Permanently remove a video and everything derived from it:
//   • S3: the source video blob, its audio chunks (audio/<id>/*), its thumbnails (thumbnails/<id>/*)
//   • DB: the Video row plus its Likes and Comments (schema has no ON DELETE CASCADE, so we
//     delete children explicitly inside one transaction).
// S3 deletes are best-effort — a missing/already-deleted object must not block the DB cleanup.
// Returns false if the video no longer exists.
export async function deleteVideoCompletely(videoId: string): Promise<boolean> {
  const video = await prisma.video.findUnique({
    where: { id: videoId },
    select: { blobUrl: true },
  })
  if (!video) return false

  await Promise.allSettled([
    deleteFromS3(s3Key(video.blobUrl)),
    deleteS3Prefix(`audio/${videoId}/`),
    deleteS3Prefix(`thumbnails/${videoId}/`),
  ])

  await prisma.$transaction([
    prisma.like.deleteMany({ where: { videoId } }),
    prisma.comment.deleteMany({ where: { videoId } }),
    prisma.video.delete({ where: { id: videoId } }),
  ])

  return true
}
