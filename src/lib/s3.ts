import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { createWriteStream, existsSync } from 'fs'
import { rename, unlink } from 'fs/promises'
import { pipeline } from 'stream/promises'
import { Readable } from 'stream'
import { join } from 'path'
import { tmpdir } from 'os'

export const s3 = new S3Client({
  region: process.env.AWS_REGION!,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
})

export const BUCKET = process.env.AWS_S3_BUCKET!

export function s3Url(key: string) {
  return `https://${BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`
}

export function s3Key(url: string) {
  return url.replace(`https://${BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/`, '')
}

export async function getPresignedUploadUrl(key: string, contentType: string) {
  const cmd = new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: contentType })
  return getSignedUrl(s3, cmd, { expiresIn: 3600 })
}

export async function getPresignedDownloadUrl(key: string, expiresIn = 6 * 3600) {
  const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: key })
  return getSignedUrl(s3, cmd, { expiresIn })
}

export async function downloadFromS3(key: string, localPath: string) {
  const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: key })
  const res = await s3.send(cmd)
  const chunks: Uint8Array[] = []
  for await (const chunk of res.Body as AsyncIterable<Uint8Array>) chunks.push(chunk)
  const { writeFile } = await import('fs/promises')
  await writeFile(localPath, Buffer.concat(chunks))
}

// Download the video to a stable local path once and reuse it across steps.
// The static ffmpeg binary segfaults on https ranged reads, so every ffmpeg op
// runs against a local file instead. On one machine (local dev, or a single
// Fluid Compute instance) this downloads once; across separate step invocations
// it re-downloads, which is correct but worth optimizing later (pre-split audio).
// Streams to disk via a temp file + atomic rename so parallel steps can't collide.
export async function ensureLocalVideo(videoId: string, key: string): Promise<string> {
  const finalPath = join(tmpdir(), `wf-video-${videoId}`)
  if (existsSync(finalPath)) return finalPath

  const tmpPath = `${finalPath}.${process.pid}.${Date.now()}.part`
  const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }))
  await pipeline(res.Body as Readable, createWriteStream(tmpPath))
  if (!existsSync(finalPath)) {
    try {
      await rename(tmpPath, finalPath)
      return finalPath
    } catch { /* another worker won the race */ }
  }
  // finalPath already existed (or rename lost the race) → discard our temp copy
  // so we don't leak a multi-hundred-MB orphan .part file.
  await unlink(tmpPath).catch(() => {})
  return finalPath
}

export async function uploadToS3(localPath: string, key: string, contentType: string) {
  const { readFile } = await import('fs/promises')
  const body = await readFile(localPath)
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: contentType }))
  return s3Url(key)
}
