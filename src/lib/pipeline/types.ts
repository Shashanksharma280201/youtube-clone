// Shared types + tunable constants for the transcription pipeline.
// This module is orchestration-agnostic — it has no Workflow/Vercel imports,
// so the whole `pipeline/` folder ports to any server unchanged.

export type RawSegment = {
  id: number;
  start: number;
  end: number;
  text: string;
  no_speech_prob?: number;
};

export type TaggedSegment = RawSegment & { mainTag: string; subTag: string };

export type VideoSegment = {
  mainTag: string;
  subTag: string;
  start: number;
  end: number;
  thumbnailPath: string | null;
};

export type SilentWindow = { start: number; end: number | null };

// ─── tunables ───────────────────────────────────────────────────────────────

// How long each video segment is. Configurable so 1–4hr videos can be tuned.
// CHUNK_MINUTES is read from the environment (defaults to 10 minutes).
export const SEGMENT_SECS =
  (Number.parseInt(process.env.CHUNK_MINUTES ?? "10", 10) || 10) * 60;

export const WHISPER_LIMIT = 25 * 1024 * 1024; // 25 MB — Whisper's per-file cap
export const TAG_BATCH_SIZE = 20;
export const THUMB_CONCURRENCY = 6; // parallel ffmpeg frame extractions per step
export const SILENCE_NOISE_DB = -35; // dB floor — below this counts as silence
export const SILENCE_MIN_SECS = 3; // ignore gaps shorter than this
export const SILENCE_CHUNK_SECS = 25; // split long silent gaps into chunks of this size
export const VISION_BATCH_SIZE = 5; // frames per GPT-4o Vision call
export const VISION_CONCURRENCY = 3; // parallel Vision calls
export const MAX_SILENT_CHUNKS = 60; // safety cap for very long silent videos
export const FULL_SILENT_CHUNK_SECS = 25; // chunk size when whole video has no speech
export const NO_SPEECH_PROB_THRESH = 0.6; // Whisper segments above this are hallucinations
export const MIN_REAL_TEXT_CHARS = 4; // fewer real characters than this = hallucination

// ─── small helpers ────────────────────────────────────────────────────────────

// Run async tasks with a bounded concurrency limit, preserving order.
export async function withConcurrency<T>(
  tasks: (() => Promise<T>)[],
  limit: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}
