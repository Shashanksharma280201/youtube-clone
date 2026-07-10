import { chatComplete } from "./openai";
import type { VideoSegment } from "./types";

// Pure: map the model's {i, phase} output onto the requested indices. Keeps
// "other" when the model omitted an index or returned a phase not in the allowed
// set — so a bad response can never introduce a made-up label.
export function parseReassignments(
  text: string,
  count: number,
  allowed: string[],
): string[] {
  const set = new Set(allowed);
  type Entry = { i?: number; phase?: unknown };
  let arr: Entry[] | null = null;
  try {
    const p = JSON.parse(text) as { assignments?: unknown };
    if (Array.isArray(p.assignments)) arr = p.assignments as Entry[];
  } catch {
    arr = null;
  }
  return Array.from({ length: count }, (_, j) => {
    const e = arr?.find((x) => x?.i === j) ?? arr?.[j];
    const phase = typeof e?.phase === "string" ? e.phase.trim() : "";
    return set.has(phase) ? phase : "other";
  });
}

// Reassign every "other" chapter to the best-fitting phase drawn from the video's
// OWN phase vocabulary, using each chapter's one-line summary. Chapters that
// genuinely fit nothing stay "other". Only "other" chapters are touched; correct
// chapters are never disturbed. One cheap gpt-4o-mini call per video.
export async function reassignOtherTags(segments: VideoSegment[]): Promise<VideoSegment[]> {
  const phases = Array.from(
    new Set(segments.map((s) => s.mainTag).filter((m) => m && m !== "other")),
  );
  const otherIdx = segments
    .map((s, i) => (s.mainTag === "other" ? i : -1))
    .filter((i) => i >= 0);

  // Nothing to reassign to, or nothing to reassign.
  if (phases.length === 0 || otherIdx.length === 0) return segments;

  const input = otherIdx.map((idx, j) => ({
    i: j,
    text: (segments[idx].summarizedText || segments[idx].subTag || "").slice(0, 300),
  }));

  let mapped: string[];
  try {
    const res = await chatComplete(
      {
        temperature: 0,
        max_tokens: 800,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              `Each item describes one video chapter. Assign each to the single best-fitting phase from this list: ${phases.join(", ")}. Only use "other" if a chapter genuinely fits none of them. Return ONLY this JSON object: {"assignments":[{"i":0,"phase":"..."}]}`,
          },
          { role: "user", content: JSON.stringify(input) },
        ],
      },
      { mini: true },
    );
    mapped = parseReassignments(res.choices[0]?.message?.content ?? "{}", otherIdx.length, phases);
  } catch (err) {
    console.warn("[reassignOther] failed, keeping 'other':", err);
    return segments;
  }

  const out = segments.slice();
  otherIdx.forEach((idx, j) => {
    if (mapped[j] && mapped[j] !== "other") out[idx] = { ...out[idx], mainTag: mapped[j] };
  });
  return out;
}
