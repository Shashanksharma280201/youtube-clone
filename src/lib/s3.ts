import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

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

export async function downloadFromS3(key: string, localPath: string) {
  const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: key })
  const res = await s3.send(cmd)
  const chunks: Uint8Array[] = []
  for await (const chunk of res.Body as AsyncIterable<Uint8Array>) chunks.push(chunk)
  const { writeFile } = await import('fs/promises')
  await writeFile(localPath, Buffer.concat(chunks))
}

export async function uploadToS3(localPath: string, key: string, contentType: string) {
  const { readFile } = await import('fs/promises')
  const body = await readFile(localPath)
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: contentType }))
  return s3Url(key)
}
