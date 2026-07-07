// Machine-maintenance domain layer.
//
// After the generic pipeline produces a timestamped transcript + chapters, this
// runs a GPT pass over them and extracts a self-service DEBUGGING guide: for every
// problem/error it writes symptom → likely cause → how to check → fix steps →
// verify → what to try next, plus preventive maintenance, safety, tools/parts,
// specs, and a plain-language glossary. Every item carries timestamps to jump the
// video to the exact moment.
//
// Orchestration-agnostic (no Workflow/Vercel imports).
import OpenAI from "openai";
import type { TaggedSegment, VideoSegment } from "./types";
import { EMPTY_DOMAIN, asDomainData, hasDomainContent, type DomainData } from "./domain-types";

export { EMPTY_DOMAIN, hasDomainContent } from "./domain-types";
export type { DomainData, DebugItem, Procedure, Step, GuideItem, SpecItem, GlossaryTerm } from "./domain-types";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// gpt-4o handles ~128k tokens. ~300k chars ≈ 75k tokens leaves room for the big
// JSON output, and covers a ~4hr video in ONE coherent pass (no truncation).
// Longer than this is split into chunks and merged.
const SINGLE_PASS_CHARS = 300_000;
const CHUNK_CHARS = 140_000;

const SYSTEM = `You are a veteran maintenance technician mentoring a newcomer. From the video, write a guide that TEACHES the machine and then walks the reader through fixing each problem — like telling the story of how you'd approach it, not filling in a dry form. A person who has never seen this machine should finish able to understand it and fix the same issue themselves.

VOICE & WRITING RULES (critical):
- Warm, clear, story-like teaching voice ("You'll notice…", "What's happening here is…", "Start by…"). Second person.
- Plain words. When you use a technical term, explain it in the same breath, e.g. "the trunnion cap (the round end-cap the cylinder pivots on)".
- You MAY explain what a general technical term means from your own knowledge. But any FACT about THIS machine — values, settings, part names, causes, steps — must come ONLY from the transcript. Never invent codes, specs, numbers, or steps.
- Teach FIRST, then debug. Include the real numbers, tools, and cautions from the video.
- Leave a section as an empty array/"" if the video genuinely has nothing for it.
- For every item and step, set "start" to the SECONDS where it's shown/discussed, or null.

For each PROBLEM and ERROR CODE:
- "symptom": one line — what the technician notices (so they can match their situation fast).
- "story": 1-3 short paragraphs that TEACH: what part/system is involved and how it normally works, then what's going wrong and why, then how to spot/diagnose it. This is the heart of the guide — make it genuinely educational and narrative.
- "fix": ordered hands-on steps; each {"text": plain imperative action, "expected": what you should see after (or ""), "start": sec|null}.
- "verify": how to know it's truly fixed. "ifNotResolved": what to try next.
- "tools", "difficulty" (Easy|Medium|Hard), "time" (~X min).

Return ONLY this JSON object:
{
  "machine": "name of the machine/equipment (infer if clearly implied), or ''",
  "summary": "2-3 sentence plain overview of the machine and what this video solves",
  "overview": "a narrative that teaches how this machine works and its main parts, in plain words — the foundation before the problems (3-6 sentences)",
  "machineIntro": [{"title":"component/system", "detail":"plain teaching explanation of what it is and its job", "steps":[], "start":<sec|null>}],
  "preventiveMaintenance": [{"title":"task", "detail":"what it is, why it matters, and when to do it", "steps":[{"text":"...","expected":"...","start":<sec|null>}], "tools":["..."], "difficulty":"Easy|Medium|Hard", "time":"~X min", "start":<sec|null>}],
  "errorCodes": [{"code":"E-041", "title":"short name of the fault", "symptom":"...", "story":"teach + explain + how to diagnose", "fix":[{"text":"...","expected":"...","start":<sec|null>}], "verify":"...", "ifNotResolved":"...", "tools":["..."], "difficulty":"Easy|Medium|Hard", "time":"~X min", "start":<sec|null>}],
  "troubleshooting": [{"code":"", "title":"the problem in plain words", "symptom":"...", "story":"teach + explain + how to diagnose", "fix":[{"text":"...","expected":"...","start":<sec|null>}], "verify":"...", "ifNotResolved":"...", "tools":["..."], "difficulty":"Easy|Medium|Hard", "time":"~X min", "start":<sec|null>}],
  "safety": [{"title":"hazard/warning", "detail":"the risk and why it matters", "steps":["precaution 1","..."], "start":<sec|null>}],
  "tools": ["all tools mentioned"],
  "parts": ["all replacement parts/components mentioned"],
  "specs": [{"label":"e.g. torque / pressure / capacity", "value":"e.g. 250 Nm", "start":<sec|null>}],
  "glossary": [{"term":"technical term used in this guide", "definition":"one-line plain-language meaning"}]
}`;

function fmtClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
}

async function runPass(user: string): Promise<Record<string, unknown>> {
  const res = await openai.chat.completions.create({
    model: "gpt-4o",
    temperature: 0,
    response_format: { type: "json_object" },
    max_tokens: 16000, // rich debug flows + glossary need lots of room
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: user },
    ],
  });
  return JSON.parse(res.choices[0]?.message?.content ?? "{}");
}

// Merge several partial guides (from transcript chunks) into one.
function mergeDomains(parts: DomainData[]): DomainData {
  const merged: DomainData = { ...EMPTY_DOMAIN };
  const dedupe = <T extends { title?: string; code?: string; label?: string; term?: string }>(arr: T[]): T[] => {
    const seen = new Set<string>();
    return arr.filter((x) => {
      const k = (x.code || x.title || x.label || x.term || "").toLowerCase().trim();
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };
  for (const p of parts) {
    merged.machine ||= p.machine;
    merged.summary ||= p.summary;
    merged.overview ||= p.overview;
    merged.machineIntro.push(...p.machineIntro);
    merged.preventiveMaintenance.push(...p.preventiveMaintenance);
    merged.errorCodes.push(...p.errorCodes);
    merged.troubleshooting.push(...p.troubleshooting);
    merged.safety.push(...p.safety);
    merged.tools.push(...p.tools);
    merged.parts.push(...p.parts);
    merged.specs.push(...p.specs);
    merged.glossary.push(...p.glossary);
  }
  merged.machineIntro = dedupe(merged.machineIntro);
  merged.preventiveMaintenance = dedupe(merged.preventiveMaintenance);
  merged.errorCodes = dedupe(merged.errorCodes);
  merged.troubleshooting = dedupe(merged.troubleshooting);
  merged.safety = dedupe(merged.safety);
  merged.tools = Array.from(new Set(merged.tools));
  merged.parts = Array.from(new Set(merged.parts));
  merged.specs = dedupe(merged.specs);
  merged.glossary = dedupe(merged.glossary);
  return merged;
}

// Build the debugging guide from the timestamped transcript + chapters.
// Returns EMPTY_DOMAIN on any failure so it never blocks the pipeline.
export async function extractDomainData(
  transcriptSegments: TaggedSegment[],
  chapters: VideoSegment[],
  duration: number,
): Promise<DomainData> {
  const spoken = transcriptSegments.filter((s) => s.text && s.text.trim());
  if (spoken.length === 0 && chapters.length === 0) return EMPTY_DOMAIN;

  const fullTranscript = spoken
    .map((s) => `[${fmtClock(s.start)} | ${Math.round(s.start)}s] ${s.text.trim()}`)
    .join("\n");

  const chapterList = chapters
    .map((c, i) => `${i + 1}. [${fmtClock(c.start)} | ${Math.round(c.start)}s] ${c.mainTag} — ${c.subTag}`)
    .join("\n");

  const wrap = (t: string) =>
    `CHAPTERS:\n${chapterList || "(none)"}\n\nTRANSCRIPT:\n${t || "(no speech — silent/observational video)"}`;

  try {
    // One pass for normal-length videos; chunk + merge only for very long ones.
    if (fullTranscript.length <= SINGLE_PASS_CHARS) {
      return asDomainData(await runPass(wrap(fullTranscript))) ?? EMPTY_DOMAIN;
    }

    const chunks: string[] = [];
    for (let i = 0; i < fullTranscript.length; i += CHUNK_CHARS) {
      chunks.push(fullTranscript.slice(i, i + CHUNK_CHARS));
    }
    const parts = await Promise.all(
      chunks.map(async (c) => asDomainData(await runPass(wrap(c))) ?? EMPTY_DOMAIN),
    );
    return mergeDomains(parts);
  } catch (err) {
    console.error("[domain] extraction failed:", err);
    return EMPTY_DOMAIN;
  }
}
