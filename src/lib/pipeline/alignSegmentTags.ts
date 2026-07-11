import type { TaggedSegment, VideoSegment } from "./types";

// Chapters are the source of truth for the phase label: they are consolidated and
// (after reassignment) free of "other". A transcript segment sits inside exactly
// one chapter, so it should carry that chapter's phase — otherwise the UI's
// transcript view contradicts the chapter list it was built from.
//
// Only mainTag is propagated; each segment keeps its own subTag, which is a
// finer-grained description of that moment.
export function alignSegmentTags(
  segments: TaggedSegment[],
  chapters: VideoSegment[],
): TaggedSegment[] {
  if (chapters.length === 0) return segments;

  return segments.map((seg) => {
    const chapter = chapters.find((c) => seg.start >= c.start && seg.start < c.end);
    if (!chapter || !chapter.mainTag) return seg;
    return { ...seg, mainTag: chapter.mainTag };
  });
}
