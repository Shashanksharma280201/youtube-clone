'use client'

import { useState, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

interface FileEntry {
  file: File
  title: string
  description: string
  previewUrl?: string | null
}

function extractThumbnail(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.preload = 'metadata'
    video.onloadedmetadata = () => { video.currentTime = Math.min(1, video.duration * 0.1) }
    video.onseeked = () => {
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) { URL.revokeObjectURL(url); resolve(null); return }
      ctx.drawImage(video, 0, 0)
      resolve(canvas.toDataURL('image/jpeg', 0.8))
      URL.revokeObjectURL(url)
    }
    video.onerror = () => { URL.revokeObjectURL(url); resolve(null) }
    video.src = url
  })
}

export default function UploadPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [entries, setEntries] = useState<FileEntry[]>([])
  const [uploadingIdx, setUploadingIdx] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const [sam3Enabled, setSam3Enabled] = useState(false)

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-7 h-7 border-2 border-nb-violet border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!session) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <div className="w-16 h-16 rounded-2xl bg-yt-hover border border-yt-border flex items-center justify-center mb-2">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-8 h-8 text-slate-400">
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
          </svg>
        </div>
        <p className="text-yt-muted text-sm">You need to be signed in to upload videos.</p>
        <Link href="/login" className="bg-gradient-to-r from-nb-violet to-nb-indigo text-white px-6 py-2.5 rounded-xl font-medium shadow-violet-btn hover:opacity-90 transition-opacity">
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
        newEntries.push({ file, title: file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '), description: '', previewUrl: undefined })
      }
    }
    if (newEntries.length === 0) return
    setEntries((prev) => {
      const startIdx = prev.length
      const combined = [...prev, ...newEntries]
      newEntries.forEach((entry, i) => {
        extractThumbnail(entry.file).then((url) => {
          setEntries((cur) => cur.map((e, j) => (j === startIdx + i ? { ...e, previewUrl: url } : e)))
        })
      })
      return combined
    })
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

      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), description, filename: file.name, contentType: file.type, sam3Enabled }),
      })
      const data = await res.json()
      if (!res.ok) { setError(`"${title}" failed: ${data.error ?? 'Upload error'}`); setUploadingIdx(null); return }

      const s3Res = await fetch(data.uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } })
      if (!s3Res.ok) { setError(`"${title}" failed: S3 upload error`); setUploadingIdx(null); return }

      ids.push(data.id)
    }

    setUploadingIdx(null)
    if (ids.length === 1) router.push(`/transcribe/${ids[0]}`)
    else router.push(`/processing?ids=${ids.join(',')}`)
  }

  const isUploading = uploadingIdx !== null

  return (
    <div className="min-h-screen bg-yt-dark">
      {/* Page header */}
      <div className="border-b border-yt-border px-6 md:px-10 xl:px-16 py-5 bg-white">
        <h1 className="text-xl font-bold text-yt-text">Upload videos</h1>
        <p className="text-yt-muted text-sm mt-0.5">
          Drop your videos — NebulaIQ will transcribe, tag, and create chapters automatically.
        </p>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mx-6 md:mx-10 xl:mx-16 mt-4 flex items-start gap-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 mt-0.5 shrink-0">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="flex flex-col lg:flex-row gap-0 min-h-[calc(100vh-73px)]">

          {/* LEFT: Drop zone */}
          <div className="lg:w-[400px] xl:w-[460px] shrink-0 border-b lg:border-b-0 lg:border-r border-yt-border bg-white">
            <div className="lg:sticky lg:top-14 p-6 md:p-10 xl:p-12 flex flex-col gap-6">

              {/* Drop zone */}
              <div
                onClick={() => !isUploading && fileInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => { e.preventDefault(); setIsDragging(false); addFiles(e.dataTransfer.files) }}
                className={`relative rounded-2xl border-2 border-dashed flex flex-col items-center justify-center text-center transition-all duration-200 min-h-[280px] lg:min-h-[340px] p-8 ${
                  isUploading
                    ? 'border-yt-border opacity-50 cursor-not-allowed bg-yt-surface2'
                    : isDragging
                    ? 'border-nb-violet bg-nb-violet/5 scale-[1.01] cursor-copy'
                    : 'border-yt-border hover:border-nb-violet/50 hover:bg-yt-surface2 cursor-pointer'
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
                <div className={`mb-5 transition-all duration-200 ${isDragging ? 'scale-110' : ''}`}>
                  <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mx-auto transition-all duration-200 ${
                    isDragging ? 'bg-nb-violet/10 border border-nb-violet/30' : 'bg-yt-hover border border-yt-border'
                  }`}>
                    <svg viewBox="0 0 24 24" fill="none" stroke={isDragging ? '#7c3aed' : '#94a3b8'} strokeWidth="1.5" className="w-8 h-8">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                    </svg>
                  </div>
                </div>
                <p className={`text-base font-semibold mb-1 ${isDragging ? 'text-nb-violet' : 'text-yt-text'}`}>
                  {isDragging ? 'Drop to add videos' : entries.length > 0 ? 'Add more videos' : 'Drag & drop videos here'}
                </p>
                <p className="text-yt-muted text-sm mb-5">or click to browse your files</p>
                <div className="flex flex-wrap justify-center gap-1.5">
                  {['MP4', 'WebM', 'MOV', 'AVI', 'MKV'].map((fmt) => (
                    <span key={fmt} className="text-[11px] font-mono px-2.5 py-1 rounded-lg bg-yt-hover border border-yt-border text-slate-500">
                      {fmt}
                    </span>
                  ))}
                </div>
              </div>

              {/* Pipeline steps */}
              <div className="space-y-2">
                <p className="text-[11px] font-semibold text-yt-muted uppercase tracking-widest mb-3">What happens after upload</p>
                {[
                  { icon: '🎙', label: 'Groq Whisper', desc: 'Speech-to-text in ~10 seconds' },
                  { icon: '🏷', label: 'GPT Tagging', desc: 'Phases + subtitles per segment' },
                  { icon: '🖼', label: 'Auto chapters', desc: 'Thumbnails extracted per chapter' },
                ].map((step) => (
                  <div key={step.label} className="flex items-center gap-3 px-3.5 py-3 rounded-xl bg-yt-surface2 border border-yt-border">
                    <span className="text-xl shrink-0">{step.icon}</span>
                    <div>
                      <p className="text-yt-text text-xs font-semibold">{step.label}</p>
                      <p className="text-yt-muted text-[11px]">{step.desc}</p>
                    </div>
                  </div>
                ))}

                {/* SAM3 toggle */}
                <button
                  type="button"
                  onClick={() => setSam3Enabled((v) => !v)}
                  disabled={isUploading}
                  className={`w-full flex items-center justify-between gap-3 px-3.5 py-3 rounded-xl border transition-all duration-200 ${
                    sam3Enabled
                      ? 'bg-cyan-50 border-cyan-200'
                      : 'bg-yt-surface2 border-yt-border hover:border-slate-300'
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-xl shrink-0">🔬</span>
                    <div className="text-left min-w-0">
                      <p className={`text-xs font-semibold ${sam3Enabled ? 'text-nb-cyan' : 'text-yt-text'}`}>SAM3 Annotation</p>
                      <p className="text-yt-muted text-[11px]">AI segments objects per chapter</p>
                    </div>
                  </div>
                  <span className={`relative inline-flex shrink-0 w-8 h-[18px] rounded-full transition-all duration-200 ${sam3Enabled ? 'bg-nb-cyan' : 'bg-slate-300'}`}>
                    <span className={`absolute top-[3px] left-[3px] w-3 h-3 rounded-full bg-white shadow transition-transform duration-200 ${sam3Enabled ? 'translate-x-[14px]' : 'translate-x-0'}`} />
                  </span>
                </button>
              </div>
            </div>
          </div>

          {/* RIGHT: File queue */}
          <div className="flex-1 min-w-0 flex flex-col">
            <div className="flex-1 p-6 md:p-10 xl:p-12">

              {entries.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center gap-4 text-center py-20">
                  <div className="w-20 h-20 rounded-2xl bg-yt-hover border border-yt-border flex items-center justify-center">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-9 h-9 text-slate-400">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-yt-text font-semibold">No videos selected</p>
                    <p className="text-yt-muted text-sm mt-1">Drop or click the panel on the left to add videos</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <p className="text-yt-muted text-sm mb-2">
                    <span className="text-yt-text font-semibold">{entries.length}</span> video{entries.length !== 1 ? 's' : ''} queued
                  </p>

                  {entries.map((entry, i) => {
                    const isActive = uploadingIdx === i
                    const isDone = uploadingIdx !== null && i < uploadingIdx

                    return (
                      <div
                        key={entry.file.name + i}
                        className={`rounded-2xl border transition-all duration-200 overflow-hidden ${
                          isActive
                            ? 'border-nb-violet/40 bg-nb-violet/3 shadow-card-md'
                            : isDone
                            ? 'border-emerald-200 bg-emerald-50/50'
                            : 'border-slate-200 bg-white shadow-card'
                        }`}
                      >
                        {/* Thumbnail */}
                        <div className="relative w-full aspect-video bg-yt-hover overflow-hidden">
                          {entry.previewUrl === undefined && <div className="absolute inset-0 shimmer" />}
                          {entry.previewUrl && (
                            <img src={entry.previewUrl} alt={entry.title} className="w-full h-full object-cover" />
                          )}
                          {entry.previewUrl === null && (
                            <div className="absolute inset-0 flex items-center justify-center bg-yt-hover">
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" className="w-12 h-12 text-slate-300">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
                              </svg>
                            </div>
                          )}
                          <span className="absolute bottom-2 right-2 bg-black/60 text-white text-[10px] font-mono px-2 py-0.5 rounded-lg">
                            {(entry.file.size / 1024 / 1024).toFixed(1)} MB
                          </span>
                          {isActive && (
                            <div className="absolute inset-0 bg-black/40 flex flex-col items-center justify-center gap-2">
                              <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin" />
                              <p className="text-white text-xs font-medium">Uploading…</p>
                            </div>
                          )}
                          {isDone && (
                            <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
                              <div className="w-10 h-10 rounded-full bg-emerald-500/90 flex items-center justify-center">
                                <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" className="w-5 h-5">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                </svg>
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Card header */}
                        <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100">
                          <p className="text-yt-text text-sm font-medium truncate min-w-0">{entry.file.name}</p>
                          {!isUploading && (
                            <button
                              type="button"
                              onClick={() => removeEntry(i)}
                              className="w-7 h-7 flex items-center justify-center rounded-lg text-yt-muted hover:text-red-500 hover:bg-red-50 transition-colors shrink-0 ml-3"
                            >
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
                                <path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          )}
                        </div>

                        {/* Inputs */}
                        <div className="px-4 py-4 space-y-3">
                          <div>
                            <label className="block text-[11px] font-semibold text-yt-muted uppercase tracking-widest mb-1.5">
                              Title <span className="text-nb-violet">*</span>
                            </label>
                            <input
                              type="text"
                              required
                              value={entry.title}
                              onChange={(e) => updateEntry(i, 'title', e.target.value)}
                              disabled={isUploading}
                              placeholder="Enter a title…"
                              className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-yt-text text-sm focus:outline-none focus:border-nb-violet/50 focus:shadow-violet placeholder:text-slate-300 transition-all disabled:opacity-50"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] font-semibold text-yt-muted uppercase tracking-widest mb-1.5">
                              Description <span className="text-slate-300 normal-case">(optional)</span>
                            </label>
                            <input
                              type="text"
                              value={entry.description}
                              onChange={(e) => updateEntry(i, 'description', e.target.value)}
                              disabled={isUploading}
                              placeholder="What's this video about?"
                              className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-yt-text text-sm focus:outline-none focus:border-nb-violet/50 focus:shadow-violet placeholder:text-slate-300 transition-all disabled:opacity-50"
                            />
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Submit — sticky bottom */}
            {entries.length > 0 && (
              <div className="sticky bottom-0 bg-white border-t border-yt-border px-6 md:px-10 xl:px-12 py-4">
                <button
                  type="submit"
                  disabled={isUploading}
                  className="w-full bg-gradient-to-r from-nb-violet to-nb-indigo disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold py-3 rounded-xl transition-opacity hover:opacity-90 flex items-center justify-center gap-2.5 text-sm shadow-violet-btn"
                >
                  {isUploading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
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
