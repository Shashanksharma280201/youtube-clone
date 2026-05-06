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

  // Correction mode
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
    return segments
      .map((s, i) => ({ ...s, originalIdx: i }))
      .filter((s) => activeMainTag ? getMainTag(s) === activeMainTag : true)
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
          fetch(`/api/videos/${id}/transcript`).then((r) => r.json()).then(applyTranscriptData).catch(() => {})
        }
      })
      .catch(() => {})
  }, [id, transcribeStarted])

  // Trigger annotation once transcript is done (only if sam3Enabled)
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

  // Poll until everything is done
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

  // Sync canvas bitmap size to video native dimensions on load
  useEffect(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return
    function onMeta() {
      canvas!.width = video!.videoWidth
      canvas!.height = video!.videoHeight
    }
    video.addEventListener('loadedmetadata', onMeta)
    if (video.readyState >= 1) onMeta()
    return () => video.removeEventListener('loadedmetadata', onMeta)
  }, [videoUrl])

  // Draw polygons on canvas whenever active segment changes
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

    ctx.strokeStyle = 'rgba(0, 210, 255, 0.9)'
    ctx.fillStyle = 'rgba(0, 210, 255, 0.12)'
    ctx.lineWidth = 2

    for (const polygon of masks) {
      if (!polygon.length) continue
      ctx.beginPath()
      polygon.forEach(([x, y], i) => {
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
      })
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
    }
  }, [activeSegmentIdx, topicSegments])

  // Track active segment from video time
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

  // Capture current video frame as base64 JPEG
  function captureFrame(): string | null {
    const video = videoRef.current
    if (!video || !video.videoWidth) return null
    const tmp = document.createElement('canvas')
    tmp.width = video.videoWidth
    tmp.height = video.videoHeight
    tmp.getContext('2d')!.drawImage(video, 0, 0)
    return tmp.toDataURL('image/jpeg', 0.85).split(',')[1]
  }

  // Click on canvas in correction mode → re-annotate that segment
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
          if (seg) {
            updated[activeSegmentIdx] = {
              ...seg,
              annotationFrames: [{ time: seg.start, masks: data.masks }],
            }
          }
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

      {/* ── Top bar ── */}
      <div className="shrink-0 flex items-center justify-between px-5 md:px-8 py-3 border-b border-yt-border bg-yt-dark/95 backdrop-blur z-20">
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/" className="text-yt-muted hover:text-yt-text transition-colors shrink-0">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
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
          {/* Status badges */}
          {transcriptDone && (
            <span className="hidden sm:flex items-center gap-1.5 text-green-400 text-xs font-medium bg-green-400/10 border border-green-400/20 px-3 py-1 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
              {segments.length} segments
            </span>
          )}
          {annotating && (
            <span className="hidden sm:flex items-center gap-1.5 text-blue-400 text-xs font-medium bg-blue-400/10 border border-blue-400/20 px-3 py-1 rounded-full">
              <span className="w-2.5 h-2.5 border border-blue-400 border-t-transparent rounded-full animate-spin" />
              Annotating…
            </span>
          )}
          {annotationDone && !correctionMode && (
            <button
              onClick={() => setCorrectionMode(true)}
              className="hidden sm:flex items-center gap-1.5 text-xs font-medium bg-yt-surface hover:bg-yt-hover text-yt-muted hover:text-yt-text px-3 py-1.5 rounded-full border border-yt-border transition-colors"
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
              className="flex items-center gap-1.5 text-xs font-medium bg-blue-500/20 text-blue-400 border border-blue-400/30 px-3 py-1.5 rounded-full"
            >
              {isAnnotating
                ? <span className="w-3 h-3 border border-blue-400 border-t-transparent rounded-full animate-spin" />
                : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              }
              {isAnnotating ? 'Annotating…' : 'Exit correction'}
            </button>
          )}
          {isWorking && (
            <span className="flex items-center gap-1.5 text-yt-muted text-xs">
              <span className="w-3 h-3 rounded-full border-2 border-yt-red border-t-transparent animate-spin" />
              <span className="hidden sm:inline">Transcribing…</span>
            </span>
          )}
          {transcriptDone && (
            <Link
              href={`/watch/${id}`}
              className="bg-yt-red hover:bg-red-700 text-white px-4 py-1.5 rounded-full text-xs font-medium transition-colors"
            >
              Publish →
            </Link>
          )}
          {!transcriptDone && (
            <Link
              href={`/watch/${id}`}
              className="bg-yt-surface hover:bg-yt-hover text-yt-text px-4 py-1.5 rounded-full text-xs font-medium transition-colors border border-yt-border"
            >
              Watch
            </Link>
          )}
        </div>
      </div>

      {/* ── Correction mode banner ── */}
      {correctionMode && (
        <div className="shrink-0 flex items-center gap-2 px-5 py-2 bg-blue-500/10 border-b border-blue-500/20 text-blue-300 text-xs">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 shrink-0">
            <circle cx="12" cy="12" r="10" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 16v-4m0-4h.01" />
          </svg>
          Correction mode — pause the video and click on any object to re-annotate the active segment. Click anywhere outside the object to clear it.
        </div>
      )}

      {/* ── Main layout ── */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">

        {/* ─── LEFT: Video + canvas ─── */}
        <div className="shrink-0 lg:w-[55%] xl:w-[60%] flex flex-col border-b lg:border-b-0 lg:border-r border-yt-border bg-black/30">
          <div className={`relative w-full aspect-video bg-black ${correctionMode ? 'ring-2 ring-blue-500/40' : ''}`}>
            {videoUrl ? (
              <>
                <video ref={videoRef} src={videoUrl} controls className="w-full h-full" />
                <canvas
                  ref={canvasRef}
                  onClick={handleCanvasClick}
                  className={`absolute inset-0 w-full h-full transition-colors ${
                    correctionMode
                      ? 'cursor-crosshair'
                      : 'pointer-events-none'
                  }`}
                />
                {/* Correction target indicator */}
                {correctionMode && activeSegmentIdx !== null && (
                  <div className="absolute top-3 left-3 bg-black/70 backdrop-blur text-blue-300 text-xs px-2.5 py-1 rounded-full border border-blue-400/30">
                    Segment {activeSegmentIdx + 1} · {topicSegments[activeSegmentIdx]?.sam3Prompt ?? topicSegments[activeSegmentIdx]?.subTag ?? ''}
                  </div>
                )}
              </>
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <div className="w-10 h-10 border-2 border-yt-red border-t-transparent rounded-full animate-spin" />
              </div>
            )}
          </div>

          {/* Info bar */}
          {transcriptDone && segments.length > 0 && (
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
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.595.33a18.095 18.095 0 005.223-5.223c.542-.815.369-1.896-.33-2.595L9.568 3z" /><path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6z" />
                  </svg>
                  <span className="text-yt-muted text-xs">{allMainTags.length} phases</span>
                </div>
              )}
              {annotationDone && (
                <div className="flex items-center gap-1.5">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5 text-blue-400">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                  </svg>
                  <span className="text-blue-400 text-xs">SAM3 annotated</span>
                </div>
              )}
            </div>
          )}

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
          {/* Phase filter */}
          {transcriptDone && allMainTags.length > 0 && (
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

          {/* Segment list */}
          <div className="flex-1 overflow-y-auto">
            {isWorking && (
              <div className="flex flex-col items-center justify-center h-full gap-4 p-8">
                <div className="w-12 h-12 border-2 border-yt-red border-t-transparent rounded-full animate-spin" />
                <div className="text-center">
                  <p className="text-yt-muted text-sm">Waiting for transcript…</p>
                  <p className="text-yt-muted text-xs mt-1">This panel will update automatically</p>
                </div>
              </div>
            )}

            {transcriptDone && visibleSegments.length > 0 && (
              <div className="divide-y divide-yt-border/30">
                {visibleSegments.map((seg) => {
                  const isActive = activeSegmentIdx === seg.originalIdx
                  const mainTag = getMainTag(seg)
                  const topic = topicSegments[seg.originalIdx]
                  const hasAnnotation = (topic?.annotationFrames?.length ?? 0) > 0 &&
                    (topic?.annotationFrames?.[0]?.masks?.length ?? 0) > 0

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
                      {/* Tags row */}
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
                          {/* Annotation indicator */}
                          {hasAnnotation && (
                            <span className="inline-flex items-center gap-1 text-xs text-blue-400/70">
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                              </svg>
                            </span>
                          )}
                        </div>
                      )}

                      {/* Time + text */}
                      <div className="flex gap-3 items-start">
                        <span className={`text-xs font-mono shrink-0 mt-0.5 transition-colors ${
                          isActive ? 'text-yt-red' : 'text-yt-muted group-hover:text-yt-red'
                        }`}>
                          {fmt(seg.start)}
                        </span>
                        <p className="text-yt-muted text-sm leading-relaxed">{seg.text}</p>
                      </div>

                      {/* SAM3 prompt (shown when active + annotated) */}
                      {isActive && topic?.sam3Prompt && (
                        <p className="mt-2 text-xs text-blue-400/60 italic pl-10">
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
                <button onClick={() => setActiveMainTag(null)} className="text-yt-red text-xs hover:underline font-medium">
                  Clear filter
                </button>
              </div>
            )}

            {transcriptDone && segments.length === 0 && (
              <div className="flex flex-col items-center justify-center h-48 text-center p-6">
                <p className="text-yt-muted text-sm">No speech detected in this video.</p>
              </div>
            )}

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

          {activeMainTag && transcriptDone && (
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
