'use client'

import Link from 'next/link'
import { useSession, signOut } from 'next-auth/react'
import { useState } from 'react'

export default function Navbar() {
  const { data: session } = useSession()
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-yt-dark border-b border-yt-border h-16 flex items-center px-4 justify-between">
      {/* Logo */}
      <Link href="/" className="flex items-center gap-2">
        <div className="bg-yt-red w-8 h-8 rounded flex items-center justify-center">
          <svg viewBox="0 0 24 24" fill="white" className="w-5 h-5">
            <path d="M8 5v14l11-7z" />
          </svg>
        </div>
        <span className="text-yt-text font-bold text-xl tracking-tight">YTClone</span>
      </Link>

      {/* Right side */}
      <div className="flex items-center gap-3">
        {session ? (
          <>
            <Link
              href="/upload"
              className="flex items-center gap-2 bg-yt-surface hover:bg-yt-hover text-yt-text px-4 py-2 rounded-full text-sm transition-colors"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                <path d="M17 10.5V7a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h12a1 1 0 001-1v-3.5l4 4v-11l-4 4z" />
              </svg>
              Upload
            </Link>

            <div className="relative">
              <button
                onClick={() => setMenuOpen(!menuOpen)}
                className="flex items-center gap-2 bg-yt-surface hover:bg-yt-hover px-3 py-2 rounded-full text-sm transition-colors"
              >
                <div className="w-7 h-7 rounded-full bg-yt-red flex items-center justify-center text-white font-bold text-xs">
                  {session.user.name?.[0]?.toUpperCase()}
                </div>
                <span className="text-yt-text">{session.user.name}</span>
              </button>

              {menuOpen && (
                <div className="absolute right-0 mt-2 w-48 bg-yt-surface border border-yt-border rounded-lg shadow-lg overflow-hidden">
                  <div className="px-4 py-3 border-b border-yt-border">
                    <p className="text-sm font-medium text-yt-text">{session.user.name}</p>
                    <p className="text-xs text-yt-muted">{session.user.email}</p>
                  </div>
                  <button
                    onClick={() => signOut({ callbackUrl: '/' })}
                    className="w-full text-left px-4 py-3 text-sm text-yt-text hover:bg-yt-hover transition-colors"
                  >
                    Sign out
                  </button>
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <Link
              href="/login"
              className="text-sm text-yt-text hover:text-white border border-yt-border hover:bg-yt-hover px-4 py-2 rounded-full transition-colors"
            >
              Sign in
            </Link>
            <Link
              href="/register"
              className="text-sm bg-yt-red hover:bg-red-700 text-white px-4 py-2 rounded-full transition-colors"
            >
              Register
            </Link>
          </>
        )}
      </div>
    </header>
  )
}
