'use client'

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { tagColor, tagSolidBg } from '@/lib/tagColor'

type Segment = {
  id: number
  start: number
  end: number
  text: string
  mainTag?: string
  subTag?: string
  tags?: string[]
}
type TranscriptStatus = 'NONE' | 'PENDING' | 'PROCESSING' | 'DONE' | 'FAILED'

function cap(s: string) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s
}

function getMainTag(seg: Segment): string | undefined {
  return seg.mainTag ?? seg.tags?.[0]
}

export default function TranscribePage({ params }: { params: { id: string } }) {
  const { id } = params
  const videoRef = useRef<HTMLVideoElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const segmentRefs = useRef<(HTMLButtonElement | null)[]>([])

  const [status, setStatus] = useState<TranscriptStatus>('PENDING')
  const [segments, setSegments] = useState<Segment[]>([])
  const [failureMessage, setFailureMessage] = useState<string | null>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [activeSegmentIdx, setActiveSegmentIdx] = useState<number | null>(null)
  const [transcribeStarted, setTranscribeStarted] = useState(false)
  const [activeMainTag, setActiveMainTag] = useState<string | null>(null)

  const allMainTags = useMemo(() => {
    const seen = new Set<string>()
    const result: string[] = []
    for (const s of segments) {
      const t = getMainTag(s)
      if (t && !seen.has(t)) { seen.add(t); result.push(t) }
    }
    return result
  }, [segments])

  const visibleSegments = useMemo(() => {
    return segments
      .map((s, i) => ({ ...s, originalIdx: i }))
      .filter((s) => activeMainTag ? getMainTag(s) === activeMainTag : true)
  }, [segments, activeMainTag])

  function applyTranscriptData(data: {
    status: TranscriptStatus
    transcript?: string | null
    message?: string | null
    segments?: Segment[] | null
  }) {
    setStatus(data.status)
    if (Array.isArray(data.segments) && data.segments.length > 0) {
      setSegments(data.segments)
    }
    if (data.status === 'FAILED') {
      setFailureMessage(data.message ?? data.transcript ?? 'Transcription failed. Please try again.')
    }
  }

  useEffect(() => {
    fetch(`/api/videos/${id}`)
      .then((r) => r.json())
      .then((d) => { if (d.blobUrl) setVideoUrl(d.blobUrl) })

    fetch(`/api/videos/${id}/transcript`)
      .then((r) => r.json())
      .then(applyTranscriptData)
  }, [id])

  useEffect(() => {
    if (transcribeStarted) return
    setTranscribeStarted(true)
    fetch(`/api/videos/${id}/transcribe`, { method: 'POST' })
      .then((r) => r.json())
      .then((data) => {
        applyTranscriptData(data)
        if (data.status === 'DONE' || data.status === 'FAILED') {
          fetch(`/api/videos/${id}/transcript`)
            .then((r) => r.json())
            .then(applyTranscriptData)
            .catch(() => {})
        }
      })
      .catch(() => {})
  }, [id, transcribeStarted])

  useEffect(() => {
    if (status === 'DONE' || status === 'FAILED') {
      if (pollRef.current) clearInterval(pollRef.current)
      return
    }
    pollRef.current = setInterval(async () => {
      try {
        const data = await fetch(`/api/videos/${id}/transcript`).then((r) => r.json())
        applyTranscriptData(data)
      } catch { /* network hiccup */ }
    }, 2000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [id, status])

  useEffect(() => {
    const video = videoRef.current
    if (!video || segments.length === 0) return
    function onTimeUpdate() {
      const t = video!.currentTime
      const idx = segments.findIndex((s) => t >= s.start && t < s.end)
      if (idx !== activeSegmentIdx) {
        setActiveSegmentIdx(idx >= 0 ? idx : null)
        if (idx >= 0 && !activeMainTag) {
          segmentRefs.current[idx]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
        }
      }
    }
    video.addEventListener('timeupdate', onTimeUpdate)
    return () => video.removeEventListener('timeupdate', onTimeUpdate)
  }, [segments, activeSegmentIdx, activeMainTag])

  const seekTo = useCallback((start: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = start
      videoRef.current.play()
    }
  }, [])

  function fmt(seconds: number) {
    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60)
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  const isWorking = status === 'PENDING' || status === 'PROCESSING'
  const totalDuration = segments.length > 0 ? segments[segments.length - 1].end : 0

  return (
    <div className="h-screen flex flex-col overflow-hidden">

      {/* ── Sticky top bar ── */}
      <div className="shrink-0 flex items-center justify-between px-5 md:px-8 py-3 border-b border-yt-border bg-yt-dark/95 backdrop-blur z-20">
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/" className="text-yt-muted hover:text-yt-text transition-colors shrink-0">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
            </svg>
          </Link>
          <div className="min-w-0">
            <h1 className="text-yt-text font-semibold text-sm truncate">Review Transcription</h1>
            <p className="text-yt-muted text-xs hidden sm:block">
              {activeMainTag ? `Filtering by "${cap(activeMainTag)}"` : 'Click a segment to jump · click a phase to filter'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {status === 'DONE' && (
            <span className="hidden sm:flex items-center gap-1.5 text-green-400 text-xs font-medium bg-green-400/10 border border-green-400/20 px-3 py-1 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
              Done · {segments.length} segments · {allMainTags.length} phases
            </span>
          )}
          {isWorking && (
            <span className="flex items-center gap-1.5 text-yt-muted text-xs">
              <span className="w-3 h-3 rounded-full border-2 border-yt-red border-t-transparent animate-spin" />
              <span className="hidden sm:inline">Transcribing…</span>
            </span>
          )}
          <Link
            href={`/watch/${id}`}
            className="bg-yt-surface hover:bg-yt-hover text-yt-text px-4 py-1.5 rounded-full text-xs font-medium transition-colors border border-yt-border"
          >
            Watch
          </Link>
          <Link
            href="/"
            className="bg-yt-red hover:bg-red-700 text-white px-4 py-1.5 rounded-full text-xs font-medium transition-colors"
          >
            Home
          </Link>
        </div>
      </div>

      {/* ── Main two-column layout ── */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">

        {/* ─── LEFT: Video panel ─── */}
        <div className="shrink-0 lg:w-[55%] xl:w-[60%] flex flex-col border-b lg:border-b-0 lg:border-r border-yt-border bg-black/30">
          {/* Video */}
          <div className="w-full aspect-video bg-black">
            {videoUrl ? (
              <video ref={videoRef} src={videoUrl} controls className="w-full h-full" />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <div className="w-10 h-10 border-2 border-yt-red border-t-transparent rounded-full animate-spin" />
              </div>
            )}
          </div>

          {/* Info bar below video */}
          {status === 'DONE' && segments.length > 0 && (
            <div className="flex flex-wrap gap-4 px-5 py-3 border-t border-yt-border bg-yt-surface/30">
              <div className="flex items-center gap-1.5">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5 text-yt-muted">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12" />
                </svg>
                <span className="text-yt-muted text-xs">{segments.length} segments</span>
              </div>
              <div className="flex items-center gap-1.5">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5 text-yt-muted">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="text-yt-muted text-xs">{fmt(totalDuration)}</span>
              </div>
              {allMainTags.length > 0 && (
                <div className="flex items-center gap-1.5">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5 text-yt-muted">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.595.33a18.095 18.095 0 005.223-5.223c.542-.815.369-1.896-.33-2.595L9.568 3z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6z" />
                  </svg>
                  <span className="text-yt-muted text-xs">{allMainTags.length} phases</span>
                </div>
              )}
            </div>
          )}

          {/* Processing state */}
          {isWorking && (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8 min-h-[120px]">
              <div className="w-10 h-10 border-2 border-yt-red border-t-transparent rounded-full animate-spin" />
              <div className="text-center">
                <p className="text-yt-text text-sm font-medium">Transcribing video…</p>
                <p className="text-yt-muted text-xs mt-1">Usually takes 30–90 seconds</p>
              </div>
            </div>
          )}
        </div>

        {/* ─── RIGHT: Transcript panel ─── */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">

          {/* Sticky filter header */}
          {status === 'DONE' && allMainTags.length > 0 && (
            <div className="shrink-0 px-4 md:px-6 py-3 border-b border-yt-border bg-yt-dark/80 backdrop-blur">
              <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide pb-0.5">
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
                {allMainTags.map((tag) => (
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
            </div>
          )}

          {/* Scrollable segment list */}
          <div className="flex-1 overflow-y-auto">

            {/* Loading state */}
            {isWorking && (
              <div className="flex flex-col items-center justify-center h-full gap-4 p-8">
                <div className="w-12 h-12 border-2 border-yt-red border-t-transparent rounded-full animate-spin" />
                <div className="text-center">
                  <p className="text-yt-muted text-sm">Waiting for transcript…</p>
                  <p className="text-yt-muted text-xs mt-1">This panel will update automatically</p>
                </div>
              </div>
            )}

            {/* Segments */}
            {status === 'DONE' && visibleSegments.length > 0 && (
              <div className="divide-y divide-yt-border/30">
                {visibleSegments.map((seg) => {
                  const isActive = activeSegmentIdx === seg.originalIdx
                  const mainTag = getMainTag(seg)
                  return (
                    <button
                      key={seg.id ?? seg.originalIdx}
                      ref={(el) => { segmentRefs.current[seg.originalIdx] = el }}
                      onClick={() => seekTo(seg.start)}
                      className={`w-full text-left px-4 md:px-6 py-3.5 transition-colors group ${
                        isActive
                          ? 'bg-yt-red/10 border-l-2 border-yt-red'
                          : 'hover:bg-yt-surface/50 border-l-2 border-transparent'
                      }`}
                    >
                      {/* Tags row — prominent, above text */}
                      {(mainTag || seg.subTag) && (
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                          {mainTag && (
                            <span
                              onClick={(e) => {
                                e.stopPropagation()
                                setActiveMainTag(activeMainTag === mainTag ? null : mainTag)
                              }}
                              className={`cursor-pointer inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border transition-all ${tagColor(mainTag)} ${
                                activeMainTag === mainTag ? 'ring-1 ring-current opacity-100' : 'opacity-90 hover:opacity-100'
                              }`}
                            >
                              <span className={`w-1.5 h-1.5 rounded-full ${tagSolidBg(mainTag)}`} />
                              {cap(mainTag)}
                            </span>
                          )}
                          {seg.subTag && (
                            <span className="text-yt-text text-xs font-medium bg-yt-hover border border-yt-border px-2.5 py-1 rounded-full">
                              {seg.subTag}
                            </span>
                          )}
                        </div>
                      )}

                      {/* Time + transcript text */}
                      <div className="flex gap-3 items-start">
                        <span className={`text-xs font-mono shrink-0 mt-0.5 transition-colors ${
                          isActive ? 'text-yt-red' : 'text-yt-muted group-hover:text-yt-red'
                        }`}>
                          {fmt(seg.start)}
                        </span>
                        <p className="text-yt-muted text-sm leading-relaxed">{seg.text}</p>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}

            {/* Empty filter state */}
            {status === 'DONE' && visibleSegments.length === 0 && activeMainTag && (
              <div className="flex flex-col items-center justify-center h-48 gap-3 p-6 text-center">
                <p className="text-yt-muted text-sm">No segments tagged &quot;{cap(activeMainTag)}&quot;</p>
                <button onClick={() => setActiveMainTag(null)} className="text-yt-red text-xs hover:underline font-medium">
                  Clear filter
                </button>
              </div>
            )}

            {/* No speech */}
            {status === 'DONE' && segments.length === 0 && (
              <div className="flex flex-col items-center justify-center h-48 text-center p-6">
                <p className="text-yt-muted text-sm">No speech detected in this video.</p>
              </div>
            )}

            {/* Failed */}
            {status === 'FAILED' && (
              <div className="flex flex-col items-center justify-center h-full gap-3 p-8 text-center">
                <svg viewBox="0 0 24 24" fill="#ef4444" className="w-10 h-10 shrink-0">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
                </svg>
                <p className="text-red-400 text-base font-semibold">Transcription failed</p>
                {failureMessage && <p className="text-yt-muted text-sm max-w-xs">{failureMessage}</p>}
              </div>
            )}
          </div>

          {/* Filter footer */}
          {activeMainTag && status === 'DONE' && (
            <div className="shrink-0 flex items-center justify-between px-4 md:px-6 py-3 border-t border-yt-border bg-yt-dark/80 backdrop-blur">
              <span className="text-yt-muted text-xs">
                {visibleSegments.length} segment{visibleSegments.length !== 1 ? 's' : ''} &middot; &ldquo;{cap(activeMainTag)}&rdquo;
              </span>
              <button onClick={() => setActiveMainTag(null)} className="text-xs text-yt-red hover:underline font-medium">
                Clear ×
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
