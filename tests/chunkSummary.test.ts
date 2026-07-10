import { describe, it, expect } from 'vitest'
import { parseChunkSummaries } from '@/lib/pipeline/chunkSummary'

describe('parseChunkSummaries', () => {
  it('reads summary + tools per chunk by index', () => {
    const raw = JSON.stringify({
      chunks: [
        { i: 0, summary: 'Loosen the cap nut.', tools: ['14mm spanner'] },
        { i: 1, summary: 'Check oil level.', tools: [] },
      ],
    })
    expect(parseChunkSummaries(raw, 2)).toEqual([
      { summarizedText: 'Loosen the cap nut.', tools: ['14mm spanner'] },
      { summarizedText: 'Check oil level.', tools: [] },
    ])
  })

  it('falls back to empty values on malformed output', () => {
    expect(parseChunkSummaries('not json', 2)).toEqual([
      { summarizedText: '', tools: [] },
      { summarizedText: '', tools: [] },
    ])
  })

  it('fills gaps for chunks the model omitted', () => {
    const raw = JSON.stringify({ chunks: [{ i: 0, summary: 'A', tools: ['x'] }] })
    expect(parseChunkSummaries(raw, 2)).toEqual([
      { summarizedText: 'A', tools: ['x'] },
      { summarizedText: '', tools: [] },
    ])
  })
})
