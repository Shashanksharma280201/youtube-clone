// Shared OpenAI chat client + model selection. Every chat call in the pipeline
// (tagging, chunk summaries, other-reassignment, vision, the machine guide, chapter
// search) goes through chatComplete() here, so this file is the ONE place a model
// is chosen.
//
//   MODEL       — flagship: vision + the machine guide
//   MODEL_MINI  — cheaper:  tagging, chunk summaries, reassignment, chapter search
//
// The model is PINNED in code, not read from the environment. That is deliberate:
// the Azure ConfigMap sets OPENAI_MODEL=gpt-4o, and an env var beats a code
// default — so a default alone would silently keep the deployment on gpt-4o. Pinning
// here guarantees the same model everywhere without an App Config change.
//
// Transcription is NOT affected. It stays on whisper-1 (see transcribe.ts): no GPT-5
// speech-to-text model exists, and the gpt-4o-transcribe models refuse verbose_json,
// so they return no per-segment timestamps — which chapters, thumbnails and chunk
// boundaries all depend on.
//
// NOTE on token limits: every call sends `max_completion_tokens`, never `max_tokens`.
// GPT-5 models REJECT max_tokens outright; gpt-4o accepts both, so one parameter works
// for every model with no branching.
//
// The fallback is a safety net, but also a trap when comparing models: a key without
// access to the pinned model would silently produce gpt-4o output that looks like
// success. So a fallback logs a warning, and activeModels() is exposed on /api/health
// — together they prove which model actually ran.
import OpenAI from "openai";
import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";
import { recordChat } from "./usage";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const MODEL: string = "gpt-5.4";
const MODEL_MINI: string = "gpt-5.4-mini";
const FALLBACK: string = "gpt-4o";
const FALLBACK_MINI: string = "gpt-4o-mini";

// Image calls need a vision-capable model. The FLAGSHIP gpt-5.4 REJECTS image_url
// content ("400 image_url is only supported by certain models") — but gpt-5.4-MINI
// accepts it (verified: it reaches image parsing, not a content-type rejection). So
// vision stays in the 5.4 family on gpt-5.4-mini, with gpt-4o as a vision-capable
// fallback. The bug was only that vision calls defaulted to the flagship.
const VISION_MODEL: string = "gpt-5.4-mini";
const VISION_FALLBACK: string = "gpt-4o";

// Set the first time a call has to fall back, i.e. the key cannot use the pinned
// model. Reported on /api/health, because "configured model" alone is not proof:
// without this, health would keep claiming gpt-5.4 while every call silently ran on
// gpt-4o — and a model comparison would be measuring nothing.
let fellBackTo: string | null = null;

// What this deployment runs. Surfaced on /api/health so a model switch can be
// verified rather than assumed.
export function activeModels() {
  return {
    model: MODEL,
    modelMini: MODEL_MINI,
    visionModel: VISION_MODEL,
    transcription: "whisper-1",
    // null = the pinned models are genuinely being used.
    fellBackTo,
  };
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
export async function chatComplete(params: ChatParams, opts?: { mini?: boolean; vision?: boolean; label?: string }) {
  const primary = opts?.vision ? VISION_MODEL : opts?.mini ? MODEL_MINI : MODEL;
  const fallback = opts?.vision ? VISION_FALLBACK : opts?.mini ? FALLBACK_MINI : FALLBACK;
  const label = opts?.label ?? (opts?.vision ? "vision" : "chat");
  try {
    const res = await openai.chat.completions.create({ ...params, model: primary });
    // res.model is the model that actually ran, so accounting stays correct even if
    // the account silently served a dated snapshot id.
    recordChat(res.model ?? primary, res.usage, label);
    return res;
  } catch (err) {
    if (primary !== fallback && isModelUnavailable(err)) {
      console.warn(`[openai] model "${primary}" unavailable — falling back to "${fallback}"`);
      fellBackTo = fallback; // surfaced on /api/health so this is never silent
      const res = await openai.chat.completions.create({ ...params, model: fallback });
      recordChat(res.model ?? fallback, res.usage, label);
      return res;
    }
    throw err;
  }
}
