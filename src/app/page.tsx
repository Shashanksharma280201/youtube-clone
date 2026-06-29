import { unstable_cache } from 'next/cache'
import { prisma } from '@/lib/prisma'
import VideoGrid from '@/components/VideoGrid'

const LIMIT = 12

const SELECT = {
  id: true,
  title: true,
  blobUrl: true,
  views: true,
  createdAt: true,
  thumbnailUrl: true,
  user: { select: { name: true } },
} as const

const getVideos = unstable_cache(
  async (q?: string) => {
    // Select ONLY the columns the grid needs. Pulling transcript/transcriptSegments/
    // topicSegments here produced a 2MB+ payload that blew past unstable_cache's 2MB
    // limit (so it never cached) and took ~10s per home-page load. thumbnailUrl is now
    // a denormalized column set by the transcription workflow.
    const raw = await prisma.video.findMany({
      where: q ? { title: { contains: q, mode: 'insensitive' } } : undefined,
      orderBy: { createdAt: 'desc' },
      select: SELECT,
      take: LIMIT + 1,
    })
    const hasMore = raw.length > LIMIT
    const items = hasMore ? raw.slice(0, LIMIT) : raw
    return { items, nextCursor: hasMore ? items[items.length - 1].id : null }
  },
  ['videos'],
  { revalidate: 60, tags: ['videos'] },
)

export default async function HomePage({ searchParams }: { searchParams: { q?: string } }) {
  const q = searchParams.q?.trim()
  const { items: initialItems, nextCursor: initialCursor } = await getVideos(q)

  return (
    <div className="px-4 py-6 max-w-[1800px] mx-auto">
      {q ? (
        <p className="text-muted-foreground text-sm mb-6">
          <span className="text-foreground font-semibold">{initialItems.length}</span>{' '}
          result{initialItems.length !== 1 ? 's' : ''} for &ldquo;
          <span className="text-foreground font-semibold">{q}</span>&rdquo;
        </p>
      ) : (
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-foreground">
            Explore <span className="text-primary">Videos</span>
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            AI-powered transcription, tagging &amp; chapter detection
          </p>
        </div>
      )}
      <VideoGrid initialItems={initialItems} initialCursor={initialCursor} />
    </div>
  )
}
