import { s3Key, getPresignedDownloadUrl } from "./s3";

const TTL = 6 * 3600;

export type Signer = (storedUrl: string) => Promise<string>;
const defaultSigner: Signer = (url) => getPresignedDownloadUrl(s3Key(url), TTL);

type Seg = {
  mainTag: string; subTag: string; start: number; end: number;
  thumbnailPath: string | null; summarizedText?: string; tools?: string[];
};
type Tx = { start: number; end: number; text: string };
type Guide = { machine?: string; summary?: string; overview?: string; machineIntro?: unknown[] };

type VideoRow = {
  id: string; externalId: string | null; machineId: string | null; tenantId: string | null;
  title: string; description: string; createdAt: Date; blobUrl: string; transcriptStatus: string;
  transcriptSegments: unknown; topicSegments: unknown; domainData: unknown;
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
  const videoSummary = guide?.summary ?? "";
  const blobUrlSigned = await sign(video.blobUrl);

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

  return {
    resourceId,
    machineId: video.machineId,
    tenantId: video.tenantId,
    status: video.transcriptStatus,
    title: video.title,
    description: video.description,
    createdAt: video.createdAt,
    chunks,
    chunkCount: chunks.length,
  };
}

export type ExtractionResponse = Awaited<ReturnType<typeof buildExtractionResponse>>;
