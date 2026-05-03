import { notFound } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import WatchLayout from '@/components/WatchLayout'

export const dynamic = 'force-dynamic'

export default async function WatchPage({ params }: { params: { id: string } }) {
  // Parallel: fetch video (read-only) + session
  const [rawVideo, session] = await Promise.all([
    prisma.video.findUnique({
      where: { id: params.id },
      include: {
        user: { select: { id: true, name: true } },
        _count: { select: { likes: true, comments: true } },
      },
    }),
    getServerSession(authOptions),
  ])

  if (!rawVideo) notFound()

  // Check like only if user is signed in (sequential — needs session.user.id)
  let userLiked = false
  if (session?.user?.id) {
    const like = await prisma.like.findUnique({
      where: { userId_videoId: { userId: session.user.id, videoId: params.id } },
    })
    userLiked = !!like
  }

  const video = rawVideo as typeof rawVideo & {
    transcriptStatus: string
    transcript: string | null
    transcriptSegments: unknown
    topicSegments: unknown
  }

  const segments = Array.isArray(video.topicSegments)
    ? (video.topicSegments as { mainTag: string; subTag: string; start: number; end: number; thumbnailPath: string | null }[])
    : []

  return (
    <WatchLayout
      videoId={video.id}
      src={video.blobUrl}
      title={video.title}
      description={video.description}
      userName={video.user.name}
      userInitial={video.user.name[0]?.toUpperCase() ?? '?'}
      views={video.views}
      createdAt={video.createdAt.toISOString()}
      segments={segments}
      initialLiked={userLiked}
      initialLikeCount={video._count.likes}
      transcriptStatus={video.transcriptStatus}
      transcript={video.transcript}
      transcriptSegments={video.transcriptSegments}
    />
  )
}
