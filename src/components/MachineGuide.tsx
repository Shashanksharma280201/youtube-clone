'use client'

import { useRef, useState } from 'react'
import type { DomainData } from '@/lib/pipeline/domain-types'

// The machine-maintenance "guide" panel. Renders the structured sections
// (intro, preventive maintenance, error codes, troubleshooting, safety,
// tools/parts, specs) with big, high-contrast, fully-visible text. Every
// timestamped item is a button that seeks the video to that moment.

function fmt(sec: number) {
  const s = Math.max(0, Math.floor(sec))
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`
}

// A small "jump to timestamp" pill.
function Jump({ start, onSeek }: { start: number | null; onSeek: (t: number) => void }) {
  if (start == null) return null
  return (
    <button
      onClick={() => onSeek(start)}
      className="inline-flex items-center gap-1 shrink-0 rounded-lg bg-nb-violet/10 hover:bg-nb-violet/20 text-nb-violet text-xs font-semibold px-2 py-1 transition-colors"
      title={`Jump to ${fmt(start)}`}
    >
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3">
        <path d="M8 5v14l11-7z" />
      </svg>
      {fmt(start)}
    </button>
  )
}

// An ordered, numbered checklist of steps. Renders nothing when empty.
function Steps({ steps }: { steps?: string[] }) {
  if (!steps || steps.length === 0) return null
  return (
    <ol className="mt-3 space-y-2">
      {steps.map((s, i) => (
        <li key={i} className="flex gap-2.5">
          <span className="shrink-0 w-5 h-5 rounded-full bg-nb-violet/10 text-nb-violet text-xs font-bold flex items-center justify-center mt-0.5">{i + 1}</span>
          <span className="text-slate-700 text-sm leading-relaxed break-words">{s}</span>
        </li>
      ))}
    </ol>
  )
}

function SectionHeader({ icon, title, count }: { icon: React.ReactNode; title: string; count?: number }) {
  return (
    <div className="flex items-center gap-2.5 mb-3">
      <span className="w-8 h-8 rounded-xl bg-nb-violet/10 text-nb-violet flex items-center justify-center shrink-0">
        {icon}
      </span>
      <h3 className="text-yt-text font-bold text-base">{title}</h3>
      {count != null && count > 0 && (
        <span className="text-xs font-semibold text-yt-muted bg-yt-hover rounded-full px-2 py-0.5">{count}</span>
      )}
    </div>
  )
}

// Icons (inline, stroke-based)
const icons = {
  intro: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
  pm: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.196-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118L2.049 9.101c-.783-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.518-4.674z" /></svg>,
  error: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
  faq: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
  safety: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M5.07 19H19a2 2 0 001.75-2.97l-6.93-12a2 2 0 00-3.5 0l-6.93 12A2 2 0 005.07 19z" /></svg>,
  tools: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>,
  specs: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>,
}

// A generic list of title/detail items with a jump pill.
function GuideList({ items, onSeek }: { items: DomainData['machineIntro']; onSeek: (t: number) => void }) {
  return (
    <ul className="space-y-2.5">
      {items.map((it, i) => (
        <li key={i} className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-card">
          <div className="flex items-start justify-between gap-3">
            <p className="text-yt-text font-semibold text-sm leading-snug">{it.title}</p>
            <Jump start={it.start} onSeek={onSeek} />
          </div>
          {it.detail && <p className="text-slate-700 text-sm mt-1.5 leading-relaxed break-words">{it.detail}</p>}
          <Steps steps={it.steps} />
        </li>
      ))}
    </ul>
  )
}

function FaqAccordion({ items, onSeek }: { items: DomainData['troubleshooting']; onSeek: (t: number) => void }) {
  const [open, setOpen] = useState<number | null>(0)
  return (
    <div className="space-y-2">
      {items.map((it, i) => {
        const isOpen = open === i
        return (
          <div key={i} className="bg-white border border-slate-200 rounded-xl shadow-card overflow-hidden">
            <button
              onClick={() => setOpen(isOpen ? null : i)}
              className="w-full flex items-center justify-between gap-3 p-3.5 text-left hover:bg-yt-hover transition-colors"
            >
              <span className="text-yt-text font-semibold text-sm leading-snug">{it.question}</span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={`w-4 h-4 shrink-0 text-yt-muted transition-transform ${isOpen ? 'rotate-180' : ''}`}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {isOpen && (
              <div className="px-3.5 pb-3.5 -mt-0.5">
                <p className="text-slate-700 text-sm leading-relaxed break-words">{it.answer}</p>
                <Steps steps={it.steps} />
                {it.start != null && <div className="mt-3"><Jump start={it.start} onSeek={onSeek} /></div>}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default function MachineGuide({ data, onSeek }: { data: DomainData; onSeek: (t: number) => void }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({})

  const sections = [
    { key: 'intro', label: 'Machine Intro', count: data.machineIntro.length },
    { key: 'pm', label: 'Maintenance', count: data.preventiveMaintenance.length },
    { key: 'errors', label: 'Error Codes', count: data.errorCodes.length },
    { key: 'faq', label: 'Troubleshooting', count: data.troubleshooting.length },
    { key: 'safety', label: 'Safety', count: data.safety.length },
    { key: 'tools', label: 'Tools & Parts', count: data.tools.length + data.parts.length },
    { key: 'specs', label: 'Specs', count: data.specs.length },
  ].filter((s) => s.count > 0)

  const scrollTo = (key: string) =>
    sectionRefs.current[key]?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  return (
    <div className="mt-4">
      {/* Overview */}
      {(data.machine || data.summary) && (
        <div className="bg-gradient-to-br from-nb-violet/8 to-nb-indigo/5 border border-nb-violet/20 rounded-2xl p-4 mb-4">
          {data.machine && <p className="text-nb-violet font-bold text-sm mb-1">{data.machine}</p>}
          {data.summary && <p className="text-yt-text text-sm leading-relaxed break-words">{data.summary}</p>}
        </div>
      )}

      {/* Section quick-nav */}
      {sections.length > 1 && (
        <div className="flex flex-wrap gap-2 mb-5">
          {sections.map((s) => (
            <button
              key={s.key}
              onClick={() => scrollTo(s.key)}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-yt-text hover:border-nb-violet/40 hover:text-nb-violet transition-colors"
            >
              {s.label} <span className="text-yt-muted">· {s.count}</span>
            </button>
          ))}
        </div>
      )}

      <div ref={scrollRef} className="space-y-8">
        {/* Machine Intro */}
        {data.machineIntro.length > 0 && (
          <section ref={(el) => { sectionRefs.current.intro = el }}>
            <SectionHeader icon={icons.intro} title="Machine Introduction" count={data.machineIntro.length} />
            <GuideList items={data.machineIntro} onSeek={onSeek} />
          </section>
        )}

        {/* Preventive Maintenance */}
        {data.preventiveMaintenance.length > 0 && (
          <section ref={(el) => { sectionRefs.current.pm = el }}>
            <SectionHeader icon={icons.pm} title="Preventive Maintenance" count={data.preventiveMaintenance.length} />
            <GuideList items={data.preventiveMaintenance} onSeek={onSeek} />
          </section>
        )}

        {/* Error Codes */}
        {data.errorCodes.length > 0 && (
          <section ref={(el) => { sectionRefs.current.errors = el }}>
            <SectionHeader icon={icons.error} title="Error Codes" count={data.errorCodes.length} />
            <div className="space-y-2.5">
              {data.errorCodes.map((ec, i) => (
                <div key={i} className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-card">
                  <div className="flex items-center justify-between gap-3 mb-1.5">
                    <span className="font-mono font-bold text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-2 py-0.5">{ec.code || '—'}</span>
                    <Jump start={ec.start} onSeek={onSeek} />
                  </div>
                  {ec.meaning && <p className="text-yt-text text-sm font-medium leading-snug break-words">{ec.meaning}</p>}
                  {ec.resolution && (
                    <p className="text-slate-700 text-sm mt-1.5 leading-relaxed break-words">
                      <span className="text-emerald-600 font-semibold">Fix: </span>{ec.resolution}
                    </p>
                  )}
                  <Steps steps={ec.steps} />
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Troubleshooting */}
        {data.troubleshooting.length > 0 && (
          <section ref={(el) => { sectionRefs.current.faq = el }}>
            <SectionHeader icon={icons.faq} title="Troubleshooting" count={data.troubleshooting.length} />
            <FaqAccordion items={data.troubleshooting} onSeek={onSeek} />
          </section>
        )}

        {/* Safety */}
        {data.safety.length > 0 && (
          <section ref={(el) => { sectionRefs.current.safety = el }}>
            <SectionHeader icon={icons.safety} title="Safety" count={data.safety.length} />
            <ul className="space-y-2.5">
              {data.safety.map((it, i) => (
                <li key={i} className="bg-amber-50 border border-amber-200 rounded-xl p-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-amber-900 font-semibold text-sm leading-snug break-words">{it.title}</p>
                    <Jump start={it.start} onSeek={onSeek} />
                  </div>
                  {it.detail && <p className="text-amber-800 text-sm mt-1.5 leading-relaxed break-words">{it.detail}</p>}
                  <Steps steps={it.steps} />
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Tools & Parts */}
        {(data.tools.length > 0 || data.parts.length > 0) && (
          <section ref={(el) => { sectionRefs.current.tools = el }}>
            <SectionHeader icon={icons.tools} title="Tools & Parts" count={data.tools.length + data.parts.length} />
            <div className="grid sm:grid-cols-2 gap-4">
              {data.tools.length > 0 && (
                <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-card">
                  <p className="text-yt-muted text-xs font-semibold uppercase tracking-wide mb-2">Tools</p>
                  <div className="flex flex-wrap gap-1.5">
                    {data.tools.map((t, i) => (
                      <span key={i} className="text-sm text-yt-text bg-yt-hover border border-slate-200 rounded-lg px-2.5 py-1 break-words">{t}</span>
                    ))}
                  </div>
                </div>
              )}
              {data.parts.length > 0 && (
                <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-card">
                  <p className="text-yt-muted text-xs font-semibold uppercase tracking-wide mb-2">Parts</p>
                  <div className="flex flex-wrap gap-1.5">
                    {data.parts.map((p, i) => (
                      <span key={i} className="text-sm text-yt-text bg-yt-hover border border-slate-200 rounded-lg px-2.5 py-1 break-words">{p}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Specs */}
        {data.specs.length > 0 && (
          <section ref={(el) => { sectionRefs.current.specs = el }}>
            <SectionHeader icon={icons.specs} title="Specifications" count={data.specs.length} />
            <div className="bg-white border border-slate-200 rounded-xl shadow-card overflow-hidden divide-y divide-slate-100">
              {data.specs.map((sp, i) => (
                <div key={i} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                  <span className="text-slate-700 text-sm break-words">{sp.label}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-yt-text font-semibold text-sm">{sp.value}</span>
                    <Jump start={sp.start} onSeek={onSeek} />
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
