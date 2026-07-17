import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the DB and S3 signing so the real route + response builder run without
// network access. buildExtractionResponse's default signer calls getPresignedDownloadUrl.
const findUnique = vi.fn()
vi.mock('@/lib/prisma', () => ({ prisma: { video: { findUnique: (...a: unknown[]) => findUnique(...a) } } }))
vi.mock('@/lib/s3', () => ({
  s3Key: (u: string) => u,
  getPresignedDownloadUrl: async (u: string) => `${u}?sig=1`,
}))

import { GET } from '@/app/api/v1/response-status/route'

const req = (url: string) => new Request(url)

describe('GET /response-status', () => {
  beforeEach(() => findUnique.mockReset())

  it('400 when resourceId is missing', async () => {
    const res = await GET(req('http://x/api/v1/response-status'))
    expect(res.status).toBe(400)
  })

  it('404 when the resourceId is unknown', async () => {
    findUnique.mockResolvedValue(null)
    const res = await GET(req('http://x/api/v1/response-status?resourceId=nope'))
    expect(res.status).toBe(404)
    expect((await res.json()).status).toBe('NOT_FOUND')
  })

  it('200 with PROCESSING and a poll hint while running', async () => {
    findUnique.mockResolvedValue({ id: 'v1', externalId: 'r-1', machineId: 'm', tenantId: 't', transcriptStatus: 'PROCESSING' })
    const res = await GET(req('http://x/api/v1/response-status?resourceId=r-1'))
    expect(res.status).toBe(200)
    const b = await res.json()
    expect(b.status).toBe('PROCESSING')
    expect(b.pollAfterMs).toBe(5000)
    expect(b.chunks).toBeUndefined()
  })

  it('200 with FAILED so the poll loop can stop', async () => {
    findUnique.mockResolvedValue({ id: 'v1', externalId: 'r-1', machineId: 'm', tenantId: 't', transcriptStatus: 'FAILED' })
    const res = await GET(req('http://x/api/v1/response-status?resourceId=r-1'))
    expect(res.status).toBe(200)
    expect((await res.json()).status).toBe('FAILED')
  })

  it('200 with the full result inline when DONE', async () => {
    findUnique.mockResolvedValue({
      id: 'v1', externalId: 'r-1', machineId: 'm', tenantId: 't',
      title: 'krc.mp4', description: '', createdAt: new Date('2026-07-06T00:00:00Z'),
      blobUrl: 'https://acct.blob.core.windows.net/videosvc/videos/krc.mp4',
      transcriptStatus: 'DONE', thumbnailUrl: 'https://acct.blob.core.windows.net/videosvc/thumb/v1.jpg',
      transcriptSegments: [{ start: 1, end: 2, text: 'hi', mainTag: 'intro', subTag: 'x' }],
      topicSegments: [{ mainTag: 'intro', subTag: 'x', start: 1, end: 2, thumbnailPath: null, summarizedText: 's', tools: [] }],
      domainData: {
        machine: 'Lube System', summary: 'sum', overview: 'ov', machineIntro: [],
        troubleshooting: [{ code: '', title: 'Low flow', symptom: 'hot', story: 'st', fix: [], verify: '', ifNotResolved: '', tools: [], difficulty: '', time: '', start: null }],
      },
    })
    const res = await GET(req('http://x/api/v1/response-status?resourceId=r-1'))
    expect(res.status).toBe(200)
    const b = await res.json()
    expect(b.status).toBe('DONE')
    expect(b.chunks).toHaveLength(1)
    expect(b.transcript).toHaveLength(1)
    expect(b.guide.machine).toBe('Lube System')
    expect(b.guide.troubleshooting).toHaveLength(1)
    expect(b.thumbnailUrl).toBe('https://acct.blob.core.windows.net/videosvc/thumb/v1.jpg?sig=1')
  })
})
