import Link from 'next/link'
import { timeAgo, formatViews } from '@/lib/utils'

interface VideoCardProps {
  id: string
  title: string
  blobUrl: string
  thumbnailUrl?: string | null
  views: number
  createdAt: Date | string
  user: { name: string }
}

export default function VideoCard({ id, title, thumbnailUrl, views, createdAt, user }: VideoCardProps) {
  return (
    <Link href={`/watch/${id}`} className="group block">
      {/* Thumbnail */}
      <div className="relative w-full aspect-video rounded-xl overflow-hidden mb-3 bg-yt-hover shadow-card group-hover:shadow-card-hover transition-all duration-300">
        {thumbnailUrl ? (
          <>
            {/* Real thumbnail from first chapter */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={thumbnailUrl}
              alt={title}
              className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-300"
            />
            {/* Dark gradient + play on hover */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300">
              <div className="w-12 h-12 rounded-full bg-white/90 flex items-center justify-center shadow-lg">
                <svg viewBox="0 0 24 24" fill="#7c3aed" className="w-5 h-5 ml-0.5">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </div>
            </div>
          </>
        ) : (
          /* Placeholder when no thumbnail yet */
          <div className="absolute inset-0 bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center">
            <div className="w-12 h-12 rounded-full bg-white shadow-card flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
              <svg viewBox="0 0 24 24" fill="#7c3aed" className="w-5 h-5 ml-0.5">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
          </div>
        )}
      </div>

      {/* Info row */}
      <div className="flex gap-3">
        {/* Avatar */}
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-nb-violet to-nb-indigo flex-shrink-0 flex items-center justify-center text-white font-semibold text-sm shadow-sm">
          {user.name[0]?.toUpperCase()}
        </div>

        <div className="flex-1 min-w-0">
          <h3 className="text-yt-text font-semibold text-sm leading-snug line-clamp-2 mb-1 group-hover:text-nb-violet transition-colors">
            {title}
          </h3>
          <p className="text-yt-muted text-xs font-medium">{user.name}</p>
          <p className="text-yt-muted text-xs mt-0.5">
            {formatViews(views)} views
            <span className="mx-1 opacity-50">·</span>
            {timeAgo(createdAt)}
          </p>
        </div>
      </div>
    </Link>
  )
}
