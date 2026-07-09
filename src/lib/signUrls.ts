import { s3Key, getPresignedDownloadUrl } from './s3'

const THUMB_TTL_SECONDS = 6 * 3600

// Receives the stored (unsigned) URL and returns a fetchable one. Injectable so
// the transform can be tested without touching a storage backend.
export type Signer = (storedUrl: string) => Promise<string>

const defaultSigner: Signer = (storedUrl) =>
  getPresignedDownloadUrl(s3Key(storedUrl), THUMB_TTL_SECONDS)

type WithThumbs = { thumbnailUrl?: unknown; topicSegments?: unknown }

// Thumbnails are stored as plain object URLs. Private containers reject those
// (Azure Blob returns 403 when anonymous access is off), so mint short-lived
// signed URLs whenever we hand a video to a caller.
export async function signThumbnails<T extends WithThumbs>(
  video: T,
  sign: Signer = defaultSigner,
): Promise<T> {
  const out = { ...video } as T & WithThumbs

  if (typeof out.thumbnailUrl === 'string' && out.thumbnailUrl) {
    out.thumbnailUrl = await sign(out.thumbnailUrl)
  }

  if (Array.isArray(out.topicSegments)) {
    out.topicSegments = await Promise.all(
      out.topicSegments.map(async (seg) => {
        const path = (seg as { thumbnailPath?: unknown })?.thumbnailPath
        if (typeof path !== 'string' || !path) return seg
        return { ...(seg as object), thumbnailPath: await sign(path) }
      }),
    )
  }

  return out as T
}
