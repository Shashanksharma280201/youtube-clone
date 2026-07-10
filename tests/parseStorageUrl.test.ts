import { describe, it, expect, beforeEach } from 'vitest'
import { parseStorageUrl } from '@/lib/storage/parseUrl'

describe('parseStorageUrl (azure backend)', () => {
  beforeEach(() => {
    process.env.AZURE_STORAGE_ACCOUNT = 'stdatadevcentralindia'
    process.env.AZURE_STORAGE_KEY = 'k'
    process.env.AZURE_STORAGE_CONTAINER = 'videosvc'
    delete process.env.AZURE_STORAGE_ENDPOINT
  })

  it('splits container and key from a tenant-container URL', () => {
    const out = parseStorageUrl(
      'https://stdatadevcentralindia.blob.core.windows.net/bpl-x/machine/pump.mp4',
    )
    expect(out).toEqual({ container: 'bpl-x', key: 'machine/pump.mp4' })
  })

  it('rejects a URL pointing at a different account', () => {
    expect(() =>
      parseStorageUrl('https://someoneelse.blob.core.windows.net/c/x.mp4'),
    ).toThrow('foreign-host')
  })

  it('rejects a URL with no container segment', () => {
    expect(() =>
      parseStorageUrl('https://stdatadevcentralindia.blob.core.windows.net/'),
    ).toThrow('bad-url')
  })

  it('honours AZURE_STORAGE_ENDPOINT for a local emulator host', () => {
    process.env.AZURE_STORAGE_ENDPOINT = 'http://azurite:10000/devstoreaccount1'
    const out = parseStorageUrl('http://azurite:10000/devstoreaccount1/videosvc/a.mp4')
    expect(out).toEqual({ container: 'videosvc', key: 'a.mp4' })
  })
})

describe('parseStorageUrl (s3 backend)', () => {
  beforeEach(() => {
    delete process.env.AZURE_STORAGE_ACCOUNT
    delete process.env.AZURE_STORAGE_KEY
    delete process.env.AZURE_STORAGE_CONTAINER
    process.env.AWS_S3_BUCKET = 'video-testing'
    process.env.AWS_REGION = 'ap-south-1'
  })

  it('reads container(bucket) and key from a virtual-hosted S3 URL', () => {
    const out = parseStorageUrl(
      'https://video-testing.s3.ap-south-1.amazonaws.com/videos/a.mp4',
    )
    expect(out).toEqual({ container: 'video-testing', key: 'videos/a.mp4' })
  })

  it('rejects a foreign S3 bucket host', () => {
    expect(() =>
      parseStorageUrl('https://other-bucket.s3.ap-south-1.amazonaws.com/x.mp4'),
    ).toThrow('foreign-host')
  })
})
