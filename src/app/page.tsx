import { unstable_cache } from 'next/cache'
import { prisma } from '@/lib/prisma'
import VideoGrid from '@/components/VideoGrid'

const getVideos = unstable_cache(
  async (q?: string) => {
    const videos = await prisma.video.findMany({
      where: q ? { title: { contains: q, mode: 'insensitive' } } : undefined,
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { name: true } } },
    })

    return videos.map((v) => {
      const segments = Array.isArray(v.topicSegments)
        ? (v.topicSegments as { thumbnailPath?: string | null }[])
        : []
      const thumbnailUrl = segments.find((s) => s.thumbnailPath)?.thumbnailPath ?? null
      return { ...v, thumbnailUrl }
    })
  },
  ['videos'],
  { revalidate: 60, tags: ['videos'] },
)

export default async function HomePage({ searchParams }: { searchParams: { q?: string } }) {
  const q = searchParams.q?.trim()
  const videos = await getVideos(q)

  return (
    <div className="px-4 py-6 max-w-[1800px] mx-auto">
      {q ? (
        <p className="text-yt-muted text-sm mb-6">
          <span className="text-yt-text font-semibold">{videos.length}</span>{' '}
          result{videos.length !== 1 ? 's' : ''} for &ldquo;
          <span className="text-yt-text font-semibold">{q}</span>&rdquo;
        </p>
      ) : (
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-yt-text">
            Explore <span className="gradient-text">Videos</span>
          </h1>
          <p className="text-yt-muted text-sm mt-1">
            AI-powered transcription, tagging &amp; chapter detection
          </p>
        </div>
      )}
      <VideoGrid videos={videos} />
    </div>
  )
}
