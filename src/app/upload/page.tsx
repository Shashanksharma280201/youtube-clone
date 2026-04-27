'use client'

import { useState, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function UploadPage() {
  const { data: session, status } = useSession()
  const router = useRouter()

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [uploadedId, setUploadedId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

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

  if (uploadedId) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center">
          <svg viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2" className="w-8 h-8">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-yt-text">Upload successful!</h2>
        <p className="text-yt-muted text-sm">Your video is now live and visible to everyone.</p>
        <div className="flex gap-3">
          <Link href={`/watch/${uploadedId}`} className="bg-yt-red hover:bg-red-700 text-white px-6 py-2 rounded-full text-sm transition-colors">
            Watch video
          </Link>
          <Link href="/" className="bg-yt-surface hover:bg-yt-hover text-yt-text px-6 py-2 rounded-full text-sm transition-colors">
            Go home
          </Link>
        </div>
      </div>
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!file) { setError('Please select a video file'); return }
    if (!title.trim()) { setError('Please enter a title'); return }

    setError('')
    setUploading(true)

    const formData = new FormData()
    formData.append('title', title)
    formData.append('description', description)
    formData.append('video', file)

    const res = await fetch('/api/upload', { method: 'POST', body: formData })
    const data = await res.json()

    setUploading(false)

    if (!res.ok) {
      setError(data.error || 'Upload failed')
      return
    }

    setUploadedId(data.id)
  }

  return (
    <div className="min-h-screen px-4 py-10 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-yt-text mb-8">Upload video</h1>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg px-4 py-3 mb-6">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* File drop zone */}
        <div
          onClick={() => fileInputRef.current?.click()}
          className="border-2 border-dashed border-yt-border hover:border-yt-red rounded-2xl p-12 text-center cursor-pointer transition-colors"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
          {file ? (
            <div>
              <p className="text-yt-text font-medium">{file.name}</p>
              <p className="text-yt-muted text-sm mt-1">{(file.size / (1024 * 1024)).toFixed(1)} MB</p>
            </div>
          ) : (
            <div>
              <svg viewBox="0 0 24 24" fill="#aaa" className="w-12 h-12 mx-auto mb-4">
                <path d="M17 10.5V7a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h12a1 1 0 001-1v-3.5l4 4v-11l-4 4z" />
              </svg>
              <p className="text-yt-text font-medium mb-1">Click to select a video</p>
              <p className="text-yt-muted text-sm">MP4, WebM, MOV supported</p>
            </div>
          )}
        </div>

        <div>
          <label className="block text-sm text-yt-muted mb-1.5">Title <span className="text-yt-red">*</span></label>
          <input
            type="text"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full bg-yt-surface border border-yt-border rounded-lg px-4 py-3 text-yt-text text-sm focus:outline-none focus:border-yt-red transition-colors"
            placeholder="Give your video a title"
          />
        </div>

        <div>
          <label className="block text-sm text-yt-muted mb-1.5">Description</label>
          <textarea
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full bg-yt-surface border border-yt-border rounded-lg px-4 py-3 text-yt-text text-sm focus:outline-none focus:border-yt-red transition-colors resize-none"
            placeholder="Tell viewers about your video"
          />
        </div>

        <button
          type="submit"
          disabled={uploading}
          className="w-full bg-yt-red hover:bg-red-700 disabled:opacity-50 text-white font-medium py-3 rounded-lg transition-colors flex items-center justify-center gap-2"
        >
          {uploading ? (
            <>
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Uploading...
            </>
          ) : (
            'Upload video'
          )}
        </button>
      </form>
    </div>
  )
}
