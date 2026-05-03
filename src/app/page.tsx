import { prisma } from '@/lib/prisma'
import VideoGrid from '@/components/VideoGrid'

export const dynamic = 'force-dynamic'

async function getVideos(q?: string) {
  return prisma.video.findMany({
    where: q ? { title: { contains: q, mode: 'insensitive' } } : undefined,
    orderBy: { createdAt: 'desc' },
    include: { user: { select: { name: true } } },
  })
}

export default async function HomePage({ searchParams }: { searchParams: { q?: string } }) {
  const q = searchParams.q?.trim()
  const videos = await getVideos(q)

  return (
    <div className="px-4 py-6 max-w-[1800px] mx-auto">
      {q && (
        <p className="text-yt-muted text-sm mb-6">
          <span className="text-yt-text font-medium">{videos.length}</span> result{videos.length !== 1 ? 's' : ''} for{' '}
          &ldquo;<span className="text-yt-text font-medium">{q}</span>&rdquo;
        </p>
      )}
      <VideoGrid videos={videos} />
    </div>
  )
}
