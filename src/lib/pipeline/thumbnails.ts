// Extract one thumbnail per segment (frame at its start) and upload it to S3.
// `source` is a local path or presigned URL — ffmpeg seeks remote sources, so a
// long video never has to be downloaded in full.
import { mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { uploadToS3 } from "@/lib/s3";
import { extractFrameAt } from "./media";
import { THUMB_CONCURRENCY, withConcurrency, type TaggedSegment, type VideoSegment } from "./types";

export async function generateVideoSegments(
  segments: TaggedSegment[],
  source: string,
  videoId: string,
): Promise<VideoSegment[]> {
  if (segments.length === 0) return [];

  const thumbnailDir = join(tmpdir(), `thumbs-${videoId}`);
  await mkdir(thumbnailDir, { recursive: true });

  const tasks = segments.map((seg) => async (): Promise<VideoSegment> => {
    // Name by start time (centiseconds) so names are globally unique even when
    // segments are processed in separate batches/steps.
    const thumbName = `segment-${Math.round(seg.start * 100)}.jpg`;
    const thumbAbsPath = join(thumbnailDir, thumbName);
    const s3ThumbKey = `thumbnails/${videoId}/${thumbName}`;

    let thumbnailPath: string | null = null;
    try {
      await extractFrameAt(source, seg.start, thumbAbsPath);
      if (existsSync(thumbAbsPath))
        thumbnailPath = await uploadToS3(thumbAbsPath, s3ThumbKey, "image/jpeg");
    } catch {
      /* non-fatal — chapter still works without a thumbnail */
    }

    return { mainTag: seg.mainTag, subTag: seg.subTag, start: seg.start, end: seg.end, thumbnailPath };
  });

  return withConcurrency(tasks, THUMB_CONCURRENCY);
}
