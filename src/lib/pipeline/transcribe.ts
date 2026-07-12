// Speech-to-text via OpenAI Whisper (whisper-1). On a 429 we throw a typed
// RateLimitedError carrying the retry-after seconds, so the orchestrator can pace
// durably instead of failing.
import OpenAI from "openai";
import { readFile } from "fs/promises";
import {
  NO_SPEECH_PROB_THRESH,
  LOGPROB_THRESH,
  MIN_REAL_TEXT_CHARS,
  type RawSegment,
} from "./types";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export type WhisperSeg = {
  id: number;
  start: number;
  end: number;
  text: string;
  no_speech_prob: number;
};

export class RateLimitedError extends Error {
  retryAfterSecs: number;
  constructor(message: string, retryAfterSecs: number) {
    super(message);
    this.name = "RateLimitedError";
    this.retryAfterSecs = retryAfterSecs;
  }
}

type ApiError = {
  status?: number;
  headers?: Headers | Record<string, string>;
  error?: { message?: string };
};

function parseRetryAfter(e: ApiError): number {
  // Prefer the retry-after header (seconds).
  const h = e.headers;
  let raw: string | null | undefined;
  if (h && typeof (h as Headers).get === "function") raw = (h as Headers).get("retry-after");
  else if (h) raw = (h as Record<string, string>)["retry-after"];
  const headerSecs = raw ? Number.parseInt(raw, 10) : NaN;
  if (Number.isFinite(headerSecs) && headerSecs > 0) return headerSecs;

  // Otherwise parse "try again in 7m29s" from the message.
  const m = e.error?.message?.match(/try again in (?:(\d+)m)?([\d.]+)s/i);
  if (m) return (Number.parseInt(m[1] ?? "0", 10) || 0) * 60 + Math.ceil(parseFloat(m[2] ?? "0"));

  return 600; // fallback: 10 minutes
}

// Transcribe a single audio file. Timestamps are relative to that file.
export async function transcribeAudioFile(filePath: string): Promise<WhisperSeg[]> {
  const bytes = await readFile(filePath);
  const file = new File([bytes], "audio.mp3", { type: "audio/mpeg" });
  try {
    const result = await openai.audio.transcriptions.create({
      file,
      model: "whisper-1",
      response_format: "verbose_json",
      timestamp_granularities: ["segment"],
    });
    return (result.segments ?? []).map((s) => ({
      id: s.id,
      start: s.start,
      end: s.end,
      text: s.text.trim(),
      no_speech_prob: s.no_speech_prob ?? 0,
      avg_logprob: s.avg_logprob ?? 0,
    }));
  } catch (err) {
    const e = err as ApiError;
    if (e?.status === 429) {
      throw new RateLimitedError(
        `OpenAI rate limit: ${e.error?.message ?? "rate limit exceeded"}`,
        parseRetryAfter(e),
      );
    }
    throw err;
  }
}

// Drop Whisper hallucinations (ambient noise, music, tool sounds reported as speech).
//
// Two lessons are baked in here:
//
// 1. The "real characters" test counts letters/digits in ANY script (\p{L}\p{N}),
//    not just a-zA-Z0-9. An ASCII-only test silently discarded every non-Latin
//    segment — Hindi, Arabic, Chinese — leaving those videos with an empty transcript.
//
// 2. A high no_speech_prob ALONE does not mean silence. Whisper is routinely
//    unsure whether non-English audio is speech (no_speech_prob ~0.9) while being
//    perfectly confident in the text it produced (avg_logprob ~-0.4). Dropping on
//    that signal alone discarded 31 of 35 real Hindi segments. So we require BOTH
//    signals to be bad — Whisper's own reference implementation uses exactly this
//    pair (no_speech_threshold + logprob_threshold). A true hallucination has a
//    high no_speech_prob AND low text confidence.
export function isHallucination(seg: RawSegment, totalDuration: number): boolean {
  const noSpeech = (seg.no_speech_prob ?? 0) >= NO_SPEECH_PROB_THRESH;
  const lowConfidence = (seg.avg_logprob ?? 0) < LOGPROB_THRESH;
  if (noSpeech && lowConfidence) return true;
  if (seg.start >= totalDuration) return true;
  if (seg.text.replace(/[^\p{L}\p{N}]/gu, "").length < MIN_REAL_TEXT_CHARS) return true;
  return false;
}
