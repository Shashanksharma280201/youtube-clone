// Consolidate hundreds of fine-grained segments into a handful of navigable
// chapters. Only the chapter list (topicSegments / thumbnails) is consolidated —
// the full-resolution transcript is kept separately. Fewer chapters means fewer
// thumbnails to extract/upload (304 → ~40), which is what keeps the Vercel
// "frames" step small and the watch-page chapter rail usable.
import type { TaggedSegment } from "./types";

export function consolidateChapters(
  segments: TaggedSegment[],
  maxChapters = 40,
): TaggedSegment[] {
  if (segments.length === 0) return [];

  const sorted = [...segments].sort((a, b) => a.start - b.start);

  // Pass 1: merge consecutive segments that share the same phase (mainTag).
  // A run of "diagnosis" lines becomes one Diagnosis chapter, etc.
  const chapters: TaggedSegment[] = [];
  for (const s of sorted) {
    const last = chapters[chapters.length - 1];
    if (last && last.mainTag === s.mainTag) {
      last.end = Math.max(last.end, s.end);
    } else {
      chapters.push({ ...s }); // keeps the first segment's subTag as the label
    }
  }

  // Pass 2: hard cap — repeatedly fold the shortest chapter into a neighbour
  // until we're under the limit, so a choppy video can't explode the count.
  while (chapters.length > maxChapters) {
    let minIdx = 0;
    let minDur = Infinity;
    for (let i = 0; i < chapters.length; i++) {
      const d = chapters[i].end - chapters[i].start;
      if (d < minDur) { minDur = d; minIdx = i; }
    }
    const neighbour = minIdx > 0 ? minIdx - 1 : minIdx + 1;
    const lo = Math.min(minIdx, neighbour);
    const hi = Math.max(minIdx, neighbour);
    chapters[lo].start = Math.min(chapters[lo].start, chapters[hi].start);
    chapters[lo].end = Math.max(chapters[lo].end, chapters[hi].end);
    chapters.splice(hi, 1);
  }

  return chapters;
}
