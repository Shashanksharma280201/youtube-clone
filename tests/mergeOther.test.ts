import { describe, it, expect } from 'vitest'
import { mergeOrphanOther } from '@/lib/pipeline/mergeOther'

const seg = (start: number, end: number, mainTag: string) =>
  ({ id: start, start, end, text: '', mainTag, subTag: '' })

describe('mergeOrphanOther', () => {
  it('absorbs a short lone other between two same-tag segments', () => {
    const out = mergeOrphanOther([
      seg(0, 10, 'repair'),
      seg(10, 15, 'other'), // 5s orphan
      seg(15, 25, 'repair'),
    ])
    expect(out.map((s) => s.mainTag)).toEqual(['repair', 'repair', 'repair'])
  })

  it('leaves a long other alone', () => {
    const out = mergeOrphanOther([
      seg(0, 10, 'repair'),
      seg(10, 40, 'other'), // 30s, real content
      seg(40, 50, 'repair'),
    ])
    expect(out.map((s) => s.mainTag)).toEqual(['repair', 'other', 'repair'])
  })

  it('leaves an other between differing tags alone', () => {
    const out = mergeOrphanOther([
      seg(0, 10, 'diagnosis'),
      seg(10, 13, 'other'),
      seg(15, 25, 'repair'),
    ])
    expect(out.map((s) => s.mainTag)).toEqual(['diagnosis', 'other', 'repair'])
  })
})
