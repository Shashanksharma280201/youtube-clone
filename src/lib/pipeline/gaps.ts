// Pure functions for finding and chunking the unspoken (silent / no-speech)
// stretches of a video. No I/O — easy to reason about and test.
import {
  SILENCE_MIN_SECS,
  MAX_SILENT_CHUNKS,
  type RawSegment,
  type SilentWindow,
} from "./types";

// Combine silencedetect windows + gaps between Whisper segments.
// silencedetect catches true-quiet videos; Whisper gaps catch tool-noise videos
// where the silence threshold isn't crossed but no speech is present.
export function findUnspokenGaps(
  silentWindows: SilentWindow[],
  spokenSegments: RawSegment[],
  totalDuration: number,
): { start: number; end: number }[] {
  // Source 1: silencedetect windows not overlapping any spoken segment
  const fromSilence = silentWindows
    .map((w) => ({ start: w.start, end: w.end ?? totalDuration }))
    .filter((w) => {
      const overlaps = spokenSegments.some((s) => s.end > w.start && s.start < w.end);
      return !overlaps && w.end - w.start >= SILENCE_MIN_SECS;
    });

  // Source 2: gaps between Whisper segments
  const sorted = [...spokenSegments].sort((a, b) => a.start - b.start);
  const whisperGaps: { start: number; end: number }[] = [];
  if (sorted.length === 0) {
    whisperGaps.push({ start: 0, end: totalDuration });
  } else {
    if (sorted[0].start >= SILENCE_MIN_SECS)
      whisperGaps.push({ start: 0, end: sorted[0].start });
    for (let i = 0; i < sorted.length - 1; i++) {
      const gapLen = sorted[i + 1].start - sorted[i].end;
      if (gapLen >= SILENCE_MIN_SECS)
        whisperGaps.push({ start: sorted[i].end, end: sorted[i + 1].start });
    }
    const tail = totalDuration - sorted[sorted.length - 1].end;
    if (tail >= SILENCE_MIN_SECS)
      whisperGaps.push({ start: sorted[sorted.length - 1].end, end: totalDuration });
  }

  // Merge + deduplicate by start time
  const seen = new Set<string>();
  return [...fromSilence, ...whisperGaps]
    .filter((g) => {
      const key = g.start.toFixed(1);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.start - b.start);
}

// Split overly long silent gaps into evenly-sized chunks, capped for safety.
export function chunkLongGaps(
  gaps: { start: number; end: number }[],
  chunkSize: number,
): { start: number; end: number }[] {
  const chunks: { start: number; end: number }[] = [];
  for (const gap of gaps) {
    if (gap.end - gap.start <= chunkSize) {
      chunks.push(gap);
    } else {
      let t = gap.start;
      while (t < gap.end) {
        chunks.push({ start: t, end: Math.min(t + chunkSize, gap.end) });
        t += chunkSize;
      }
    }
  }
  return chunks.slice(0, MAX_SILENT_CHUNKS);
}
