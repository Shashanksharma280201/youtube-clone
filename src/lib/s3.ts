// Storage facade. Uses Azure Blob Storage when AZURE_STORAGE_* credentials are
// present, otherwise falls back to AWS S3 (the original backend). Callers import
// the same function names regardless of which backend is active — the "s3" naming
// is kept for backward compatibility and does not imply AWS.
import { s3Backend } from './storage/s3'
import { azureBackend } from './storage/azure'
import type { StorageBackend } from './storage/types'

export type { UploadTarget } from './storage/types'

const USE_AZURE = !!(
  process.env.AZURE_STORAGE_ACCOUNT &&
  process.env.AZURE_STORAGE_KEY &&
  process.env.AZURE_STORAGE_CONTAINER
)

const backend: StorageBackend = USE_AZURE ? azureBackend : s3Backend

export const STORAGE_BACKEND = USE_AZURE ? 'azure' : 's3'

export const s3Url = backend.s3Url
export const s3Key = backend.s3Key
export const getPresignedUploadUrl = backend.getPresignedUploadUrl
export const getPresignedDownloadUrl = backend.getPresignedDownloadUrl
export const downloadFromS3 = backend.downloadFromS3
export const ensureLocalVideo = backend.ensureLocalVideo
export const uploadToS3 = backend.uploadToS3
export const deleteFromS3 = backend.deleteFromS3
export const deleteS3Prefix = backend.deleteS3Prefix
