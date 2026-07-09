import { describe, it, expect } from 'vitest'
import { signThumbnails } from '@/lib/signUrls'

const fakeSigner = async (url: string) => `${url}?sig=abc`

describe('signThumbnails', () => {
  it('signs thumbnailUrl and every topicSegments thumbnailPath', async () => {
    const out = await signThumbnails(
      {
        thumbnailUrl: 'https://acct.blob.core.windows.net/c/thumbnails/a.jpg',
        topicSegments: [
          { mainTag: 'intro', thumbnailPath: 'https://acct.blob.core.windows.net/c/thumbnails/b.jpg' },
          { mainTag: 'silent', thumbnailPath: null },
        ],
      },
      fakeSigner,
    )

    expect(out.thumbnailUrl).toBe('https://acct.blob.core.windows.net/c/thumbnails/a.jpg?sig=abc')
    expect(out.topicSegments[0].thumbnailPath).toBe(
      'https://acct.blob.core.windows.net/c/thumbnails/b.jpg?sig=abc',
    )
    expect(out.topicSegments[1].thumbnailPath).toBeNull()
  })

  it('leaves a video without thumbnails untouched', async () => {
    const out = await signThumbnails({ thumbnailUrl: null, topicSegments: null }, fakeSigner)
    expect(out.thumbnailUrl).toBeNull()
    expect(out.topicSegments).toBeNull()
  })
})
