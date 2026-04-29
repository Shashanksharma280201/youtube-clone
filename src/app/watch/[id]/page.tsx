import { notFound } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { timeAgo, formatViews } from '@/lib/utils'
import LikeButton from '@/components/LikeButton'

export const dynamic = 'force-dynamic'

async function getVideo(id: string) {
  const video = await prisma.video.update({
    where: { id },
    data: { views: { increment: 1 } },
    include: {
      user: { select: { id: true, name: true } },
      _count: { select: { likes: true, comments: true } },
    },
  })
  return video
}

async function getRelatedVideos(excludeId: string) {
  return prisma.video.findMany({
    where: { id: { not: excludeId } },
    orderBy: { createdAt: 'desc' },
    take: 8,
    include: { user: { select: { name: true } } },
  })
}

export default async function WatchPage({ params }: { params: { id: string } }) {
  let video
  try {
    video = await getVideo(params.id)
  } catch {
    notFound()
  }

  const [related, session] = await Promise.all([
    getRelatedVideos(params.id),
    getServerSession(authOptions),
  ])

  let userLiked = false
  if (session) {
    const like = await prisma.like.findUnique({
      where: {
        userId_videoId: { userId: session.user.id, videoId: params.id }
      }
    })
    userLiked = !!like
  }

  return (
    <div className="max-w-[1800px] mx-auto px-4 py-6">
      <div className="flex flex-col lg:flex-row gap-6">
        {/* Left: player + info */}
        <div className="flex-1 min-w-0">
          {/* Video player */}
          <div className="w-full aspect-video bg-black rounded-xl overflow-hidden">
            <video
              src={video.blobUrl}
              controls
              autoPlay={false}
              className="w-full h-full"
            />
          </div>

          {/* Title */}
          <h1 className="text-yt-text text-xl font-bold mt-4 mb-2">{video.title}</h1>

          {/* Stats row */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-yt-border">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-yt-red flex items-center justify-center text-white font-bold">
                {video.user.name[0]?.toUpperCase()}
              </div>
              <div>
                <p className="text-yt-text font-medium text-sm">{video.user.name}</p>
              </div>
            </div>

            <div className="flex items-center gap-4 text-yt-muted text-sm">
              <span>{formatViews(video.views)} views</span>
              <span>{timeAgo(video.createdAt)}</span>
              <LikeButton
                videoId={video.id}
                initialLiked={userLiked}
                initialCount={video._count.likes}
              />
            </div>
          </div>

          {/* Description */}
          {video.description && (
            <div className="mt-4 bg-yt-surface rounded-xl p-4">
              <p className="text-yt-muted text-sm whitespace-pre-wrap">{video.description}</p>
            </div>
          )}
        </div>

        {/* Right: related videos */}
        <div className="lg:w-96 xl:w-[420px] shrink-0">
          <h2 className="text-yt-text font-medium mb-4">More videos</h2>
          {related.length === 0 ? (
            <p className="text-yt-muted text-sm">No other videos yet.</p>
          ) : (
            <div className="flex flex-col gap-4">
              {related.map((v) => (
                <div key={v.id} className="flex gap-3">
                  <a href={`/watch/${v.id}`} className="w-40 aspect-video bg-yt-surface rounded-lg overflow-hidden flex-shrink-0 flex items-center justify-center hover:opacity-80 transition-opacity">
                    <svg viewBox="0 0 24 24" fill="#aaa" className="w-8 h-8">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </a>
                  <div className="flex-1 min-w-0">
                    <a href={`/watch/${v.id}`} className="text-yt-text text-sm font-medium line-clamp-2 hover:text-white">
                      {v.title}
                    </a>
                    <p className="text-yt-muted text-xs mt-1">{v.user.name}</p>
                    <p className="text-yt-muted text-xs">{formatViews(v.views)} views · {timeAgo(v.createdAt)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
