import { prisma } from '@/lib/prisma'
import VideoGrid from '@/components/VideoGrid'

export const dynamic = 'force-dynamic'  // do not cache the page as multiple users would see the same cached data on this page

async function getVideos() {
  return prisma.video.findMany({
    orderBy: { createdAt: 'desc' },  // fetch all the videos and desc from large to small 
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
