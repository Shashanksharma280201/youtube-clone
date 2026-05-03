'use client'

import { useRef, useState, useEffect, useMemo, useCallback } from 'react'
import { tagColor, tagSolidBg } from '@/lib/tagColor'
import LikeButton from '@/components/LikeButton'
import WatchTranscript from '@/components/WatchTranscript'
import { timeAgo, formatViews } from '@/lib/utils'

type VideoSegment = {
  mainTag: string
  subTag: string
  start: number
  end: number
  thumbnailPath: string | null
}

interface WatchLayoutProps {
  videoId: string
  src: string
  title: string
  description: string | null
  userName: string
  userInitial: string
  views: number
  createdAt: string
  segments: VideoSegment[]
  initialLiked: boolean
  initialLikeCount: number
  transcriptStatus: string
  transcript: string | null
  transcriptSegments: unknown
}

function fmt(s: number) {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

function cap(s: string) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s
}

// ── Chapter card with lazy-load image + animated skeleton ──────────────────
function ChapterCard({
  seg,
  isActive,
  onSeek,
  cardRef,
}: {
  seg: VideoSegment & { idx: number }
  isActive: boolean
  onSeek: (t: number) => void
  cardRef: (el: HTMLButtonElement | null) => void
}) {
  const [loaded, setLoaded] = useState(false)
  const [imgError, setImgError] = useState(false)
  const hasThumb = !!seg.thumbnailPath && !imgError

  return (
    <button
      ref={cardRef}
      onClick={() => onSeek(seg.start)}
      className={`w-full text-left rounded-xl overflow-hidden border transition-all duration-200 group active:scale-[0.98] ${
        isActive
          ? 'border-yt-red ring-1 ring-yt-red/40 shadow-[0_0_20px_rgba(255,0,0,0.15)]'
          : 'border-yt-border bg-yt-surface hover:border-yt-hover hover:shadow-lg'
      }`}
    >
      {/* ── Thumbnail ── */}
      <div className="relative aspect-video bg-yt-dark overflow-hidden">

        {/* Skeleton — fades away once image is ready */}
        <div
          className={`absolute inset-0 bg-yt-surface transition-opacity duration-300 ${
            loaded ? 'opacity-0 pointer-events-none' : 'animate-pulse'
          }`}
        />

        {/* Lazy image */}
        {hasThumb && (
          <img
            src={seg.thumbnailPath!}
            alt={seg.subTag || seg.mainTag}
            loading="lazy"
            decoding="async"
            onLoad={() => setLoaded(true)}
            onError={() => setImgError(true)}
            className={`w-full h-full object-cover transition-all duration-300 group-hover:scale-[1.04] ${
              loaded ? 'opacity-100' : 'opacity-0'
            }`}
          />
        )}

        {/* No-thumbnail fallback */}
        {!hasThumb && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className={`w-9 h-9 rounded-full ${tagSolidBg(seg.mainTag)} opacity-20`} />
            <svg viewBox="0 0 24 24" fill="currentColor" className="absolute w-5 h-5 text-yt-muted opacity-50">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        )}

        {/* mainTag pill — overlaid bottom-left of thumbnail */}
        <span
          className={`absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded text-[10px] font-semibold border backdrop-blur-sm z-10 ${tagColor(seg.mainTag)}`}
        >
          {cap(seg.mainTag)}
        </span>

        {/* Timestamp badge */}
        <span className="absolute bottom-1.5 right-1.5 bg-black/80 text-white text-[10px] font-mono px-1.5 py-0.5 rounded z-10">
          {fmt(seg.start)}
        </span>

        {/* Active overlay — playing indicator */}
        {isActive && (
          <div className="absolute inset-0 bg-yt-red/10 flex items-center justify-center">
            <div className="w-8 h-8 rounded-full bg-yt-red/90 flex items-center justify-center shadow-lg">
              <svg viewBox="0 0 24 24" fill="white" className="w-4 h-4 ml-0.5">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
          </div>
        )}
      </div>

      {/* ── Title under thumbnail ── */}
      <div className={`px-2.5 py-2 ${isActive ? 'bg-yt-red/5' : ''}`}>
        <p className={`text-xs font-medium leading-snug line-clamp-2 ${
          isActive ? 'text-yt-red' : 'text-yt-text'
        }`}>
          {seg.subTag || cap(seg.mainTag)}
        </p>
      </div>
    </button>
  )
}

// ── Main watch layout ───────────────────────────────────────────────────────
export default function WatchLayout({
  videoId,
  src,
  title,
  description,
  userName,
  userInitial,
  views,
  createdAt,
  segments,
  initialLiked,
  initialLikeCount,
  transcriptStatus,
  transcript,
  transcriptSegments,
}: WatchLayoutProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const cardRefs = useRef<(HTMLButtonElement | null)[]>([])
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [hoveredTimelineIdx, setHoveredTimelineIdx] = useState<number | null>(null)
  const [activeMainTag, setActiveMainTag] = useState<string | null>(null)

  // Fire-and-forget view increment — not in the render critical path
  useEffect(() => {
    fetch(`/api/videos/${videoId}/view`, { method: 'PATCH' }).catch(() => {})
  }, [videoId])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const onTime = () => setCurrentTime(video.currentTime)
    const onMeta = () => setDuration(video.duration)
    video.addEventListener('timeupdate', onTime)
    video.addEventListener('loadedmetadata', onMeta)
    return () => {
      video.removeEventListener('timeupdate', onTime)
      video.removeEventListener('loadedmetadata', onMeta)
    }
  }, [])

  const activeIdx = useMemo(() => {
    let idx = -1
    for (let i = 0; i < segments.length; i++) {
      if (currentTime >= segments[i].start) idx = i
      else break
    }
    return idx
  }, [currentTime, segments])

  // Auto-scroll active chapter into view in the sidebar
  useEffect(() => {
    if (activeIdx >= 0 && !activeMainTag) {
      cardRefs.current[activeIdx]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [activeIdx, activeMainTag])

  const seekTo = useCallback((t: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = t
      videoRef.current.play()
    }
  }, [])

  const total = duration || (segments.length > 0 ? segments[segments.length - 1].end : 0)

  const mainTags = useMemo(() => {
    const seen = new Set<string>()
    const result: string[] = []
    for (const seg of segments) {
      if (!seen.has(seg.mainTag)) { seen.add(seg.mainTag); result.push(seg.mainTag) }
    }
    return result
  }, [segments])

  const visibleSegments = useMemo(
    () => segments.map((s, i) => ({ ...s, idx: i })).filter(s => !activeMainTag || s.mainTag === activeMainTag),
    [segments, activeMainTag],
  )

  const hasChapters = segments.length > 0
  const activeSegment = activeIdx >= 0 ? segments[activeIdx] : null

  return (
    <div className="max-w-[1800px] mx-auto px-4 py-6">
      <div className="flex flex-col lg:flex-row gap-6 items-start">

        {/* ─────────────── LEFT: Video + info ─────────────── */}
        <div className="flex-1 min-w-0">

          {/* Video player */}
          <div className="w-full aspect-video bg-black rounded-xl overflow-hidden">
            <video ref={videoRef} src={src} controls className="w-full h-full" />
          </div>

          {/* Phase timeline strip */}
          {hasChapters && total > 0 && (
            <div className="mt-2 px-0.5">
              <div className="flex gap-[2px] h-1.5 rounded-full overflow-visible">
                {segments.map((seg, i) => {
                  const widthPct = ((seg.end - seg.start) / total) * 100
                  const isActive = i === activeIdx
                  return (
                    <div
                      key={i}
                      style={{ width: `${widthPct}%` }}
                      className={`relative cursor-pointer rounded-sm transition-all duration-150 h-1.5 hover:h-2.5 hover:-mt-0.5 ${tagSolidBg(seg.mainTag)} ${
                        isActive ? 'opacity-100' : 'opacity-35 hover:opacity-80'
                      }`}
                      onClick={() => seekTo(seg.start)}
                      onMouseEnter={() => setHoveredTimelineIdx(i)}
                      onMouseLeave={() => setHoveredTimelineIdx(null)}
                    >
                      {hoveredTimelineIdx === i && (
                        <div className="absolute bottom-5 left-1/2 -translate-x-1/2 bg-black/95 border border-yt-border text-white text-xs px-2.5 py-1.5 rounded-lg whitespace-nowrap z-30 pointer-events-none shadow-xl">
                          <span className="font-mono text-yt-red">{fmt(seg.start)}</span>
                          <span className="mx-1.5 text-yt-border">·</span>
                          <span className="font-medium">{cap(seg.mainTag)}</span>
                          {seg.subTag && (
                            <><span className="mx-1.5 text-yt-border">·</span><span className="text-yt-muted">{seg.subTag}</span></>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
              {/* Phase color legend */}
              {mainTags.length > 1 && (
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5">
                  {mainTags.map((tag) => (
                    <div key={tag} className="flex items-center gap-1">
                      <div className={`w-2 h-2 rounded-full ${tagSolidBg(tag)}`} />
                      <span className="text-yt-muted text-[11px]">{cap(tag)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Title */}
          <h1 className="text-yt-text text-xl font-bold mt-4 mb-2">{title}</h1>

          {/* Stats row */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-yt-border">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-yt-red flex items-center justify-center text-white font-bold shrink-0">
                {userInitial}
              </div>
              <p className="text-yt-text font-medium text-sm">{userName}</p>
            </div>
            <div className="flex items-center gap-4 text-yt-muted text-sm flex-wrap">
              <span>{formatViews(views)} views</span>
              <span>{timeAgo(createdAt)}</span>
              <LikeButton videoId={videoId} initialLiked={initialLiked} initialCount={initialLikeCount} />
            </div>
          </div>

          {/* Description */}
          {description && (
            <div className="mt-4 bg-yt-surface rounded-xl p-4">
              <p className="text-yt-muted text-sm whitespace-pre-wrap">{description}</p>
            </div>
          )}

          {/* Transcript */}
          {transcriptStatus === 'DONE' && transcript && (
            <WatchTranscript segments={transcriptSegments} fallback={transcript} />
          )}
        </div>

        {/* ─────────────── RIGHT: Chapters sidebar ─────────────── */}
        {hasChapters && (
          <div className="lg:w-[360px] xl:w-[400px] shrink-0 w-full">
            <div
              className="lg:sticky lg:top-4 flex flex-col overflow-hidden"
              style={{ maxHeight: 'calc(100vh - 2rem)' }}
            >
              {/* Panel header */}
              <div className="flex items-start justify-between gap-3 mb-3 shrink-0">
                <div className="min-w-0">
                  <h2 className="text-yt-text font-semibold text-base">
                    {segments.length} Chapter{segments.length !== 1 ? 's' : ''}
                  </h2>
                  {activeSegment && (
                    <p className="text-yt-muted text-xs mt-0.5 flex items-center gap-1.5 min-w-0">
                      <span className="w-1.5 h-1.5 rounded-full bg-yt-red animate-pulse shrink-0" />
                      <span className="truncate">{activeSegment.subTag || cap(activeSegment.mainTag)}</span>
                    </p>
                  )}
                </div>
                {activeMainTag && (
                  <button
                    onClick={() => setActiveMainTag(null)}
                    className="shrink-0 text-xs text-yt-red hover:underline mt-0.5"
                  >
                    Clear ×
                  </button>
                )}
              </div>

              {/* Phase filter chips */}
              {mainTags.length > 1 && (
                <div className="flex gap-2 overflow-x-auto pb-2 mb-3 shrink-0 scrollbar-hide">
                  <button
                    onClick={() => setActiveMainTag(null)}
                    className={`shrink-0 px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                      !activeMainTag
                        ? 'bg-yt-red/20 text-yt-red border-yt-red/50'
                        : 'bg-yt-hover text-yt-muted border-yt-border hover:text-yt-text'
                    }`}
                  >
                    All
                  </button>
                  {mainTags.map((tag) => (
                    <button
                      key={tag}
                      onClick={() => setActiveMainTag(activeMainTag === tag ? null : tag)}
                      className={`shrink-0 px-3 py-1 rounded-full text-xs font-medium border transition-all ${tagColor(tag)} ${
                        activeMainTag === tag ? 'ring-1 ring-current opacity-100' : 'opacity-60 hover:opacity-100'
                      }`}
                    >
                      {cap(tag)}
                    </button>
                  ))}
                </div>
              )}

              {/* Scrollable 2-column chapter grid */}
              <div className="flex-1 overflow-y-auto pr-0.5">
                <div className="grid grid-cols-2 gap-2.5 pb-2">
                  {visibleSegments.map((seg) => (
                    <ChapterCard
                      key={seg.idx}
                      seg={seg}
                      isActive={seg.idx === activeIdx}
                      onSeek={seekTo}
                      cardRef={(el) => { cardRefs.current[seg.idx] = el }}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
