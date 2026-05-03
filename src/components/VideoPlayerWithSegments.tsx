'use client'

import { useRef, useState, useEffect, useCallback, useMemo } from 'react'
import { tagColor, tagSolidBg } from '@/lib/tagColor'

type VideoSegment = {
  mainTag: string
  subTag: string
  start: number
  end: number
  thumbnailPath: string | null
}

type VideoSegmentLegacy = {
  title: string
  start: number
  end: number
  thumbnailPath: string | null
}

function fmt(s: number) {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

function cap(s: string) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s
}

function normalize(seg: VideoSegment | VideoSegmentLegacy): VideoSegment {
  if ('mainTag' in seg) return seg
  const t = (seg as VideoSegmentLegacy).title
  return { mainTag: t, subTag: t, start: seg.start, end: seg.end, thumbnailPath: seg.thumbnailPath }
}

export default function VideoPlayerWithSegments({
  src,
  segments: rawSegments,
}: {
  src: string
  segments: (VideoSegment | VideoSegmentLegacy)[]
}) {
  const segments = useMemo(() => rawSegments.map(normalize), [rawSegments])

  const videoRef = useRef<HTMLVideoElement>(null)
  const chapterListRef = useRef<HTMLDivElement>(null)
  const cardRefs = useRef<(HTMLButtonElement | null)[]>([])
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [hoveredTimelineIdx, setHoveredTimelineIdx] = useState<number | null>(null)
  const [activeMainTag, setActiveMainTag] = useState<string | null>(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const onTimeUpdate = () => setCurrentTime(video.currentTime)
    const onLoadedMetadata = () => setDuration(video.duration)
    video.addEventListener('timeupdate', onTimeUpdate)
    video.addEventListener('loadedmetadata', onLoadedMetadata)
    return () => {
      video.removeEventListener('timeupdate', onTimeUpdate)
      video.removeEventListener('loadedmetadata', onLoadedMetadata)
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

  // Auto-scroll the chapter list to keep the active card visible
  useEffect(() => {
    if (activeIdx >= 0 && !activeMainTag) {
      cardRefs.current[activeIdx]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [activeIdx, activeMainTag])

  const seekTo = useCallback((time: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = time
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

  const activeSegment = activeIdx >= 0 ? segments[activeIdx] : null

  return (
    <>
      {/* ── Video player ── */}
      <div className="w-full aspect-video bg-black rounded-xl overflow-hidden">
        <video ref={videoRef} src={src} controls className="w-full h-full" />
      </div>

      {/* ── Phase timeline strip ── */}
      {segments.length > 0 && total > 0 && (
        <div className="mt-2 px-0.5">
          <div className="flex gap-[2px] h-1.5 rounded-full overflow-visible">
            {segments.map((seg, i) => {
              const widthPct = ((seg.end - seg.start) / total) * 100
              const isActive = i === activeIdx
              const bg = tagSolidBg(seg.mainTag)
              return (
                <div
                  key={i}
                  style={{ width: `${widthPct}%` }}
                  className={`relative cursor-pointer rounded-sm transition-all duration-150 h-1.5 hover:h-2.5 hover:-mt-0.5 ${bg} ${
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
                        <>
                          <span className="mx-1.5 text-yt-border">·</span>
                          <span className="text-yt-muted">{seg.subTag}</span>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Phase color legend */}
          {mainTags.length > 1 && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
              {mainTags.map((tag) => (
                <div key={tag} className="flex items-center gap-1.5">
                  <div className={`w-2 h-2 rounded-full ${tagSolidBg(tag)}`} />
                  <span className="text-yt-muted text-[11px]">{cap(tag)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Chapters section ── */}
      {segments.length > 0 && (
        <div className="mt-5">
          {/* Header */}
          <div className="flex items-start justify-between gap-4 mb-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-yt-text font-semibold text-base">
                  {segments.length} Chapter{segments.length !== 1 ? 's' : ''}
                </h3>
                {activeSegment && (
                  <span className="hidden sm:flex items-center gap-1.5 text-xs text-yt-muted">
                    <span className="w-1.5 h-1.5 rounded-full bg-yt-red animate-pulse" />
                    Playing: <span className="text-yt-text truncate max-w-[200px]">{activeSegment.subTag || cap(activeSegment.mainTag)}</span>
                  </span>
                )}
              </div>
            </div>
            {activeMainTag && (
              <button onClick={() => setActiveMainTag(null)} className="shrink-0 text-xs text-yt-red hover:underline">
                Clear filter ×
              </button>
            )}
          </div>

          {/* Phase filter chips */}
          {mainTags.length > 1 && (
            <div className="flex gap-2 overflow-x-auto pb-2 mb-3 scrollbar-hide">
              <button
                onClick={() => setActiveMainTag(null)}
                className={`shrink-0 px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                  activeMainTag === null
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

          {/* Chapter cards grid */}
          <div
            ref={chapterListRef}
            className="grid grid-cols-2 sm:grid-cols-2 xl:grid-cols-3 gap-3 max-h-[520px] overflow-y-auto pr-0.5 pb-0.5"
          >
            {visibleSegments.map((seg) => {
              const isActive = seg.idx === activeIdx
              return (
                <button
                  key={seg.idx}
                  ref={(el) => { cardRefs.current[seg.idx] = el }}
                  onClick={() => seekTo(seg.start)}
                  className={`text-left rounded-xl overflow-hidden border transition-all duration-200 group ${
                    isActive
                      ? 'border-yt-red ring-1 ring-yt-red/60 bg-yt-red/5 shadow-[0_0_20px_rgba(255,0,0,0.12)]'
                      : 'border-yt-border bg-yt-surface hover:border-yt-hover hover:bg-yt-hover/40 hover:shadow-lg'
                  }`}
                >
                  {/* Thumbnail */}
                  <div className="relative aspect-video bg-yt-dark overflow-hidden">
                    {seg.thumbnailPath ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={seg.thumbnailPath}
                        alt={seg.subTag || seg.mainTag}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <div className={`w-10 h-10 rounded-full ${tagSolidBg(seg.mainTag)} opacity-30`} />
                        <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6 text-yt-muted absolute">
                          <path d="M8 5v14l11-7z" />
                        </svg>
                      </div>
                    )}

                    {/* Timestamp badge */}
                    <span className="absolute bottom-1.5 right-1.5 bg-black/80 text-white text-[10px] font-mono px-1.5 py-0.5 rounded font-medium">
                      {fmt(seg.start)}
                    </span>

                    {/* Active overlay: playing indicator */}
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

                  {/* Card info */}
                  <div className="p-2.5">
                    <p className={`text-sm font-medium leading-snug line-clamp-2 mb-1.5 ${
                      isActive ? 'text-yt-red' : 'text-yt-text'
                    }`}>
                      {seg.subTag || cap(seg.mainTag)}
                    </p>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${tagColor(seg.mainTag)}`}>
                        {cap(seg.mainTag)}
                      </span>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </>
  )
}
