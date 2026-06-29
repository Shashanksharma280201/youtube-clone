'use client'
import { useEffect, useRef, useState, useCallback } from 'react'
import VideoCard from './VideoCard'
import { Skeleton } from '@/components/ui/skeleton'

type V = { id:string; title:string; blobUrl:string; thumbnailUrl?:string|null; views:number; createdAt:string|Date; user:{name:string} }

export default function VideoGrid({ initialItems, initialCursor }: { initialItems: V[]; initialCursor: string|null }) {
  const [items, setItems] = useState<V[]>(initialItems)
  const [cursor, setCursor] = useState<string|null>(initialCursor)
  const [loading, setLoading] = useState(false)
  const sentinel = useRef<HTMLDivElement>(null)

  const loadMore = useCallback(async () => {
    if (loading || !cursor) return
    setLoading(true)
    const res = await fetch(`/api/videos?cursor=${cursor}&limit=12`)
    const data = await res.json()
    setItems((prev) => [...prev, ...data.items])
    setCursor(data.nextCursor)
    setLoading(false)
  }, [cursor, loading])

  useEffect(() => {
    const el = sentinel.current
    if (!el) return
    const io = new IntersectionObserver((e) => { if (e[0].isIntersecting) loadMore() }, { rootMargin: '600px' })
    io.observe(el)
    return () => io.disconnect()
  }, [loadMore])

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-40 text-center">
        <div className="w-20 h-20 rounded-2xl bg-yt-hover border border-yt-border flex items-center justify-center mb-5">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" className="w-10 h-10 text-slate-400">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
          </svg>
        </div>
        <h2 className="text-foreground text-xl font-semibold mb-2">No videos yet</h2>
        <p className="text-muted-foreground text-sm max-w-xs">Be the first to upload — NebulaIQ will transcribe, tag, and create chapters automatically.</p>
      </div>
    )
  }

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-5 gap-y-8">
        {items.map((v) => <VideoCard key={v.id} {...v} />)}
        {loading && Array.from({length:4}).map((_,i)=>(
          <div key={`s${i}`}><Skeleton className="aspect-video rounded-lg" /><Skeleton className="h-4 w-3/4 mt-3" /></div>
        ))}
      </div>
      {cursor && <div ref={sentinel} className="h-10" />}
    </>
  )
}
