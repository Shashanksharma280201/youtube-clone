// Shared OpenAI chat client + model selection.
//
// The model is configurable via env so you can point at a newer model without
// code changes:
//   OPENAI_MODEL       (flagship, default gpt-4o)      — used for vision + the guide
//   OPENAI_MODEL_MINI  (cheaper,  default gpt-4o-mini) — used for tagging + search
// If the configured model isn't available to the key, calls auto-fall back to
// gpt-4o / gpt-4o-mini so the pipeline keeps working.
//
// NOTE on token limits: every call sends `max_completion_tokens`, never
// `max_tokens`. GPT-5 models REJECT max_tokens outright; gpt-4o accepts both. One
// parameter therefore works for every model, with no branching.
//
// The fallback is a safety net, but it is also a trap when comparing models: a key
// without access to the configured model silently produces gpt-4o output that looks
// like success. `activeModels()` is exposed on /api/health, and a fallback logs a
// warning, so you can always prove which model actually ran.
import OpenAI from "openai";
import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const MODEL = process.env.OPENAI_MODEL || "gpt-4o";
const MODEL_MINI = process.env.OPENAI_MODEL_MINI || "gpt-4o-mini";
const FALLBACK = "gpt-4o";
const FALLBACK_MINI = "gpt-4o-mini";

// What this deployment is configured to use. Surfaced on /api/health so a model
// switch can be verified instead of assumed.
export function activeModels() {
  return { model: MODEL, modelMini: MODEL_MINI };
}

// True when the error means the model can't be used by this key (not a transient
// failure) — so we should retry with the known-good fallback model.
function isModelUnavailable(err: unknown): boolean {
  const e = err as { status?: number; code?: string; error?: { code?: string; message?: string } };
  const code = e?.code || e?.error?.code || "";
  const msg = (e?.error?.message || "").toLowerCase();
  return (
    e?.status === 404 ||
    e?.status === 403 ||
    code === "model_not_found" ||
    msg.includes("does not exist") ||
    msg.includes("do not have access") ||
    msg.includes("not available")
  );
}

type ChatParams = Omit<ChatCompletionCreateParamsNonStreaming, "model">;

// Run a chat completion with the configured model; fall back to gpt-4o(-mini) if
// that model isn't available to the key. `opts.mini` selects the smaller tier.
export async function chatComplete(params: ChatParams, opts?: { mini?: boolean }) {
  const primary = opts?.mini ? MODEL_MINI : MODEL;
  const fallback = opts?.mini ? FALLBACK_MINI : FALLBACK;
  try {
    return await openai.chat.completions.create({ ...params, model: primary });
  } catch (err) {
    if (primary !== fallback && isModelUnavailable(err)) {
      console.warn(`[openai] model "${primary}" unavailable — falling back to "${fallback}"`);
      return openai.chat.completions.create({ ...params, model: fallback });
    }
    throw err;
  }
}
