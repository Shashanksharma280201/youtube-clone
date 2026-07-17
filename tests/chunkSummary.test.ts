import { describe, it, expect } from 'vitest'
import { parseChunkSummaries } from '@/lib/pipeline/chunkSummary'

describe('parseChunkSummaries', () => {
  it('reads title + summary + tools per chunk by index', () => {
    const raw = JSON.stringify({
      chunks: [
        { i: 0, title: 'Loosen cap nut', summary: 'Loosen the cap nut.', tools: ['14mm spanner'] },
        { i: 1, title: 'Check oil level', summary: 'Check oil level.', tools: [] },
      ],
    })
    expect(parseChunkSummaries(raw, 2)).toEqual([
      { title: 'Loosen cap nut', summarizedText: 'Loosen the cap nut.', tools: ['14mm spanner'] },
      { title: 'Check oil level', summarizedText: 'Check oil level.', tools: [] },
    ])
  })

  it('falls back to empty values on malformed output', () => {
    expect(parseChunkSummaries('not json', 2)).toEqual([
      { title: '', summarizedText: '', tools: [] },
      { title: '', summarizedText: '', tools: [] },
    ])
  })

  it('fills gaps for chunks the model omitted', () => {
    const raw = JSON.stringify({ chunks: [{ i: 0, title: 'Step A', summary: 'A', tools: ['x'] }] })
    expect(parseChunkSummaries(raw, 2)).toEqual([
      { title: 'Step A', summarizedText: 'A', tools: ['x'] },
      { title: '', summarizedText: '', tools: [] },
    ])
  })

  it('defaults title to empty when the model omits it', () => {
    const raw = JSON.stringify({ chunks: [{ i: 0, summary: 'no title here', tools: [] }] })
    expect(parseChunkSummaries(raw, 1)).toEqual([
      { title: '', summarizedText: 'no title here', tools: [] },
    ])
  })
})
