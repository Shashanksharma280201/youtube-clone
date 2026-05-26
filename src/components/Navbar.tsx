'use client'

import Link from 'next/link'
import { useSession, signOut } from 'next-auth/react'
import { useState, useEffect, useRef } from 'react'
import { useRouter, usePathname } from 'next/navigation'

export default function Navbar() {
  const { data: session } = useSession()
  const router = useRouter()
  const pathname = usePathname()

  const [menuOpen, setMenuOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)

  const menuRef = useRef<HTMLDivElement>(null)
  const mobileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('q')
    if (q) setSearchQuery(q)
  }, [])

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    const q = searchQuery.trim()
    router.push(q ? `/?q=${encodeURIComponent(q)}` : '/')
    setMobileSearchOpen(false)
  }

  function clearSearch() {
    setSearchQuery('')
    router.push('/')
  }

  const isUpload = pathname === '/upload'

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 h-14 flex items-center px-4 md:px-6 gap-3 bg-white transition-shadow duration-200 ${
        scrolled ? 'shadow-[0_1px_0_#e2e8f0,0_4px_16px_rgba(0,0,0,0.06)]' : 'border-b border-yt-border'
      }`}
    >
      {/* Mobile search overlay */}
      {mobileSearchOpen && (
        <div className="absolute inset-0 bg-white flex items-center px-3 gap-2 md:hidden z-10 border-b border-yt-border">
          <button
            onClick={() => setMobileSearchOpen(false)}
            className="shrink-0 w-9 h-9 flex items-center justify-center rounded-xl text-yt-muted hover:text-yt-text hover:bg-yt-hover transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
            </svg>
          </button>
          <form onSubmit={handleSearch} className="flex-1 flex items-center">
            <input
              ref={mobileInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search videos…"
              autoFocus
              className="flex-1 bg-yt-hover border border-yt-border border-r-0 rounded-l-xl pl-4 pr-4 h-9 text-sm text-yt-text placeholder:text-yt-muted focus:outline-none focus:border-nb-violet/50 transition-colors"
            />
            <button
              type="submit"
              className="bg-yt-hover border border-yt-border rounded-r-xl px-4 h-9 flex items-center justify-center text-yt-muted hover:text-yt-text transition-colors"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                <circle cx="11" cy="11" r="8" />
                <path strokeLinecap="round" d="M21 21l-4.35-4.35" />
              </svg>
            </button>
          </form>
        </div>
      )}

      {/* Logo */}
      <Link href="/" onClick={clearSearch} className="flex items-center gap-2 shrink-0 group">
        <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-nb-violet to-nb-indigo flex items-center justify-center shadow-violet-btn transition-all duration-200 group-hover:scale-105">
          <svg viewBox="0 0 24 24" fill="white" className="w-4 h-4 ml-0.5">
            <path d="M8 5v14l11-7z" />
          </svg>
        </div>
        <span className="text-yt-text font-bold text-lg tracking-tight hidden sm:block">
          Nebula<span className="gradient-text">IQ</span>
        </span>
      </Link>

      {/* Search bar — desktop */}
      <form onSubmit={handleSearch} className="hidden md:flex flex-1 max-w-lg items-center mx-2">
        <div className="relative flex-1 group">
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-yt-muted group-focus-within:text-nb-violet transition-colors">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
              <circle cx="11" cy="11" r="8" />
              <path strokeLinecap="round" d="M21 21l-4.35-4.35" />
            </svg>
          </div>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search videos…"
            className="w-full bg-yt-hover border border-yt-border rounded-xl pl-10 pr-9 h-9 text-sm text-yt-text placeholder:text-yt-muted focus:outline-none focus:border-nb-violet/50 focus:bg-white focus:shadow-violet transition-all duration-200"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={clearSearch}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-yt-muted hover:text-yt-text transition-colors"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-3.5 h-3.5">
                <path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </form>

      <div className="flex-1 md:hidden" />

      {/* Right side */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Mobile search icon */}
        <button
          onClick={() => setMobileSearchOpen(true)}
          className="md:hidden w-9 h-9 flex items-center justify-center rounded-xl text-yt-muted hover:text-yt-text hover:bg-yt-hover transition-colors"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
            <circle cx="11" cy="11" r="8" />
            <path strokeLinecap="round" d="M21 21l-4.35-4.35" />
          </svg>
        </button>

        {session ? (
          <>
            {/* Upload button */}
            <Link
              href="/upload"
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-sm font-medium transition-all duration-200 border ${
                isUpload
                  ? 'bg-nb-violet/10 text-nb-violet border-nb-violet/30'
                  : 'bg-white hover:bg-yt-hover text-yt-text border-yt-border hover:border-slate-300'
              }`}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 shrink-0">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
              </svg>
              <span className="hidden sm:inline">Upload</span>
            </Link>

            {/* Avatar + dropdown */}
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setMenuOpen(!menuOpen)}
                className={`w-8 h-8 rounded-xl bg-gradient-to-br from-nb-violet to-nb-indigo flex items-center justify-center text-white font-bold text-sm transition-all duration-200 ${
                  menuOpen ? 'ring-2 ring-nb-violet/40 ring-offset-2' : 'hover:ring-2 hover:ring-nb-violet/25 hover:ring-offset-2'
                }`}
              >
                {session.user.name?.[0]?.toUpperCase()}
              </button>

              {menuOpen && (
                <div className="absolute right-0 mt-2 w-60 bg-white border border-yt-border rounded-2xl shadow-card-md overflow-hidden z-50">
                  {/* User header */}
                  <div className="flex items-center gap-3 px-4 py-4 border-b border-yt-border bg-yt-hover/60">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-nb-violet to-nb-indigo flex items-center justify-center text-white font-bold shrink-0">
                      {session.user.name?.[0]?.toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-yt-text truncate">{session.user.name}</p>
                      <p className="text-xs text-yt-muted truncate">{session.user.email}</p>
                    </div>
                  </div>

                  <div className="p-1.5">
                    <Link
                      href="/upload"
                      onClick={() => setMenuOpen(false)}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-yt-text hover:bg-yt-hover transition-colors group"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4 text-yt-muted group-hover:text-nb-violet shrink-0 transition-colors">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                      </svg>
                      Upload video
                    </Link>

                    <div className="my-1 border-t border-yt-border" />

                    <button
                      onClick={() => { setMenuOpen(false); signOut({ callbackUrl: '/' }) }}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-yt-text hover:bg-yt-hover transition-colors text-left group"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4 text-yt-muted group-hover:text-nb-red shrink-0 transition-colors">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
                      </svg>
                      Sign out
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex items-center gap-2">
            <Link
              href="/login"
              className="text-sm text-yt-text border border-yt-border hover:bg-yt-hover px-4 py-1.5 rounded-xl transition-colors font-medium"
            >
              Sign in
            </Link>
            <Link
              href="/register"
              className="text-sm bg-gradient-to-r from-nb-violet to-nb-indigo text-white px-4 py-1.5 rounded-xl font-medium shadow-violet-btn hover:opacity-90 transition-opacity"
            >
              Register
            </Link>
          </div>
        )}
      </div>
    </header>
  )
}
