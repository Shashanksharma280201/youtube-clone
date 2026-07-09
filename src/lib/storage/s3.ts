// AWS S3 storage backend. The client is created lazily so this module can be
// imported even in an Azure-only deployment (missing AWS_* env) without throwing.
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { createWriteStream, existsSync } from 'fs'
import { rename, unlink } from 'fs/promises'
import { pipeline } from 'stream/promises'
import { Readable } from 'stream'
import { join } from 'path'
import { tmpdir } from 'os'
import type { StorageBackend, UploadTarget } from './types'

let _s3: S3Client | null = null
function client(): S3Client {
  if (!_s3) {
    _s3 = new S3Client({
      region: process.env.AWS_REGION!,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
    })
  }
  return _s3
}

const BUCKET = () => process.env.AWS_S3_BUCKET!

function s3Url(key: string): string {
  return `https://${BUCKET()}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`
}

function s3Key(url: string): string {
  return url.replace(`https://${BUCKET()}.s3.${process.env.AWS_REGION}.amazonaws.com/`, '')
}

async function getPresignedUploadUrl(key: string, contentType: string): Promise<UploadTarget> {
  const cmd = new PutObjectCommand({ Bucket: BUCKET(), Key: key, ContentType: contentType })
  const url = await getSignedUrl(client(), cmd, { expiresIn: 3600 })
  // S3 needs no extra headers beyond the Content-Type the client already sends.
  return { url, headers: {} }
}

async function getPresignedDownloadUrl(key: string, expiresIn = 6 * 3600): Promise<string> {
  const cmd = new GetObjectCommand({ Bucket: BUCKET(), Key: key })
  return getSignedUrl(client(), cmd, { expiresIn })
}

async function downloadFromS3(key: string, localPath: string): Promise<void> {
  const res = await client().send(new GetObjectCommand({ Bucket: BUCKET(), Key: key }))
  const chunks: Uint8Array[] = []
  for await (const chunk of res.Body as AsyncIterable<Uint8Array>) chunks.push(chunk)
  const { writeFile } = await import('fs/promises')
  await writeFile(localPath, Buffer.concat(chunks))
}

// Download the video to a stable local path once and reuse it across steps.
// Streams to a temp file + atomic rename so parallel steps can't collide.
async function ensureLocalVideo(videoId: string, key: string): Promise<string> {
  const finalPath = join(tmpdir(), `wf-video-${videoId}`)
  if (existsSync(finalPath)) return finalPath

  const tmpPath = `${finalPath}.${process.pid}.${Date.now()}.part`
  const res = await client().send(new GetObjectCommand({ Bucket: BUCKET(), Key: key }))
  await pipeline(res.Body as Readable, createWriteStream(tmpPath))
  if (!existsSync(finalPath)) {
    try {
      await rename(tmpPath, finalPath)
      return finalPath
    } catch { /* another worker won the race */ }
  }
  await unlink(tmpPath).catch(() => {})
  return finalPath
}

async function uploadToS3(localPath: string, key: string, contentType: string): Promise<string> {
  const { readFile } = await import('fs/promises')
  const body = await readFile(localPath)
  await client().send(new PutObjectCommand({ Bucket: BUCKET(), Key: key, Body: body, ContentType: contentType }))
  return s3Url(key)
}

// Delete a single object. No-op if it doesn't exist (S3 delete is idempotent).
async function deleteFromS3(key: string): Promise<void> {
  await client().send(new DeleteObjectCommand({ Bucket: BUCKET(), Key: key }))
}

// Delete every object under a prefix, paging + batch-deleting up to 1000 keys.
async function deleteS3Prefix(prefix: string): Promise<void> {
  let ContinuationToken: string | undefined
  do {
    const list = await client().send(
      new ListObjectsV2Command({ Bucket: BUCKET(), Prefix: prefix, ContinuationToken }),
    )
    const objects = (list.Contents ?? []).map((o) => ({ Key: o.Key! }))
    if (objects.length > 0) {
      await client().send(new DeleteObjectsCommand({ Bucket: BUCKET(), Delete: { Objects: objects } }))
    }
    ContinuationToken = list.IsTruncated ? list.NextContinuationToken : undefined
  } while (ContinuationToken)
}

async function exists(key: string): Promise<boolean> {
  try {
    await client().send(new HeadObjectCommand({ Bucket: BUCKET(), Key: key }))
    return true
  } catch (err) {
    const e = err as { name?: string; $metadata?: { httpStatusCode?: number } }
    if (e.$metadata?.httpStatusCode === 404 || e.name === 'NotFound' || e.name === 'NoSuchKey') {
      return false
    }
    throw err
  }
}

export const s3Backend: StorageBackend = {
  s3Url,
  s3Key,
  exists,
  getPresignedUploadUrl,
  getPresignedDownloadUrl,
  downloadFromS3,
  ensureLocalVideo,
  uploadToS3,
  deleteFromS3,
  deleteS3Prefix,
}
