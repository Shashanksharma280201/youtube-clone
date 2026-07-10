import { describe, it, expect } from 'vitest'
import { buildExtractionResponse } from '@/lib/videoExtractionResponse'

const sign = async (u: string) => `${u}?sig=1`

const baseVideo = {
  id: 'v1',
  externalId: 'r-1',
  machineId: 'm-1',
  tenantId: 't-1',
  title: 'KRC Demo',
  description: 'desc',
  createdAt: new Date('2026-07-06T14:22:10.000Z'),
  blobUrl: 'https://acct.blob.core.windows.net/videosvc/videos/krc.mp4',
  transcriptStatus: 'DONE',
  transcriptSegments: [
    { id: 0, start: 12.4, end: 15, text: 'Alright, today the lube pump.' },
    { id: 1, start: 15, end: 18.9, text: 'It feeds oil to the bearings.' },
    { id: 2, start: 40, end: 44, text: 'Next chapter text.' },
  ],
  topicSegments: [
    { mainTag: 'intro', subTag: 'lube overview', start: 12.4, end: 18.9,
      thumbnailPath: 'https://acct.blob.core.windows.net/videosvc/thumbnails/v1/s0.jpg',
      summarizedText: 'The lube system feeds oil to the bearings.', tools: ['Multimeter'] },
    { mainTag: 'diagnosis', subTag: 'low flow', start: 40, end: 44,
      thumbnailPath: null, summarizedText: 'Check the flow.', tools: [] },
  ],
  domainData: {
    machine: 'Lubrication System', summary: 'Diagnosing low-lube-flow.',
    overview: 'The lube system keeps parts oiled.', machineIntro: [{ title: 'Float switch', detail: 'Detects oil level.' }],
  },
}

describe('buildExtractionResponse', () => {
  it('maps a DONE video into the chunk shape', async () => {
    const r = await buildExtractionResponse(baseVideo as never, sign)
    expect(r.resourceId).toBe('r-1')
    expect(r.machineId).toBe('m-1')
    expect(r.tenantId).toBe('t-1')
    expect(r.status).toBe('DONE')
    expect(r.chunkCount).toBe(2)
    expect(r.chunks).toHaveLength(2)

    const c0 = r.chunks[0]
    expect(c0.chunkId).toBe('v1-0')
    expect(c0.start).toBe(12.4)
    expect(c0.transcript).toBe('Alright, today the lube pump. It feeds oil to the bearings.')
    expect(c0.summarizedText).toBe('The lube system feeds oil to the bearings.')
    expect(c0.tools).toEqual(['Multimeter'])
    expect(c0.thumbnailUrl).toBe(
      'https://acct.blob.core.windows.net/videosvc/thumbnails/v1/s0.jpg?sig=1',
    )
    expect(c0.blobUrl).toBe('https://acct.blob.core.windows.net/videosvc/videos/krc.mp4?sig=1')
    expect(c0.videoSummary).toBe('Diagnosing low-lube-flow.')
    expect(c0.domainMetaData.machine).toBe('Lubrication System')
  })

  it('uses externalId as resourceId, falls back to id', async () => {
    const r = await buildExtractionResponse({ ...baseVideo, externalId: null } as never, sign)
    expect(r.resourceId).toBe('v1')
  })

  it('null thumbnailPath yields null thumbnailUrl (not signed)', async () => {
    const r = await buildExtractionResponse(baseVideo as never, sign)
    expect(r.chunks[1].thumbnailUrl).toBeNull()
  })

  it('empty domainData yields empty domainMetaData, not a throw', async () => {
    const r = await buildExtractionResponse({ ...baseVideo, domainData: null } as never, sign)
    expect(r.chunks[0].domainMetaData).toEqual({ machine: '', summary: '', overview: '', machineIntro: [] })
    expect(r.chunks[0].videoSummary).toBe('')
  })
})
