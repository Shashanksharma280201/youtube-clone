// Token + cost accounting for every OpenAI call in the pipeline.
//
// Purpose: turn the "we estimate ~$X per video" guess into the ACTUAL tokens and
// dollars. Every GPT chat call (openai.ts) and every Whisper call (transcribe.ts)
// reports here, so one run prints exactly what it cost.
//
// TOKEN COUNTS ARE EXACT — they come straight from the OpenAI response `usage`
// object. COST is derived from the rate table below; edit CHAT_PRICES / WHISPER
// to match your account's actual price card and the dollars become exact too.
//
// Scope note: locally (`next dev`) the whole pipeline runs in ONE Node process, so
// the running total printed at the end of a run IS that video's total. In production
// each durable "use step" can run in a separate isolate, so there the per-CALL log
// lines are the source of truth (sum them per video, or persist to the DB); the
// in-memory running total is per-process only. This module never throws — accounting
// must never break a real transcription.

// ── Rate card (USD). EDIT THESE to your account's real prices. ──────────────────
// Chat is priced per 1,000,000 tokens, split input (prompt) vs output (completion).
type ChatPrice = { in: number; out: number };

const CHAT_PRICES: Record<string, ChatPrice> = {
  // Placeholder GPT-5-tier rates — replace with your billed rates.
  "gpt-5.4": { in: 1.25, out: 10.0 },
  "gpt-5.4-mini": { in: 0.25, out: 2.0 },
  // Fallback models (known public rates).
  "gpt-4o": { in: 2.5, out: 10.0 },
  "gpt-4o-mini": { in: 0.15, out: 0.6 },
};

// Whisper is priced per minute of audio sent (this rate is real/public).
const WHISPER_PER_MIN = 0.006;

// ── Running totals (per process) ────────────────────────────────────────────────
type Totals = {
  chatCalls: number;
  promptTokens: number;
  completionTokens: number;
  whisperCalls: number;
  whisperSeconds: number;
  usd: number;
};

const totals: Totals = {
  chatCalls: 0,
  promptTokens: 0,
  completionTokens: 0,
  whisperCalls: 0,
  whisperSeconds: 0,
  usd: 0,
};

function money(n: number): string {
  return `$${n.toFixed(6)}`;
}

// Look up a price row, tolerating dated model ids like "gpt-5.4-mini-2026-03-17".
// The LONGEST matching prefix wins, so a "-mini" id is never mispriced as the
// flagship (both share the "gpt-5.4" prefix; "gpt-5.4-mini" is the correct match).
function priceFor(model: string): ChatPrice | undefined {
  if (CHAT_PRICES[model]) return CHAT_PRICES[model];
  const key = Object.keys(CHAT_PRICES)
    .filter((k) => model.startsWith(k))
    .sort((a, b) => b.length - a.length)[0];
  return key ? CHAT_PRICES[key] : undefined;
}

type Usage = { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null | undefined;

// Record one chat completion. `model` is the model that ACTUALLY ran (response.model),
// so a silent fallback is priced correctly. `label` names the pipeline step.
export function recordChat(model: string, usage: Usage, label = "chat"): void {
  try {
    const prompt = usage?.prompt_tokens ?? 0;
    const completion = usage?.completion_tokens ?? 0;
    const price = priceFor(model);
    const cost = price ? (prompt / 1e6) * price.in + (completion / 1e6) * price.out : 0;

    totals.chatCalls += 1;
    totals.promptTokens += prompt;
    totals.completionTokens += completion;
    totals.usd += cost;

    const costStr = price ? money(cost) : "cost=? (no rate for model)";
    console.log(
      `[usage] chat step=${label} model=${model} prompt=${prompt} completion=${completion} ` +
        `total=${prompt + completion} ${price ? `cost=${costStr}` : costStr} ` +
        `| run: calls=${totals.chatCalls} tokens=${totals.promptTokens + totals.completionTokens} cost=${money(totals.usd)}`,
    );
  } catch {
    /* accounting must never break the pipeline */
  }
}

// Record one Whisper transcription of `seconds` of audio.
export function recordWhisper(seconds: number, label = "whisper"): void {
  try {
    const secs = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
    const cost = (secs / 60) * WHISPER_PER_MIN;
    totals.whisperCalls += 1;
    totals.whisperSeconds += secs;
    totals.usd += cost;
    console.log(
      `[usage] whisper step=${label} seconds=${secs.toFixed(1)} min=${(secs / 60).toFixed(2)} cost=${money(cost)} ` +
        `| run: whisperMin=${(totals.whisperSeconds / 60).toFixed(2)} cost=${money(totals.usd)}`,
    );
  } catch {
    /* never break the pipeline */
  }
}

export function usageSnapshot(): Totals {
  return { ...totals };
}

// Print a clear one-block summary. Call once at the end of a run. In local single-
// process dev this is the whole video's cost; in prod it is this process's share.
export function logUsageTotal(tag = "video"): void {
  const t = totals;
  const tokens = t.promptTokens + t.completionTokens;
  console.log(
    [
      "",
      `==================== USAGE TOTAL (${tag}) ====================`,
      `  GPT chat calls   : ${t.chatCalls}`,
      `  prompt tokens    : ${t.promptTokens}`,
      `  completion tokens: ${t.completionTokens}`,
      `  chat tokens total: ${tokens}`,
      `  Whisper calls    : ${t.whisperCalls}  (${(t.whisperSeconds / 60).toFixed(2)} min audio)`,
      `  ESTIMATED COST   : ${money(t.usd)}   (tokens are exact; cost uses editable rates in usage.ts)`,
      `=============================================================`,
      "",
    ].join("\n"),
  );
}
