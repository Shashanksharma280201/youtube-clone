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

type AnnotationFrame = { time: number; masks: number[][][] }

type TopicSegment = {
  mainTag: string
  subTag: string
  start: number
  end: number
  thumbnailPath: string | null
  sam3Prompt?: string
  annotationFrames?: AnnotationFrame[]
}

type TranscriptStatus = 'NONE' | 'PENDING' | 'PROCESSING' | 'DONE' | 'FAILED'
type AnnotationStatus = 'NONE' | 'PENDING' | 'PROCESSING' | 'DONE' | 'FAILED'

function cap(s: string) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s
}

function getMainTag(seg: Segment): string | undefined {
  return seg.mainTag ?? seg.tags?.[0]
}

function fmt(seconds: number) {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function TranscribePage({ params }: { params: { id: string } }) {
  const { id } = params
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const segmentRefs = useRef<(HTMLButtonElement | null)[]>([])

  const [status, setStatus] = useState<TranscriptStatus>('PENDING')
  const [annotationStatus, setAnnotationStatus] = useState<AnnotationStatus>('NONE')
  const [sam3Enabled, setSam3Enabled] = useState(false)
  const [segments, setSegments] = useState<Segment[]>([])
  const [topicSegments, setTopicSegments] = useState<TopicSegment[]>([])
  const [failureMessage, setFailureMessage] = useState<string | null>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [activeSegmentIdx, setActiveSegmentIdx] = useState<number | null>(null)
  const [transcribeStarted, setTranscribeStarted] = useState(false)
  const [activeMainTag, setActiveMainTag] = useState<string | null>(null)

  const [correctionMode, setCorrectionMode] = useState(false)
  const [isAnnotating, setIsAnnotating] = useState(false)
  const annotateStartedRef = useRef(false)

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
    return segments.map((s, i) => ({ ...s, originalIdx: i })).filter((s) => activeMainTag ? getMainTag(s) === activeMainTag : true)
  }, [segments, activeMainTag])

  function applyTranscriptData(data: {
    status: TranscriptStatus
    annotationStatus?: AnnotationStatus
    sam3Enabled?: boolean
    transcript?: string | null
    message?: string | null
    segments?: Segment[] | null
    topicSegments?: TopicSegment[] | null
  }) {
    setStatus(data.status)
    if (data.annotationStatus != null) setAnnotationStatus(data.annotationStatus)
    if (data.sam3Enabled != null) setSam3Enabled(!!data.sam3Enabled)
    if (Array.isArray(data.segments) && data.segments.length > 0) setSegments(data.segments)
    if (Array.isArray(data.topicSegments) && data.topicSegments.length > 0) setTopicSegments(data.topicSegments)
    if (data.status === 'FAILED') setFailureMessage(data.message ?? data.transcript ?? 'Transcription failed. Please try again.')
  }

  useEffect(() => {
    fetch(`/api/videos/${id}`).then((r) => r.json()).then((d) => { if (d.blobUrl) setVideoUrl(d.blobUrl) })
    fetch(`/api/videos/${id}/transcript`).then((r) => r.json()).then(applyTranscriptData)
  }, [id])

  useEffect(() => {
    if (transcribeStarted) return
    setTranscribeStarted(true)
    fetch(`/api/videos/${id}/transcribe`, { method: 'POST' })
      .then((r) => r.json())
      .then((data) => {
        applyTranscriptData(data)
        if (data.status === 'DONE' || data.status === 'FAILED') {
          fetch(`/api/videos/${id}/transcript`).then((r) => r.json()).then(applyTranscriptData).catch(() => {})
        }
      })
      .catch(() => {})
  }, [id, transcribeStarted])

  useEffect(() => {
    if (!sam3Enabled) return
    if (status !== 'DONE') return
    if (annotationStatus === 'DONE' || annotationStatus === 'PROCESSING' || annotationStatus === 'FAILED') return
    if (annotateStartedRef.current) return
    annotateStartedRef.current = true
    fetch(`/api/videos/${id}/annotate`, { method: 'POST' })
      .then((r) => r.json())
      .then((data) => { if (data.status) setAnnotationStatus(data.status) })
      .catch(() => {})
  }, [id, sam3Enabled, status, annotationStatus])

  useEffect(() => {
    const done =
      (status === 'DONE' || status === 'FAILED') &&
      (annotationStatus === 'DONE' || annotationStatus === 'FAILED' || status === 'FAILED')

    if (done) {
      if (pollRef.current) clearInterval(pollRef.current)
      return
    }
    pollRef.current = setInterval(async () => {
      try {
        const data = await fetch(`/api/videos/${id}/transcript`).then((r) => r.json())
        applyTranscriptData(data)
      } catch { /* ignore */ }
    }, 2000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [id, status, annotationStatus])

  useEffect(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return
    function onMeta() { canvas!.width = video!.videoWidth; canvas!.height = video!.videoHeight }
    video.addEventListener('loadedmetadata', onMeta)
    if (video.readyState >= 1) onMeta()
    return () => video.removeEventListener('loadedmetadata', onMeta)
  }, [videoUrl])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    if (activeSegmentIdx === null) return
    const topic = topicSegments[activeSegmentIdx]
    if (!topic?.annotationFrames?.length) return
    const masks = topic.annotationFrames[0]?.masks ?? []
    if (!masks.length) return
    ctx.strokeStyle = 'rgba(34, 211, 238, 0.9)'
    ctx.fillStyle = 'rgba(34, 211, 238, 0.12)'
    ctx.lineWidth = 2
    for (const polygon of masks) {
      if (!polygon.length) continue
      ctx.beginPath()
      polygon.forEach(([x, y], i) => { i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y) })
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
    }
  }, [activeSegmentIdx, topicSegments])

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
    if (videoRef.current) { videoRef.current.currentTime = start; videoRef.current.play() }
  }, [])

  function captureFrame(): string | null {
    const video = videoRef.current
    if (!video || !video.videoWidth) return null
    const tmp = document.createElement('canvas')
    tmp.width = video.videoWidth
    tmp.height = video.videoHeight
    tmp.getContext('2d')!.drawImage(video, 0, 0)
    return tmp.toDataURL('image/jpeg', 0.85).split(',')[1]
  }

  const handleCanvasClick = useCallback(async (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!correctionMode || isAnnotating || activeSegmentIdx === null) return
    const canvas = canvasRef.current
    const video = videoRef.current
    if (!canvas || !video) return
    video.pause()
    const frameBase64 = captureFrame()
    if (!frameBase64) return
    const rect = canvas.getBoundingClientRect()
    const clickX = (e.clientX - rect.left) * (video.videoWidth / rect.width)
    const clickY = (e.clientY - rect.top) * (video.videoHeight / rect.height)
    setIsAnnotating(true)
    try {
      const res = await fetch(`/api/videos/${id}/segment-annotate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ segmentIndex: activeSegmentIdx, frameBase64, clickX, clickY, isPositive: true }),
      })
      const data = await res.json()
      if (Array.isArray(data.masks)) {
        setTopicSegments((prev) => {
          const updated = [...prev]
          const seg = updated[activeSegmentIdx]
          if (seg) updated[activeSegmentIdx] = { ...seg, annotationFrames: [{ time: seg.start, masks: data.masks }] }
          return updated
        })
      }
    } catch (err) {
      console.error('[correction]', err)
    } finally {
      setIsAnnotating(false)
    }
  }, [correctionMode, isAnnotating, activeSegmentIdx, id])

  const isWorking = status === 'PENDING' || status === 'PROCESSING'
  const transcriptDone = status === 'DONE'
  const annotating = annotationStatus === 'PROCESSING' || (transcriptDone && annotationStatus === 'NONE')
  const annotationDone = annotationStatus === 'DONE'
  const totalDuration = segments.length > 0 ? segments[segments.length - 1].end : 0

  return (
    <div className="h-screen flex flex-col overflow-hidden">

      {/* Top bar */}
      <div className="shrink-0 flex items-center justify-between px-5 md:px-8 py-3 border-b border-yt-border bg-white z-20">
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/" className="text-yt-muted hover:text-yt-text transition-colors shrink-0 w-8 h-8 flex items-center justify-center rounded-xl hover:bg-yt-surface">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
            </svg>
          </Link>
          <div className="min-w-0">
            <h1 className="text-yt-text font-semibold text-sm truncate">Review &amp; Annotate</h1>
            <p className="text-yt-muted text-xs hidden sm:block">
              {correctionMode
                ? 'Click anywhere on the video to re-annotate the active segment'
                : activeMainTag
                  ? `Filtering by "${cap(activeMainTag)}"`
                  : 'Click a segment to jump · toggle correction mode to fix annotations'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {transcriptDone && (
            <span className="hidden sm:flex items-center gap-1.5 text-nb-green text-xs font-medium bg-nb-green/10 border border-nb-green/20 px-3 py-1 rounded-xl">
              <span className="w-1.5 h-1.5 rounded-full bg-nb-green" />
              {segments.length} segments
            </span>
          )}
          {annotating && (
            <span className="hidden sm:flex items-center gap-1.5 text-nb-sky text-xs font-medium bg-nb-sky/10 border border-nb-sky/20 px-3 py-1 rounded-xl">
              <span className="w-2.5 h-2.5 border border-nb-sky border-t-transparent rounded-full animate-spin" />
              Annotating…
            </span>
          )}
          {annotationDone && !correctionMode && (
            <button
              onClick={() => setCorrectionMode(true)}
              className="hidden sm:flex items-center gap-1.5 text-xs font-medium bg-white hover:bg-yt-hover text-yt-muted hover:text-yt-text px-3 py-1.5 rounded-xl border border-yt-border hover:border-nb-violet/30 transition-all"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
              </svg>
              Correct annotations
            </button>
          )}
          {correctionMode && (
            <button
              onClick={() => setCorrectionMode(false)}
              className="flex items-center gap-1.5 text-xs font-medium bg-nb-sky/15 text-nb-sky border border-nb-sky/30 px-3 py-1.5 rounded-xl"
            >
              {isAnnotating
                ? <span className="w-3 h-3 border border-nb-sky border-t-transparent rounded-full animate-spin" />
                : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              }
              {isAnnotating ? 'Annotating…' : 'Exit correction'}
            </button>
          )}
          {isWorking && (
            <span className="flex items-center gap-1.5 text-yt-muted text-xs">
              <span className="w-3 h-3 rounded-full border-2 border-nb-violet border-t-transparent animate-spin" />
              <span className="hidden sm:inline">Transcribing…</span>
            </span>
          )}
          {transcriptDone && (
            <Link
              href={`/watch/${id}`}
              className="bg-gradient-to-r from-nb-violet to-nb-indigo hover:from-nb-violet/90 hover:to-nb-indigo/90 text-white px-4 py-1.5 rounded-xl text-xs font-semibold transition-all shadow-[0_0_10px_rgba(124,58,237,0.25)]"
            >
              Publish →
            </Link>
          )}
          {!transcriptDone && (
            <Link
              href={`/watch/${id}`}
              className="bg-white hover:bg-yt-hover text-yt-text px-4 py-1.5 rounded-xl text-xs font-medium transition-colors border border-yt-border"
            >
              Watch
            </Link>
          )}
        </div>
      </div>

      {/* Correction mode banner */}
      {correctionMode && (
        <div className="shrink-0 flex items-center gap-2 px-5 py-2 bg-nb-sky/8 border-b border-nb-sky/20 text-nb-sky text-xs">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 shrink-0">
            <circle cx="12" cy="12" r="10" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 16v-4m0-4h.01" />
          </svg>
          Correction mode — pause the video and click on any object to re-annotate the active segment.
        </div>
      )}

      {/* Main layout */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">

        {/* LEFT: Video + canvas */}
        <div className="shrink-0 lg:w-[55%] xl:w-[60%] flex flex-col border-b lg:border-b-0 lg:border-r border-yt-border bg-white">
          <div className={`relative w-full aspect-video bg-black ${correctionMode ? 'ring-1 ring-nb-sky/40' : ''}`}>
            {videoUrl ? (
              <>
                <video ref={videoRef} src={videoUrl} controls className="w-full h-full" />
                <canvas
                  ref={canvasRef}
                  onClick={handleCanvasClick}
                  className={`absolute inset-0 w-full h-full transition-colors ${correctionMode ? 'cursor-crosshair' : 'pointer-events-none'}`}
                />
                {correctionMode && activeSegmentIdx !== null && (
                  <div className="absolute top-3 left-3 bg-black/70 backdrop-blur text-nb-sky text-xs px-2.5 py-1 rounded-xl border border-nb-sky/30">
                    Segment {activeSegmentIdx + 1} · {topicSegments[activeSegmentIdx]?.sam3Prompt ?? topicSegments[activeSegmentIdx]?.subTag ?? ''}
                  </div>
                )}
              </>
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <div className="w-10 h-10 border-2 border-nb-violet border-t-transparent rounded-full animate-spin" />
              </div>
            )}
          </div>

          {/* Info bar */}
          {transcriptDone && segments.length > 0 && (
            <div className="flex flex-wrap gap-4 px-5 py-3 border-t border-yt-border bg-slate-50">
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
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.595.33a18.095 18.095 0 005.223-5.223c.542-.815.369-1.896-.33-2.595L9.568 3z" /><path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6z" />
                  </svg>
                  <span className="text-yt-muted text-xs">{allMainTags.length} phases</span>
                </div>
              )}
              {annotationDone && (
                <div className="flex items-center gap-1.5">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5 text-nb-cyan">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                  </svg>
                  <span className="text-nb-cyan text-xs">SAM3 annotated</span>
                </div>
              )}
            </div>
          )}

          {isWorking && (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8 min-h-[120px]">
              <div className="w-10 h-10 border-2 border-nb-violet border-t-transparent rounded-full animate-spin" />
              <div className="text-center">
                <p className="text-yt-text text-sm font-medium">Transcribing video…</p>
                <p className="text-yt-muted text-xs mt-1">Usually takes 30–90 seconds</p>
              </div>
            </div>
          )}
        </div>

        {/* RIGHT: Transcript panel */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {/* Phase filter */}
          {transcriptDone && allMainTags.length > 0 && (
            <div className="shrink-0 px-4 md:px-6 py-3 border-b border-yt-border bg-white">
              <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide pb-0.5">
                <button
                  onClick={() => setActiveMainTag(null)}
                  className={`shrink-0 px-3 py-1 rounded-lg text-xs font-medium border transition-all duration-200 ${
                    activeMainTag === null
                      ? 'bg-nb-violet/20 text-nb-violet border-nb-violet/40'
                      : 'bg-yt-hover text-yt-muted border-yt-border hover:text-yt-text'
                  }`}
                >
                  All
                </button>
                {allMainTags.map((tag) => (
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
            </div>
          )}

          {/* Segment list */}
          <div className="flex-1 overflow-y-auto">
            {isWorking && (
              <div className="flex flex-col items-center justify-center h-full gap-4 p-8">
                <div className="w-12 h-12 border-2 border-nb-violet border-t-transparent rounded-full animate-spin" />
                <div className="text-center">
                  <p className="text-yt-muted text-sm">Waiting for transcript…</p>
                  <p className="text-yt-muted text-xs mt-1">This panel will update automatically</p>
                </div>
              </div>
            )}

            {transcriptDone && visibleSegments.length > 0 && (
              <div className="divide-y divide-yt-border/20">
                {visibleSegments.map((seg) => {
                  const isActive = activeSegmentIdx === seg.originalIdx
                  const mainTag = getMainTag(seg)
                  const topic = topicSegments[seg.originalIdx]
                  const hasAnnotation = (topic?.annotationFrames?.length ?? 0) > 0 && (topic?.annotationFrames?.[0]?.masks?.length ?? 0) > 0

                  return (
                    <button
                      key={seg.id ?? seg.originalIdx}
                      ref={(el) => { segmentRefs.current[seg.originalIdx] = el }}
                      onClick={() => seekTo(seg.start)}
                      className={`w-full text-left px-4 md:px-6 py-3.5 transition-colors group ${
                        isActive
                          ? 'bg-nb-violet/5 border-l-2 border-nb-violet'
                          : 'hover:bg-yt-hover/70 border-l-2 border-transparent'
                      }`}
                    >
                      {(mainTag || seg.subTag) && (
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                          {mainTag && (
                            <span
                              onClick={(e) => { e.stopPropagation(); setActiveMainTag(activeMainTag === mainTag ? null : mainTag) }}
                              className={`cursor-pointer inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg text-[11px] font-semibold border transition-all duration-200 ${
                                activeMainTag === mainTag
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-300 ring-1 ring-emerald-200'
                                  : 'bg-slate-100 text-slate-600 border-slate-200 hover:border-slate-300'
                              }`}
                            >
                              <span className={`w-1.5 h-1.5 rounded-full ${tagSolidBg(mainTag)}`} />
                              {cap(mainTag)}
                            </span>
                          )}
                          {seg.subTag && (
                            <span className="text-yt-text text-[11px] font-medium bg-yt-hover border border-yt-border px-2 py-0.5 rounded-lg">
                              {seg.subTag}
                            </span>
                          )}
                          {hasAnnotation && (
                            <span className="inline-flex items-center gap-1 text-xs text-nb-cyan/60">
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                              </svg>
                            </span>
                          )}
                        </div>
                      )}

                      <div className="flex gap-3 items-start">
                        <span className={`text-xs font-mono shrink-0 mt-0.5 tabular-nums transition-colors ${
                          isActive ? 'text-nb-violet' : 'text-yt-muted group-hover:text-nb-violet'
                        }`}>
                          {fmt(seg.start)}
                        </span>
                        <p className="text-yt-muted text-sm leading-relaxed">{seg.text}</p>
                      </div>

                      {isActive && topic?.sam3Prompt && (
                        <p className="mt-2 text-xs text-nb-cyan/50 italic pl-10">
                          SAM3: &ldquo;{topic.sam3Prompt}&rdquo;
                        </p>
                      )}
                    </button>
                  )
                })}
              </div>
            )}

            {transcriptDone && visibleSegments.length === 0 && activeMainTag && (
              <div className="flex flex-col items-center justify-center h-48 gap-3 p-6 text-center">
                <p className="text-yt-muted text-sm">No segments tagged &quot;{cap(activeMainTag)}&quot;</p>
                <button onClick={() => setActiveMainTag(null)} className="text-nb-violet text-xs hover:underline font-medium">Clear filter</button>
              </div>
            )}

            {transcriptDone && segments.length === 0 && (
              <div className="flex flex-col items-center justify-center h-48 text-center p-6">
                <p className="text-yt-muted text-sm">No speech detected in this video.</p>
              </div>
            )}

            {status === 'FAILED' && (
              <div className="flex flex-col items-center justify-center h-full gap-3 p-8 text-center">
                <div className="w-12 h-12 rounded-2xl bg-nb-red/10 border border-nb-red/20 flex items-center justify-center">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-6 h-6 text-nb-red">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                  </svg>
                </div>
                <p className="text-nb-red text-base font-semibold">Transcription failed</p>
                {failureMessage && <p className="text-yt-muted text-sm max-w-xs">{failureMessage}</p>}
              </div>
            )}
          </div>

          {activeMainTag && transcriptDone && (
            <div className="shrink-0 flex items-center justify-between px-4 md:px-6 py-3 border-t border-yt-border bg-white">
              <span className="text-yt-muted text-xs">
                {visibleSegments.length} segment{visibleSegments.length !== 1 ? 's' : ''} &middot; &ldquo;{cap(activeMainTag)}&rdquo;
              </span>
              <button onClick={() => setActiveMainTag(null)} className="text-xs text-nb-violet hover:text-nb-indigo font-medium transition-colors">
                Clear ×
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
