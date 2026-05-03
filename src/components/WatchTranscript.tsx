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
  tags?: string[] // legacy single-tag format
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
    return (
      <div className="mt-4 bg-yt-surface rounded-xl p-4">
        <h3 className="text-yt-text text-sm font-semibold mb-2">Transcript</h3>
        <p className="text-yt-muted text-sm leading-relaxed">{fallback}</p>
      </div>
    )
  }

  return (
    <div className="mt-4 bg-yt-surface rounded-xl overflow-hidden">
      {/* Header + filter chips */}
      <div className="px-4 pt-4 pb-3 border-b border-yt-border">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-yt-text text-sm font-semibold">Transcript</h3>
          {activeTag && (
            <button onClick={() => setActiveTag(null)} className="text-xs text-yt-red hover:underline">
              Clear filter ×
            </button>
          )}
        </div>

        {allMainTags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setActiveTag(null)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                activeTag === null
                  ? 'bg-yt-red/20 text-yt-red border-yt-red/50'
                  : 'bg-yt-hover text-yt-muted border-yt-border hover:text-yt-text'
              }`}
            >
              All
            </button>
            {allMainTags.map((tag) => (
              <button
                key={tag}
                onClick={() => setActiveTag(activeTag === tag ? null : tag)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${tagColor(tag)} ${
                  activeTag === tag ? 'ring-1 ring-current opacity-100' : 'opacity-60 hover:opacity-100'
                }`}
              >
                {cap(tag)}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Segment list */}
      <div className="divide-y divide-yt-border/30 max-h-80 overflow-y-auto">
        {visible.map((seg, i) => {
          const mainTag = getMainTag(seg)
          return (
            <div key={seg.id ?? i} className="px-4 py-3 hover:bg-yt-hover/30 transition-colors">

              {/* Tags row — prominent, above the text */}
              {(mainTag || seg.subTag) && (
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  {mainTag && (
                    <button
                      onClick={() => setActiveTag(activeTag === mainTag ? null : mainTag)}
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border transition-all ${tagColor(mainTag)} ${
                        activeTag === mainTag ? 'ring-1 ring-current opacity-100' : 'opacity-90 hover:opacity-100'
                      }`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${tagSolidBg(mainTag)}`} />
                      {cap(mainTag)}
                    </button>
                  )}
                  {seg.subTag && (
                    <span className="text-yt-text text-xs font-medium bg-yt-hover border border-yt-border px-2.5 py-1 rounded-full">
                      {seg.subTag}
                    </span>
                  )}
                </div>
              )}

              {/* Timestamp + transcript text */}
              <div className="flex gap-2.5 items-start">
                <span className="text-yt-red font-mono text-xs shrink-0 mt-0.5">{fmt(seg.start)}</span>
                <p className="text-yt-muted text-sm leading-relaxed">{seg.text}</p>
              </div>
            </div>
          )
        })}

        {visible.length === 0 && activeTag && (
          <p className="text-yt-muted text-sm py-6 text-center">
            No segments tagged &quot;{activeTag}&quot;
          </p>
        )}
      </div>
    </div>
  )
}
