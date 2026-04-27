import Link from 'next/link'
import { timeAgo, formatViews } from '@/lib/utils'

interface VideoCardProps {
  id: string
  title: string
  blobUrl: string
  views: number
  createdAt: Date | string
  user: { name: string }
}

export default function VideoCard({ id, title, views, createdAt, user }: VideoCardProps) {
  return (
    <Link href={`/watch/${id}`} className="group block">
      {/* Thumbnail */}
      <div className="relative w-full aspect-video bg-yt-surface rounded-xl overflow-hidden mb-3 group-hover:rounded-none transition-all duration-200">
        <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-[#1a1a2e] to-[#16213e]">
          <div className="w-14 h-14 rounded-full bg-black/40 flex items-center justify-center group-hover:scale-110 transition-transform">
            <svg viewBox="0 0 24 24" fill="white" className="w-7 h-7 ml-1">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        </div>
      </div>

      {/* Info */}
      <div className="flex gap-3">
        {/* Avatar */}
        <div className="w-9 h-9 rounded-full bg-yt-red flex-shrink-0 flex items-center justify-center text-white font-bold text-sm">
          {user.name[0]?.toUpperCase()}
        </div>

        <div className="flex-1 min-w-0">
          <h3 className="text-yt-text font-medium text-sm leading-5 line-clamp-2 group-hover:text-white mb-1">
            {title}
          </h3>
          <p className="text-yt-muted text-xs">{user.name}</p>
          <p className="text-yt-muted text-xs">
            {formatViews(views)} views · {timeAgo(createdAt)}
          </p>
        </div>
      </div>
    </Link>
  )
}
