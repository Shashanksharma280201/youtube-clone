import VideoCard from './VideoCard'

interface Video {
  id: string
  title: string
  blobUrl: string
  views: number
  createdAt: Date | string
  user: { name: string }
}

interface VideoGridProps {
  videos: Video[]
}

export default function VideoGrid({ videos }: VideoGridProps) {
  if (videos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-32 text-center">
        <div className="w-20 h-20 bg-yt-surface rounded-full flex items-center justify-center mb-4">
          <svg viewBox="0 0 24 24" fill="#aaa" className="w-10 h-10">
            <path d="M17 10.5V7a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h12a1 1 0 001-1v-3.5l4 4v-11l-4 4z" />
          </svg>
        </div>
        <h2 className="text-yt-text text-xl font-medium mb-2">No videos yet</h2>
        <p className="text-yt-muted text-sm">Be the first to upload a video!</p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-8">
      {videos.map((video) => (
        <VideoCard key={video.id} {...video} />
      ))}
    </div>
  )
}
