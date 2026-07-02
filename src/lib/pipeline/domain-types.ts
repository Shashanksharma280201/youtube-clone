// Pure types + helpers for the machine-maintenance guide. No server-only imports
// (no OpenAI SDK), so this is safe to import from client components.

// A guide entry tied to a moment in the video. `start` is seconds (null if the
// item isn't tied to a specific timestamp).
export type GuideItem = {
  title: string;
  detail: string;
  start: number | null;
};

export type ErrorCodeItem = {
  code: string;
  meaning: string;
  resolution: string;
  start: number | null;
};

export type FaqItem = {
  question: string;
  answer: string;
  start: number | null;
};

export type SpecItem = {
  label: string;
  value: string;
  start: number | null;
};

// The full structured guide persisted on the video (Video.domainData).
export type DomainData = {
  machine: string;
  summary: string;
  machineIntro: GuideItem[];
  preventiveMaintenance: GuideItem[];
  errorCodes: ErrorCodeItem[];
  troubleshooting: FaqItem[];
  safety: GuideItem[];
  tools: string[];
  parts: string[];
  specs: SpecItem[];
};

export const EMPTY_DOMAIN: DomainData = {
  machine: "",
  summary: "",
  machineIntro: [],
  preventiveMaintenance: [],
  errorCodes: [],
  troubleshooting: [],
  safety: [],
  tools: [],
  parts: [],
  specs: [],
};

// True when there's at least one populated section worth a "Machine Guide" tab.
export function hasDomainContent(d: DomainData | null | undefined): boolean {
  if (!d) return false;
  return Boolean(
    d.summary ||
      d.machineIntro.length ||
      d.preventiveMaintenance.length ||
      d.errorCodes.length ||
      d.troubleshooting.length ||
      d.safety.length ||
      d.tools.length ||
      d.parts.length ||
      d.specs.length,
  );
}

// Normalize whatever is stored in Video.domainData (Prisma JSON) into a DomainData.
export function asDomainData(raw: unknown): DomainData | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Partial<DomainData>;
  const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  const strs = (v: unknown): string[] => (Array.isArray(v) ? (v as unknown[]).map(String) : []);
  const d: DomainData = {
    machine: typeof o.machine === "string" ? o.machine : "",
    summary: typeof o.summary === "string" ? o.summary : "",
    machineIntro: list<GuideItem>(o.machineIntro),
    preventiveMaintenance: list<GuideItem>(o.preventiveMaintenance),
    errorCodes: list<ErrorCodeItem>(o.errorCodes),
    troubleshooting: list<FaqItem>(o.troubleshooting),
    safety: list<GuideItem>(o.safety),
    tools: strs(o.tools),
    parts: strs(o.parts),
    specs: list<SpecItem>(o.specs),
  };
  return hasDomainContent(d) ? d : null;
}
