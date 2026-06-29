import Link from 'next/link'
import Image from 'next/image'
import { timeAgo, formatViews } from '@/lib/utils'
import { Card, CardContent } from '@/components/ui/card'
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
    <Link href={`/watch/${id}`} className="block">
      <Card className="border-border bg-card hover:border-primary/40 hover:bg-card/80 transition-colors overflow-hidden">
        {/* Thumbnail */}
        <div className="relative aspect-video rounded-lg overflow-hidden bg-muted">
          {thumbnailUrl ? (
            <Image
              src={thumbnailUrl}
              alt={title}
              fill
              sizes="(max-width:768px) 100vw, 25vw"
              className="object-cover"
            />
          ) : (
            /* Placeholder when no thumbnail yet */
            <div className="absolute inset-0 bg-muted flex items-center justify-center">
              <svg viewBox="0 0 24 24" className="w-10 h-10 text-muted-foreground" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
          )}
        </div>

        <CardContent className="p-3">
          {/* Info row */}
          <div className="flex gap-3">
            {/* Avatar */}
            <Avatar className="w-9 h-9 flex-shrink-0">
              <AvatarFallback className="bg-primary text-primary-foreground text-sm font-semibold">
                {user.name[0]?.toUpperCase()}
              </AvatarFallback>
            </Avatar>

            <div className="flex-1 min-w-0">
              <h3 className="text-foreground font-semibold text-sm leading-snug line-clamp-2 mb-1">
                {title}
              </h3>
              <p className="text-muted-foreground text-xs font-medium">{user.name}</p>
              <p className="text-muted-foreground text-xs mt-0.5">
                {formatViews(views)} views
                <span className="mx-1 opacity-50">·</span>
                {timeAgo(createdAt)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}
