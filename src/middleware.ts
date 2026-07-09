import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Internal-service access control for the data API (/api/v1/*).
//
// A request is allowed if EITHER:
//   - it comes from the app's own UI (same-origin browser request), OR
//   - it presents a valid service key:  Authorization: Bearer <SERVICE_API_KEY>
//
// SERVICE_API_KEY may be a comma-separated list (for zero-downtime rotation).
// If SERVICE_API_KEY is unset, the gate stays OPEN (dev convenience) — set it in
// any shared/production environment to require the key for external callers.
//
// Note: /api/health and the workflow's /.well-known/workflow/* routes are NOT
// matched here (see `config.matcher`), so probes and the engine keep working.

function isSameOrigin(req: NextRequest): boolean {
  const site = req.headers.get('sec-fetch-site')
  if (site === 'same-origin' || site === 'same-site') return true
  const host = req.headers.get('host')
  const origin = req.headers.get('origin') || req.headers.get('referer')
  if (host && origin) {
    try {
      return new URL(origin).host === host
    } catch {
      return false
    }
  }
  return false
}

export function middleware(req: NextRequest) {
  if (isSameOrigin(req)) return NextResponse.next()

  const keys = (process.env.SERVICE_API_KEY || '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean)

  // No key configured -> leave the gate open (lock down by setting SERVICE_API_KEY).
  if (keys.length === 0) return NextResponse.next()

  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
  if (token && keys.includes(token)) return NextResponse.next()

  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

export const config = {
  matcher: ['/api/v1/:path*'],
}
