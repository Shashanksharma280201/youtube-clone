'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

export default function RegisterPage() {
  const router = useRouter()
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })

    const data = await res.json()
    setLoading(false)

    if (!res.ok) {
      setError(data.error || 'Something went wrong')
      return
    }

    router.push('/login?registered=true')
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-yt-surface border border-yt-border rounded-2xl p-8">
        {/* Logo */}
        <div className="flex justify-center mb-6">
          <div className="bg-yt-red w-10 h-10 rounded flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="white" className="w-6 h-6">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        </div>

        <h1 className="text-2xl font-bold text-center text-yt-text mb-1">Create account</h1>
        <p className="text-yt-muted text-sm text-center mb-8">Join YTClone today</p>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg px-4 py-3 mb-6">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-yt-muted mb-1.5">Full name</label>
            <input
              type="text"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full bg-yt-dark border border-yt-border rounded-lg px-4 py-3 text-yt-text text-sm focus:outline-none focus:border-yt-red transition-colors"
              placeholder="Your name"
            />
          </div>

          <div>
            <label className="block text-sm text-yt-muted mb-1.5">Email address</label>
            <input
              type="email"
              required
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="w-full bg-yt-dark border border-yt-border rounded-lg px-4 py-3 text-yt-text text-sm focus:outline-none focus:border-yt-red transition-colors"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label className="block text-sm text-yt-muted mb-1.5">Password</label>
            <input
              type="password"
              required
              minLength={6}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              className="w-full bg-yt-dark border border-yt-border rounded-lg px-4 py-3 text-yt-text text-sm focus:outline-none focus:border-yt-red transition-colors"
              placeholder="Min. 6 characters"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-yt-red hover:bg-red-700 disabled:opacity-50 text-white font-medium py-3 rounded-lg transition-colors mt-2"
          >
            {loading ? 'Creating account...' : 'Create account'}
          </button>
        </form>

        <p className="text-center text-yt-muted text-sm mt-6">
          Already have an account?{' '}
          <Link href="/login" className="text-yt-red hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
