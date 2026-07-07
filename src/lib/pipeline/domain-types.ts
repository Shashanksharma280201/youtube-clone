// Pure types + helpers for the machine-maintenance guide. No server-only imports
// (no OpenAI SDK), so this is safe to import from client components.
//
// The guide is built for SELF-SERVICE DEBUGGING: each problem is a full flow —
// symptom → likely cause → how to check → fix steps → verify → if it still fails.

// One step in a procedure. `text` is a plain-language action (technical terms
// explained inline); `expected` is what you should see after it (or ""); `start`
// jumps to the exact moment in the video (or null). `visual` is a vision-derived
// note about WHERE the component is on screen (filled in by the enrich step).
export type Step = {
  text: string;
  expected: string;
  visual: string;
  start: number | null;
};

// A guided fix for a problem or an error code — told as a teaching story.
export type DebugItem = {
  code: string; // error code (e.g. "E-041"), or "" for a plain problem
  title: string; // the problem stated simply
  symptom: string; // one line: what you notice (for quick matching)
  // The narrative: teaches the machine part involved, explains what's going wrong
  // and why, and talks the technician through spotting/diagnosing it. 1-3 paragraphs.
  story: string;
  fix: Step[]; // ordered, actionable resolution steps
  verify: string; // how to confirm it's resolved
  ifNotResolved: string; // what to try next if the fix didn't work
  tools: string[]; // tools/parts needed for this fix
  difficulty: string; // "Easy" | "Medium" | "Hard" | ""
  time: string; // rough time, e.g. "~30 min", or ""
  start: number | null;
};

// A routine procedure (preventive maintenance).
export type Procedure = {
  title: string;
  detail: string; // what it is, why it matters, when to do it
  steps: Step[];
  tools: string[];
  difficulty: string;
  time: string;
  start: number | null;
};

// A simple titled note (machine intro, safety) with optional plain points.
export type GuideItem = {
  title: string;
  detail: string;
  steps: string[];
  start: number | null;
};

export type GlossaryTerm = { term: string; definition: string };

export type SpecItem = { label: string; value: string; start: number | null };

// The full structured guide persisted on the video (Video.domainData).
export type DomainData = {
  machine: string;
  summary: string;
  // Narrative "how this machine works" — the teaching foundation before the issues.
  overview: string;
  machineIntro: GuideItem[];
  preventiveMaintenance: Procedure[];
  errorCodes: DebugItem[];
  troubleshooting: DebugItem[];
  safety: GuideItem[];
  tools: string[];
  parts: string[];
  specs: SpecItem[];
  glossary: GlossaryTerm[];
};

export const EMPTY_DOMAIN: DomainData = {
  machine: "",
  summary: "",
  overview: "",
  machineIntro: [],
  preventiveMaintenance: [],
  errorCodes: [],
  troubleshooting: [],
  safety: [],
  tools: [],
  parts: [],
  specs: [],
  glossary: [],
};

// True when there's at least one populated section worth a "Machine Guide" tab.
export function hasDomainContent(d: DomainData | null | undefined): boolean {
  if (!d) return false;
  return Boolean(
    d.summary ||
      d.overview ||
      d.machineIntro.length ||
      d.preventiveMaintenance.length ||
      d.errorCodes.length ||
      d.troubleshooting.length ||
      d.safety.length ||
      d.tools.length ||
      d.parts.length ||
      d.specs.length ||
      d.glossary.length,
  );
}

// ─── normalizers (defensive: DB JSON or model output → valid types) ────────────

const asStr = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const asStrArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(asStr).filter(Boolean) : [];
const asNum = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const asList = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? (v as Record<string, unknown>[]) : [];

// Steps may arrive as plain strings (old data) or {text,expected,start} objects.
export function asSteps(v: unknown): Step[] {
  return asList(v)
    .map((s) =>
      typeof s === "string"
        ? { text: asStr(s), expected: "", visual: "", start: null }
        : { text: asStr(s.text), expected: asStr(s.expected), visual: asStr(s.visual), start: asNum(s.start) },
    )
    .filter((s) => s.text);
}

function asGuideItem(v: unknown): GuideItem {
  const o = (v ?? {}) as Record<string, unknown>;
  return { title: asStr(o.title), detail: asStr(o.detail), steps: asStrArr(o.steps), start: asNum(o.start) };
}

function asDebugItem(v: unknown): DebugItem {
  const o = (v ?? {}) as Record<string, unknown>;
  return {
    code: asStr(o.code),
    // fall back to legacy fields so old records still show something
    title: asStr(o.title) || asStr(o.question) || asStr(o.meaning),
    symptom: asStr(o.symptom) || asStr(o.question),
    story: asStr(o.story) || asStr(o.cause) || asStr(o.answer),
    fix: asSteps(o.fix ?? o.steps),
    verify: asStr(o.verify),
    ifNotResolved: asStr(o.ifNotResolved),
    tools: asStrArr(o.tools),
    difficulty: asStr(o.difficulty),
    time: asStr(o.time),
    start: asNum(o.start),
  };
}

function asProcedure(v: unknown): Procedure {
  const o = (v ?? {}) as Record<string, unknown>;
  return {
    title: asStr(o.title),
    detail: asStr(o.detail),
    steps: asSteps(o.steps),
    tools: asStrArr(o.tools),
    difficulty: asStr(o.difficulty),
    time: asStr(o.time),
    start: asNum(o.start),
  };
}

// Normalize whatever is stored in Video.domainData (Prisma JSON) into a DomainData.
export function asDomainData(raw: unknown): DomainData | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const d: DomainData = {
    machine: asStr(o.machine),
    summary: asStr(o.summary),
    overview: asStr(o.overview),
    machineIntro: asList(o.machineIntro).map(asGuideItem).filter((x) => x.title || x.detail),
    preventiveMaintenance: asList(o.preventiveMaintenance).map(asProcedure).filter((x) => x.title),
    errorCodes: asList(o.errorCodes).map(asDebugItem).filter((x) => x.code || x.title),
    troubleshooting: asList(o.troubleshooting).map(asDebugItem).filter((x) => x.title || x.symptom),
    safety: asList(o.safety).map(asGuideItem).filter((x) => x.title || x.detail),
    tools: asStrArr(o.tools),
    parts: asStrArr(o.parts),
    specs: asList(o.specs)
      .map((s) => ({ label: asStr(s.label), value: asStr(s.value), start: asNum(s.start) }))
      .filter((s) => s.label || s.value),
    glossary: asList(o.glossary)
      .map((g) => ({ term: asStr(g.term), definition: asStr(g.definition) }))
      .filter((g) => g.term && g.definition),
  };
  return hasDomainContent(d) ? d : null;
}
