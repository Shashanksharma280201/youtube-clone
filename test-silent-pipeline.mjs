/**
 * Standalone test: silent segment detection pipeline
 * Run: node test-silent-pipeline.mjs
 */

import { spawn } from 'child_process'
import { mkdir, readFile, unlink, rm, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createRequire } from 'module'
import { readFileSync } from 'fs'

// Load env
const env = readFileSync('/home/shanks/Videos/youtube-clone/.env.local', 'utf8')
for (const line of env.split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m) {
    let val = m[2].trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
      val = val.slice(1, -1)
    process.env[m[1].trim()] = val
  }
}

const require = createRequire(import.meta.url)
const ffmpegPath = require('ffmpeg-static')
import { chmodSync } from 'fs'
try { chmodSync(ffmpegPath, 0o755) } catch {}

import OpenAI from 'openai'
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
const groq   = new OpenAI({ apiKey: process.env.GROQ_API_KEY, baseURL: 'https://api.groq.com/openai/v1' })

const VIDEO_PATH = '/home/shanks/Videos/youtube-clone/How to Desolder SMD Resistor with Soldering Iron Quickly.mp4'
const TMP        = join(tmpdir(), 'silent-test')

// ─── constants ───────────────────────────────────────────────────────────────
const SILENCE_NOISE_DB      = -30   // lower threshold catches tool noise as "silence"
const SILENCE_MIN_SECS      = 1     // lowered for this short 9s clip
const SILENCE_CHUNK_SECS    = 4     // lowered for the short clip
const VISION_BATCH_SIZE     = 5
const MAX_SILENT_CHUNKS     = 40
const NO_SPEECH_PROB_THRESH = 0.6   // Whisper segments above this are hallucinations
const MIN_REAL_TEXT_CHARS   = 4     // punctuation-only or < 4 real chars = hallucination
const FULL_SILENT_CHUNK_SECS = 3    // when whole video is silent, sample every N seconds

// ─── helpers ─────────────────────────────────────────────────────────────────

function run(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = '', err = ''
    proc.stdout.on('data', d => out += d)
    proc.stderr.on('data', d => err += d)
    proc.on('close', code => code === 0 ? resolve({ out, err }) : reject(new Error(`ffmpeg exit ${code}\n${err}`)))
    proc.on('error', reject)
  })
}

async function extractAudio(videoPath, audioPath) {
  await run(['-y', '-i', videoPath, '-vn', '-ar', '16000', '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '64k', audioPath])
}

async function extractFrame(videoPath, time, outPath) {
  await run(['-y', '-ss', String(time), '-i', videoPath, '-vframes', '1', '-q:v', '2', outPath])
}

async function getVideoDuration(videoPath) {
  const { err } = await run(['-i', videoPath, '-f', 'null', '-'])
    .catch(e => ({ err: e.message }))
  const m = err.match(/Duration:\s+(\d+):(\d+):([\d.]+)/)
  if (!m) return 0
  return parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3])
}

// ─── Step A: silencedetect ────────────────────────────────────────────────────

async function detectSilentWindows(audioPath) {
  console.log('\n📡 Running ffmpeg silencedetect...')
  const args = [
    '-i', audioPath,
    '-af', `silencedetect=noise=${SILENCE_NOISE_DB}dB:d=${SILENCE_MIN_SECS}`,
    '-f', 'null', '-'
  ]
  const { err } = await run(args).catch(e => ({ err: e.message }))

  const windows = []
  let currentStart = null
  for (const line of err.split('\n')) {
    const startMatch = line.match(/silence_start:\s*([\d.]+)/)
    const endMatch   = line.match(/silence_end:\s*([\d.]+)/)
    if (startMatch) currentStart = parseFloat(startMatch[1])
    if (endMatch && currentStart !== null) {
      windows.push({ start: currentStart, end: parseFloat(endMatch[1]) })
      currentStart = null
    }
  }
  // open-ended silence at the very end of file
  if (currentStart !== null) windows.push({ start: currentStart, end: null })

  console.log(`   Found ${windows.length} silent window(s):`)
  windows.forEach((w, i) => console.log(`   [${i+1}] ${w.start.toFixed(2)}s → ${w.end?.toFixed(2) ?? 'EOF'}s`))
  return windows
}

// ─── Step B: find gaps not covered by real speech ────────────────────────────
// Two sources: (1) silencedetect windows, (2) gaps between Whisper segments.
// Using both makes it robust: ambient-noise videos are caught by Whisper gaps,
// true-silence videos are caught by silencedetect.

function findUnspokenGaps(silentWindows, spokenSegments, totalDuration) {
  // Source 1: silencedetect windows with no overlapping speech
  const fromSilence = silentWindows
    .map(w => ({ start: w.start, end: w.end ?? totalDuration }))
    .filter(w => {
      const overlaps = spokenSegments.some(s => s.end > w.start && s.start < w.end)
      return !overlaps && (w.end - w.start) >= SILENCE_MIN_SECS
    })

  // Source 2: gaps between Whisper segments (catches tool-noise / ambient sound videos)
  const whisperGaps = []
  const sorted = [...spokenSegments].sort((a, b) => a.start - b.start)
  // gap before first segment
  if (sorted.length === 0) {
    whisperGaps.push({ start: 0, end: totalDuration })
  } else {
    if (sorted[0].start >= SILENCE_MIN_SECS) whisperGaps.push({ start: 0, end: sorted[0].start })
    for (let i = 0; i < sorted.length - 1; i++) {
      const gapLen = sorted[i+1].start - sorted[i].end
      if (gapLen >= SILENCE_MIN_SECS) whisperGaps.push({ start: sorted[i].end, end: sorted[i+1].start })
    }
    // gap after last segment
    const tail = totalDuration - sorted[sorted.length-1].end
    if (tail >= SILENCE_MIN_SECS) whisperGaps.push({ start: sorted[sorted.length-1].end, end: totalDuration })
  }

  // Merge both sources, deduplicate by start time
  const all = [...fromSilence, ...whisperGaps]
  const seen = new Set()
  return all.filter(g => {
    const key = g.start.toFixed(1)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).sort((a, b) => a.start - b.start)
}

// ─── Step C: chunk long gaps ─────────────────────────────────────────────────

function chunkLongGaps(gaps) {
  const chunks = []
  for (const gap of gaps) {
    const len = gap.end - gap.start
    if (len <= SILENCE_CHUNK_SECS) {
      chunks.push(gap)
    } else {
      let t = gap.start
      while (t < gap.end) {
        chunks.push({ start: t, end: Math.min(t + SILENCE_CHUNK_SECS, gap.end) })
        t += SILENCE_CHUNK_SECS
      }
    }
  }
  return chunks.slice(0, MAX_SILENT_CHUNKS)
}

// ─── Step D: Vision batch calls ──────────────────────────────────────────────

async function describeFramesBatch(framePaths) {
  if (framePaths.length === 0) return []

  const descriptions = []
  for (let i = 0; i < framePaths.length; i += VISION_BATCH_SIZE) {
    const batch = framePaths.slice(i, i + VISION_BATCH_SIZE)
    console.log(`\n🔍 GPT-4o Vision call — batch of ${batch.length} frame(s)...`)

    const imageContents = await Promise.all(batch.map(async (p) => {
      const bytes = await readFile(p)
      return {
        type: 'image_url',
        image_url: { url: `data:image/jpeg;base64,${bytes.toString('base64')}`, detail: 'low' }
      }
    }))

    const prompt = batch.length === 1
      ? 'This is a frame from a how-to/tutorial video. Write one sentence describing exactly what the person is doing — what tool or object they are using, and what action they are performing on what. Be specific and observational. Example: "The person is pressing a soldering iron tip against a resistor on a circuit board to melt the solder." Return ONLY the sentence, no extra text.'
      : `These are ${batch.length} frames from a how-to/tutorial video numbered 1 to ${batch.length}. For each frame, write one sentence describing exactly what the person is doing — what tool/object they are using and what action they are performing. Be specific and observational. Return ONLY valid JSON: [{"i":1,"desc":"..."},{"i":2,"desc":"..."},...]`

    try {
      const res = await openai.chat.completions.create({
        model: 'gpt-4o',
        max_tokens: 200,
        messages: [{
          role: 'user',
          content: [{ type: 'text', text: prompt }, ...imageContents]
        }]
      })
      const text = res.choices[0]?.message?.content?.trim() ?? ''
      console.log(`   Raw response: ${text}`)

      if (batch.length === 1) {
        descriptions.push(text)
      } else {
        try {
          const parsed = JSON.parse(text)
          for (let j = 0; j < batch.length; j++) {
            descriptions.push(parsed[j]?.desc ?? 'performing task')
          }
        } catch {
          // fallback: one description for all
          for (let j = 0; j < batch.length; j++) descriptions.push(text)
        }
      }
    } catch (err) {
      console.log(`   Vision call failed: ${err.message}`)
      for (let j = 0; j < batch.length; j++) descriptions.push('performing task')
    }
  }
  return descriptions
}

// ─── main test ────────────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════════════')
  console.log(' Silent Segment Detection — Pipeline Test')
  console.log('═══════════════════════════════════════════════════════')
  console.log(`Video: How to Desolder SMD Resistor with Soldering Iron Quickly.mp4`)

  await mkdir(TMP, { recursive: true })
  const audioPath = join(TMP, 'audio.mp3')
  const t0 = Date.now()

  // ── 1. Extract audio ──────────────────────────────────────────────────────
  console.log('\n🎵 Extracting audio...')
  const t1 = Date.now()
  await extractAudio(VIDEO_PATH, audioPath)
  console.log(`   Done in ${Date.now()-t1}ms`)

  // ── 2. Get duration ───────────────────────────────────────────────────────
  const totalDuration = await getVideoDuration(VIDEO_PATH)
  console.log(`\n⏱  Total video duration: ${totalDuration.toFixed(2)}s`)

  // ── 3. Groq Whisper ───────────────────────────────────────────────────────
  console.log('\n🎙  Running Groq Whisper...')
  const t3 = Date.now()
  const audioBytes = await readFile(audioPath)
  const audioFile = new File([audioBytes], 'audio.mp3', { type: 'audio/mpeg' })
  const whisperResult = await groq.audio.transcriptions.create({
    file: audioFile,
    model: 'whisper-large-v3-turbo',
    response_format: 'verbose_json',
    timestamp_granularities: ['segment'],
  })
  const allWhisperSegs = (whisperResult.segments ?? []).map(s => ({
    id: s.id,
    start: Math.min(s.start, totalDuration),
    end: Math.min(s.end, totalDuration),
    text: s.text.trim(),
    no_speech_prob: s.no_speech_prob ?? 0
  }))

  function isHallucination(s) {
    if (s.no_speech_prob >= NO_SPEECH_PROB_THRESH) return 'high no_speech_prob'
    if (s.start >= totalDuration) return 'starts beyond video duration'
    const realChars = s.text.replace(/[^a-zA-Z0-9]/g, '')
    if (realChars.length < MIN_REAL_TEXT_CHARS) return 'text too short / punctuation only'
    return null
  }

  const spokenSegments = []
  const filteredOut = []
  for (const s of allWhisperSegs) {
    const reason = isHallucination(s)
    if (reason) filteredOut.push({ ...s, reason })
    else spokenSegments.push(s)
  }

  console.log(`   Done in ${Date.now()-t3}ms — ${allWhisperSegs.length} raw segment(s)`)
  allWhisperSegs.forEach((s, i) => {
    const reason = isHallucination(s)
    const flag = reason ? ` ⚠️  [${reason}]` : ' ✅'
    console.log(`   [${i+1}] ${s.start.toFixed(2)}s–${s.end.toFixed(2)}s (no_speech_prob=${s.no_speech_prob.toFixed(2)}): "${s.text}"${flag}`)
  })
  console.log(`   Real speech: ${spokenSegments.length}  |  Filtered hallucinations: ${filteredOut.length}`)

  // ── 4. Silence detection ──────────────────────────────────────────────────
  const t4 = Date.now()
  const silentWindows = await detectSilentWindows(audioPath)
  console.log(`   silencedetect done in ${Date.now()-t4}ms`)

  // ── 5. Find gaps + chunk ──────────────────────────────────────────────────
  const isFullySilent = spokenSegments.length === 0
  let chunks

  if (isFullySilent) {
    // Entire video has no real speech — sample a frame every FULL_SILENT_CHUNK_SECS
    console.log(`\n⚠️  No real speech detected — treating entire video as visual-only`)
    chunks = []
    let t = 0
    while (t < totalDuration) {
      chunks.push({ start: t, end: Math.min(t + FULL_SILENT_CHUNK_SECS, totalDuration) })
      t += FULL_SILENT_CHUNK_SECS
    }
    chunks = chunks.slice(0, MAX_SILENT_CHUNKS)
  } else {
    const gaps = findUnspokenGaps(silentWindows, spokenSegments, totalDuration)
    chunks = chunkLongGaps(gaps)
    console.log(`\n✂️  Unspoken gaps after filtering: ${gaps.length}`)
  }

  console.log(`   Chunks to process with Vision: ${chunks.length}`)
  chunks.forEach((c,i) => console.log(`   [${i+1}] ${c.start.toFixed(2)}s–${c.end.toFixed(2)}s (midpoint: ${((c.start+c.end)/2).toFixed(2)}s)`))

  // ── 6. Extract frames + Vision ────────────────────────────────────────────
  let silentTopicSegments = []
  if (chunks.length > 0) {
    console.log('\n🖼  Extracting frames for silent chunks...')
    const t6 = Date.now()
    const framePaths = []
    for (let i = 0; i < chunks.length; i++) {
      const midpoint = (chunks[i].start + chunks[i].end) / 2
      const framePath = join(TMP, `silent-frame-${i}.jpg`)
      try {
        await extractFrame(VIDEO_PATH, midpoint, framePath)
        framePaths.push(framePath)
        console.log(`   Frame ${i+1}: extracted at ${midpoint.toFixed(2)}s → ${existsSync(framePath) ? '✓' : '✗'}`)
      } catch (err) {
        console.log(`   Frame ${i+1}: failed — ${err.message}`)
        framePaths.push(null)
      }
    }
    console.log(`   Frame extraction done in ${Date.now()-t6}ms`)

    const validFramePaths = framePaths.filter(Boolean)
    const t6b = Date.now()
    const descriptions = await describeFramesBatch(validFramePaths)
    console.log(`   Vision done in ${Date.now()-t6b}ms`)

    let descIdx = 0
    for (let i = 0; i < chunks.length; i++) {
      const desc = framePaths[i] ? (descriptions[descIdx++] ?? 'performing task') : 'performing task'
      silentTopicSegments.push({
        mainTag: 'action',
        subTag: desc,
        start: chunks[i].start,
        end: chunks[i].end,
        thumbnailPath: null,
        source: 'vision'
      })
    }
  }

  // ── 7. Merge + sort ───────────────────────────────────────────────────────
  const spokenTopicSegments = spokenSegments.map(s => ({
    mainTag: 'speech',
    subTag: s.text.slice(0, 60),
    start: s.start,
    end: s.end,
    source: 'whisper'
  }))

  const merged = [...spokenTopicSegments, ...silentTopicSegments]
    .sort((a, b) => a.start - b.start)

  // ── 8. Results ────────────────────────────────────────────────────────────
  const totalTime = Date.now() - t0
  console.log('\n═══════════════════════════════════════════════════════')
  console.log(' RESULTS')
  console.log('═══════════════════════════════════════════════════════')
  console.log(`\nTotal pipeline time: ${totalTime}ms (${(totalTime/1000).toFixed(1)}s)`)
  console.log(`\nUnified chapter timeline (${merged.length} segments):\n`)
  console.log('  #   Start    End     Source    Tag       Description')
  console.log('  ─────────────────────────────────────────────────────────────────')
  merged.forEach((s, i) => {
    const src = s.source === 'vision' ? '👁 vision ' : '🎙 whisper'
    console.log(`  ${String(i+1).padStart(2)}  ${s.start.toFixed(2).padStart(5)}s  ${s.end.toFixed(2).padStart(5)}s  ${src}  ${s.mainTag.padEnd(8)}  ${s.subTag}`)
  })

  console.log(`\nSummary:`)
  console.log(`  Spoken segments  : ${spokenTopicSegments.length}`)
  console.log(`  Silent segments  : ${silentTopicSegments.length}`)
  console.log(`  Total segments   : ${merged.length}`)
  console.log(`  Coverage gained  : ${silentTopicSegments.length > 0 ? '✅ silent gaps now have chapters' : 'ℹ️  no silent gaps found'}`)

  // cleanup
  await rm(TMP, { recursive: true, force: true })
}

main().catch(err => { console.error('\n❌ Error:', err.message); process.exit(1) })
