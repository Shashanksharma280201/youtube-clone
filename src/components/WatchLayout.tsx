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
  annotationFrames?: Array<{ time: number; masks: number[][][] }>
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
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const cardRefs = useRef<(HTMLButtonElement | null)[]>([])
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [showAnnotations, setShowAnnotations] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [hoveredTimelineIdx, setHoveredTimelineIdx] = useState<number | null>(null)
  const [activeMainTag, setActiveMainTag] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchState, setSearchState] = useState<'idle' | 'loading' | 'found' | 'empty' | 'error'>('idle')
  const [searchResults, setSearchResults] = useState<Array<{ index: number; segment: typeof segments[0] }>>([])

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

  // Sync canvas size to video native dimensions on load
  useEffect(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return
    const onMeta = () => { canvas.width = video.videoWidth; canvas.height = video.videoHeight }
    video.addEventListener('loadedmetadata', onMeta)
    return () => video.removeEventListener('loadedmetadata', onMeta)
  }, [])

  // Redraw annotation masks whenever the active segment changes
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    const masks = activeIdx >= 0 ? (segments[activeIdx]?.annotationFrames?.[0]?.masks ?? []) : []
    if (!masks.length) return
    ctx.strokeStyle = 'rgba(0, 210, 255, 0.9)'
    ctx.fillStyle = 'rgba(0, 210, 255, 0.12)'
    ctx.lineWidth = 2
    for (const polygon of masks) {
      if (polygon.length < 3) continue
      ctx.beginPath()
      polygon.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y))
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
    }
  }, [activeIdx, segments])

  const seekTo = useCallback((t: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = t
      videoRef.current.play()
    }
  }, [])

  const handleSearch = useCallback(async (q: string) => {
    const query = q.trim()
    if (!query) return
    setSearchState('loading')
    setSearchResults([])
    try {
      const res = await fetch(`/api/videos/${videoId}/search-chapter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      })
      const data = await res.json()
      if (data.found && Array.isArray(data.results)) {
        setSearchResults(data.results)
        setSearchState('found')
      } else {
        setSearchState('empty')
      }
    } catch {
      setSearchState('error')
    }
  }, [videoId])

  const clearSearch = useCallback(() => {
    setSearchQuery('')
    setSearchState('idle')
    setSearchResults([])
    searchInputRef.current?.focus()
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
  const hasAnnotations = useMemo(() => segments.some(s => (s.annotationFrames?.[0]?.masks?.length ?? 0) > 0), [segments])
  const activeSegment = activeIdx >= 0 ? segments[activeIdx] : null

  return (
    <div className="max-w-[1800px] mx-auto px-4 py-6">
      <div className="flex flex-col lg:flex-row gap-6 items-start">

        {/* ─────────────── LEFT: Video + info ─────────────── */}
        <div className="flex-1 min-w-0">

          {/* Video player */}
          <div className="relative w-full aspect-video bg-black rounded-xl overflow-hidden">
            <video ref={videoRef} src={src} controls className="w-full h-full" />
            <canvas
              ref={canvasRef}
              className={`absolute inset-0 w-full h-full pointer-events-none transition-opacity duration-200 ${showAnnotations ? 'opacity-100' : 'opacity-0'}`}
            />
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

          {/* SAM3 annotation toggle — only shown when annotation data exists */}
          {hasAnnotations && (
            <div className="flex items-center gap-3 mt-3">
              <button
                onClick={() => setShowAnnotations((v) => !v)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border transition-all duration-200 ${
                  showAnnotations
                    ? 'bg-cyan-500/15 border-cyan-500/50 text-cyan-400'
                    : 'bg-yt-surface border-yt-border text-yt-muted hover:text-yt-text hover:border-yt-hover'
                }`}
              >
                {/* Toggle track */}
                <span className={`relative inline-flex w-7 h-4 rounded-full transition-colors duration-200 ${showAnnotations ? 'bg-cyan-500' : 'bg-yt-border'}`}>
                  <span className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform duration-200 ${showAnnotations ? 'translate-x-3' : 'translate-x-0'}`} />
                </span>
                SAM3 Annotations
              </button>
              {showAnnotations && (
                <span className="text-[11px] text-yt-muted">Cyan outlines show AI-segmented objects per chapter</span>
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
              {/* ── Search bar ── */}
              <div className="shrink-0 mb-3">
                <div className={`flex items-center gap-2 bg-yt-surface border rounded-xl px-3 py-2 transition-colors duration-150 ${
                  searchState === 'loading' ? 'border-yt-border' : 'border-yt-border hover:border-yt-hover focus-within:border-white/30'
                }`}>
                  {/* Icon: spinner or magnifying glass */}
                  <span className="shrink-0 text-yt-muted">
                    {searchState === 'loading' ? (
                      <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
                      </svg>
                    )}
                  </span>

                  <input
                    ref={searchInputRef}
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSearch(searchQuery)}
                    placeholder="Search chapters…"
                    className="flex-1 bg-transparent text-sm text-yt-text placeholder:text-yt-muted outline-none min-w-0"
                    disabled={searchState === 'loading'}
                  />

                  {/* Clear button */}
                  {searchQuery && searchState !== 'loading' && (
                    <button onClick={clearSearch} className="shrink-0 text-yt-muted hover:text-yt-text transition-colors">
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M18 6 6 18M6 6l12 12" />
                      </svg>
                    </button>
                  )}

                  {/* Search button */}
                  {searchQuery && searchState !== 'loading' && (
                    <button
                      onClick={() => handleSearch(searchQuery)}
                      className="shrink-0 bg-white/10 hover:bg-white/20 text-yt-text text-xs px-2.5 py-1 rounded-lg transition-colors"
                    >
                      Go
                    </button>
                  )}
                </div>
              </div>

              {/* ── Search result / idle chapters ── */}
              {searchState === 'found' && searchResults.length > 0 ? (
                /* Result state — same grid as normal chapters */
                <div className="flex flex-col flex-1 overflow-hidden">
                  <div className="flex items-center justify-between mb-3 shrink-0">
                    <p className="text-xs text-yt-muted">
                      <span className="text-yt-text font-medium">{searchResults.length}</span> chapter{searchResults.length !== 1 ? 's' : ''} match &ldquo;{searchQuery}&rdquo;
                    </p>
                    <button onClick={clearSearch} className="text-xs text-yt-muted hover:text-yt-text transition-colors">
                      ← All chapters
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto pr-0.5">
                    <div className="grid grid-cols-2 gap-2.5 pb-2">
                      {searchResults.map(({ index, segment }) => (
                        <ChapterCard
                          key={index}
                          seg={{ ...segment, idx: index }}
                          isActive={index === activeIdx}
                          onSeek={seekTo}
                          cardRef={(el) => { cardRefs.current[index] = el }}
                        />
                      ))}
                    </div>
                  </div>
                </div>

              ) : searchState === 'empty' ? (
                /* No results state */
                <div className="flex flex-col flex-1">
                  <div className="flex items-center justify-between mb-3 shrink-0">
                    <span className="text-xs text-yt-muted">No match for <span className="text-yt-text font-medium">"{searchQuery}"</span></span>
                    <button onClick={clearSearch} className="text-xs text-yt-muted hover:text-yt-text transition-colors">← All</button>
                  </div>
                  <div className="flex flex-col items-center justify-center flex-1 gap-2 py-10 text-center">
                    <svg className="w-8 h-8 text-yt-muted opacity-40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
                      <path d="M8 11h6M11 8v6" opacity="0.5" strokeLinecap="round" />
                    </svg>
                    <p className="text-yt-text text-sm font-medium">No chapter found</p>
                    <p className="text-yt-muted text-xs max-w-[220px]">Try searching for a topic, action, or object mentioned in this video</p>
                  </div>
                </div>

              ) : searchState === 'error' ? (
                /* Error state */
                <div className="flex flex-col flex-1">
                  <div className="flex items-center justify-between mb-3 shrink-0">
                    <span className="text-xs text-red-400">Search failed</span>
                    <button onClick={clearSearch} className="text-xs text-yt-muted hover:text-yt-text transition-colors">← All</button>
                  </div>
                  <div className="flex items-center justify-center flex-1 py-10">
                    <p className="text-yt-muted text-xs">Something went wrong. Please try again.</p>
                  </div>
                </div>

              ) : (
                /* Idle: normal chapter list */
                <>
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
                      <button onClick={() => setActiveMainTag(null)} className="shrink-0 text-xs text-yt-red hover:underline mt-0.5">
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
                          !activeMainTag ? 'bg-yt-red/20 text-yt-red border-yt-red/50' : 'bg-yt-hover text-yt-muted border-yt-border hover:text-yt-text'
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
                </>
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
