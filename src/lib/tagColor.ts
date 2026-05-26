// Neutral badge — used for decorative tag labels
export function tagColor(_tag: string): string {
  return 'bg-slate-100 text-slate-600 border-slate-200'
}

// Distinct solid color for the timeline strip only
const SOLIDS = [
  'bg-violet-400', 'bg-sky-400',  'bg-emerald-400', 'bg-amber-400',
  'bg-rose-400',   'bg-indigo-400', 'bg-teal-400',  'bg-orange-400',
]

function hashTag(tag: string): number {
  let h = 0
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) & 0xffff
  return h
}

export function tagSolidBg(tag: string): string {
  return SOLIDS[hashTag(tag) % SOLIDS.length]
}
