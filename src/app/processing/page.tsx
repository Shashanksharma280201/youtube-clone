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

  const [state, setState] = useState<VideoState>({
    title: '',
    transcriptStatus: 'PENDING',
    annotationStatus: 'NONE',
    segments: [],
    failureMessage: null,
  })

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
      if (data.status === 'FAILED' && (data.message || data.transcript)) next.failureMessage = data.message ?? data.transcript ?? null
      return next
    })
  }

  useEffect(() => {
    fetch(`/api/videos/${id}`).then((r) => r.json()).then((d) => setState((prev) => ({ ...prev, title: d.title ?? id })))
  }, [id])

  useEffect(() => {
    fetch(`/api/videos/${id}/transcript`).then((r) => r.json()).then(applyData)
  }, [id])

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

  useEffect(() => {
    const isFullyDone = state.transcriptStatus === 'DONE' || state.transcriptStatus === 'FAILED'
    if (isFullyDone) { if (pollRef.current) clearInterval(pollRef.current); return }

    pollRef.current = setInterval(async () => {
      try { const data = await fetch(`/api/videos/${id}/transcript`).then((r) => r.json()); applyData(data) } catch { /* ignore */ }
    }, 2000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [id, state.transcriptStatus])

  const transcriptDone = state.transcriptStatus === 'DONE'
  const transcriptFailed = state.transcriptStatus === 'FAILED'
  const isFullyDone = transcriptDone
  const isFailed = transcriptFailed

  const allTags = Array.from(new Set(state.segments.flatMap((s) => s.tags ?? []))).sort()
  const displayTags = allTags.slice(0, 5)
  const extraTags = allTags.length - displayTags.length

  return (
    <div className={`bg-white rounded-2xl border shadow-card flex flex-col overflow-hidden transition-all duration-200 ${
      isFullyDone ? 'border-emerald-200' : isFailed ? 'border-red-200' : 'border-slate-200'
    }`}>
      {/* Top status strip */}
      <div className={`h-1 w-full ${isFullyDone ? 'bg-emerald-400' : isFailed ? 'bg-red-400' : 'bg-nb-violet animate-pulse'}`} />

      <div className="p-5 flex flex-col gap-4">
        {/* Title + badge */}
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-yt-text font-semibold text-sm leading-snug line-clamp-2 flex-1">{state.title || id}</h3>
          <span className={`shrink-0 text-[11px] px-2.5 py-1 rounded-lg font-semibold border ${
            isFullyDone ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
            : isFailed ? 'bg-red-50 text-red-600 border-red-200'
            : 'bg-nb-violet/8 text-nb-violet border-nb-violet/20'
          }`}>
            {isFullyDone ? 'Done' : isFailed ? 'Failed' : state.transcriptStatus === 'PROCESSING' ? 'Transcribing' : 'Queued'}
          </span>
        </div>

        <div className="flex-1">
          {!isFullyDone && !isFailed && (
            <div className="space-y-2.5">
              <div className="flex items-center gap-2.5 text-xs">
                {transcriptDone
                  ? <div className="w-4 h-4 rounded-full bg-emerald-100 flex items-center justify-center shrink-0"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-2.5 h-2.5 text-emerald-600"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg></div>
                  : <div className="w-4 h-4 border-2 border-nb-violet border-t-transparent rounded-full animate-spin shrink-0" />
                }
                <span className={transcriptDone ? 'text-emerald-600' : 'text-yt-muted'}>Transcribing &amp; tagging</span>
              </div>
            </div>
          )}

          {isFullyDone && (
            <div className="space-y-3">
              <p className="text-yt-muted text-xs">{state.segments.length} segments · {allTags.length} topics</p>
              {displayTags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {displayTags.map((tag) => (
                    <span key={tag} className={`px-2 py-0.5 rounded-lg text-xs border ${tagColor(tag)}`}>{tag}</span>
                  ))}
                  {extraTags > 0 && <span className="px-2 py-0.5 rounded-lg text-xs border border-slate-200 text-yt-muted">+{extraTags} more</span>}
                </div>
              )}
            </div>
          )}

          {isFailed && <p className="text-red-500 text-xs">{state.failureMessage ?? 'Transcription failed.'}</p>}
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-3 border-t border-slate-100">
          {isFullyDone && (
            <Link href={`/transcribe/${id}`} className="flex-1 text-center bg-yt-hover hover:bg-nb-violet/8 hover:text-nb-violet text-yt-text text-xs py-2 rounded-xl transition-colors border border-slate-200 font-medium">
              Review &amp; Annotate
            </Link>
          )}
          <Link href={`/watch/${id}`} className="flex-1 text-center bg-gradient-to-r from-nb-violet to-nb-indigo text-white text-xs py-2 rounded-xl font-medium shadow-violet-btn hover:opacity-90 transition-opacity">
            Watch
          </Link>
        </div>
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
        <Link href="/upload" className="bg-gradient-to-r from-nb-violet to-nb-indigo text-white px-5 py-2 rounded-xl text-sm font-medium shadow-violet-btn hover:opacity-90 transition-opacity">
          Upload videos
        </Link>
      </div>
    )
  }

  return (
    <>
      <div className="flex items-start justify-between mb-8 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-yt-text">
            Processing <span className="gradient-text">{ids.length} video{ids.length > 1 ? 's' : ''}</span>
          </h1>
          <p className="text-yt-muted text-sm mt-1">Transcribing, tagging, and annotating automatically…</p>
        </div>
        <div className="flex gap-3">
          <Link href="/upload" className="bg-white hover:bg-yt-hover text-yt-text px-5 py-2 rounded-xl text-sm font-medium border border-yt-border transition-colors">
            Upload more
          </Link>
          <Link href="/" className="bg-gradient-to-r from-nb-violet to-nb-indigo text-white px-5 py-2 rounded-xl text-sm font-medium shadow-violet-btn hover:opacity-90 transition-opacity">
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
          <div className="w-7 h-7 border-2 border-nb-violet border-t-transparent rounded-full animate-spin" />
        </div>
      }>
        <ProcessingGrid />
      </Suspense>
    </div>
  )
}
