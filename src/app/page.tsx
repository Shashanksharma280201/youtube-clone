import { prisma } from '@/lib/prisma'
import VideoGrid from '@/components/VideoGrid'

export const dynamic = 'force-dynamic'

async function getVideos() {
  return prisma.video.findMany({
    orderBy: { createdAt: 'desc' },
    include: { user: { select: { name: true } } },
  })
}

export default async function HomePage() {
  const videos = await getVideos()

  return (
    <div className="px-4 py-6 max-w-[1800px] mx-auto">
      <VideoGrid videos={videos} />
    </div>
  )
}
