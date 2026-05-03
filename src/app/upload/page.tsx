'use client'

import { useState, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

interface FileEntry {
  file: File
  title: string
  description: string
}

function FileSvg({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <rect x="2" y="2" width="20" height="20" rx="4" fill="currentColor" opacity="0.15" />
      <path d="M9 8.5L16 12L9 15.5V8.5Z" fill="currentColor" opacity="0.8" />
    </svg>
  )
}

export default function UploadPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [entries, setEntries] = useState<FileEntry[]>([])
  const [uploadingIdx, setUploadingIdx] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [isDragging, setIsDragging] = useState(false)

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-yt-red border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!session) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <p className="text-yt-muted">You need to be signed in to upload videos.</p>
        <Link href="/login" className="bg-yt-red hover:bg-red-700 text-white px-6 py-2 rounded-full transition-colors">
          Sign in
        </Link>
      </div>
    )
  }

  function addFiles(fileList: FileList | null) {
    if (!fileList) return
    const existing = new Set(entries.map((e) => e.file.name + e.file.size))
    const newEntries: FileEntry[] = []
    for (const file of Array.from(fileList)) {
      if (!existing.has(file.name + file.size)) {
        newEntries.push({
          file,
          title: file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '),
          description: '',
        })
      }
    }
    setEntries((prev) => [...prev, ...newEntries])
  }

  function removeEntry(idx: number) {
    setEntries((prev) => prev.filter((_, i) => i !== idx))
  }

  function updateEntry(idx: number, field: 'title' | 'description', value: string) {
    setEntries((prev) => prev.map((e, i) => (i === idx ? { ...e, [field]: value } : e)))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (entries.length === 0) { setError('Select at least one video'); return }
    if (entries.some((e) => !e.title.trim())) { setError('Every video needs a title'); return }

    setError('')
    const ids: string[] = []

    for (let i = 0; i < entries.length; i++) {
      setUploadingIdx(i)
      const { file, title, description } = entries[i]
      const fd = new FormData()
      fd.append('video', file)
      fd.append('title', title.trim())
      fd.append('description', description)

      const res = await fetch('/api/upload', { method: 'POST', body: fd })
      const data = await res.json()

      if (!res.ok) {
        setError(`"${title}" failed: ${data.error ?? 'Upload error'}`)
        setUploadingIdx(null)
        return
      }
      ids.push(data.id)
    }

    setUploadingIdx(null)
    router.push(`/processing?ids=${ids.join(',')}`)
  }

  const isUploading = uploadingIdx !== null

  return (
    <div className="min-h-screen">
      {/* Page header */}
      <div className="border-b border-yt-border px-6 md:px-10 xl:px-16 py-5">
        <h1 className="text-2xl font-bold text-yt-text tracking-tight">Upload videos</h1>
        <p className="text-yt-muted text-sm mt-1">
          Drop your videos — we&apos;ll transcribe, tag, and create chapters automatically.
        </p>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mx-6 md:mx-10 xl:mx-16 mt-4 flex items-start gap-3 bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-xl px-4 py-3">
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 mt-0.5 shrink-0">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
          </svg>
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="flex flex-col lg:flex-row gap-0 min-h-[calc(100vh-73px)]">

          {/* ─────────── LEFT: Drop zone (sticky) ─────────── */}
          <div className="lg:w-[400px] xl:w-[460px] shrink-0 border-b lg:border-b-0 lg:border-r border-yt-border">
            <div className="lg:sticky lg:top-0 p-6 md:p-10 xl:p-12 flex flex-col gap-6">

              {/* Drop zone */}
              <div
                onClick={() => !isUploading && fileInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => { e.preventDefault(); setIsDragging(false); addFiles(e.dataTransfer.files) }}
                className={`relative rounded-2xl border-2 border-dashed flex flex-col items-center justify-center text-center transition-all duration-200 min-h-[280px] lg:min-h-[360px] p-10 ${
                  isUploading
                    ? 'border-yt-border opacity-50 cursor-not-allowed'
                    : isDragging
                    ? 'border-yt-red bg-yt-red/5 scale-[1.01] cursor-copy shadow-[0_0_40px_rgba(255,0,0,0.15)]'
                    : 'border-yt-border hover:border-yt-red hover:bg-yt-surface/50 cursor-pointer hover:shadow-[0_0_30px_rgba(255,0,0,0.08)]'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/*"
                  multiple
                  className="hidden"
                  onChange={(e) => addFiles(e.target.files)}
                  disabled={isUploading}
                />
                <div className={`mb-5 transition-colors ${isDragging ? 'text-yt-red' : 'text-yt-muted'}`}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" className="w-16 h-16">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                  </svg>
                </div>
                <p className={`text-lg font-semibold mb-1.5 transition-colors ${isDragging ? 'text-yt-red' : 'text-yt-text'}`}>
                  {isDragging ? 'Drop to add videos' : entries.length > 0 ? 'Add more videos' : 'Drag & drop videos here'}
                </p>
                <p className="text-yt-muted text-sm mb-6">or click to browse your files</p>
                <div className="flex flex-wrap justify-center gap-2">
                  {['MP4', 'WebM', 'MOV', 'AVI', 'MKV'].map((fmt) => (
                    <span key={fmt} className="text-[11px] font-mono px-2.5 py-1 rounded-lg bg-yt-dark border border-yt-border text-yt-muted">
                      {fmt}
                    </span>
                  ))}
                </div>
              </div>

              {/* Pipeline info */}
              <div className="space-y-2.5">
                <p className="text-yt-muted text-xs font-medium uppercase tracking-widest mb-3">What happens after upload</p>
                {[
                  { icon: '🎙', label: 'Groq Whisper', desc: 'Speech-to-text in ~10 seconds' },
                  { icon: '🏷', label: 'GPT Tagging', desc: 'Phases + subtitles per segment' },
                  { icon: '🖼', label: 'Auto chapters', desc: 'Thumbnails extracted per chapter' },
                ].map((step) => (
                  <div key={step.label} className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-yt-surface">
                    <span className="text-lg">{step.icon}</span>
                    <div>
                      <p className="text-yt-text text-xs font-semibold">{step.label}</p>
                      <p className="text-yt-muted text-[11px]">{step.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ─────────── RIGHT: File queue ─────────── */}
          <div className="flex-1 min-w-0 flex flex-col">
            <div className="flex-1 p-6 md:p-10 xl:p-12">

              {entries.length === 0 ? (
                /* Empty state */
                <div className="h-full flex flex-col items-center justify-center gap-4 text-center py-20">
                  <div className="w-20 h-20 rounded-2xl bg-yt-surface flex items-center justify-center">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-9 h-9 text-yt-muted">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-yt-text font-semibold text-lg">No videos selected</p>
                    <p className="text-yt-muted text-sm mt-1">Drop or click the panel on the left to add videos</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-yt-muted text-sm">
                      <span className="text-yt-text font-semibold">{entries.length}</span> video{entries.length !== 1 ? 's' : ''} queued
                    </p>
                  </div>

                  {entries.map((entry, i) => {
                    const isActive = uploadingIdx === i
                    const isDone = uploadingIdx !== null && i < uploadingIdx

                    return (
                      <div
                        key={entry.file.name + i}
                        className={`rounded-2xl border transition-all duration-200 overflow-hidden ${
                          isActive
                            ? 'border-yt-red/60 bg-yt-red/5 shadow-[0_0_20px_rgba(255,0,0,0.1)]'
                            : isDone
                            ? 'border-green-500/30 bg-green-500/5'
                            : 'border-yt-border bg-yt-surface'
                        }`}
                      >
                        {/* Card header */}
                        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
                          <div className="flex items-center gap-3 min-w-0">
                            {isActive ? (
                              <div className="w-5 h-5 border-2 border-yt-red border-t-transparent rounded-full animate-spin shrink-0" />
                            ) : isDone ? (
                              <svg viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5" className="w-5 h-5 shrink-0">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                            ) : (
                              <FileSvg className="w-5 h-5 shrink-0 text-yt-muted" />
                            )}
                            <div className="min-w-0">
                              <p className="text-yt-text text-sm font-medium truncate">{entry.file.name}</p>
                              <p className="text-yt-muted text-xs">{(entry.file.size / 1024 / 1024).toFixed(1)} MB</p>
                            </div>
                          </div>
                          {!isUploading && (
                            <button
                              type="button"
                              onClick={() => removeEntry(i)}
                              className="w-8 h-8 flex items-center justify-center rounded-full text-yt-muted hover:text-red-400 hover:bg-red-400/10 transition-colors shrink-0 ml-3 text-xl leading-none"
                            >
                              ×
                            </button>
                          )}
                        </div>

                        {/* Inputs */}
                        <div className="px-5 py-4 space-y-3">
                          <div>
                            <label className="block text-yt-muted text-[11px] font-semibold uppercase tracking-widest mb-1.5">
                              Title <span className="text-yt-red">*</span>
                            </label>
                            <input
                              type="text"
                              required
                              value={entry.title}
                              onChange={(e) => updateEntry(i, 'title', e.target.value)}
                              disabled={isUploading}
                              placeholder="Enter a title…"
                              className="w-full bg-yt-dark border border-yt-border rounded-xl px-4 py-2.5 text-yt-text text-sm focus:outline-none focus:border-yt-red placeholder:text-yt-muted/40 transition-colors disabled:opacity-50"
                            />
                          </div>
                          <div>
                            <label className="block text-yt-muted text-[11px] font-semibold uppercase tracking-widest mb-1.5">
                              Description <span className="text-yt-muted/40 normal-case">(optional)</span>
                            </label>
                            <input
                              type="text"
                              value={entry.description}
                              onChange={(e) => updateEntry(i, 'description', e.target.value)}
                              disabled={isUploading}
                              placeholder="What's this video about?"
                              className="w-full bg-yt-dark border border-yt-border rounded-xl px-4 py-2.5 text-yt-text text-sm focus:outline-none focus:border-yt-red placeholder:text-yt-muted/40 transition-colors disabled:opacity-50"
                            />
                          </div>
                        </div>

                        {/* Status footer */}
                        {(isActive || isDone) && (
                          <div className="px-5 pb-4">
                            {isActive && (
                              <>
                                <div className="h-0.5 bg-yt-dark rounded-full overflow-hidden">
                                  <div className="h-full bg-yt-red rounded-full w-1/2 animate-pulse" />
                                </div>
                                <p className="text-yt-red text-xs mt-1.5 font-medium">Uploading…</p>
                              </>
                            )}
                            {isDone && (
                              <p className="text-green-400 text-xs flex items-center gap-1.5 font-medium">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-3.5 h-3.5">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                </svg>
                                Uploaded successfully
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Submit — sticky at bottom of right column */}
            {entries.length > 0 && (
              <div className="sticky bottom-0 bg-yt-dark/95 backdrop-blur border-t border-yt-border px-6 md:px-10 xl:px-12 py-4">
                <button
                  type="submit"
                  disabled={isUploading}
                  className="w-full bg-yt-red hover:bg-red-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold py-3.5 rounded-xl transition-colors flex items-center justify-center gap-2.5 text-sm tracking-wide"
                >
                  {isUploading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Uploading {uploadingIdx! + 1} of {entries.length}…
                    </>
                  ) : (
                    <>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                      </svg>
                      Upload {entries.length} video{entries.length !== 1 ? 's' : ''}
                    </>
                  )}
                </button>
                <p className="text-center text-yt-muted text-xs mt-2">
                  Transcription and chapter generation starts automatically after upload.
                </p>
              </div>
            )}
          </div>
        </div>
      </form>
    </div>
  )
}
