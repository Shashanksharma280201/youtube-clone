'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { tagColor } from '@/lib/tagColor'

type TranscriptStatus = 'NONE' | 'PENDING' | 'PROCESSING' | 'DONE' | 'FAILED'
type AnnotationStatus = 'NONE' | 'PENDING' | 'PROCESSING' | 'DONE' | 'FAILED'

type VideoState = {
  title: string
  transcriptStatus: TranscriptStatus
  annotationStatus: AnnotationStatus
  segments: { tags?: string[] }[]
  failureMessage: string | null
}

function VideoCard({ id }: { id: string }) {
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const transcribeStartedRef = useRef(false)
  const annotateStartedRef = useRef(false)

  const [state, setState] = useState<VideoState>({
    title: '',
    transcriptStatus: 'PENDING',
    annotationStatus: 'NONE',
    segments: [],
    failureMessage: null,
  })
  const [sam3Enabled, setSam3Enabled] = useState(false)

  function applyData(data: {
    status?: TranscriptStatus
    annotationStatus?: AnnotationStatus
    segments?: { tags?: string[] }[] | null
    message?: string | null
    transcript?: string | null
  }) {
    setState((prev) => {
      const next = { ...prev }
      if (data.status) next.transcriptStatus = data.status
      if (data.annotationStatus != null) next.annotationStatus = data.annotationStatus
      if (Array.isArray(data.segments) && data.segments.length > 0) next.segments = data.segments
      if (data.status === 'FAILED' && (data.message || data.transcript)) {
        next.failureMessage = data.message ?? data.transcript ?? null
      }
      return next
    })
  }

  // Fetch title
  useEffect(() => {
    fetch(`/api/videos/${id}`)
      .then((r) => r.json())
      .then((d) => setState((prev) => ({ ...prev, title: d.title ?? id })))
  }, [id])

  // Fetch initial transcript + annotation status + sam3Enabled
  useEffect(() => {
    fetch(`/api/videos/${id}/transcript`)
      .then((r) => r.json())
      .then((data) => {
        applyData(data)
        if (data.sam3Enabled != null) setSam3Enabled(!!data.sam3Enabled)
      })
  }, [id])

  // Step 1: kick off transcription once
  useEffect(() => {
    if (transcribeStartedRef.current) return
    transcribeStartedRef.current = true
    fetch(`/api/videos/${id}/transcribe`, { method: 'POST' })
      .then((r) => r.json())
      .then((data) => {
        applyData(data)
        if (data.status === 'DONE' || data.status === 'FAILED') {
          fetch(`/api/videos/${id}/transcript`).then((r) => r.json()).then(applyData).catch(() => {})
        }
      })
      .catch(() => {})
  }, [id])

  // Step 2: kick off annotation once transcription is done (only if sam3Enabled)
  useEffect(() => {
    if (!sam3Enabled) return
    if (state.transcriptStatus !== 'DONE') return
    if (annotateStartedRef.current) return
    if (state.annotationStatus === 'DONE' || state.annotationStatus === 'PROCESSING') return
    annotateStartedRef.current = true
    fetch(`/api/videos/${id}/annotate`, { method: 'POST' })
      .then((r) => r.json())
      .then((data) => {
        if (data.status) setState((prev) => ({ ...prev, annotationStatus: data.status }))
      })
      .catch(() => {})
  }, [id, sam3Enabled, state.transcriptStatus, state.annotationStatus])

  // Poll for both statuses
  useEffect(() => {
    const isFullyDone =
      (state.transcriptStatus === 'DONE' || state.transcriptStatus === 'FAILED') &&
      (state.annotationStatus === 'DONE' || state.annotationStatus === 'FAILED' || state.transcriptStatus === 'FAILED')

    if (isFullyDone) {
      if (pollRef.current) clearInterval(pollRef.current)
      return
    }

    pollRef.current = setInterval(async () => {
      try {
        const data = await fetch(`/api/videos/${id}/transcript`).then((r) => r.json())
        applyData(data)
      } catch { /* ignore */ }
    }, 2000)

    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [id, state.transcriptStatus, state.annotationStatus])

  const transcriptDone = state.transcriptStatus === 'DONE'
  const transcriptFailed = state.transcriptStatus === 'FAILED'
  const annotationDone = state.annotationStatus === 'DONE'
  const annotationFailed = state.annotationStatus === 'FAILED'

  const isFullyDone = transcriptDone && (annotationDone || annotationFailed)
  const isFailed = transcriptFailed

  // Current step label
  let stepLabel = 'Queued'
  let stepColor = 'bg-yt-hover text-yt-muted'
  if (transcriptFailed) {
    stepLabel = 'Failed'
    stepColor = 'bg-red-500/20 text-red-400'
  } else if (!transcriptDone) {
    stepLabel = state.transcriptStatus === 'PROCESSING' ? 'Step 1: Transcribing' : 'Queued'
    stepColor = 'bg-yt-hover text-yt-muted'
  } else if (!annotationDone && !annotationFailed) {
    stepLabel = state.annotationStatus === 'PROCESSING' ? 'Step 2: Annotating' : 'Step 2: Starting…'
    stepColor = 'bg-blue-500/20 text-blue-400'
  } else if (isFullyDone) {
    stepLabel = annotationFailed ? 'Done (annotation failed)' : 'Done'
    stepColor = 'bg-green-500/20 text-green-400'
  }

  const allTags = Array.from(new Set(state.segments.flatMap((s) => s.tags ?? []))).sort()
  const displayTags = allTags.slice(0, 5)
  const extraTags = allTags.length - displayTags.length

  return (
    <div className={`bg-yt-surface rounded-xl p-5 flex flex-col gap-4 border transition-colors ${
      isFullyDone ? 'border-green-500/30' : isFailed ? 'border-red-500/30' : 'border-yt-border'
    }`}>
      {/* Status badge + title */}
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-yt-text font-medium text-sm leading-snug line-clamp-2 flex-1">
          {state.title || id}
        </h3>
        <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${stepColor}`}>
          {stepLabel}
        </span>
      </div>

      {/* Body */}
      <div className="flex-1">
        {!isFullyDone && !isFailed && (
          <div className="space-y-2">
            {/* Step 1 */}
            <div className="flex items-center gap-2 text-xs">
              {transcriptDone
                ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-3.5 h-3.5 text-green-400 shrink-0"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                : <div className="w-3.5 h-3.5 border-2 border-yt-red border-t-transparent rounded-full animate-spin shrink-0" />
              }
              <span className={transcriptDone ? 'text-green-400' : 'text-yt-muted'}>
                Transcribing &amp; tagging
              </span>
            </div>
            {/* Step 2 */}
            <div className="flex items-center gap-2 text-xs">
              {annotationDone
                ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-3.5 h-3.5 text-green-400 shrink-0"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                : transcriptDone
                  ? <div className="w-3.5 h-3.5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin shrink-0" />
                  : <div className="w-3.5 h-3.5 rounded-full border border-yt-border shrink-0" />
              }
              <span className={annotationDone ? 'text-green-400' : transcriptDone ? 'text-blue-400' : 'text-yt-muted/40'}>
                Annotating with SAM3
              </span>
            </div>
          </div>
        )}

        {isFullyDone && (
          <div className="space-y-3">
            <p className="text-yt-muted text-xs">
              {state.segments.length} segments · {allTags.length} topics
            </p>
            {displayTags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {displayTags.map((tag) => (
                  <span key={tag} className={`px-2 py-0.5 rounded-full text-xs border ${tagColor(tag)}`}>
                    {tag}
                  </span>
                ))}
                {extraTags > 0 && (
                  <span className="px-2 py-0.5 rounded-full text-xs border border-yt-border text-yt-muted">
                    +{extraTags} more
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {isFailed && (
          <p className="text-red-400 text-xs">{state.failureMessage ?? 'Transcription failed.'}</p>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-1 border-t border-yt-border">
        {isFullyDone && (
          <Link
            href={`/transcribe/${id}`}
            className="flex-1 text-center bg-yt-hover hover:bg-yt-red/20 text-yt-text text-xs py-2 rounded-lg transition-colors"
          >
            Review &amp; Annotate
          </Link>
        )}
        <Link
          href={`/watch/${id}`}
          className="flex-1 text-center bg-yt-red hover:bg-red-700 text-white text-xs py-2 rounded-lg transition-colors"
        >
          Watch
        </Link>
      </div>
    </div>
  )
}

function ProcessingGrid() {
  const searchParams = useSearchParams()
  const ids = (searchParams.get('ids') ?? '').split(',').filter(Boolean)

  if (ids.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <p className="text-yt-muted">No videos found.</p>
        <Link href="/upload" className="bg-yt-red hover:bg-red-700 text-white px-5 py-2 rounded-full text-sm transition-colors">
          Upload videos
        </Link>
      </div>
    )
  }

  return (
    <>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-yt-text">Processing {ids.length} video{ids.length > 1 ? 's' : ''}</h1>
          <p className="text-yt-muted text-sm mt-1">
            Transcribing, tagging, and annotating with SAM3 automatically…
          </p>
        </div>
        <div className="flex gap-3">
          <Link href="/upload" className="bg-yt-surface hover:bg-yt-hover text-yt-text px-5 py-2 rounded-full text-sm transition-colors">
            Upload more
          </Link>
          <Link href="/" className="bg-yt-red hover:bg-red-700 text-white px-5 py-2 rounded-full text-sm transition-colors">
            Go home
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {ids.map((id) => (
          <VideoCard key={id} id={id} />
        ))}
      </div>
    </>
  )
}

export default function ProcessingPage() {
  return (
    <div className="min-h-screen px-4 py-8 max-w-[1400px] mx-auto">
      <Suspense fallback={
        <div className="flex items-center justify-center h-64">
          <div className="w-8 h-8 border-2 border-yt-red border-t-transparent rounded-full animate-spin" />
        </div>
      }>
        <ProcessingGrid />
      </Suspense>
    </div>
  )
}
