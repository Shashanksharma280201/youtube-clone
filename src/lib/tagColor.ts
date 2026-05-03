const PALETTES = [
  'bg-blue-500/20 text-blue-400 border-blue-400/40',
  'bg-green-500/20 text-green-400 border-green-400/40',
  'bg-yellow-500/20 text-yellow-400 border-yellow-400/40',
  'bg-purple-500/20 text-purple-400 border-purple-400/40',
  'bg-orange-500/20 text-orange-400 border-orange-400/40',
  'bg-pink-500/20 text-pink-400 border-pink-400/40',
  'bg-cyan-500/20 text-cyan-400 border-cyan-400/40',
  'bg-indigo-500/20 text-indigo-400 border-indigo-400/40',
  'bg-teal-500/20 text-teal-400 border-teal-400/40',
  'bg-rose-500/20 text-rose-400 border-rose-400/40',
]

// Same index ordering as PALETTES — so tagSolidBg("X") always matches tagColor("X")'s color family
const SOLID_BG = [
  'bg-blue-500',
  'bg-green-500',
  'bg-yellow-500',
  'bg-purple-500',
  'bg-orange-500',
  'bg-pink-500',
  'bg-cyan-500',
  'bg-indigo-500',
  'bg-teal-500',
  'bg-rose-500',
]

function hash(tag: string): number {
  let h = 0
  for (let i = 0; i < tag.length; i++) h = (Math.imul(31, h) + tag.charCodeAt(i)) | 0
  return Math.abs(h)
}

export function tagColor(tag: string): string {
  return PALETTES[hash(tag) % PALETTES.length]
}

export function tagSolidBg(tag: string): string {
  return SOLID_BG[hash(tag) % SOLID_BG.length]
}
