import type { TaggedSegment } from "./types";

// A lone `other` segment shorter than `maxSecs`, flanked by two segments that
// share the same non-`other` tag, is almost always filler mid-task. Absorb it so
// it does not surface as its own chapter. Longer `other` runs are left alone.
export function mergeOrphanOther(
  segments: TaggedSegment[],
  maxSecs = 8,
): TaggedSegment[] {
  return segments.map((seg, i) => {
    if (seg.mainTag !== "other") return seg;
    const prev = segments[i - 1];
    const next = segments[i + 1];
    const short = seg.end - seg.start < maxSecs;
    if (
      short &&
      prev &&
      next &&
      prev.mainTag !== "other" &&
      prev.mainTag === next.mainTag
    ) {
      return { ...seg, mainTag: prev.mainTag };
    }
    return seg;
  });
}
