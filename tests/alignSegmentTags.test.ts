import { describe, it, expect } from 'vitest'
import { alignSegmentTags } from '@/lib/pipeline/alignSegmentTags'

const tx = (start: number, end: number, mainTag: string, subTag = '') =>
  ({ id: start, start, end, text: 't', mainTag, subTag })

const ch = (start: number, end: number, mainTag: string) =>
  ({ mainTag, subTag: '', start, end, thumbnailPath: null })

describe('alignSegmentTags', () => {
  it('gives each transcript segment the phase of the chapter it sits in', () => {
    const out = alignSegmentTags(
      [tx(0, 5, 'other'), tx(5, 9, 'other'), tx(20, 25, 'other')],
      [ch(0, 10, 'electrical check'), ch(10, 30, 'air supply check')],
    )
    expect(out.map((s) => s.mainTag)).toEqual([
      'electrical check',
      'electrical check',
      'air supply check',
    ])
  })

  it('keeps each segment its own subTag', () => {
    const out = alignSegmentTags(
      [tx(0, 5, 'other', 'checking the coil')],
      [ch(0, 10, 'electrical check')],
    )
    expect(out[0].subTag).toBe('checking the coil')
  })

  it('leaves a segment alone when no chapter contains it', () => {
    const out = alignSegmentTags([tx(50, 55, 'diagnosis')], [ch(0, 10, 'introduction')])
    expect(out[0].mainTag).toBe('diagnosis')
  })

  it('returns segments unchanged when there are no chapters', () => {
    const out = alignSegmentTags([tx(0, 5, 'other')], [])
    expect(out[0].mainTag).toBe('other')
  })
})
