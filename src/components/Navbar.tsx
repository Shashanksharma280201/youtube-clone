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

  // Populate search box from URL on first mount
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('q')
    if (q) setSearchQuery(q)
  }, [])

  // Scroll shadow
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Close user dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
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
      className={`fixed top-0 left-0 right-0 z-50 h-14 flex items-center px-4 md:px-6 gap-3 border-b border-yt-border transition-all duration-200 ${
        scrolled
          ? 'bg-yt-dark/95 backdrop-blur-md shadow-[0_2px_12px_rgba(0,0,0,0.5)]'
          : 'bg-yt-dark'
      }`}
    >
      {/* ── Mobile search overlay ── */}
      {mobileSearchOpen && (
        <div className="absolute inset-0 bg-yt-dark flex items-center px-3 gap-2 md:hidden z-10 border-b border-yt-border">
          <button
            onClick={() => setMobileSearchOpen(false)}
            className="shrink-0 w-9 h-9 flex items-center justify-center rounded-full text-yt-muted hover:text-yt-text hover:bg-yt-surface transition-colors"
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
              className="flex-1 bg-yt-surface border border-yt-border border-r-0 rounded-l-full pl-4 pr-4 h-9 text-sm text-yt-text placeholder:text-yt-muted focus:outline-none focus:border-yt-red transition-colors"
            />
            <button
              type="submit"
              className="bg-yt-surface border border-yt-border rounded-r-full px-4 h-9 flex items-center justify-center text-yt-muted hover:text-yt-text hover:bg-yt-hover transition-colors"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                <circle cx="11" cy="11" r="8" />
                <path strokeLinecap="round" d="M21 21l-4.35-4.35" />
              </svg>
            </button>
          </form>
        </div>
      )}

      {/* ── Logo ── */}
      <Link
        href="/"
        onClick={clearSearch}
        className="flex items-center gap-2 shrink-0 group"
      >
        <div className="w-8 h-8 bg-yt-red rounded-lg flex items-center justify-center transition-transform duration-150 group-hover:scale-105 group-hover:shadow-[0_0_12px_rgba(255,0,0,0.4)]">
          <svg viewBox="0 0 24 24" fill="white" className="w-4 h-4 ml-0.5">
            <path d="M8 5v14l11-7z" />
          </svg>
        </div>
        <span className="text-yt-text font-bold text-lg tracking-tight hidden sm:block">
          YT<span className="text-yt-red">Clone</span>
        </span>
      </Link>

      {/* ── Search bar (desktop) ── */}
      <form onSubmit={handleSearch} className="hidden md:flex flex-1 max-w-lg items-center">
        <div className="relative flex-1">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search videos…"
            className="w-full bg-yt-surface border border-yt-border border-r-0 rounded-l-full pl-4 pr-8 h-9 text-sm text-yt-text placeholder:text-yt-muted/60 focus:outline-none focus:border-yt-red focus:bg-yt-hover transition-colors"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={clearSearch}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center text-yt-muted hover:text-yt-text transition-colors"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-3.5 h-3.5">
                <path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
        <button
          type="submit"
          className="bg-yt-surface border border-yt-border rounded-r-full px-5 h-9 flex items-center justify-center text-yt-muted hover:text-yt-text hover:bg-yt-hover transition-colors shrink-0"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
            <circle cx="11" cy="11" r="8" />
            <path strokeLinecap="round" d="M21 21l-4.35-4.35" />
          </svg>
        </button>
      </form>

      {/* Flex spacer on mobile */}
      <div className="flex-1 md:hidden" />

      {/* ── Right side ── */}
      <div className="flex items-center gap-1.5 shrink-0">

        {/* Mobile search icon */}
        <button
          onClick={() => setMobileSearchOpen(true)}
          className="md:hidden w-9 h-9 flex items-center justify-center rounded-full text-yt-muted hover:text-yt-text hover:bg-yt-surface transition-colors"
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
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border transition-all ${
                isUpload
                  ? 'bg-yt-red/20 text-yt-red border-yt-red/40'
                  : 'bg-yt-surface hover:bg-yt-hover text-yt-text border-yt-border'
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
                className={`w-8 h-8 rounded-full bg-yt-red flex items-center justify-center text-white font-bold text-sm transition-all ${
                  menuOpen
                    ? 'ring-2 ring-yt-red/60 ring-offset-2 ring-offset-yt-dark'
                    : 'hover:ring-2 hover:ring-yt-red/40 hover:ring-offset-2 hover:ring-offset-yt-dark'
                }`}
              >
                {session.user.name?.[0]?.toUpperCase()}
              </button>

              {menuOpen && (
                <div className="absolute right-0 mt-2.5 w-56 bg-yt-surface border border-yt-border rounded-2xl shadow-2xl shadow-black/60 overflow-hidden z-50">
                  {/* User header */}
                  <div className="flex items-center gap-3 px-4 py-4 border-b border-yt-border bg-yt-hover/30">
                    <div className="w-10 h-10 rounded-full bg-yt-red flex items-center justify-center text-white font-bold shrink-0">
                      {session.user.name?.[0]?.toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-yt-text truncate">{session.user.name}</p>
                      <p className="text-xs text-yt-muted truncate">{session.user.email}</p>
                    </div>
                  </div>

                  {/* Menu items */}
                  <div className="p-1.5">
                    <Link
                      href="/upload"
                      onClick={() => setMenuOpen(false)}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-yt-text hover:bg-yt-hover transition-colors"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4 text-yt-muted shrink-0">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                      </svg>
                      Upload video
                    </Link>

                    <div className="my-1 border-t border-yt-border" />

                    <button
                      onClick={() => { setMenuOpen(false); signOut({ callbackUrl: '/' }) }}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-yt-text hover:bg-yt-hover transition-colors text-left"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4 text-yt-muted shrink-0">
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
              className="text-sm text-yt-text border border-yt-border hover:bg-yt-hover px-4 py-1.5 rounded-full transition-colors"
            >
              Sign in
            </Link>
            <Link
              href="/register"
              className="text-sm bg-yt-red hover:bg-red-700 text-white px-4 py-1.5 rounded-full transition-colors font-medium"
            >
              Register
            </Link>
          </div>
        )}
      </div>
    </header>
  )
}
