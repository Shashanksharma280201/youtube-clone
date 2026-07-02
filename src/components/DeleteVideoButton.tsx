'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

// Owner-only button that permanently deletes a video (blob, audio, thumbnails, DB
// rows). Two-step inline confirm so a single click can't nuke a video by accident.
export default function DeleteVideoButton({ videoId }: { videoId: string }) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState(false)

  async function handleDelete() {
    setDeleting(true)
    setError(false)
    try {
      const res = await fetch(`/api/videos/${videoId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(String(res.status))
      router.push('/')
      router.refresh()
    } catch {
      setError(true)
      setDeleting(false)
      setConfirming(false)
    }
  }

  if (confirming) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-yt-muted">Delete permanently?</span>
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="text-xs font-semibold px-3 py-1.5 rounded-xl bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-60"
        >
          {deleting ? 'Deleting…' : 'Confirm'}
        </button>
        <button
          onClick={() => setConfirming(false)}
          disabled={deleting}
          className="text-xs font-medium px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-yt-muted hover:text-yt-text transition-colors"
        >
          Cancel
        </button>
      </div>
    )
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      title="Delete this video"
      className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-red-600 hover:bg-red-50 hover:border-red-200 transition-colors"
    >
      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 5v6m4-6v6" />
      </svg>
      {error ? 'Retry delete' : 'Delete'}
    </button>
  )
}
