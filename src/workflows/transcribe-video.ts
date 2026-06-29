// Durable transcription pipeline, optimised for Vercel's isolated steps.
//
// The big idea: each Vercel step runs on its own machine with its own disk, so we
// must NOT re-download the full video in every step. Instead we touch the video
// exactly twice:
//   • PREPARE  — download once, rip the audio into small ~2MB chunks, store them in
//                S3, then throw the video away.
//   • FRAMES   — download once, grab only the silent-gap frames + chapter thumbnails.
// Everything in between (transcription, tagging) works on the tiny audio chunks.
// Video downloads per video: ~17 → 2.
//
// All domain logic lives in the orchestration-agnostic src/lib/pipeline/* modules,
// so moving off Vercel later means swapping this one file, not the pipeline.
import { FatalError, RetryableError } from "workflow";
import { prisma } from "@/lib/prisma";
import { s3Key, ensureLocalVideo, uploadToS3, downloadFromS3 } from "@/lib/s3";
import { probeDuration, extractAudioSlice, detectSilentWindows } from "@/lib/pipeline/media";
import { transcribeAudioFile, isHallucination, RateLimitedError } from "@/lib/pipeline/transcribe";
import { findUnspokenGaps, chunkLongGaps } from "@/lib/pipeline/gaps";
import { buildSilentSegments } from "@/lib/pipeline/vision";
import { analyzeVideo, tagSegments } from "@/lib/pipeline/tag";
import { generateVideoSegments } from "@/lib/pipeline/thumbnails";
import { consolidateChapters } from "@/lib/pipeline/consolidate";
import {
  SEGMENT_SECS,
  SILENCE_CHUNK_SECS,
  FULL_SILENT_CHUNK_SECS,
  MAX_SILENT_CHUNKS,
} from "@/lib/pipeline/types";
import { unlink, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import type { RawSegment, TaggedSegment, VideoSegment, SilentWindow } from "@/lib/pipeline/types";

type AudioChunk = { key: string; offset: number; dur: number };
type ChunkResult = { spoken: RawSegment[]; silentWindows: { start: number; end: number }[] };

const TRANSCRIBE_CONCURRENCY = 3; // parallel transcription steps — modest, kind to dev + Groq
const MAX_CHAPTERS = 40;

// Run async work with a bounded concurrency limit (plain orchestration — safe in
// the workflow sandbox). Keeps us from firing dozens of steps at once.
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// ─── steps (full Node.js access) ──────────────────────────────────────────────

// Download the video ONCE, slice its audio into small chunks, push them to S3, and
// drop the video. Returns the S3 video key (for the frames step) + per-chunk audio keys.
async function prepareStep(
  videoId: string,
): Promise<{ key: string; duration: number; chunks: AudioChunk[] }> {
  "use step";
  const video = await prisma.video.findUnique({ where: { id: videoId } });
  if (!video) throw new FatalError("Video not found");

  const key = s3Key(video.blobUrl);
  const local = await ensureLocalVideo(videoId, key);
  const duration = await probeDuration(local);
  const total = Math.max(duration, 1);

  const dir = join(tmpdir(), `aprep-${videoId}`);
  await mkdir(dir, { recursive: true });

  const chunks: AudioChunk[] = [];
  for (let t = 0, i = 0; t < total; t += SEGMENT_SECS, i++) {
    const dur = Math.min(SEGMENT_SECS, total - t) || SEGMENT_SECS;
    const localChunk = join(dir, `chunk-${i}.mp3`);
    await extractAudioSlice(local, t, dur, localChunk);
    const chunkKey = `audio/${videoId}/chunk-${i}.mp3`;
    await uploadToS3(localChunk, chunkKey, "audio/mpeg");
    await unlink(localChunk).catch(() => {});
    chunks.push({ key: chunkKey, offset: t, dur });
  }

  // Drop the big video — transcription only needs the small audio chunks now.
  await unlink(local).catch(() => {});
  return { key, duration, chunks };
}

// Transcribe ONE small audio chunk (downloaded from S3, ~2MB). Also runs
// silencedetect on it. Timestamps are offset back onto the real timeline.
// A Groq 429 becomes a RetryableError so the workflow paces durably around the quota.
async function transcribeChunkStep(
  videoId: string,
  chunkKey: string,
  offset: number,
  dur: number,
): Promise<ChunkResult> {
  "use step";
  const local = join(tmpdir(), `tchunk-${videoId}-${Math.round(offset)}.mp3`);
  try {
    await downloadFromS3(chunkKey, local);

    let spoken: RawSegment[];
    try {
      const segs = await transcribeAudioFile(local);
      spoken = segs.map((s) => ({
        id: s.id,
        start: s.start + offset,
        end: s.end + offset,
        text: s.text,
        no_speech_prob: s.no_speech_prob,
      }));
    } catch (err) {
      if (err instanceof RateLimitedError || (err as { name?: string })?.name === "RateLimitedError") {
        throw new RetryableError((err as Error).message, {
          retryAfter: `${(err as RateLimitedError).retryAfterSecs ?? 600}s`,
        });
      }
      throw err;
    }

    const windowsRaw: SilentWindow[] = await detectSilentWindows(local);
    const silentWindows = windowsRaw.map((w) => ({
      start: w.start + offset,
      end: (w.end ?? dur) + offset,
    }));

    return { spoken, silentWindows };
  } finally {
    unlink(local).catch(() => {});
  }
}
transcribeChunkStep.maxRetries = 25; // tolerate many Groq quota windows for 3–4hr videos

// Clean + de-hallucinate the merged spoken segments, then tag them into phases.
async function tagStep(videoId: string, spokenRaw: RawSegment[], duration: number): Promise<TaggedSegment[]> {
  "use step";
  const real = spokenRaw
    .map((s) => ({ ...s, start: Math.min(s.start, duration), end: Math.min(s.end, duration) }))
    .filter((s) => !isHallucination(s, duration))
    .sort((a, b) => a.start - b.start)
    .map((s, i) => ({ ...s, id: i }));

  const sample = real.map((s) => s.text).join(" ").slice(0, 60000);
  const { phases } = await analyzeVideo(sample);
  try {
    return await tagSegments(real, phases);
  } catch {
    return real.map((s) => ({ ...s, mainTag: "other", subTag: "" }));
  }
}

// Download the video ONCE more, describe silent gaps with Vision, consolidate into
// chapters, and extract one thumbnail per chapter. Returns everything saveStep persists.
async function framesStep(
  videoId: string,
  key: string,
  windows: { start: number; end: number }[],
  spokenSegments: TaggedSegment[],
  duration: number,
): Promise<{ transcript: string; transcriptSegments: TaggedSegment[]; topicSegments: VideoSegment[] }> {
  "use step";
  const local = await ensureLocalVideo(videoId, key);
  try {
    // Decide which stretches to describe with Vision.
    let chunks: { start: number; end: number }[];
    if (spokenSegments.length === 0 && duration > 0) {
      chunks = [];
      for (let t = 0; t < duration; t += FULL_SILENT_CHUNK_SECS)
        chunks.push({ start: t, end: Math.min(t + FULL_SILENT_CHUNK_SECS, duration) });
      chunks = chunks.slice(0, MAX_SILENT_CHUNKS);
    } else {
      const gaps = findUnspokenGaps(windows as SilentWindow[], spokenSegments, duration);
      chunks = chunkLongGaps(gaps, SILENCE_CHUNK_SECS);
    }

    let silentSegments: TaggedSegment[] = [];
    try {
      silentSegments = await buildSilentSegments(chunks, local, videoId);
    } catch (err) {
      console.error("[transcribe-workflow] silent vision failed:", err);
    }

    // Full-resolution transcript (spoken + silent descriptions) for the transcript panel.
    const transcriptSegments = [
      ...spokenSegments,
      ...silentSegments.map((s) => ({ ...s, text: s.subTag })),
    ].sort((a, b) => a.start - b.start);

    // Consolidated chapters (far fewer) → one thumbnail each.
    const chapters = consolidateChapters(
      [...spokenSegments, ...silentSegments].sort((a, b) => a.start - b.start),
      MAX_CHAPTERS,
    );
    let topicSegments: VideoSegment[] = [];
    try {
      topicSegments = await generateVideoSegments(chapters, local, videoId);
    } catch (err) {
      console.error("[transcribe-workflow] thumbnails failed:", err);
      topicSegments = chapters.map((c) => ({
        mainTag: c.mainTag, subTag: c.subTag, start: c.start, end: c.end, thumbnailPath: null,
      }));
    }

    const transcript = spokenSegments.map((s) => s.text).join(" ");
    return { transcript, transcriptSegments, topicSegments };
  } finally {
    unlink(local).catch(() => {});
  }
}

async function saveStep(
  videoId: string,
  transcript: string,
  transcriptSegments: TaggedSegment[],
  topicSegments: VideoSegment[],
): Promise<void> {
  "use step";
  const thumbnailUrl = topicSegments.find((s) => s.thumbnailPath)?.thumbnailPath ?? null;
  await prisma.video.update({
    where: { id: videoId },
    data: {
      transcriptStatus: "DONE",
      transcript,
      transcriptSegments,
      topicSegments: topicSegments.length > 0 ? topicSegments : undefined,
      thumbnailUrl,
    },
  });
}

async function failStep(videoId: string, message: string): Promise<void> {
  "use step";
  await prisma.video.update({
    where: { id: videoId },
    data: { transcriptStatus: "FAILED", transcript: message },
  });
}

// ─── workflow (orchestration only — sandboxed) ────────────────────────────────

export async function transcribeVideoWorkflow(videoId: string): Promise<{ status: string }> {
  "use workflow";
  try {
    const { key, duration, chunks } = await prepareStep(videoId);

    // Transcribe the small audio chunks with bounded concurrency.
    const perChunk = await mapLimit(chunks, TRANSCRIBE_CONCURRENCY, (c) =>
      transcribeChunkStep(videoId, c.key, c.offset, c.dur),
    );
    const allSpokenRaw = perChunk.flatMap((p) => p.spoken);
    const allWindows = perChunk.flatMap((p) => p.silentWindows);

    const spokenSegments = await tagStep(videoId, allSpokenRaw, duration);
    const { transcript, transcriptSegments, topicSegments } = await framesStep(
      videoId, key, allWindows, spokenSegments, duration,
    );

    await saveStep(videoId, transcript, transcriptSegments, topicSegments);
    return { status: "DONE" };
  } catch (err) {
    const message = (err as Error)?.message ?? "An error occurred during transcription. Please try again.";
    await failStep(videoId, message);
    throw err;
  }
}
