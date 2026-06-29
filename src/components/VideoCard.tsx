import Link from 'next/link'
import Image from 'next/image'
import { timeAgo, formatViews } from '@/lib/utils'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'

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
      {/* Thumbnail — rounded, borderless, no shadow. Subtle hover only. */}
      <div className="relative aspect-video rounded-xl overflow-hidden bg-muted">
        {thumbnailUrl ? (
          <Image
            src={thumbnailUrl}
            alt={title}
            fill
            sizes="(max-width:768px) 100vw, 25vw"
            className="object-cover transition-opacity duration-200 group-hover:opacity-90"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <svg viewBox="0 0 24 24" className="w-10 h-10 text-muted-foreground" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        )}
      </div>

      {/* Info row — sits on the page, no card chrome */}
      <div className="flex gap-3 mt-3">
        <Avatar className="w-9 h-9 flex-shrink-0">
          <AvatarFallback className="bg-secondary text-secondary-foreground text-sm font-semibold">
            {user.name[0]?.toUpperCase()}
          </AvatarFallback>
        </Avatar>

        <div className="flex-1 min-w-0">
          <h3 className="text-foreground font-medium text-sm leading-snug line-clamp-2">
            {title}
          </h3>
          <p className="text-muted-foreground text-xs mt-1">{user.name}</p>
          <p className="text-muted-foreground text-xs">
            {formatViews(views)} views
            <span className="mx-1 opacity-50">·</span>
            {timeAgo(createdAt)}
          </p>
        </div>
      </div>
    </Link>
  )
}
