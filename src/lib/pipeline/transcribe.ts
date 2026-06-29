// Speech-to-text via Groq Whisper. On a 429 we throw a typed RateLimitedError
// carrying the retry-after seconds, so the orchestrator can pace durably instead
// of failing (Groq's free tier caps audio-seconds per rolling hour).
import OpenAI from "openai";
import { readFile } from "fs/promises";
import {
  NO_SPEECH_PROB_THRESH,
  MIN_REAL_TEXT_CHARS,
  type RawSegment,
} from "./types";

const groq = new OpenAI({
  apiKey: process.env.GROQ_API_KEY ?? "",
  baseURL: "https://api.groq.com/openai/v1",
});

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
    const result = await groq.audio.transcriptions.create({
      file,
      model: "whisper-large-v3-turbo",
      response_format: "verbose_json",
      timestamp_granularities: ["segment"],
    });
    return (result.segments ?? []).map((s) => ({
      id: s.id,
      start: s.start,
      end: s.end,
      text: s.text.trim(),
      no_speech_prob: s.no_speech_prob ?? 0,
    }));
  } catch (err) {
    const e = err as ApiError;
    if (e?.status === 429) {
      throw new RateLimitedError(
        `Groq rate limit: ${e.error?.message ?? "audio-seconds per hour exceeded"}`,
        parseRetryAfter(e),
      );
    }
    throw err;
  }
}

// Drop Whisper hallucinations (ambient noise, music, tool sounds reported as speech).
export function isHallucination(seg: RawSegment, totalDuration: number): boolean {
  if ((seg.no_speech_prob ?? 0) >= NO_SPEECH_PROB_THRESH) return true;
  if (seg.start >= totalDuration) return true;
  if (seg.text.replace(/[^a-zA-Z0-9]/g, "").length < MIN_REAL_TEXT_CHARS) return true;
  return false;
}
