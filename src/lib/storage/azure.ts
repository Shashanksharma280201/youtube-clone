// Azure Blob Storage backend. Selected by the facade when AZURE_STORAGE_ACCOUNT
// / AZURE_STORAGE_KEY / AZURE_STORAGE_CONTAINER are set. Clients are created
// lazily so this module imports cleanly in an S3-only deployment.
import {
  BlobServiceClient,
  StorageSharedKeyCredential,
  ContainerClient,
  BlockBlobClient,
  generateBlobSASQueryParameters,
  BlobSASPermissions,
  SASProtocol,
} from '@azure/storage-blob'
import { existsSync } from 'fs'
import { rename, unlink } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import type { StorageBackend, UploadTarget } from './types'

const ACCOUNT = () => process.env.AZURE_STORAGE_ACCOUNT!
const CONTAINER = () => process.env.AZURE_STORAGE_CONTAINER!
// Overridable for sovereign clouds / Azurite; defaults to the public endpoint.
const ENDPOINT = () =>
  process.env.AZURE_STORAGE_ENDPOINT || `https://${ACCOUNT()}.blob.core.windows.net`

let _cred: StorageSharedKeyCredential | null = null
function cred(): StorageSharedKeyCredential {
  if (!_cred) _cred = new StorageSharedKeyCredential(ACCOUNT(), process.env.AZURE_STORAGE_KEY!)
  return _cred
}

let _container: ContainerClient | null = null
function container(): ContainerClient {
  if (!_container) {
    const service = new BlobServiceClient(ENDPOINT(), cred())
    _container = service.getContainerClient(CONTAINER())
  }
  return _container
}

function blob(key: string): BlockBlobClient {
  return container().getBlockBlobClient(key)
}

function s3Url(key: string): string {
  return `${ENDPOINT()}/${CONTAINER()}/${key}`
}

function s3Key(url: string): string {
  return url.replace(`${ENDPOINT()}/${CONTAINER()}/`, '')
}

// Build a time-limited SAS URL for a single blob with the given permissions.
function sasUrl(key: string, perms: string, expiresIn: number): string {
  const now = Date.now()
  const sas = generateBlobSASQueryParameters(
    {
      containerName: CONTAINER(),
      blobName: key,
      permissions: BlobSASPermissions.parse(perms),
      // small backdate absorbs clock skew between us and Azure
      startsOn: new Date(now - 5 * 60 * 1000),
      expiresOn: new Date(now + expiresIn * 1000),
      protocol: SASProtocol.Https,
    },
    cred(),
  ).toString()
  return `${s3Url(key)}?${sas}`
}

async function getPresignedUploadUrl(key: string, _contentType: string): Promise<UploadTarget> {
  // 'c' create + 'w' write lets the client PUT the whole blob in one shot.
  const url = sasUrl(key, 'cw', 3600)
  // Azure requires this header on a single-PUT block-blob upload.
  return { url, headers: { 'x-ms-blob-type': 'BlockBlob' } }
}

async function getPresignedDownloadUrl(key: string, expiresIn = 6 * 3600): Promise<string> {
  return sasUrl(key, 'r', expiresIn)
}

async function downloadFromS3(key: string, localPath: string): Promise<void> {
  await blob(key).downloadToFile(localPath)
}

// Download the video to a stable local path once and reuse it across steps.
// Streams to a temp file + atomic rename so parallel steps can't collide.
async function ensureLocalVideo(videoId: string, key: string): Promise<string> {
  const finalPath = join(tmpdir(), `wf-video-${videoId}`)
  if (existsSync(finalPath)) return finalPath

  const tmpPath = `${finalPath}.${process.pid}.${Date.now()}.part`
  await blob(key).downloadToFile(tmpPath)
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
  await blob(key).uploadFile(localPath, { blobHTTPHeaders: { blobContentType: contentType } })
  return s3Url(key)
}

// Delete a single blob. No-op if it doesn't exist.
async function deleteFromS3(key: string): Promise<void> {
  await blob(key).deleteIfExists()
}

// Delete every blob under a prefix (e.g. `audio/<videoId>/`).
async function deleteS3Prefix(prefix: string): Promise<void> {
  for await (const item of container().listBlobsFlat({ prefix })) {
    await container().getBlockBlobClient(item.name).deleteIfExists()
  }
}

async function exists(key: string): Promise<boolean> {
  return blob(key).exists()
}

export const azureBackend: StorageBackend = {
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
