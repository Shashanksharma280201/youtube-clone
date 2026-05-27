'use client'

import { useRef, useState, useEffect, useMemo, useCallback } from 'react'
import { tagColor } from '@/lib/tagColor'
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
      className={`w-full text-left rounded-xl overflow-hidden border transition-all duration-200 group active:scale-[0.98] bg-white ${
        isActive
          ? 'border-nb-violet/50 ring-1 ring-nb-violet/20 shadow-card-md'
          : 'border-slate-200 hover:border-slate-300 hover:shadow-card-md shadow-card'
      }`}
    >
      <div className="relative aspect-video bg-yt-hover overflow-hidden">
        <div className={`absolute inset-0 transition-opacity duration-300 ${loaded ? 'opacity-0 pointer-events-none' : 'shimmer'}`} />
        {hasThumb && (
          <img
            src={seg.thumbnailPath!}
            alt={seg.subTag || seg.mainTag}
            loading="lazy"
            decoding="async"
            onLoad={() => setLoaded(true)}
            onError={() => setImgError(true)}
            className={`w-full h-full object-cover transition-all duration-300 group-hover:scale-[1.04] ${loaded ? 'opacity-100' : 'opacity-0'}`}
          />
        )}
        {!hasThumb && (
          <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200">
            <svg viewBox="0 0 24 24" fill="#7c3aed" className="absolute w-5 h-5 opacity-30">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        )}

        <span className={`absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded-lg text-[10px] font-semibold border backdrop-blur-sm z-10 ${tagColor(seg.mainTag)}`}>
          {cap(seg.mainTag)}
        </span>
        <span className="absolute bottom-1.5 right-1.5 bg-black/70 text-white text-[10px] font-mono px-1.5 py-0.5 rounded-lg z-10">
          {fmt(seg.start)}
        </span>

        {isActive && (
          <div className="absolute inset-0 bg-nb-violet/10 flex items-center justify-center">
            <div className="w-8 h-8 rounded-xl bg-nb-violet flex items-center justify-center shadow-violet-btn">
              <svg viewBox="0 0 24 24" fill="white" className="w-4 h-4 ml-0.5">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
          </div>
        )}
      </div>

      <div className={`px-2.5 py-2 ${isActive ? 'bg-nb-violet/5' : ''}`}>
        <p className={`text-xs font-medium leading-snug line-clamp-2 ${isActive ? 'text-nb-violet' : 'text-yt-text'}`}>
          {seg.subTag || cap(seg.mainTag)}
        </p>
      </div>
    </button>
  )
}

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
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)

  const [activeMainTag, setActiveMainTag] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchState, setSearchState] = useState<'idle' | 'loading' | 'found' | 'empty' | 'error'>('idle')
  const [searchResults, setSearchResults] = useState<Array<{ index: number; segment: typeof segments[0] }>>([])

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
    return () => { video.removeEventListener('timeupdate', onTime); video.removeEventListener('loadedmetadata', onMeta) }
  }, [])

  const activeIdx = useMemo(() => {
    let idx = -1
    for (let i = 0; i < segments.length; i++) {
      if (currentTime >= segments[i].start) idx = i
      else break
    }
    return idx
  }, [currentTime, segments])

  useEffect(() => {
    if (activeIdx >= 0 && !activeMainTag) cardRefs.current[activeIdx]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [activeIdx, activeMainTag])

  const seekTo = useCallback((t: number) => {
    if (videoRef.current) { videoRef.current.currentTime = t; videoRef.current.play() }
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
      if (data.found && Array.isArray(data.results)) { setSearchResults(data.results); setSearchState('found') }
      else setSearchState('empty')
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
  const activeSegment = activeIdx >= 0 ? segments[activeIdx] : null

  return (
    <div className="max-w-[1800px] mx-auto px-4 py-6">
      <div className="flex flex-col lg:flex-row gap-6 items-start">

        {/* LEFT: Video + info */}
        <div className="flex-1 min-w-0">

          {/* Video player */}
          <div className="w-full bg-black rounded-2xl overflow-hidden shadow-card-md border border-slate-200 flex justify-center">
            <video ref={videoRef} src={src} controls className="block max-w-full max-h-[75vh]" />
          </div>

          {/* Title */}
          <h1 className="text-yt-text text-xl font-bold mt-4 mb-3 leading-snug">{title}</h1>

          {/* Stats row */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-yt-border">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-nb-violet to-nb-indigo flex items-center justify-center text-white font-bold shrink-0">
                {userInitial}
              </div>
              <div>
                <p className="text-yt-text font-semibold text-sm">{userName}</p>
                <p className="text-yt-muted text-xs">{formatViews(views)} views · {timeAgo(createdAt)}</p>
              </div>
            </div>
            <LikeButton videoId={videoId} initialLiked={initialLiked} initialCount={initialLikeCount} />
          </div>

          {/* Description */}
          {description && (
            <div className="mt-4 bg-white border border-yt-border rounded-2xl p-4 shadow-card">
              <p className="text-yt-muted text-sm whitespace-pre-wrap leading-relaxed">{description}</p>
            </div>
          )}

          {/* Transcript */}
          {transcriptStatus === 'DONE' && (transcript || (Array.isArray(transcriptSegments) && (transcriptSegments as unknown[]).length > 0)) && (
            <WatchTranscript segments={transcriptSegments} fallback={transcript} />
          )}
        </div>

        {/* RIGHT: Chapters sidebar */}
        {hasChapters && (
          <div className="lg:w-[360px] xl:w-[400px] shrink-0 w-full">
            <div className="lg:sticky lg:top-4 flex flex-col overflow-hidden" style={{ maxHeight: 'calc(100vh - 2rem)' }}>

              {/* Search bar */}
              <div className="shrink-0 mb-3">
                <div className={`flex items-center gap-2 bg-white border rounded-xl px-3 py-2 transition-all duration-150 ${
                  searchState === 'loading' ? 'border-slate-200' : 'border-slate-200 hover:border-slate-300 focus-within:border-nb-violet/50 focus-within:shadow-violet'
                }`}>
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

                  {searchQuery && searchState !== 'loading' && (
                    <button onClick={clearSearch} className="shrink-0 text-yt-muted hover:text-yt-text transition-colors">
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M18 6 6 18M6 6l12 12" />
                      </svg>
                    </button>
                  )}

                  {searchQuery && searchState !== 'loading' && (
                    <button
                      onClick={() => handleSearch(searchQuery)}
                      className="shrink-0 bg-nb-violet/10 hover:bg-nb-violet/20 text-nb-violet text-xs px-2.5 py-1 rounded-lg transition-colors font-semibold"
                    >
                      Go
                    </button>
                  )}
                </div>
              </div>

              {searchState === 'found' && searchResults.length > 0 ? (
                <div className="flex flex-col flex-1 overflow-hidden">
                  <div className="flex items-center justify-between mb-3 shrink-0">
                    <p className="text-xs text-yt-muted">
                      <span className="text-yt-text font-medium">{searchResults.length}</span> chapter{searchResults.length !== 1 ? 's' : ''} match &ldquo;{searchQuery}&rdquo;
                    </p>
                    <button onClick={clearSearch} className="text-xs text-nb-violet hover:text-nb-indigo transition-colors">← All</button>
                  </div>
                  <div className="flex-1 overflow-y-auto pr-0.5">
                    <div className="grid grid-cols-2 gap-2.5 pb-2">
                      {searchResults.map(({ index, segment }) => (
                        <ChapterCard key={index} seg={{ ...segment, idx: index }} isActive={index === activeIdx} onSeek={seekTo} cardRef={(el) => { cardRefs.current[index] = el }} />
                      ))}
                    </div>
                  </div>
                </div>

              ) : searchState === 'empty' ? (
                <div className="flex flex-col flex-1">
                  <div className="flex items-center justify-between mb-3 shrink-0">
                    <span className="text-xs text-yt-muted">No match for <span className="text-yt-text font-medium">"{searchQuery}"</span></span>
                    <button onClick={clearSearch} className="text-xs text-nb-violet hover:text-nb-indigo transition-colors">← All</button>
                  </div>
                  <div className="flex flex-col items-center justify-center flex-1 gap-3 py-10 text-center">
                    <div className="w-12 h-12 rounded-2xl bg-yt-hover border border-yt-border flex items-center justify-center">
                      <svg className="w-6 h-6 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
                      </svg>
                    </div>
                    <p className="text-yt-text text-sm font-medium">No chapter found</p>
                    <p className="text-yt-muted text-xs max-w-[220px]">Try searching for a topic, action, or object in this video</p>
                  </div>
                </div>

              ) : searchState === 'error' ? (
                <div className="flex flex-col flex-1">
                  <div className="flex items-center justify-between mb-3 shrink-0">
                    <span className="text-xs text-red-500">Search failed</span>
                    <button onClick={clearSearch} className="text-xs text-yt-muted hover:text-yt-text transition-colors">← All</button>
                  </div>
                  <div className="flex items-center justify-center flex-1 py-10">
                    <p className="text-yt-muted text-xs">Something went wrong. Please try again.</p>
                  </div>
                </div>

              ) : (
                <>
                  <div className="flex items-start justify-between gap-3 mb-3 shrink-0">
                    <div className="min-w-0">
                      <h2 className="text-yt-text font-semibold text-base">
                        {segments.length} Chapter{segments.length !== 1 ? 's' : ''}
                      </h2>
                      {activeSegment && (
                        <p className="text-yt-muted text-xs mt-0.5 flex items-center gap-1.5 min-w-0">
                          <span className="w-1.5 h-1.5 rounded-full bg-nb-violet shrink-0 animate-pulse" />
                          <span className="truncate">{activeSegment.subTag || cap(activeSegment.mainTag)}</span>
                        </p>
                      )}
                    </div>
                    {activeMainTag && (
                      <button onClick={() => setActiveMainTag(null)} className="shrink-0 text-xs text-nb-violet hover:text-nb-indigo mt-0.5 transition-colors">
                        Clear ×
                      </button>
                    )}
                  </div>

                  {mainTags.length > 1 && (
                    <div className="flex gap-2 overflow-x-auto pb-2 mb-3 shrink-0 scrollbar-hide">
                      <button
                        onClick={() => setActiveMainTag(null)}
                        className={`shrink-0 px-3 py-1 rounded-lg text-xs font-medium border transition-all duration-200 ${
                          !activeMainTag ? 'bg-nb-violet/10 text-nb-violet border-nb-violet/30' : 'bg-white text-yt-muted border-slate-200 hover:text-yt-text'
                        }`}
                      >
                        All
                      </button>
                      {mainTags.map((tag) => (
                        <button
                          key={tag}
                          onClick={() => setActiveMainTag(activeMainTag === tag ? null : tag)}
                          className={`shrink-0 px-3 py-1 rounded-lg text-xs font-medium border transition-all duration-200 ${
                            activeMainTag === tag
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-300 ring-1 ring-emerald-200'
                              : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300 hover:text-slate-800'
                          }`}
                        >
                          {cap(tag)}
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="flex-1 overflow-y-auto pr-0.5">
                    <div className="grid grid-cols-2 gap-2.5 pb-2">
                      {visibleSegments.map((seg) => (
                        <ChapterCard key={seg.idx} seg={seg} isActive={seg.idx === activeIdx} onSeek={seekTo} cardRef={(el) => { cardRefs.current[seg.idx] = el }} />
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
