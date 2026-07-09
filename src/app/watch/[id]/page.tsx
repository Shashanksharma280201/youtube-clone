import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import WatchLayout from '@/components/WatchLayout'
import { asDomainData } from '@/lib/pipeline/domain-types'

export const dynamic = 'force-dynamic'

export default async function WatchPage({ params }: { params: { id: string } }) {
  const video = await prisma.video.findUnique({ where: { id: params.id } })
  if (!video) notFound()

  const segments = Array.isArray(video.topicSegments)
    ? (video.topicSegments as {
        mainTag: string
        subTag: string
        start: number
        end: number
        thumbnailPath: string | null
      }[])
    : []

  return (
    <WatchLayout
      videoId={video.id}
      src={video.blobUrl}
      title={video.title}
      description={video.description}
      views={video.views}
      createdAt={video.createdAt.toISOString()}
      segments={segments}
      transcriptStatus={video.transcriptStatus}
      transcript={video.transcript}
      transcriptSegments={video.transcriptSegments}
      domainData={asDomainData(video.domainData)}
    />
  )
}
