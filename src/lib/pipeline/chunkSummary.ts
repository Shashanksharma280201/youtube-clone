import { chatComplete } from "./openai";
import { withConcurrency, TAG_BATCH_SIZE } from "./types";

export type ChunkInput = { mainTag: string; subTag: string; transcript: string };
export type ChunkSummary = { summarizedText: string; tools: string[] };

// Never throws. A malformed model response degrades every chunk to empty values.
export function parseChunkSummaries(text: string, count: number): ChunkSummary[] {
  type Entry = { i?: number; summary?: string; tools?: unknown };
  let arr: Entry[] | null = null;
  try {
    const parsed = JSON.parse(text) as { chunks?: unknown };
    if (Array.isArray(parsed.chunks)) arr = parsed.chunks as Entry[];
  } catch {
    arr = null;
  }
  return Array.from({ length: count }, (_, j) => {
    const e = arr?.find((x) => x?.i === j) ?? arr?.[j];
    const summary = typeof e?.summary === "string" ? e.summary.trim() : "";
    const tools = Array.isArray(e?.tools)
      ? (e!.tools as unknown[]).filter((t): t is string => typeof t === "string").map((t) => t.trim())
      : [];
    return { summarizedText: summary, tools };
  });
}

// One batched gpt-4o-mini call per group. On failure a batch degrades to empties
// rather than failing the whole video — chapters and the guide still stand.
export async function summarizeChunks(chunks: ChunkInput[]): Promise<ChunkSummary[]> {
  const batches: ChunkInput[][] = [];
  for (let i = 0; i < chunks.length; i += TAG_BATCH_SIZE)
    batches.push(chunks.slice(i, i + TAG_BATCH_SIZE));

  const results = await withConcurrency(
    batches.map((batch) => async () => {
      const input = batch.map((c, i) => ({
        i,
        tag: `${c.mainTag} / ${c.subTag}`,
        transcript: c.transcript.slice(0, 600),
      }));
      try {
        const res = await chatComplete(
          {
            temperature: 0,
            max_tokens: 1600,
            response_format: { type: "json_object" },
            messages: [
              {
                role: "system",
                content:
                  'For each transcript chunk write "summary": one plain sentence describing what happens, and "tools": an array of the physical tools/instruments named in that chunk (empty if none). Do not invent tools. Return ONLY this JSON object: {"chunks":[{"i":0,"summary":"...","tools":["..."]}]}',
              },
              { role: "user", content: JSON.stringify(input) },
            ],
          },
          { mini: true },
        );
        return parseChunkSummaries(res.choices[0]?.message?.content ?? "{}", batch.length);
      } catch (err) {
        console.warn("[chunkSummary] batch failed:", err);
        return batch.map(() => ({ summarizedText: "", tools: [] }));
      }
    }),
    3,
  );

  return results.flat();
}
