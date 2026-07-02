// Machine-maintenance domain layer.
//
// After the generic pipeline produces a timestamped transcript + chapters, this
// runs ONE GPT pass over them and extracts a structured "machine guide": intro,
// preventive maintenance, error codes, troubleshooting FAQs, safety, tools/parts,
// and specs. Every item carries a `start` timestamp so the UI can jump the video
// to the exact moment it's discussed.
//
// Orchestration-agnostic (no Workflow/Vercel imports) — lives with the rest of
// the portable pipeline.
import OpenAI from "openai";
import type { TaggedSegment, VideoSegment } from "./types";
import {
  EMPTY_DOMAIN,
  type DomainData,
  type GuideItem,
} from "./domain-types";

export { EMPTY_DOMAIN, hasDomainContent } from "./domain-types";
export type { DomainData, GuideItem, ErrorCodeItem, FaqItem, SpecItem } from "./domain-types";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const MAX_TRANSCRIPT_CHARS = 90_000; // keep the prompt within gpt-4o's context

function fmtClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

// Coerce whatever the model returns into a valid DomainData (never throws).
function coerce(raw: unknown, duration: number): DomainData {
  const o = (raw ?? {}) as Record<string, unknown>;
  const clampStart = (v: unknown): number | null => {
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n) || n < 0) return null;
    return duration > 0 ? Math.min(n, duration) : n;
  };
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const arr = (v: unknown): Record<string, unknown>[] =>
    Array.isArray(v) ? (v as Record<string, unknown>[]) : [];
  const strArr = (v: unknown): string[] =>
    Array.isArray(v) ? v.map((x) => str(x)).filter(Boolean) : [];

  const items = (v: unknown): GuideItem[] =>
    arr(v)
      .map((it) => ({ title: str(it.title), detail: str(it.detail), start: clampStart(it.start) }))
      .filter((it) => it.title || it.detail);

  return {
    machine: str(o.machine),
    summary: str(o.summary),
    machineIntro: items(o.machineIntro),
    preventiveMaintenance: items(o.preventiveMaintenance),
    errorCodes: arr(o.errorCodes)
      .map((it) => ({
        code: str(it.code),
        meaning: str(it.meaning),
        resolution: str(it.resolution),
        start: clampStart(it.start),
      }))
      .filter((it) => it.code || it.meaning),
    troubleshooting: arr(o.troubleshooting)
      .map((it) => ({ question: str(it.question), answer: str(it.answer), start: clampStart(it.start) }))
      .filter((it) => it.question),
    safety: items(o.safety),
    tools: strArr(o.tools),
    parts: strArr(o.parts),
    specs: arr(o.specs)
      .map((it) => ({ label: str(it.label), value: str(it.value), start: clampStart(it.start) }))
      .filter((it) => it.label || it.value),
  };
}

// Build the structured machine guide from the timestamped transcript + chapters.
// Returns EMPTY_DOMAIN on any failure so it never blocks the pipeline.
export async function extractDomainData(
  transcriptSegments: TaggedSegment[],
  chapters: VideoSegment[],
  duration: number,
): Promise<DomainData> {
  const spoken = transcriptSegments.filter((s) => s.text && s.text.trim());
  if (spoken.length === 0 && chapters.length === 0) return EMPTY_DOMAIN;

  // Compact, timestamped transcript so the model can cite exact moments.
  let transcript = "";
  for (const s of spoken) {
    const line = `[${fmtClock(s.start)} | ${Math.round(s.start)}s] ${s.text.trim()}\n`;
    if (transcript.length + line.length > MAX_TRANSCRIPT_CHARS) break;
    transcript += line;
  }

  const chapterList = chapters
    .map((c, i) => `${i + 1}. [${fmtClock(c.start)} | ${Math.round(c.start)}s] ${c.mainTag} — ${c.subTag}`)
    .join("\n");

  const system = `You are an expert at turning a machine/equipment maintenance video into a structured guide for technicians.
Read the timestamped transcript and chapter list, then extract ONLY information actually present in the video.
For every item, set "start" to the number of SECONDS where it is discussed (pick the closest transcript/chapter timestamp). Use null only if it truly maps to no moment.
Do NOT invent error codes, specs, or steps that aren't in the transcript. Leave a section as an empty array if the video has nothing for it.

Return ONLY this JSON object:
{
  "machine": "short name of the machine/equipment, or ''",
  "summary": "1-2 sentence overview of what this video covers",
  "machineIntro": [{"title":"...", "detail":"what is introduced/explained", "start":<seconds|null>}],
  "preventiveMaintenance": [{"title":"task name", "detail":"how/when to do it", "start":<seconds|null>}],
  "errorCodes": [{"code":"E-123", "meaning":"what it indicates", "resolution":"how to resolve", "start":<seconds|null>}],
  "troubleshooting": [{"question":"symptom/problem as a question", "answer":"the fix explained", "start":<seconds|null>}],
  "safety": [{"title":"warning", "detail":"why/precaution", "start":<seconds|null>}],
  "tools": ["tool names mentioned"],
  "parts": ["replacement parts/components mentioned"],
  "specs": [{"label":"e.g. torque / pressure / capacity", "value":"e.g. 250 Nm", "start":<seconds|null>}]
}`;

  const user = `CHAPTERS:\n${chapterList || "(none)"}\n\nTRANSCRIPT:\n${transcript || "(no speech — silent/observational video)"}`;

  try {
    const res = await openai.chat.completions.create({
      model: "gpt-4o",
      temperature: 0,
      response_format: { type: "json_object" },
      max_tokens: 4000,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });
    const parsed = JSON.parse(res.choices[0]?.message?.content ?? "{}");
    return coerce(parsed, duration);
  } catch (err) {
    console.error("[domain] extraction failed:", err);
    return EMPTY_DOMAIN;
  }
}
