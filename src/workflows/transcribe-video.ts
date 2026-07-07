// Durable transcription pipeline, optimised for Vercel's isolated steps.
//
// The big idea: NEVER download the full video. ffmpeg seeks each slice it needs
// (audio chunks, frames) straight from a presigned S3 URL via HTTP range requests,
// so on-disk footprint per step is only the small output (a ~2MB audio slice or a
// JPEG), never the multi-GB source. This is what keeps 1–4hr videos under Vercel's
// ~512MB /tmp (the previous full-download approach overflowed it → ENOSPC).
//
// Each step presigns its OWN short-lived URL at execution time, so nothing expires
// mid-workflow even when Groq rate-limits pace a long video across hours.
//
// All domain logic lives in the orchestration-agnostic src/lib/pipeline/* modules,
// so moving off Vercel later means swapping this one file, not the pipeline.
import { FatalError, RetryableError } from "workflow";
import { prisma } from "@/lib/prisma";
import { s3Key, getPresignedDownloadUrl } from "@/lib/s3";
import { probeDuration, extractAudioSlice, detectSilentWindows } from "@/lib/pipeline/media";
import { transcribeAudioFile, isHallucination, RateLimitedError } from "@/lib/pipeline/transcribe";
import { findUnspokenGaps, chunkLongGaps } from "@/lib/pipeline/gaps";
import { buildSilentSegments, enrichStepsWithVision } from "@/lib/pipeline/vision";
import { analyzeVideo, tagSegments } from "@/lib/pipeline/tag";
import { generateVideoSegments } from "@/lib/pipeline/thumbnails";
import { consolidateChapters } from "@/lib/pipeline/consolidate";
import { extractDomainData, EMPTY_DOMAIN, type DomainData } from "@/lib/pipeline/domain";
import {
  SEGMENT_SECS,
  SILENCE_CHUNK_SECS,
  FULL_SILENT_CHUNK_SECS,
  MAX_SILENT_CHUNKS,
} from "@/lib/pipeline/types";
import { unlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import type { RawSegment, TaggedSegment, VideoSegment, SilentWindow } from "@/lib/pipeline/types";

type AudioSegment = { offset: number; dur: number };
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

// Probe the video's duration (ranged read of the container header — no download)
// and slice the timeline into fixed-length segments for the transcribe fan-out.
async function prepareStep(
  videoId: string,
): Promise<{ key: string; duration: number; segments: AudioSegment[] }> {
  "use step";
  const video = await prisma.video.findUnique({ where: { id: videoId } });
  if (!video) throw new FatalError("Video not found");

  const key = s3Key(video.blobUrl);
  const url = await getPresignedDownloadUrl(key);
  const duration = await probeDuration(url);
  const total = Math.max(duration, 1);

  const segments: AudioSegment[] = [];
  for (let t = 0; t < total; t += SEGMENT_SECS) {
    segments.push({ offset: t, dur: Math.min(SEGMENT_SECS, total - t) || SEGMENT_SECS });
  }
  return { key, duration, segments };
}

// Transcribe ONE segment: ffmpeg rips just this ~10-min audio slice straight from
// the presigned S3 URL (disk ≈ 2MB), then Groq transcribes it and silencedetect
// runs on it. Timestamps are offset back onto the real timeline.
// A Groq 429 becomes a RetryableError so the workflow paces durably around the quota.
async function transcribeChunkStep(
  videoId: string,
  key: string,
  offset: number,
  dur: number,
): Promise<ChunkResult> {
  "use step";
  const url = await getPresignedDownloadUrl(key);
  const local = join(tmpdir(), `tchunk-${videoId}-${Math.round(offset)}.mp3`);
  try {
    await extractAudioSlice(url, offset, dur, local);

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
  // ffmpeg seeks each frame straight from S3 — no full-video download.
  const url = await getPresignedDownloadUrl(key);

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
    silentSegments = await buildSilentSegments(chunks, url, videoId);
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
    topicSegments = await generateVideoSegments(chapters, url, videoId);
  } catch (err) {
    console.error("[transcribe-workflow] thumbnails failed:", err);
    topicSegments = chapters.map((c) => ({
      mainTag: c.mainTag, subTag: c.subTag, start: c.start, end: c.end, thumbnailPath: null,
    }));
  }

  const transcript = spokenSegments.map((s) => s.text).join(" ");
  return { transcript, transcriptSegments, topicSegments };
}

// Machine-maintenance domain extraction: turn the transcript + chapters into a
// structured guide (error codes, PM, troubleshooting FAQs, safety, tools, specs).
async function domainStep(
  transcriptSegments: TaggedSegment[],
  topicSegments: VideoSegment[],
  duration: number,
): Promise<DomainData> {
  "use step";
  try {
    return await extractDomainData(transcriptSegments, topicSegments, duration);
  } catch (err) {
    console.error("[transcribe-workflow] domain extraction failed:", err);
    return EMPTY_DOMAIN;
  }
}

// Add "where is it on screen" notes to each fix step: grab the video frame at
// the step's timestamp and describe the component's location with Vision.
async function enrichGuideStep(videoId: string, key: string, domain: DomainData): Promise<DomainData> {
  "use step";
  try {
    const url = await getPresignedDownloadUrl(key);
    const steps = [
      ...domain.troubleshooting.flatMap((d) => d.fix),
      ...domain.errorCodes.flatMap((d) => d.fix),
      ...domain.preventiveMaintenance.flatMap((p) => p.steps),
    ];
    await enrichStepsWithVision(url, steps, videoId); // mutates step.visual in place
  } catch (err) {
    console.error("[transcribe-workflow] guide vision enrich failed:", err);
  }
  return domain;
}

async function saveStep(
  videoId: string,
  transcript: string,
  transcriptSegments: TaggedSegment[],
  topicSegments: VideoSegment[],
  domainData: DomainData,
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      domainData: domainData as any,
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
    const { key, duration, segments } = await prepareStep(videoId);

    // Transcribe the segments with bounded concurrency — each step rips its own
    // audio slice from S3, so no full download and no per-chunk S3 round-trip.
    const perChunk = await mapLimit(segments, TRANSCRIBE_CONCURRENCY, (s) =>
      transcribeChunkStep(videoId, key, s.offset, s.dur),
    );
    const allSpokenRaw = perChunk.flatMap((p) => p.spoken);
    const allWindows = perChunk.flatMap((p) => p.silentWindows);

    const spokenSegments = await tagStep(videoId, allSpokenRaw, duration);
    const { transcript, transcriptSegments, topicSegments } = await framesStep(
      videoId, key, allWindows, spokenSegments, duration,
    );

    // Machine-maintenance guide extraction (runs off the transcript + chapters),
    // then enrich each fix step with an on-screen "where is it" note via Vision.
    const domainData = await domainStep(transcriptSegments, topicSegments, duration);
    const enriched = await enrichGuideStep(videoId, key, domainData);

    await saveStep(videoId, transcript, transcriptSegments, topicSegments, enriched);
    return { status: "DONE" };
  } catch (err) {
    const message = (err as Error)?.message ?? "An error occurred during transcription. Please try again.";
    await failStep(videoId, message);
    throw err;
  }
}
