// Shared shape both storage backends (S3, Azure) implement, so the facade in
// ../s3.ts can swap them without callers noticing.
export type UploadTarget = {
  // The URL the client PUTs the file bytes to.
  url: string
  // Extra headers the client MUST send on that PUT (e.g. Azure needs
  // `x-ms-blob-type: BlockBlob`). Empty for S3.
  headers: Record<string, string>
}

export interface StorageBackend {
  // Public URL persisted as Video.blobUrl (not presigned).
  s3Url(key: string): string
  // Inverse of s3Url — extract the object key from a stored blobUrl.
  s3Key(url: string): string
  // True when the object is present. Used to validate an ingest request.
  // `container` reads from a non-default container/bucket (e.g. a tenant's).
  exists(key: string, container?: string): Promise<boolean>
  getPresignedUploadUrl(key: string, contentType: string): Promise<UploadTarget>
  getPresignedDownloadUrl(key: string, expiresIn?: number, container?: string): Promise<string>
  downloadFromS3(key: string, localPath: string, container?: string): Promise<void>
  ensureLocalVideo(videoId: string, key: string): Promise<string>
  uploadToS3(localPath: string, key: string, contentType: string): Promise<string>
  deleteFromS3(key: string): Promise<void>
  deleteS3Prefix(prefix: string): Promise<void>
}
