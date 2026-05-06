import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import OpenAI from "openai";
import { visualSegment } from "@/lib/roboflow";
import { s3Key, downloadFromS3, s3, BUCKET } from "@/lib/s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { spawn } from "child_process";
import { readFileSync, chmodSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffmpegPath: string = require("ffmpeg-static");
try { chmodSync(ffmpegPath, 0o755); } catch {}

export const maxDuration = 300;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const CONCURRENCY = 3;

type TopicSegment = {
  mainTag: string;
  subTag: string;
  start: number;
  end: number;
  thumbnailPath: string | null;
  transcript?: string;
  sam3Click?: { x: number; y: number };
  sam3Target?: string;
  annotationFrames?: Array<{ time: number; masks: number[][][] }>;
};

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

function extractFrame(videoPath: string, time: number, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, [
      "-y", "-ss", String(time), "-i", videoPath,
      "-vframes", "1", "-q:v", "4",
      outputPath,
    ]);
    proc.on("close", (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}`)));
    proc.on("error", reject);
  });
}

async function getFrameBase64(
  seg: TopicSegment,
  videoLocalPath: string | null,
  videoId: string
): Promise<string | null> {
  if (seg.thumbnailPath) {
    try {
      const key = s3Key(seg.thumbnailPath);
      const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: key });
      const url = await getSignedUrl(s3, cmd, { expiresIn: 3600 });
      const res = await fetch(url);
      if (res.ok) {
        const buf = await res.arrayBuffer();
        return Buffer.from(buf).toString("base64");
      }
    } catch {}
  }

  if (!videoLocalPath) return null;
  const framePath = join(tmpdir(), `annotate-${videoId}-t${seg.start}.jpg`);
  try {
    await extractFrame(videoLocalPath, seg.start + 0.5, framePath);
    return readFileSync(framePath).toString("base64");
  } catch (err) {
    console.error(`[annotate] frame extract at t=${seg.start}:`, err);
    return null;
  }
}

async function locateObject(
  frameBase64: string,
  seg: TopicSegment
): Promise<{ x: number; y: number; target: string } | null> {
  try {
    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      max_tokens: 100,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: `data:image/jpeg;base64,${frameBase64}`, detail: "low" },
            },
            {
              type: "text",
              text: `Video frame. Action: "${seg.mainTag}" — "${seg.subTag}".${seg.transcript ? ` Narration: "${seg.transcript}"` : ""}

Give ONE pixel coordinate (x,y) to click on the PRIMARY object in focus. Return coordinates in the original image pixel space.
Return JSON: {"x":<integer>,"y":<integer>,"target":"<short object name>"}`,
            },
          ],
        },
      ],
    });
    const parsed = JSON.parse(res.choices[0]?.message?.content ?? "{}");
    if (typeof parsed.x === "number" && typeof parsed.y === "number") {
      return { x: Math.round(parsed.x), y: Math.round(parsed.y), target: String(parsed.target ?? "object") };
    }
    return null;
  } catch (err) {
    console.error("[annotate] locateObject:", err);
    return null;
  }
}

async function failAnnotation(id: string) {
  await prisma.video.update({ where: { id }, data: { annotationStatus: "FAILED" } });
  return NextResponse.json({ status: "FAILED" });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const reqUrl = new URL(req.url);
  const limitParam = reqUrl.searchParams.get("limit");
  const limit = limitParam ? Math.max(1, parseInt(limitParam)) : null;

  const video = await prisma.video.findUnique({ where: { id: params.id } });
  if (!video) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (video.userId !== session.user.id)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  if (video.transcriptStatus !== "DONE")
    return NextResponse.json({ error: "Transcription not complete" }, { status: 400 });

  if (video.annotationStatus === "PROCESSING" || video.annotationStatus === "DONE")
    return NextResponse.json({ status: video.annotationStatus });

  const allSegments = Array.isArray(video.topicSegments)
    ? (video.topicSegments as TopicSegment[])
    : [];

  if (allSegments.length === 0)
    return NextResponse.json({ error: "No segments to annotate" }, { status: 400 });

  await prisma.video.update({ where: { id: params.id }, data: { annotationStatus: "PROCESSING" } });

  try {
    const segments = limit ? allSegments.slice(0, limit) : allSegments;

    // Download video once if any segment lacks a thumbnail
    let videoLocalPath: string | null = null;
    if (segments.some((s) => !s.thumbnailPath)) {
      const localPath = join(tmpdir(), `annotate-${params.id}.mp4`);
      console.log("[annotate] Downloading video for frame extraction...");
      await downloadFromS3(s3Key(video.blobUrl), localPath);
      videoLocalPath = localPath;
    }

    const tasks = segments.map((seg, i) => async (): Promise<TopicSegment> => {
      try {
        const frameBase64 = await getFrameBase64(seg, videoLocalPath, params.id);
        if (!frameBase64) {
          console.warn(`[annotate] seg ${i}: no frame available`);
          return { ...seg, annotationFrames: [] };
        }

        const location = await locateObject(frameBase64, seg);
        if (!location) {
          console.warn(`[annotate] seg ${i}: could not locate object`);
          return { ...seg, annotationFrames: [] };
        }

        console.log(`[annotate] seg ${i} "${seg.mainTag}": "${location.target}" at (${location.x},${location.y})`);

        const masks = await visualSegment(frameBase64, [{ x: location.x, y: location.y, positive: true }]);
        const significant = masks.filter((m) => m.length > 10).slice(0, 20);
        console.log(`[annotate] seg ${i}: ${masks.length} masks → ${significant.length} significant`);

        return {
          ...seg,
          sam3Click: { x: location.x, y: location.y },
          sam3Target: location.target,
          annotationFrames: [{ time: seg.start, masks: significant }],
        };
      } catch (err) {
        console.error(`[annotate] seg ${i} error:`, err);
        return { ...seg, annotationFrames: [] };
      }
    });

    const annotated = await withConcurrency(tasks, CONCURRENCY);

    // Merge back — replace annotated segment positions, leave rest untouched
    const annotatedByStart = new Map(annotated.map((s) => [s.start, s]));
    const merged = allSegments.map((seg) => annotatedByStart.get(seg.start) ?? seg);

    await prisma.video.update({
      where: { id: params.id },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: { annotationStatus: "DONE", topicSegments: merged as any },
    });

    const withMasks = annotated.filter((s) => (s.annotationFrames?.length ?? 0) > 0).length;
    console.log(`[annotate] Done: ${annotated.length} segments processed, ${withMasks} with masks`);

    return NextResponse.json({ status: "DONE", annotated: annotated.length, withMasks });
  } catch (err) {
    console.error("[annotate]", err);
    return failAnnotation(params.id);
  }
}
