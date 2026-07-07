'use client'

import { useRef } from 'react'
import type { DomainData, DebugItem, Procedure, Step } from '@/lib/pipeline/domain-types'

// The machine-maintenance "guide": teaches the machine, then tells the story of
// each problem and walks the technician through fixing it. Big, high-contrast,
// fully-visible text; every timestamp is a button that seeks the video.

function fmt(sec: number) {
  const s = Math.max(0, Math.floor(sec))
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`
}

function Jump({ start, onSeek }: { start: number | null; onSeek: (t: number) => void }) {
  if (start == null) return null
  return (
    <button
      onClick={() => onSeek(start)}
      className="inline-flex items-center gap-1 shrink-0 rounded-lg bg-nb-violet/10 hover:bg-nb-violet/20 text-nb-violet text-xs font-semibold px-2 py-1 transition-colors"
      title={`Jump to ${fmt(start)}`}
    >
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3"><path d="M8 5v14l11-7z" /></svg>
      {fmt(start)}
    </button>
  )
}

function Meta({ difficulty, time }: { difficulty?: string; time?: string }) {
  const diffColor =
    difficulty === 'Easy' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : difficulty === 'Hard' ? 'bg-red-50 text-red-700 border-red-200'
    : difficulty === 'Medium' ? 'bg-amber-50 text-amber-700 border-amber-200'
    : ''
  return (
    <div className="flex items-center gap-1.5 shrink-0">
      {difficulty && <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-lg border ${diffColor}`}>{difficulty}</span>}
      {time && <span className="text-[11px] font-medium text-yt-muted bg-yt-hover rounded-lg px-2 py-0.5">{time}</span>}
    </div>
  )
}

// Section header with icon + title + count.
function SectionHeader({ icon, title, count }: { icon: React.ReactNode; title: string; count?: number }) {
  return (
    <div className="flex items-center gap-2.5 mb-3">
      <span className="w-8 h-8 rounded-xl bg-nb-violet/10 text-nb-violet flex items-center justify-center shrink-0">{icon}</span>
      <h3 className="text-yt-text font-bold text-lg">{title}</h3>
      {count != null && count > 0 && (
        <span className="text-xs font-semibold text-yt-muted bg-yt-hover rounded-full px-2 py-0.5">{count}</span>
      )}
    </div>
  )
}

// Ordered, numbered fix steps with expected result + per-step jump.
function StepList({ steps, onSeek }: { steps: Step[]; onSeek: (t: number) => void }) {
  if (!steps || steps.length === 0) return null
  return (
    <ol className="space-y-3">
      {steps.map((s, i) => (
        <li key={i} className="flex gap-3">
          <span className="shrink-0 w-6 h-6 rounded-full bg-nb-violet text-white text-xs font-bold flex items-center justify-center mt-0.5 shadow-violet-btn">{i + 1}</span>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <p className="text-slate-800 text-sm leading-relaxed break-words">{s.text}</p>
              <Jump start={s.start} onSeek={onSeek} />
            </div>
            {s.visual && (
              <p className="text-nb-indigo text-[13px] mt-1 leading-relaxed break-words">
                <span className="font-semibold">On screen: </span>{s.visual}
              </p>
            )}
            {s.expected && (
              <p className="text-emerald-700 text-[13px] mt-1 leading-relaxed break-words">
                <span className="font-semibold">Expect: </span>{s.expected}
              </p>
            )}
          </div>
        </li>
      ))}
    </ol>
  )
}

// A small labelled block used inside debug cards.
function Field({ label, color, children }: { label: string; color: string; children: React.ReactNode }) {
  return (
    <div>
      <p className={`text-[11px] font-bold uppercase tracking-wide mb-1 ${color}`}>{label}</p>
      <div className="text-slate-800 text-sm leading-relaxed break-words">{children}</div>
    </div>
  )
}

// Split a story string into paragraphs.
function paras(text: string) {
  return text.split(/\n{1,}/).map((p) => p.trim()).filter(Boolean)
}

// The full teaching + debug card for a problem or error code.
function DebugCard({ item, onSeek }: { item: DebugItem; onSeek: (t: number) => void }) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-card p-5">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          {item.code && (
            <span className="font-mono font-bold text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-2 py-0.5">{item.code}</span>
          )}
          <h4 className="text-yt-text font-bold text-base leading-snug">{item.title}</h4>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Meta difficulty={item.difficulty} time={item.time} />
          <Jump start={item.start} onSeek={onSeek} />
        </div>
      </div>

      {item.symptom && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mb-4">
          <span className="text-[11px] font-bold uppercase tracking-wide text-amber-700 mt-0.5 shrink-0">Symptom</span>
          <p className="text-amber-900 text-sm leading-relaxed break-words">{item.symptom}</p>
        </div>
      )}

      {/* Teaching story */}
      {item.story && (
        <div className="space-y-2.5 mb-5">
          {paras(item.story).map((p, i) => (
            <p key={i} className="text-slate-700 text-[15px] leading-relaxed break-words">{p}</p>
          ))}
        </div>
      )}

      {/* Fix steps */}
      {item.fix.length > 0 && (
        <div className="bg-nb-violet/[0.04] border border-nb-violet/15 rounded-xl p-4 mb-4">
          <p className="text-[11px] font-bold uppercase tracking-wide text-nb-violet mb-3">How to fix it</p>
          <StepList steps={item.fix} onSeek={onSeek} />
        </div>
      )}

      <div className="space-y-3">
        {item.verify && (
          <Field label="How to confirm it's fixed" color="text-emerald-700">{item.verify}</Field>
        )}
        {item.ifNotResolved && (
          <Field label="If it still doesn't work" color="text-slate-500">{item.ifNotResolved}</Field>
        )}
        {item.tools.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <span className="text-[11px] font-bold uppercase tracking-wide text-yt-muted mr-1">Tools</span>
            {item.tools.map((t, i) => (
              <span key={i} className="text-xs text-yt-text bg-yt-hover border border-slate-200 rounded-lg px-2 py-0.5">{t}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ProcedureCard({ item, onSeek }: { item: Procedure; onSeek: (t: number) => void }) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-card p-5">
      <div className="flex items-start justify-between gap-3 mb-2">
        <h4 className="text-yt-text font-bold text-base leading-snug">{item.title}</h4>
        <div className="flex items-center gap-2 shrink-0"><Meta difficulty={item.difficulty} time={item.time} /><Jump start={item.start} onSeek={onSeek} /></div>
      </div>
      {item.detail && <p className="text-slate-700 text-[15px] leading-relaxed break-words mb-4">{item.detail}</p>}
      {item.steps.length > 0 && (
        <div className="bg-nb-violet/[0.04] border border-nb-violet/15 rounded-xl p-4">
          <StepList steps={item.steps} onSeek={onSeek} />
        </div>
      )}
      {item.tools.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mt-3">
          <span className="text-[11px] font-bold uppercase tracking-wide text-yt-muted mr-1">Tools</span>
          {item.tools.map((t, i) => (
            <span key={i} className="text-xs text-yt-text bg-yt-hover border border-slate-200 rounded-lg px-2 py-0.5">{t}</span>
          ))}
        </div>
      )}
    </div>
  )
}

const icons = {
  overview: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>,
  trouble: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
  error: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
  pm: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.196-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118L2.049 9.101c-.783-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.518-4.674z" /></svg>,
  safety: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M5.07 19H19a2 2 0 001.75-2.97l-6.93-12a2 2 0 00-3.5 0l-6.93 12A2 2 0 005.07 19z" /></svg>,
  specs: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>,
  tools: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>,
  glossary: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>,
}

export default function MachineGuide({ data, onSeek }: { data: DomainData; onSeek: (t: number) => void }) {
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({})
  const scrollTo = (k: string) => sectionRefs.current[k]?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  const nav = [
    { key: 'trouble', label: 'Troubleshooting', count: data.troubleshooting.length },
    { key: 'error', label: 'Error Codes', count: data.errorCodes.length },
    { key: 'pm', label: 'Maintenance', count: data.preventiveMaintenance.length },
    { key: 'intro', label: 'How it works', count: (data.overview ? 1 : 0) + data.machineIntro.length },
    { key: 'safety', label: 'Safety', count: data.safety.length },
    { key: 'specs', label: 'Specs', count: data.specs.length },
    { key: 'glossary', label: 'Glossary', count: data.glossary.length },
  ].filter((s) => s.count > 0)

  return (
    <div className="mt-4">
      {/* Overview — teach the machine */}
      {(data.machine || data.summary || data.overview) && (
        <div className="bg-gradient-to-br from-nb-violet/8 to-nb-indigo/5 border border-nb-violet/20 rounded-2xl p-5 mb-4">
          {data.machine && <p className="text-nb-violet font-bold text-base mb-1.5">{data.machine}</p>}
          {data.summary && <p className="text-yt-text text-sm font-medium leading-relaxed break-words mb-2">{data.summary}</p>}
          {data.overview && (
            <div className="space-y-2 pt-2 border-t border-nb-violet/15">
              {paras(data.overview).map((p, i) => (
                <p key={i} className="text-slate-700 text-[15px] leading-relaxed break-words">{p}</p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Quick nav */}
      {nav.length > 1 && (
        <div className="flex flex-wrap gap-2 mb-6">
          {nav.map((s) => (
            <button key={s.key} onClick={() => scrollTo(s.key)}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-yt-text hover:border-nb-violet/40 hover:text-nb-violet transition-colors">
              {s.label} <span className="text-yt-muted">· {s.count}</span>
            </button>
          ))}
        </div>
      )}

      <div className="space-y-10">
        {/* Troubleshooting */}
        {data.troubleshooting.length > 0 && (
          <section ref={(el) => { sectionRefs.current.trouble = el }}>
            <SectionHeader icon={icons.trouble} title="Troubleshooting" count={data.troubleshooting.length} />
            <div className="space-y-4">
              {data.troubleshooting.map((it, i) => <DebugCard key={i} item={it} onSeek={onSeek} />)}
            </div>
          </section>
        )}

        {/* Error codes */}
        {data.errorCodes.length > 0 && (
          <section ref={(el) => { sectionRefs.current.error = el }}>
            <SectionHeader icon={icons.error} title="Error Codes" count={data.errorCodes.length} />
            <div className="space-y-4">
              {data.errorCodes.map((it, i) => <DebugCard key={i} item={it} onSeek={onSeek} />)}
            </div>
          </section>
        )}

        {/* Preventive maintenance */}
        {data.preventiveMaintenance.length > 0 && (
          <section ref={(el) => { sectionRefs.current.pm = el }}>
            <SectionHeader icon={icons.pm} title="Preventive Maintenance" count={data.preventiveMaintenance.length} />
            <div className="space-y-4">
              {data.preventiveMaintenance.map((it, i) => <ProcedureCard key={i} item={it} onSeek={onSeek} />)}
            </div>
          </section>
        )}

        {/* Machine intro */}
        {data.machineIntro.length > 0 && (
          <section ref={(el) => { sectionRefs.current.intro = el }}>
            <SectionHeader icon={icons.overview} title="Machine Parts" count={data.machineIntro.length} />
            <div className="grid sm:grid-cols-2 gap-3">
              {data.machineIntro.map((it, i) => (
                <div key={i} className="bg-white border border-slate-200 rounded-xl p-4 shadow-card">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-yt-text font-semibold text-sm leading-snug">{it.title}</p>
                    <Jump start={it.start} onSeek={onSeek} />
                  </div>
                  {it.detail && <p className="text-slate-700 text-sm mt-1.5 leading-relaxed break-words">{it.detail}</p>}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Safety */}
        {data.safety.length > 0 && (
          <section ref={(el) => { sectionRefs.current.safety = el }}>
            <SectionHeader icon={icons.safety} title="Safety" count={data.safety.length} />
            <ul className="space-y-3">
              {data.safety.map((it, i) => (
                <li key={i} className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-amber-900 font-semibold text-sm leading-snug break-words">{it.title}</p>
                    <Jump start={it.start} onSeek={onSeek} />
                  </div>
                  {it.detail && <p className="text-amber-800 text-sm mt-1.5 leading-relaxed break-words">{it.detail}</p>}
                  {it.steps.length > 0 && (
                    <ul className="mt-2.5 space-y-1.5">
                      {it.steps.map((s, j) => (
                        <li key={j} className="flex gap-2 text-amber-800 text-sm leading-relaxed">
                          <span className="text-amber-500 mt-0.5">•</span><span className="break-words">{s}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Specs */}
        {data.specs.length > 0 && (
          <section ref={(el) => { sectionRefs.current.specs = el }}>
            <SectionHeader icon={icons.specs} title="Specifications" count={data.specs.length} />
            <div className="bg-white border border-slate-200 rounded-xl shadow-card overflow-hidden divide-y divide-slate-100">
              {data.specs.map((sp, i) => (
                <div key={i} className="flex items-center justify-between gap-3 px-4 py-2.5">
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

        {/* Tools & Parts */}
        {(data.tools.length > 0 || data.parts.length > 0) && (
          <section ref={(el) => { sectionRefs.current.tools = el }}>
            <SectionHeader icon={icons.tools} title="Tools & Parts" count={data.tools.length + data.parts.length} />
            <div className="grid sm:grid-cols-2 gap-4">
              {data.tools.length > 0 && (
                <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-card">
                  <p className="text-yt-muted text-xs font-semibold uppercase tracking-wide mb-2">Tools</p>
                  <div className="flex flex-wrap gap-1.5">
                    {data.tools.map((t, i) => <span key={i} className="text-sm text-yt-text bg-yt-hover border border-slate-200 rounded-lg px-2.5 py-1 break-words">{t}</span>)}
                  </div>
                </div>
              )}
              {data.parts.length > 0 && (
                <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-card">
                  <p className="text-yt-muted text-xs font-semibold uppercase tracking-wide mb-2">Parts</p>
                  <div className="flex flex-wrap gap-1.5">
                    {data.parts.map((p, i) => <span key={i} className="text-sm text-yt-text bg-yt-hover border border-slate-200 rounded-lg px-2.5 py-1 break-words">{p}</span>)}
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Glossary */}
        {data.glossary.length > 0 && (
          <section ref={(el) => { sectionRefs.current.glossary = el }}>
            <SectionHeader icon={icons.glossary} title="Glossary" count={data.glossary.length} />
            <div className="bg-white border border-slate-200 rounded-xl shadow-card overflow-hidden divide-y divide-slate-100">
              {data.glossary.map((g, i) => (
                <div key={i} className="px-4 py-3">
                  <p className="text-yt-text font-semibold text-sm">{g.term}</p>
                  <p className="text-slate-700 text-sm mt-0.5 leading-relaxed break-words">{g.definition}</p>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
