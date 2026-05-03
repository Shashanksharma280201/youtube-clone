import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import OpenAI from "openai";
import { readFile, unlink, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { spawn } from "child_process";
import { tmpdir } from "os";

// Runtime require so webpack doesn't bundle the binary path (ffmpeg-static uses __dirname)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffmpegPath: string = require("ffmpeg-static");

export const maxDuration = 300;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
// Groq runs Whisper on custom LPU hardware — 10–30x faster than OpenAI
const groq = new OpenAI({
  apiKey: process.env.GROQ_API_KEY ?? "",
  baseURL: "https://api.groq.com/openai/v1",
});
const WHISPER_LIMIT = 25 * 1024 * 1024; // 25 MB
const TAG_BATCH_SIZE = 20;
const THUMB_CONCURRENCY = 10; // max parallel ffmpeg frame extractions

type RawSegment = { id: number; start: number; end: number; text: string };
type TaggedSegment = RawSegment & { mainTag: string; subTag: string };
type VideoSegment = {
  mainTag: string;
  subTag: string;
  start: number;
  end: number;
  thumbnailPath: string | null;
};

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

// Runs tasks with at most `limit` concurrent executions
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

// One GPT call: categorize the video + extract a phase vocabulary for it
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

// Tags every segment with mainTag (single-word phase) + subTag (2-5 word specific description)
async function tagSegments(segments: RawSegment[], phases: string[]): Promise<TaggedSegment[]> {
  if (segments.length === 0) return [];

  const phaseHint =
    phases.length > 0
      ? `Use ONLY these phase labels for "m": ${phases.join(", ")}.`
      : 'Use a single-word label for "m" that best describes the phase.';

  const batches: RawSegment[][] = [];
  for (let i = 0; i < segments.length; i += TAG_BATCH_SIZE) {
    batches.push(segments.slice(i, i + TAG_BATCH_SIZE));
  }

  const batchResults = await Promise.all(
    batches.map(async (batch) => {
      const input = batch.map((s, i) => ({ i, t: s.text.slice(0, 80) }));
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

// One VideoSegment per transcript segment — every segment gets its own thumbnail
async function generateVideoSegments(
  segments: TaggedSegment[],
  videoPath: string,
  videoId: string,
): Promise<VideoSegment[]> {
  if (segments.length === 0) return [];

  const thumbnailDir = join(process.cwd(), "public", "uploads", "thumbnails", videoId);
  await mkdir(thumbnailDir, { recursive: true });

  const tasks = segments.map((seg, i) => async (): Promise<VideoSegment> => {
    const thumbName = `segment-${i}.jpg`;
    const thumbAbsPath = join(thumbnailDir, thumbName);
    const thumbUrl = `/uploads/thumbnails/${videoId}/${thumbName}`;

    let hasThumbnail = false;
    try {
      await extractFrame(videoPath, seg.start, thumbAbsPath);
      hasThumbnail = existsSync(thumbAbsPath);
    } catch { /* non-fatal */ }

    return {
      mainTag: seg.mainTag,
      subTag: seg.subTag,
      start: seg.start,
      end: seg.end,
      thumbnailPath: hasThumbnail ? thumbUrl : null,
    };
  });

  return withConcurrency(tasks, THUMB_CONCURRENCY);
}

async function fail(id: string, message: string) {
  await prisma.video.update({
    where: { id },
    data: { transcriptStatus: "FAILED", transcript: message },
  });
  return NextResponse.json({ status: "FAILED", message });
}

export async function POST(_: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const video = await prisma.video.findUnique({ where: { id: params.id } });
  if (!video) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (video.userId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (
    video.transcriptStatus === "PROCESSING" ||
    video.transcriptStatus === "DONE"
  ) {
    return NextResponse.json({ status: video.transcriptStatus });
  }

  await prisma.video.update({
    where: { id: params.id },
    data: { transcriptStatus: "PROCESSING" },
  });

  const videoPath = join(process.cwd(), "public", video.blobUrl);
  const audioPath = join(tmpdir(), `${params.id}.mp3`);

  try {
    await extractAudio(videoPath, audioPath);

    const audioBytes = await readFile(audioPath);

    if (audioBytes.length > WHISPER_LIMIT) {
      return fail(
        params.id,
        `Audio track is ${(audioBytes.length / 1024 / 1024).toFixed(0)} MB after extraction — still over Whisper's 25 MB limit. Try a shorter video.`,
      );
    }

    const file = new File([audioBytes], `audio-${params.id}.mp3`, {
      type: "audio/mpeg",
    });

    // Groq Whisper: 10–30x faster than OpenAI Whisper
    const result = await groq.audio.transcriptions.create({
      file,
      model: "whisper-large-v3-turbo",
      response_format: "verbose_json",
      timestamp_granularities: ["segment"],
    });

    const rawSegments: RawSegment[] = (result.segments ?? []).map((s) => ({
      id: s.id,
      start: s.start,
      end: s.end,
      text: s.text.trim(),
    }));

    // Step 1: analyze video type + extract phase vocabulary
    const sampleText = rawSegments.map((s) => s.text).join(" ").slice(0, 4000);
    const { phases } = await analyzeVideo(sampleText);

    // Step 2: tag every segment with mainTag + subTag
    let segments: TaggedSegment[];
    try {
      segments = await tagSegments(rawSegments, phases);
    } catch (err) {
      console.error("[transcribe] tagging failed:", err);
      segments = rawSegments.map((s) => ({ ...s, mainTag: "other", subTag: "" }));
    }

    // Step 3: extract one thumbnail per segment (capped concurrency)
    let topicSegments: VideoSegment[] = [];
    try {
      topicSegments = await generateVideoSegments(segments, videoPath, params.id);
    } catch (err) {
      console.error("[transcribe] segment generation failed:", err);
    }

    const fullText = segments.map((s) => s.text).join(" ");

    await prisma.video.update({
      where: { id: params.id },
      data: {
        transcriptStatus: "DONE",
        transcript: fullText,
        transcriptSegments: segments,
        topicSegments: topicSegments.length > 0 ? topicSegments : undefined,
      },
    });

    return NextResponse.json({ status: "DONE" });
  } catch (err) {
    console.error("[transcribe]", err);
    return fail(
      params.id,
      "An error occurred during transcription. Please try again.",
    );
  } finally {
    unlink(audioPath).catch(() => {});
  }
}
