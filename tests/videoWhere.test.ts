import { describe, it, expect } from 'vitest'
import { videoWhere } from '@/lib/videoWhere'

describe('videoWhere', () => {
  it('matches either our cuid or the caller externalId', () => {
    expect(videoWhere('ext-123')).toEqual({
      OR: [{ id: 'ext-123' }, { externalId: 'ext-123' }],
    })
  })
})
