import { s3Key, getPresignedDownloadUrl } from "./s3";
import { EMPTY_DOMAIN, asDomainData, type DomainData } from "./pipeline/domain-types";

const TTL = 6 * 3600;

export type Signer = (storedUrl: string) => Promise<string>;
const defaultSigner: Signer = (url) => getPresignedDownloadUrl(s3Key(url), TTL);

type Seg = {
  mainTag: string; subTag: string; start: number; end: number;
  thumbnailPath: string | null; summarizedText?: string; tools?: string[];
};
// transcriptSegments carry their own phase tags (added by the tag/align steps).
type Tx = { start: number; end: number; text: string; mainTag?: string; subTag?: string };
type Guide = { machine?: string; summary?: string; overview?: string; machineIntro?: unknown[] };

type VideoRow = {
  id: string; externalId: string | null; machineId: string | null; tenantId: string | null;
  title: string; description: string; createdAt: Date; blobUrl: string; transcriptStatus: string;
  transcriptSegments: unknown; topicSegments: unknown; domainData: unknown;
  thumbnailUrl: string | null;
};

function guideMeta(g: Guide | null) {
  return {
    machine: g?.machine ?? "",
    summary: g?.summary ?? "",
    overview: g?.overview ?? "",
    machineIntro: Array.isArray(g?.machineIntro) ? g!.machineIntro : [],
  };
}

export async function buildExtractionResponse(video: VideoRow, sign: Signer = defaultSigner) {
  const resourceId = video.externalId ?? video.id;
  const tx = (Array.isArray(video.transcriptSegments) ? video.transcriptSegments : []) as Tx[];
  const segs = (Array.isArray(video.topicSegments) ? video.topicSegments : []) as Seg[];
  const guide = (video.domainData ?? null) as Guide | null;
  const meta = guideMeta(guide);
  // Full 12-field machine guide (troubleshooting, error codes, PM, safety, parts,
  // specs, glossary …), normalized from the stored JSON. Previously only the 4-field
  // `domainMetaData` reached the caller; the actionable guide was dropped.
  const fullGuide: DomainData = asDomainData(video.domainData) ?? EMPTY_DOMAIN;
  const videoSummary = guide?.summary ?? "";
  const blobUrlSigned = await sign(video.blobUrl);
  const thumbnailUrl = video.thumbnailUrl ? await sign(video.thumbnailUrl) : null;

  const chunks = await Promise.all(
    segs.map(async (seg, i) => ({
      chunkId: `${video.id}-${i}`,
      start: seg.start,
      end: seg.end,
      mainTag: seg.mainTag,
      subTag: seg.subTag,
      transcript: tx.filter((t) => t.start >= seg.start && t.start < seg.end).map((t) => t.text.trim()).join(" "),
      summarizedText: seg.summarizedText ?? "",
      tools: seg.tools ?? [],
      thumbnailUrl: seg.thumbnailPath ? await sign(seg.thumbnailPath) : null,
      blobUrl: blobUrlSigned,
      videoSummary,
      domainMetaData: meta,
    })),
  );

  // Full timestamped transcript with its phase tags — the transcript-view data,
  // which the flat per-chunk `transcript` string does not expose on its own.
  const transcript = tx.map((t) => ({
    start: t.start,
    end: t.end,
    text: t.text,
    mainTag: t.mainTag ?? "",
    subTag: t.subTag ?? "",
  }));

  return {
    resourceId,
    machineId: video.machineId,
    tenantId: video.tenantId,
    status: video.transcriptStatus,
    title: video.title,
    description: video.description,
    createdAt: video.createdAt,
    thumbnailUrl,
    // Video-level machine guide (one per video). `chunks[].domainMetaData` is kept
    // for backward compatibility; `guide` is the complete structured guide.
    guide: fullGuide,
    // Chapters, each with its tags/subtags, summary, tools and thumbnail.
    chunks,
    chunkCount: chunks.length,
    // Full tagged transcript segments.
    transcript,
  };
}

export type ExtractionResponse = Awaited<ReturnType<typeof buildExtractionResponse>>;
