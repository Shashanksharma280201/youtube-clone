'use client'

import { useState, useMemo } from 'react'
import { tagColor, tagSolidBg } from '@/lib/tagColor'

type Segment = {
  id: number
  start: number
  end: number
  text: string
  mainTag?: string
  subTag?: string
  tags?: string[]
}

function fmt(seconds: number) {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function cap(s: string) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s
}

function getMainTag(seg: Segment): string | undefined {
  return seg.mainTag ?? seg.tags?.[0]
}

export default function WatchTranscript({
  segments: rawSegments,
  fallback,
}: {
  segments: unknown
  fallback: string | null
}) {
  const [activeTag, setActiveTag] = useState<string | null>(null)

  const segments: Segment[] = useMemo(() => {
    if (!Array.isArray(rawSegments)) return []
    return rawSegments as Segment[]
  }, [rawSegments])

  const allMainTags = useMemo(() => {
    const seen = new Set<string>()
    const result: string[] = []
    for (const s of segments) {
      const t = getMainTag(s)
      if (t && !seen.has(t)) { seen.add(t); result.push(t) }
    }
    return result
  }, [segments])

  const visible = useMemo(
    () => segments.filter((s) => (activeTag ? getMainTag(s) === activeTag : true)),
    [segments, activeTag],
  )

  if (segments.length === 0) {
    if (!fallback) return null
    return (
      <div className="mt-4 bg-white border border-yt-border rounded-2xl p-5 shadow-card">
        <h3 className="text-yt-text text-sm font-semibold mb-3 flex items-center gap-2">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4 text-nb-violet">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12" />
          </svg>
          Transcript
        </h3>
        <p className="text-yt-muted text-sm leading-relaxed">{fallback}</p>
      </div>
    )
  }

  return (
    <div className="mt-4 bg-white border border-yt-border rounded-2xl overflow-hidden shadow-card">
      {/* Header + filter chips */}
      <div className="px-4 pt-4 pb-3 border-b border-yt-border">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-yt-text text-sm font-semibold flex items-center gap-2">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4 text-nb-violet">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12" />
            </svg>
            Transcript
          </h3>
          {activeTag && (
            <button onClick={() => setActiveTag(null)} className="text-xs text-nb-violet hover:text-nb-indigo font-medium transition-colors">
              Clear filter ×
            </button>
          )}
        </div>

        {allMainTags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setActiveTag(null)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-all duration-200 ${
                activeTag === null
                  ? 'bg-nb-violet/10 text-nb-violet border-nb-violet/30'
                  : 'bg-yt-hover text-yt-muted border-yt-border hover:text-yt-text'
              }`}
            >
              All
            </button>
            {allMainTags.map((tag) => (
              <button
                key={tag}
                onClick={() => setActiveTag(activeTag === tag ? null : tag)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-all duration-200 ${
                  activeTag === tag
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-300 ring-1 ring-emerald-200'
                    : 'bg-yt-surface2 text-slate-600 border-yt-border hover:border-slate-300 hover:text-slate-800'
                }`}
              >
                {cap(tag)}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Segment list */}
      <div className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
        {visible.map((seg, i) => {
          const mainTag = getMainTag(seg)
          const isAction = mainTag === 'action'
          return (
            <div key={seg.id ?? i} className={`px-4 py-3 transition-colors ${isAction ? 'bg-sky-50/40 hover:bg-sky-50/70' : 'hover:bg-yt-hover/50'}`}>
              {mainTag && (
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <button
                    onClick={() => setActiveTag(activeTag === mainTag ? null : mainTag)}
                    className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg text-[11px] font-semibold border transition-all duration-200 ${
                      activeTag === mainTag
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-300 ring-1 ring-emerald-200'
                        : isAction
                          ? 'bg-sky-50 text-sky-600 border-sky-200 hover:border-sky-300'
                          : 'bg-yt-hover text-slate-600 border-yt-border hover:border-slate-300'
                    }`}
                  >
                    {isAction ? (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-2.5 h-2.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.069A1 1 0 0121 8.867v6.266a1 1 0 01-1.447.902L15 14M3 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
                      </svg>
                    ) : (
                      <span className={`w-1.5 h-1.5 rounded-full ${tagSolidBg(mainTag)}`} />
                    )}
                    {cap(mainTag)}
                  </button>
                  {!isAction && seg.subTag && (
                    <span className="text-yt-text text-[11px] font-medium bg-yt-hover border border-yt-border px-2 py-0.5 rounded-lg">
                      {seg.subTag}
                    </span>
                  )}
                </div>
              )}

              <div className="flex gap-2.5 items-start">
                <span className={`font-mono text-xs shrink-0 mt-0.5 tabular-nums ${isAction ? 'text-nb-sky' : 'text-nb-violet'}`}>{fmt(seg.start)}</span>
                <p className={`text-sm leading-relaxed ${isAction ? 'text-sky-700 italic' : 'text-yt-muted'}`}>{seg.text}</p>
              </div>
            </div>
          )
        })}

        {visible.length === 0 && activeTag && (
          <p className="text-yt-muted text-sm py-8 text-center">
            No segments tagged &quot;{activeTag}&quot;
          </p>
        )}
      </div>
    </div>
  )
}
