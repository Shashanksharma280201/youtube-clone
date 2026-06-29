// GPT-4o Vision describes what's happening on screen during silent / no-speech
// stretches, so wordless videos still get meaningful chapters.
import OpenAI from "openai";
import { readFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { extractFrameAt } from "./media";
import {
  VISION_BATCH_SIZE,
  VISION_CONCURRENCY,
  withConcurrency,
  type TaggedSegment,
} from "./types";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Extract `count` plain-sentence descriptions from a model response that may be
// markdown-fenced (```json …```), wrapped in an object, or slightly malformed.
// Critically, it NEVER returns the raw JSON text as a description — a parse
// failure falls back to a generic phrase instead of dumping the array into a chapter.
function parseDescriptions(text: string, count: number): string[] {
  const clean = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();

  let arr: { i?: number; desc?: string }[] | null = null;
  try {
    const parsed = JSON.parse(clean);
    if (Array.isArray(parsed)) arr = parsed;
    else if (Array.isArray((parsed as { frames?: unknown }).frames))
      arr = (parsed as { frames: { i?: number; desc?: string }[] }).frames;
  } catch {
    const m = clean.match(/\[[\s\S]*\]/); // last resort: grab the first [...] block
    if (m) {
      try { arr = JSON.parse(m[0]); } catch { arr = null; }
    }
  }

  return Array.from({ length: count }, (_, j) => {
    const entry = arr?.find((e) => e?.i === j + 1) ?? arr?.[j];
    const desc = typeof entry?.desc === "string" ? entry.desc.trim() : "";
    return desc || "performing task";
  });
}

export async function describeFramesBatch(framePaths: string[]): Promise<string[]> {
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

    try {
      if (batch.length === 1) {
        const res = await openai.chat.completions.create({
          model: "gpt-4o",
          max_tokens: 120,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "This is a frame from a how-to or tutorial video. Write ONE sentence describing exactly what the person is physically doing — mention the tool or object and the action. Be specific and observational. Return ONLY the sentence, with no quotes, brackets, or JSON.",
                },
                ...imageContents,
              ],
            },
          ],
        });
        const text = res.choices[0]?.message?.content?.trim() ?? "";
        // A bare sentence is best; if the model still returned JSON, parse it safely.
        descriptions.push(text && !text.startsWith("[") && !text.startsWith("{") ? text : parseDescriptions(text, 1)[0]);
      } else {
        // json_object mode guarantees parseable JSON — no markdown fences to trip on.
        const res = await openai.chat.completions.create({
          model: "gpt-4o",
          max_tokens: 500,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: `These are ${batch.length} frames from a how-to or tutorial video, numbered 1 to ${batch.length}. For each frame, write one sentence describing exactly what the person is doing — the tool/object used and the action performed. Return ONLY this JSON object: {"frames":[{"i":1,"desc":"..."},{"i":2,"desc":"..."}]}`,
                },
                ...imageContents,
              ],
            },
          ],
        });
        const text = res.choices[0]?.message?.content?.trim() ?? "";
        descriptions.push(...parseDescriptions(text, batch.length));
      }
    } catch (err) {
      console.error("[vision] batch failed:", err);
      for (let j = 0; j < batch.length; j++) descriptions.push("performing task");
    }
  }

  return descriptions;
}

// Extract a frame at the midpoint of each silent chunk and describe it.
// `source` is a local path or presigned URL (ffmpeg reads either).
export async function buildSilentSegments(
  chunks: { start: number; end: number }[],
  source: string,
  videoId: string,
): Promise<TaggedSegment[]> {
  if (chunks.length === 0) return [];

  const visionDir = join(tmpdir(), `vision-${videoId}`);
  await mkdir(visionDir, { recursive: true });

  const framePaths: (string | null)[] = await withConcurrency(
    chunks.map((chunk, i) => async () => {
      const midpoint = (chunk.start + chunk.end) / 2;
      const framePath = join(visionDir, `frame-${i}.jpg`);
      try {
        await extractFrameAt(source, midpoint, framePath);
        return existsSync(framePath) ? framePath : null;
      } catch {
        return null;
      }
    }),
    VISION_CONCURRENCY,
  );

  const validPaths = framePaths.filter((p): p is string => p !== null);

  const batchCount = Math.ceil(validPaths.length / VISION_BATCH_SIZE);
  const batches: string[][] = Array.from({ length: batchCount }, (_, i) =>
    validPaths.slice(i * VISION_BATCH_SIZE, (i + 1) * VISION_BATCH_SIZE),
  );

  const batchDescriptions = await withConcurrency(
    batches.map((batch) => () => describeFramesBatch(batch)),
    VISION_CONCURRENCY,
  );
  const allDescriptions = batchDescriptions.flat();

  let descIdx = 0;
  return chunks.map((chunk, i) => ({
    id: -(i + 1), // negative IDs distinguish silent segments
    start: chunk.start,
    end: chunk.end,
    text: "",
    mainTag: "action",
    subTag: framePaths[i] ? (allDescriptions[descIdx++] ?? "performing task") : "performing task",
  }));
}
