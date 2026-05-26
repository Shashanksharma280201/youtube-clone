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
    <div className="min-h-screen flex items-center justify-center px-4 py-12 bg-yt-dark">
      <div className="w-full max-w-md">
        <div className="bg-white border border-yt-border rounded-2xl p-8 shadow-card-md">

          {/* Logo + heading */}
          <div className="flex flex-col items-center mb-8">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-nb-violet to-nb-indigo flex items-center justify-center shadow-violet-btn mb-4">
              <svg viewBox="0 0 24 24" fill="white" className="w-6 h-6 ml-0.5">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-yt-text tracking-tight">Create account</h1>
            <p className="text-yt-muted text-sm mt-1">Join NebulaIQ today</p>
          </div>

          {error && (
            <div className="flex items-center gap-2.5 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3 mb-5">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 shrink-0">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-yt-text mb-1.5">Full name</label>
              <input
                type="text"
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full bg-white border border-yt-border rounded-xl px-4 py-2.5 text-yt-text text-sm focus:outline-none focus:border-nb-violet/60 focus:shadow-violet transition-all duration-200 placeholder:text-yt-muted/50"
                placeholder="Your name"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-yt-text mb-1.5">Email address</label>
              <input
                type="email"
                required
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full bg-white border border-yt-border rounded-xl px-4 py-2.5 text-yt-text text-sm focus:outline-none focus:border-nb-violet/60 focus:shadow-violet transition-all duration-200 placeholder:text-yt-muted/50"
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-yt-text mb-1.5">Password</label>
              <input
                type="password"
                required
                minLength={6}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                className="w-full bg-white border border-yt-border rounded-xl px-4 py-2.5 text-yt-text text-sm focus:outline-none focus:border-nb-violet/60 focus:shadow-violet transition-all duration-200 placeholder:text-yt-muted/50"
                placeholder="Min. 6 characters"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-nb-violet to-nb-indigo disabled:opacity-60 text-white font-semibold py-2.5 rounded-xl transition-opacity hover:opacity-90 mt-1 shadow-violet-btn flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  Creating account…
                </>
              ) : 'Create account'}
            </button>
          </form>

          <div className="mt-6 pt-5 border-t border-yt-border text-center">
            <p className="text-yt-muted text-sm">
              Already have an account?{' '}
              <Link href="/login" className="text-nb-violet hover:text-nb-indigo font-semibold transition-colors">
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
