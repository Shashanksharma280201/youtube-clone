import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import OpenAI from "openai";
import { readFile, unlink, mkdir, rm } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { spawn } from "child_process";
import { tmpdir } from "os";
import { s3Key, downloadFromS3, uploadToS3 } from "@/lib/s3";

// Runtime require so webpack doesn't bundle the binary path (ffmpeg-static uses __dirname)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffmpegPath: string = require("ffmpeg-static");

// Ensure the binary is executable (Vercel deployments can strip execute permissions)
import { chmodSync } from "fs";
try { chmodSync(ffmpegPath, 0o755) } catch {}

export const maxDuration = 300;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
// Groq runs Whisper on custom LPU hardware — 10–30x faster than OpenAI
const groq = new OpenAI({
  apiKey: process.env.GROQ_API_KEY ?? "",
  baseURL: "https://api.groq.com/openai/v1",
});

const WHISPER_LIMIT         = 25 * 1024 * 1024; // 25 MB
const TAG_BATCH_SIZE        = 20;
const THUMB_CONCURRENCY     = 10;  // parallel ffmpeg frame extractions
const SILENCE_NOISE_DB      = -35; // dB floor — below this counts as silence
const SILENCE_MIN_SECS      = 3;   // ignore gaps shorter than this
const SILENCE_CHUNK_SECS    = 25;  // split long silent gaps into chunks of this size
const VISION_BATCH_SIZE     = 5;   // frames per GPT-4o Vision call
const VISION_CONCURRENCY    = 3;   // parallel Vision calls
const MAX_SILENT_CHUNKS     = 40;  // safety cap for very long silent videos
const FULL_SILENT_CHUNK_SECS = 25; // chunk size when whole video has no speech
const NO_SPEECH_PROB_THRESH = 0.6; // Whisper segments above this threshold are hallucinations
const MIN_REAL_TEXT_CHARS   = 4;   // fewer real characters than this = hallucination

type RawSegment    = { id: number; start: number; end: number; text: string; no_speech_prob?: number };
type TaggedSegment = RawSegment & { mainTag: string; subTag: string };
type VideoSegment  = {
  mainTag: string;
  subTag: string;
  start: number;
  end: number;
  thumbnailPath: string | null;
};

// ─── ffmpeg helpers ───────────────────────────────────────────────────────────

function extractAudio(inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, [
      "-y", "-i", inputPath, "-vn", "-ar", "16000",
      "-ac", "1", "-c:a", "libmp3lame", "-b:a", "64k", outputPath,
    ]);
    proc.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)),
    );
    proc.on("error", reject);
  });
}

function extractFrame(videoPath: string, time: number, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, [
      "-y", "-ss", String(time), "-i", videoPath,
      "-vframes", "1", "-q:v", "2", outputPath,
    ]);
    proc.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg frame exit ${code}`)),
    );
    proc.on("error", reject);
  });
}

function getVideoDuration(videoPath: string): Promise<number> {
  return new Promise((resolve) => {
    const proc = spawn(ffmpegPath, ["-i", videoPath, "-f", "null", "-"]);
    let stderr = "";
    proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    proc.on("close", () => {
      const m = stderr.match(/Duration:\s+(\d+):(\d+):([\d.]+)/);
      if (!m) return resolve(0);
      resolve(parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3]));
    });
    proc.on("error", () => resolve(0));
  });
}

// ─── concurrency helper ───────────────────────────────────────────────────────

async function withConcurrency<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
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

// ─── silence detection ────────────────────────────────────────────────────────

function detectSilentWindows(audioPath: string): Promise<{ start: number; end: number | null }[]> {
  return new Promise((resolve) => {
    const proc = spawn(ffmpegPath, [
      "-i", audioPath,
      "-af", `silencedetect=noise=${SILENCE_NOISE_DB}dB:d=${SILENCE_MIN_SECS}`,
      "-f", "null", "-",
    ]);
    let stderr = "";
    proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    proc.on("close", () => {
      const windows: { start: number; end: number | null }[] = [];
      let pendingStart: number | null = null;
      for (const line of stderr.split("\n")) {
        const s = line.match(/silence_start:\s*([\d.]+)/);
        const e = line.match(/silence_end:\s*([\d.]+)/);
        if (s) pendingStart = parseFloat(s[1]);
        if (e && pendingStart !== null) {
          windows.push({ start: pendingStart, end: parseFloat(e[1]) });
          pendingStart = null;
        }
      }
      // open-ended silence reaching end of file
      if (pendingStart !== null) windows.push({ start: pendingStart, end: null });
      resolve(windows);
    });
    proc.on("error", () => resolve([]));
  });
}

// ─── hallucination filter ─────────────────────────────────────────────────────

function isHallucination(seg: RawSegment, totalDuration: number): boolean {
  if ((seg.no_speech_prob ?? 0) >= NO_SPEECH_PROB_THRESH) return true;
  if (seg.start >= totalDuration) return true;
  if (seg.text.replace(/[^a-zA-Z0-9]/g, "").length < MIN_REAL_TEXT_CHARS) return true;
  return false;
}

// ─── gap finder ───────────────────────────────────────────────────────────────
// Combines silencedetect windows + gaps between Whisper segments.
// silencedetect catches true-quiet videos; Whisper gaps catch tool-noise videos
// where silence threshold isn't crossed but no speech is present.

function findUnspokenGaps(
  silentWindows: { start: number; end: number | null }[],
  spokenSegments: RawSegment[],
  totalDuration: number,
): { start: number; end: number }[] {
  // Source 1: silencedetect windows not overlapping any spoken segment
  const fromSilence = silentWindows
    .map((w) => ({ start: w.start, end: w.end ?? totalDuration }))
    .filter((w) => {
      const overlaps = spokenSegments.some((s) => s.end > w.start && s.start < w.end);
      return !overlaps && w.end - w.start >= SILENCE_MIN_SECS;
    });

  // Source 2: gaps between Whisper segments
  const sorted = [...spokenSegments].sort((a, b) => a.start - b.start);
  const whisperGaps: { start: number; end: number }[] = [];
  if (sorted.length === 0) {
    whisperGaps.push({ start: 0, end: totalDuration });
  } else {
    if (sorted[0].start >= SILENCE_MIN_SECS)
      whisperGaps.push({ start: 0, end: sorted[0].start });
    for (let i = 0; i < sorted.length - 1; i++) {
      const gapLen = sorted[i + 1].start - sorted[i].end;
      if (gapLen >= SILENCE_MIN_SECS)
        whisperGaps.push({ start: sorted[i].end, end: sorted[i + 1].start });
    }
    const tail = totalDuration - sorted[sorted.length - 1].end;
    if (tail >= SILENCE_MIN_SECS)
      whisperGaps.push({ start: sorted[sorted.length - 1].end, end: totalDuration });
  }

  // Merge + deduplicate by start time
  const seen = new Set<string>();
  return [...fromSilence, ...whisperGaps]
    .filter((g) => {
      const key = g.start.toFixed(1);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.start - b.start);
}

// ─── long gap chunker ─────────────────────────────────────────────────────────

function chunkLongGaps(
  gaps: { start: number; end: number }[],
  chunkSize: number,
): { start: number; end: number }[] {
  const chunks: { start: number; end: number }[] = [];
  for (const gap of gaps) {
    if (gap.end - gap.start <= chunkSize) {
      chunks.push(gap);
    } else {
      let t = gap.start;
      while (t < gap.end) {
        chunks.push({ start: t, end: Math.min(t + chunkSize, gap.end) });
        t += chunkSize;
      }
    }
  }
  return chunks.slice(0, MAX_SILENT_CHUNKS);
}

// ─── Vision: describe frames ──────────────────────────────────────────────────

async function describeFramesBatch(framePaths: string[]): Promise<string[]> {
  const descriptions: string[] = [];

  for (let i = 0; i < framePaths.length; i += VISION_BATCH_SIZE) {
    const batch = framePaths.slice(i, i + VISION_BATCH_SIZE);

    const imageContents = await Promise.all(
      batch.map(async (p) => {
        const bytes = await readFile(p);
        return {
          type: "image_url" as const,
          image_url: {
            url: `data:image/jpeg;base64,${bytes.toString("base64")}`,
            detail: "low" as const,
          },
        };
      }),
    );

    const prompt =
      batch.length === 1
        ? "This is a frame from a how-to or tutorial video. Write one sentence describing exactly what the person is physically doing — mention the tool or object they are using and the action they are performing. Be specific and observational. Return ONLY the sentence."
        : `These are ${batch.length} frames from a how-to or tutorial video, numbered 1 to ${batch.length}. For each frame, write one sentence describing exactly what the person is doing — the tool/object used and the action performed. Return ONLY valid JSON: [{"i":1,"desc":"..."},{"i":2,"desc":"..."},...]`;

    try {
      const res = await openai.chat.completions.create({
        model: "gpt-4o",
        max_tokens: 400,
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: prompt }, ...imageContents],
          },
        ],
      });
      const text = res.choices[0]?.message?.content?.trim() ?? "";

      if (batch.length === 1) {
        descriptions.push(text || "performing task");
      } else {
        try {
          const parsed: { i: number; desc: string }[] = JSON.parse(text);
          for (let j = 0; j < batch.length; j++)
            descriptions.push(parsed[j]?.desc ?? "performing task");
        } catch {
          for (let j = 0; j < batch.length; j++) descriptions.push(text || "performing task");
        }
      }
    } catch (err) {
      console.error("[vision] batch failed:", err);
      for (let j = 0; j < batch.length; j++) descriptions.push("performing task");
    }
  }

  return descriptions;
}

// ─── silent segment builder ───────────────────────────────────────────────────

async function buildSilentSegments(
  chunks: { start: number; end: number }[],
  videoPath: string,
  videoId: string,
): Promise<TaggedSegment[]> {
  if (chunks.length === 0) return [];

  const visionDir = join(tmpdir(), `vision-${videoId}`);
  await mkdir(visionDir, { recursive: true });

  // Extract frames at midpoint of each chunk
  const framePaths: (string | null)[] = await Promise.all(
    chunks.map(async (chunk, i) => {
      const midpoint = (chunk.start + chunk.end) / 2;
      const framePath = join(visionDir, `frame-${i}.jpg`);
      try {
        await extractFrame(videoPath, midpoint, framePath);
        return existsSync(framePath) ? framePath : null;
      } catch {
        return null;
      }
    }),
  );

  const validPaths = framePaths.filter((p): p is string => p !== null);

  // Call Vision in batches with capped concurrency
  const batchCount = Math.ceil(validPaths.length / VISION_BATCH_SIZE);
  const batches: string[][] = Array.from({ length: batchCount }, (_, i) =>
    validPaths.slice(i * VISION_BATCH_SIZE, (i + 1) * VISION_BATCH_SIZE),
  );

  const batchDescriptions = await withConcurrency(
    batches.map((batch) => () => describeFramesBatch(batch)),
    VISION_CONCURRENCY,
  );
  const allDescriptions = batchDescriptions.flat();

  // Map descriptions back to chunks (skipping null frames)
  let descIdx = 0;
  return chunks.map((chunk, i) => ({
    id: -(i + 1),          // negative IDs distinguish silent segments
    start: chunk.start,
    end: chunk.end,
    text: "",
    mainTag: "action",
    subTag: framePaths[i] ? (allDescriptions[descIdx++] ?? "performing task") : "performing task",
  }));
}

// ─── GPT: analyze + tag spoken segments ──────────────────────────────────────

async function analyzeVideo(sampleText: string): Promise<{ category: string; phases: string[] }> {
  try {
    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `Analyze this video transcript and return:
1. "category": the video type (e.g. "Laptop Repair", "Cooking Tutorial", "Unboxing", "Teaching", "Workout", etc.)
2. "phases": 4-8 single-word phase labels describing the main stages of THIS specific video. Title Case.
Return JSON: { "category": "...", "phases": ["Phase1", "Phase2", ...] }`,
        },
        { role: "user", content: sampleText },
      ],
    });
    const parsed = JSON.parse(res.choices[0]?.message?.content ?? "{}");
    return {
      category: typeof parsed.category === "string" ? parsed.category : "General",
      phases: Array.isArray(parsed.phases) ? parsed.phases : [],
    };
  } catch {
    return { category: "General", phases: [] };
  }
}

async function tagSegments(segments: RawSegment[], phases: string[]): Promise<TaggedSegment[]> {
  if (segments.length === 0) return [];

  const phaseHint =
    phases.length > 0
      ? `You MUST use ONLY one of these exact labels for "m": ${phases.join(", ")}. Never invent a new label — pick the closest match from the list.`
      : 'Use a single-word label for "m" that best describes the phase.';

  const batches: RawSegment[][] = [];
  for (let i = 0; i < segments.length; i += TAG_BATCH_SIZE)
    batches.push(segments.slice(i, i + TAG_BATCH_SIZE));

  const batchResults = await Promise.all(
    batches.map(async (batch) => {
      const input = batch.map((s, i) => ({ i, t: s.text.slice(0, 200) }));
      try {
        const completion = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          temperature: 0,
          max_tokens: 1600,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content: `Tag each transcript segment with:
- "m": ONE single-word phase label (main tag)
- "s": 2-5 word specific description (sub tag)
${phaseHint}
Return ONLY JSON — no input text: {"segments":[{"i":0,"m":"Introduction","s":"Overview of the parts"},{"i":1,"m":"Diagnosis","s":"Testing battery voltage"},...]}`,
            },
            { role: "user", content: JSON.stringify(input) },
          ],
        });
        const raw = completion.choices[0]?.message?.content ?? "{}";
        const parsed: { segments?: { i: number; m: string; s: string }[] } = JSON.parse(raw);
        const map = new Map(parsed.segments?.map((x) => [x.i, x]) ?? []);
        return batch.map((_, j) => ({
          mainTag: (map.get(j)?.m ?? "Other").toLowerCase().trim(),
          subTag: (map.get(j)?.s ?? "").trim(),
        }));
      } catch {
        return batch.map(() => ({ mainTag: "other", subTag: "" }));
      }
    }),
  );

  const allTags = batchResults.flat();
  return segments.map((seg, i) => ({
    ...seg,
    mainTag: allTags[i]?.mainTag ?? "other",
    subTag: allTags[i]?.subTag ?? "",
  }));
}

// ─── thumbnail extraction ─────────────────────────────────────────────────────

async function generateVideoSegments(
  segments: TaggedSegment[],
  videoPath: string,
  videoId: string,
): Promise<VideoSegment[]> {
  if (segments.length === 0) return [];

  const thumbnailDir = join(tmpdir(), `thumbs-${videoId}`);
  await mkdir(thumbnailDir, { recursive: true });

  const tasks = segments.map((seg, i) => async (): Promise<VideoSegment> => {
    const thumbName = `segment-${i}.jpg`;
    const thumbAbsPath = join(thumbnailDir, thumbName);
    const s3ThumbKey = `thumbnails/${videoId}/${thumbName}`;

    let thumbnailPath: string | null = null;
    try {
      await extractFrame(videoPath, seg.start, thumbAbsPath);
      if (existsSync(thumbAbsPath))
        thumbnailPath = await uploadToS3(thumbAbsPath, s3ThumbKey, "image/jpeg");
    } catch { /* non-fatal */ }

    return { mainTag: seg.mainTag, subTag: seg.subTag, start: seg.start, end: seg.end, thumbnailPath };
  });

  return withConcurrency(tasks, THUMB_CONCURRENCY);
}

// ─── error helper ─────────────────────────────────────────────────────────────

async function fail(id: string, message: string) {
  await prisma.video.update({
    where: { id },
    data: { transcriptStatus: "FAILED", transcript: message },
  });
  return NextResponse.json({ status: "FAILED", message });
}

// ─── POST handler ─────────────────────────────────────────────────────────────

export async function POST(_: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const video = await prisma.video.findUnique({ where: { id: params.id } });
  if (!video) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (video.userId !== session.user.id)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  if (video.transcriptStatus === "PROCESSING" || video.transcriptStatus === "DONE")
    return NextResponse.json({ status: video.transcriptStatus });

  await prisma.video.update({
    where: { id: params.id },
    data: { transcriptStatus: "PROCESSING" },
  });

  const videoPath = join(tmpdir(), `${params.id}-video`);
  const audioPath = join(tmpdir(), `${params.id}.mp3`);

  try {
    await downloadFromS3(s3Key(video.blobUrl), videoPath);
    await extractAudio(videoPath, audioPath);

    // Get video duration for gap analysis
    const totalDuration = await getVideoDuration(videoPath);

    const audioBytes = await readFile(audioPath);
    if (audioBytes.length > WHISPER_LIMIT) {
      return fail(
        params.id,
        `Audio track is ${(audioBytes.length / 1024 / 1024).toFixed(0)} MB after extraction — still over Whisper's 25 MB limit. Try a shorter video.`,
      );
    }

    const file = new File([audioBytes], `audio-${params.id}.mp3`, { type: "audio/mpeg" });

    // Step 1: Groq Whisper transcription
    const result = await groq.audio.transcriptions.create({
      file,
      model: "whisper-large-v3-turbo",
      response_format: "verbose_json",
      timestamp_granularities: ["segment"],
    });

    // Filter out Whisper hallucinations (ambient noise, music, tool sounds)
    const allWhisperSegs: RawSegment[] = (result.segments ?? []).map((s) => ({
      id: s.id,
      start: Math.min(s.start, totalDuration),
      end: Math.min(s.end, totalDuration),
      text: s.text.trim(),
      no_speech_prob: s.no_speech_prob ?? 0,
    }));
    const rawSegments = allWhisperSegs.filter((s) => !isHallucination(s, totalDuration));

    // Step 2: Analyze video + tag spoken segments
    const sampleText = rawSegments.map((s) => s.text).join(" ").slice(0, 60000);
    const { phases } = await analyzeVideo(sampleText);

    let spokenSegments: TaggedSegment[];
    try {
      spokenSegments = await tagSegments(rawSegments, phases);
    } catch (err) {
      console.error("[transcribe] tagging failed:", err);
      spokenSegments = rawSegments.map((s) => ({ ...s, mainTag: "other", subTag: "" }));
    }

    // Step 3: Detect silent / no-speech gaps and describe them with Vision
    let silentSegments: TaggedSegment[] = [];
    try {
      const isFullySilent = spokenSegments.length === 0;

      let chunks: { start: number; end: number }[];
      if (isFullySilent && totalDuration > 0) {
        // Whole video has no speech — sample a frame every FULL_SILENT_CHUNK_SECS
        chunks = [];
        let t = 0;
        while (t < totalDuration) {
          chunks.push({ start: t, end: Math.min(t + FULL_SILENT_CHUNK_SECS, totalDuration) });
          t += FULL_SILENT_CHUNK_SECS;
        }
        chunks = chunks.slice(0, MAX_SILENT_CHUNKS);
      } else {
        const silentWindows = await detectSilentWindows(audioPath);
        const gaps = findUnspokenGaps(silentWindows, spokenSegments, totalDuration);
        chunks = chunkLongGaps(gaps, SILENCE_CHUNK_SECS);
      }

      silentSegments = await buildSilentSegments(chunks, videoPath, params.id);
    } catch (err) {
      console.error("[transcribe] silent segment detection failed:", err);
    }

    // Step 4: Merge spoken + silent segments sorted by start time
    const allSegments: TaggedSegment[] = [...spokenSegments, ...silentSegments]
      .sort((a, b) => a.start - b.start);

    // Step 5: Extract thumbnails for every segment and upload to S3
    let topicSegments: VideoSegment[] = [];
    try {
      topicSegments = await generateVideoSegments(allSegments, videoPath, params.id);
    } catch (err) {
      console.error("[transcribe] segment generation failed:", err);
    }

    const fullText = spokenSegments.map((s) => s.text).join(" ");

    // Include silent segments in transcript panel — set text = vision description
    const allTranscriptSegs = [
      ...spokenSegments,
      ...silentSegments.map((s) => ({ ...s, text: s.subTag })),
    ].sort((a, b) => a.start - b.start);

    await prisma.video.update({
      where: { id: params.id },
      data: {
        transcriptStatus: "DONE",
        transcript: fullText,
        transcriptSegments: allTranscriptSegs,
        topicSegments: topicSegments.length > 0 ? topicSegments : undefined,
      },
    });

    return NextResponse.json({ status: "DONE" });
  } catch (err) {
    console.error("[transcribe]", err);
    return fail(params.id, "An error occurred during transcription. Please try again.");
  } finally {
    unlink(audioPath).catch(() => {});
    unlink(videoPath).catch(() => {});
    rm(join(tmpdir(), `thumbs-${params.id}`), { recursive: true, force: true }).catch(() => {});
    rm(join(tmpdir(), `vision-${params.id}`), { recursive: true, force: true }).catch(() => {});
  }
}
