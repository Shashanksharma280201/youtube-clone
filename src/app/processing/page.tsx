'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { tagColor } from '@/lib/tagColor'

type TranscriptStatus = 'NONE' | 'PENDING' | 'PROCESSING' | 'DONE' | 'FAILED'
type Segment = { id: number; start: number; end: number; text: string; tags: string[] }

type VideoState = {
  title: string
  status: TranscriptStatus
  segments: Segment[]
  failureMessage: string | null
}

function VideoCard({ id }: { id: string }) {
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startedRef = useRef(false)

  const [state, setState] = useState<VideoState>({
    title: '',
    status: 'PENDING',
    segments: [],
    failureMessage: null,
  })

  function applyData(data: {
    status?: TranscriptStatus
    transcript?: string | null
    message?: string | null
    segments?: Segment[] | null
  }) {
    setState((prev) => {
      const next = { ...prev }
      if (data.status) next.status = data.status
      if (Array.isArray(data.segments) && data.segments.length > 0) next.segments = data.segments
      if ((data.status === 'FAILED') && (data.message || data.transcript)) {
        next.failureMessage = data.message ?? data.transcript ?? null
      }
      return next
    })
  }

  // Fetch title + initial status
  useEffect(() => {
    fetch(`/api/videos/${id}`)
      .then((r) => r.json())
      .then((d) => setState((prev) => ({ ...prev, title: d.title ?? id })))

    fetch(`/api/videos/${id}/transcript`)
      .then((r) => r.json())
      .then(applyData)
  }, [id])

  // Kick off transcription once
  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true

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

  // Poll until done
  useEffect(() => {
    if (state.status === 'DONE' || state.status === 'FAILED') {
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
  }, [id, state.status])

  const isDone = state.status === 'DONE'
  const isFailed = state.status === 'FAILED'
  const isWorking = !isDone && !isFailed

  // Unique tags, capped at 5 for display
  const allTags = Array.from(new Set(state.segments.flatMap((s) => s.tags ?? []))).sort()
  const displayTags = allTags.slice(0, 5)
  const extraTags = allTags.length - displayTags.length

  return (
    <div className={`bg-yt-surface rounded-xl p-5 flex flex-col gap-4 border transition-colors ${
      isDone ? 'border-green-500/30' : isFailed ? 'border-red-500/30' : 'border-yt-border'
    }`}>
      {/* Status badge + title */}
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-yt-text font-medium text-sm leading-snug line-clamp-2 flex-1">
          {state.title || id}
        </h3>
        <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${
          isDone   ? 'bg-green-500/20 text-green-400' :
          isFailed ? 'bg-red-500/20 text-red-400' :
                     'bg-yt-hover text-yt-muted'
        }`}>
          {isDone ? 'Done' : isFailed ? 'Failed' : state.status === 'PROCESSING' ? 'Transcribing' : 'Queued'}
        </span>
      </div>

      {/* Body */}
      <div className="flex-1">
        {isWorking && (
          <div className="flex items-center gap-2 text-yt-muted text-sm">
            <div className="w-4 h-4 border-2 border-yt-red border-t-transparent rounded-full animate-spin shrink-0" />
            {state.status === 'PROCESSING' ? 'Transcribing and tagging…' : 'Waiting to start…'}
          </div>
        )}

        {isDone && (
          <div className="space-y-3">
            <p className="text-yt-muted text-xs">
              {state.segments.length} segments · {allTags.length} topics identified
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
        {isDone && (
          <Link
            href={`/transcribe/${id}`}
            className="flex-1 text-center bg-yt-hover hover:bg-yt-red/20 text-yt-text text-xs py-2 rounded-lg transition-colors"
          >
            Review
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

  const [statuses, setStatuses] = useState<Record<string, TranscriptStatus>>({})

  // Child cards report their status up so we can show the overall banner
  function onStatus(id: string, s: TranscriptStatus) {
    setStatuses((prev) => (prev[id] === s ? prev : { ...prev, [id]: s }))
  }

  // Use a wrapper that merges polling status into parent — but since VideoCard
  // is self-contained, we derive "all done" from polling the same endpoint here.
  // Simpler: track it via an interval at the parent level.
  const allDone = ids.length > 0 && ids.every((id) => statuses[id] === 'DONE' || statuses[id] === 'FAILED')

  // Lightweight parent poll just to update the banner
  useEffect(() => {
    if (ids.length === 0) return
    const interval = setInterval(async () => {
      const results = await Promise.all(
        ids.map((id) => fetch(`/api/videos/${id}/transcript`).then((r) => r.json()).catch(() => ({ status: 'PENDING' })))
      )
      const next: Record<string, TranscriptStatus> = {}
      ids.forEach((id, i) => { next[id] = results[i].status })
      setStatuses(next)
      if (ids.every((id) => next[id] === 'DONE' || next[id] === 'FAILED')) {
        clearInterval(interval)
      }
    }, 3000)
    return () => clearInterval(interval)
  }, [ids.join(',')])

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

  const doneCount = ids.filter((id) => statuses[id] === 'DONE' || statuses[id] === 'FAILED').length

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-yt-text">Processing {ids.length} video{ids.length > 1 ? 's' : ''}</h1>
          {!allDone ? (
            <p className="text-yt-muted text-sm mt-1">
              Transcribing and tagging automatically… {doneCount} of {ids.length} done
            </p>
          ) : (
            <p className="text-green-400 text-sm mt-1 flex items-center gap-1.5">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              All done — every video has been transcribed and tagged
            </p>
          )}
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

      {/* Card grid */}
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
