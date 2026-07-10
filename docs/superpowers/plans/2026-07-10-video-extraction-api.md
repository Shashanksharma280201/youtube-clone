# videoExtraction API + Tagging Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `POST /api/v1/videoExtraction` — a poll-based endpoint that ingests a video by its blob URL (from any tenant container), runs the pipeline, and returns the caller's exact chunk-shaped response; plus reduce the number of `other` chapter tags.

**Architecture:** The endpoint reuses the existing durable workflow. A URL parser (`parseStorageUrl`) splits `videoURL` into container + key and rejects any host that is not our storage account. The storage facade gains an optional `container` argument so the pipeline can read a tenant container. A new pipeline step writes per-chunk `summarizedText` + `tools` into `topicSegments`. A pure serializer maps the finished `Video` row into the response shape, signing thumbnail and blob URLs on read. The tagger is tightened to use `other` only as a last resort.

**Tech Stack:** Next.js 14 App Router, TypeScript, Prisma (Azure/Neon Postgres), Vercel Workflow DevKit (`workflow/api`), Azure Blob / AWS S3 storage facade, OpenAI (`gpt-4o` / `gpt-4o-mini`), Vitest.

## Global Constraints

- No emojis anywhere — code, comments, docs, or output.
- Do not commit real secrets. `.env`, `.env.docker`, `.env.local`, `.env.vercel.local` stay gitignored.
- The storage facade keeps its historical `s3*` naming. The names do not imply AWS — Azure Blob is selected when `AZURE_STORAGE_ACCOUNT` + `AZURE_STORAGE_KEY` + `AZURE_STORAGE_CONTAINER` are all set, otherwise AWS S3.
- Keep `POST /api/v1/ingest` working — do not remove or repurpose it.
- The response repeats `domainMetaData` and `videoSummary` in **every** chunk, matching the caller's sample exactly. This is intentional; do not "optimize" it to top-level.
- `status` is added to every `videoExtraction` response; the rest of the body matches the caller's sample.
- Do not push to any git remote unless explicitly asked.
- Work happens in `/home/shanks/Videos/youtube-clone`; it is synced to `/home/shanks/Pictures/amby-ai-video-service` separately. The two repos are not git-linked.
- `cp` is aliased to `cp -i` in this shell and silently declines overwrites with no tty — use `command cp -f` when copying.

## Test environment

- Unit tests (Vitest) cover all pure logic: `parseStorageUrl`, the chunk serializer, the chunk-summary parser, and the orphan-`other` merge.
- Integration is the local Docker stack (`docker compose up -d --build`) on the **S3 backend** (`.env.docker`). It verifies HTTP status codes and idempotency.
- The signed-thumbnail 403/409 control (unsigned URL rejected) is **only reproducible on Azure**, whose container is private. The local S3 test bucket is public, so an unsigned URL returns 200 there. Do not assert the control locally; note it and defer to an Azure check.

---

### Task 1: `parseStorageUrl` — split a blob URL and reject foreign hosts

**Files:**
- Create: `src/lib/storage/parseUrl.ts`
- Create: `tests/parseStorageUrl.test.ts`

**Interfaces:**
- Consumes: nothing (reads `process.env` for the active account host).
- Produces: `parseStorageUrl(url: string): { container: string; key: string }` — throws `Error` with message `foreign-host` if the host is not our account, `bad-url` if unparseable or missing a container.

- [ ] **Step 1: Write the failing tests**

Create `tests/parseStorageUrl.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { parseStorageUrl } from '@/lib/storage/parseUrl'

describe('parseStorageUrl (azure backend)', () => {
  beforeEach(() => {
    process.env.AZURE_STORAGE_ACCOUNT = 'stdatadevcentralindia'
    process.env.AZURE_STORAGE_KEY = 'k'
    process.env.AZURE_STORAGE_CONTAINER = 'videosvc'
    delete process.env.AZURE_STORAGE_ENDPOINT
  })

  it('splits container and key from a tenant-container URL', () => {
    const out = parseStorageUrl(
      'https://stdatadevcentralindia.blob.core.windows.net/bpl-x/machine/pump.mp4',
    )
    expect(out).toEqual({ container: 'bpl-x', key: 'machine/pump.mp4' })
  })

  it('rejects a URL pointing at a different account', () => {
    expect(() =>
      parseStorageUrl('https://someoneelse.blob.core.windows.net/c/x.mp4'),
    ).toThrow('foreign-host')
  })

  it('rejects a URL with no container segment', () => {
    expect(() =>
      parseStorageUrl('https://stdatadevcentralindia.blob.core.windows.net/'),
    ).toThrow('bad-url')
  })

  it('honours AZURE_STORAGE_ENDPOINT for a local emulator host', () => {
    process.env.AZURE_STORAGE_ENDPOINT = 'http://azurite:10000/devstoreaccount1'
    const out = parseStorageUrl('http://azurite:10000/devstoreaccount1/videosvc/a.mp4')
    expect(out).toEqual({ container: 'videosvc', key: 'a.mp4' })
  })
})

describe('parseStorageUrl (s3 backend)', () => {
  beforeEach(() => {
    delete process.env.AZURE_STORAGE_ACCOUNT
    delete process.env.AZURE_STORAGE_KEY
    delete process.env.AZURE_STORAGE_CONTAINER
    process.env.AWS_S3_BUCKET = 'video-testing'
    process.env.AWS_REGION = 'ap-south-1'
  })

  it('reads container(bucket) and key from a virtual-hosted S3 URL', () => {
    const out = parseStorageUrl(
      'https://video-testing.s3.ap-south-1.amazonaws.com/videos/a.mp4',
    )
    expect(out).toEqual({ container: 'video-testing', key: 'videos/a.mp4' })
  })

  it('rejects a foreign S3 bucket host', () => {
    expect(() =>
      parseStorageUrl('https://other-bucket.s3.ap-south-1.amazonaws.com/x.mp4'),
    ).toThrow('foreign-host')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- parseStorageUrl`
Expected: FAIL — cannot resolve `@/lib/storage/parseUrl`.

- [ ] **Step 3: Implement it**

Create `src/lib/storage/parseUrl.ts`:

```ts
// Split a stored blob/object URL into { container, key } and refuse any URL that
// does not point at our own storage account. The host check is the SSRF guard:
// without it, a caller could make the service fetch arbitrary URLs from inside
// the cluster.

function azureActive(): boolean {
  return !!(
    process.env.AZURE_STORAGE_ACCOUNT &&
    process.env.AZURE_STORAGE_KEY &&
    process.env.AZURE_STORAGE_CONTAINER
  )
}

// The host we accept, derived from the active backend's configuration.
function expectedHost(): string {
  if (azureActive()) {
    const ep = process.env.AZURE_STORAGE_ENDPOINT
    if (ep) return new URL(ep).host
    return `${process.env.AZURE_STORAGE_ACCOUNT}.blob.core.windows.net`
  }
  return `${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com`
}

export function parseStorageUrl(url: string): { container: string; key: string } {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    throw new Error('bad-url')
  }

  if (u.host !== expectedHost()) throw new Error('foreign-host')

  // Path is /<first>/<rest>. For Azure the first segment may be the account name
  // (when an endpoint override includes it, e.g. Azurite's devstoreaccount1); in
  // that case the container is the SECOND segment. We normalize by stripping a
  // leading segment that matches the configured account path from the endpoint.
  let path = u.pathname.replace(/^\/+/, '')

  if (azureActive() && process.env.AZURE_STORAGE_ENDPOINT) {
    const epPath = new URL(process.env.AZURE_STORAGE_ENDPOINT).pathname.replace(/^\/+|\/+$/g, '')
    if (epPath && path.startsWith(epPath + '/')) path = path.slice(epPath.length + 1)
  }

  const slash = path.indexOf('/')
  if (slash <= 0 || slash === path.length - 1) throw new Error('bad-url')

  return { container: path.slice(0, slash), key: path.slice(slash + 1) }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- parseStorageUrl`
Expected: PASS, all cases green.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/lib/storage/parseUrl.ts tests/parseStorageUrl.test.ts
git commit -m "feat(storage): parseStorageUrl splits blob URL and rejects foreign hosts"
```

---

### Task 2: Storage facade — optional `container` on read paths

**Files:**
- Modify: `src/lib/storage/types.ts`
- Modify: `src/lib/storage/s3.ts`
- Modify: `src/lib/storage/azure.ts`
- Modify: `src/lib/s3.ts`

**Interfaces:**
- Consumes: `StorageBackend` interface.
- Produces: three read functions gain an optional trailing `container?: string`, defaulting to the configured container when omitted:
  - `exists(key: string, container?: string): Promise<boolean>`
  - `getPresignedDownloadUrl(key: string, expiresIn?: number, container?: string): Promise<string>`
  - `downloadFromS3(key: string, localPath: string, container?: string): Promise<void>`

- [ ] **Step 1: Update the interface**

In `src/lib/storage/types.ts`, replace the three signatures inside `StorageBackend`:

```ts
  exists(key: string, container?: string): Promise<boolean>
  getPresignedDownloadUrl(key: string, expiresIn?: number, container?: string): Promise<string>
  downloadFromS3(key: string, localPath: string, container?: string): Promise<void>
```

- [ ] **Step 2: Typecheck to verify it fails**

Run: `npx tsc --noEmit`
Expected: FAIL — both backends no longer satisfy `StorageBackend`.

- [ ] **Step 3: Implement for S3**

In `src/lib/storage/s3.ts`, change the three functions to take an optional bucket override. Add a helper near `const BUCKET`:

```ts
const bucketOf = (container?: string) => container || BUCKET()
```

Then update each function's `Bucket:` to use it and add the parameter:

```ts
async function exists(key: string, container?: string): Promise<boolean> {
  try {
    await client().send(new HeadObjectCommand({ Bucket: bucketOf(container), Key: key }))
    return true
  } catch (err) {
    const e = err as { name?: string; $metadata?: { httpStatusCode?: number } }
    if (e.$metadata?.httpStatusCode === 404 || e.name === 'NotFound' || e.name === 'NoSuchKey') {
      return false
    }
    throw err
  }
}

async function getPresignedDownloadUrl(key: string, expiresIn = 6 * 3600, container?: string): Promise<string> {
  const cmd = new GetObjectCommand({ Bucket: bucketOf(container), Key: key })
  return getSignedUrl(client(), cmd, { expiresIn })
}

async function downloadFromS3(key: string, localPath: string, container?: string): Promise<void> {
  const res = await client().send(new GetObjectCommand({ Bucket: bucketOf(container), Key: key }))
  const chunks: Uint8Array[] = []
  for await (const chunk of res.Body as AsyncIterable<Uint8Array>) chunks.push(chunk)
  const { writeFile } = await import('fs/promises')
  await writeFile(localPath, Buffer.concat(chunks))
}
```

- [ ] **Step 4: Implement for Azure**

In `src/lib/storage/azure.ts`, add a helper that returns a container client for an arbitrary container, and thread it through. Add near the top helpers:

```ts
function containerClientFor(container?: string): ContainerClient {
  if (!container || container === CONTAINER()) return container_()
  const service = new BlobServiceClient(ENDPOINT(), cred())
  return service.getContainerClient(container)
}

function blobFor(key: string, container?: string): BlockBlobClient {
  return containerClientFor(container).getBlockBlobClient(key)
}
```

(Note: the existing singleton container accessor is `container()`. Rename the private accessor to `container_()` in one place, OR reuse the existing `container()` — inspect the file and keep its existing name. The intent: default container reuses the singleton; a named container builds a fresh client.)

Then update the three functions:

```ts
async function exists(key: string, container?: string): Promise<boolean> {
  return blobFor(key, container).exists()
}

async function getPresignedDownloadUrl(key: string, expiresIn = 6 * 3600, container?: string): Promise<string> {
  return sasUrl(key, 'r', expiresIn, container)
}

async function downloadFromS3(key: string, localPath: string, container?: string): Promise<void> {
  await blobFor(key, container).downloadToFile(localPath)
}
```

And extend `sasUrl` to accept an optional container, defaulting to `CONTAINER()`, and use it for both `containerName` and the returned URL base:

```ts
function sasUrl(key: string, perms: string, expiresIn: number, container?: string): string {
  const c = container || CONTAINER()
  const now = Date.now()
  const sas = generateBlobSASQueryParameters(
    {
      containerName: c,
      blobName: key,
      permissions: BlobSASPermissions.parse(perms),
      startsOn: new Date(now - 5 * 60 * 1000),
      expiresOn: new Date(now + expiresIn * 1000),
      protocol: SASProtocol.Https,
    },
    cred(),
  ).toString()
  return `${ENDPOINT()}/${c}/${key}?${sas}`
}
```

- [ ] **Step 5: Facade re-exports already forward these** — no change needed in `src/lib/s3.ts` (it re-exports `backend.exists` etc.). Confirm:

```bash
grep -n "export const exists\|getPresignedDownloadUrl\|downloadFromS3" src/lib/s3.ts
```

Expected: all three present.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/lib/storage/types.ts src/lib/storage/s3.ts src/lib/storage/azure.ts
git commit -m "feat(storage): optional container arg on exists/getPresignedDownloadUrl/downloadFromS3"
```

---

### Task 3: Workflow reads from the video's own container

**Files:**
- Modify: `src/workflows/transcribe-video.ts`

**Interfaces:**
- Consumes: `parseStorageUrl` (Task 1), the container-aware read functions (Task 2).
- Produces: no signature change to the exported workflow. Internally, `prepareStep` returns `container` alongside `key`, and every `getPresignedDownloadUrl(key)` call passes the container.

- [ ] **Step 1: Parse container + key in `prepareStep`**

In `src/workflows/transcribe-video.ts`, replace the `s3Key` import usage. Change the import line `import { s3Key, getPresignedDownloadUrl } from "@/lib/s3";` to:

```ts
import { getPresignedDownloadUrl } from "@/lib/s3";
import { parseStorageUrl } from "@/lib/storage/parseUrl";
```

In `prepareStep`, change its return type and the key derivation:

```ts
async function prepareStep(
  videoId: string,
): Promise<{ key: string; container: string; duration: number; segments: AudioSegment[] }> {
  "use step";
  const video = await prisma.video.findUnique({ where: { id: videoId } });
  if (!video) throw new FatalError("Video not found");

  const { container, key } = parseStorageUrl(video.blobUrl);
  const url = await getPresignedDownloadUrl(key, undefined, container);
  const duration = await probeDuration(url);
  const total = Math.max(duration, 1);

  const segments: AudioSegment[] = [];
  for (let t = 0; t < total; t += SEGMENT_SECS) {
    segments.push({ offset: t, dur: Math.min(SEGMENT_SECS, total - t) || SEGMENT_SECS });
  }
  return { key, container, duration, segments };
}
```

- [ ] **Step 2: Thread `container` into every step that presigns**

Every step that currently receives `key` and calls `getPresignedDownloadUrl(key)` must also receive and pass `container`. Read the file and update the four call sites (approx lines 91, 157, 224) plus the step signatures and the `run()` orchestration that invokes them.

Pattern for each step signature — add `container: string` after `key: string`:

```ts
async function transcribeChunkStep(
  videoId: string,
  key: string,
  container: string,
  offset: number,
  dur: number,
): Promise<ChunkResult> {
  "use step";
  const url = await getPresignedDownloadUrl(key, undefined, container);
  // ...unchanged...
}
```

And in `run()`, pass `container` (destructured from `prepareStep`) into each such step call. Do the same for the vision/thumbnail steps that presign (search for `getPresignedDownloadUrl(`).

- [ ] **Step 3: Typecheck and build**

```bash
npx tsc --noEmit && OPENAI_API_KEY=sk-build-placeholder npm run build
```

Expected: exit 0. (No unit test — this is durable-workflow wiring, covered by the Task 9 end-to-end run.)

- [ ] **Step 4: Commit**

```bash
git add src/workflows/transcribe-video.ts
git commit -m "feat(pipeline): read the video from its own container (tenant-aware)"
```

---

### Task 4: Schema — `machineId` and `tenantId`

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_machine_tenant/migration.sql`

**Interfaces:**
- Produces: `Video.machineId: string | null`, `Video.tenantId: string | null`.

- [ ] **Step 1: Add the columns**

In `prisma/schema.prisma`, under the `externalId` line in `model Video`:

```prisma
  machineId          String?
  tenantId           String?
```

- [ ] **Step 2: Generate the migration from the live local DB**

The local dev DB already has migration history (`0_init`, `1_add_external_id`). Use the normal generator:

```bash
cd /home/shanks/Videos/youtube-clone
export DATABASE_URL=$(grep -E "^DIRECT_URL=" .env.docker | cut -d= -f2-)
export DIRECT_URL="$DATABASE_URL"
npx prisma migrate dev --name add_machine_tenant --create-only
```

- [ ] **Step 3: Verify the SQL adds two nullable columns, no DROP**

```bash
cat prisma/migrations/*_add_machine_tenant/migration.sql
```

Expected: two `ALTER TABLE "Video" ADD COLUMN` statements, no `DROP`. If a `DROP` appears, stop.

- [ ] **Step 4: Apply and regenerate**

```bash
npx prisma migrate deploy
npx prisma generate
```

Expected: `1 migration applied`.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(db): add machineId and tenantId to Video"
```

---

### Task 5: Per-chunk `summarizedText` + `tools`

**Files:**
- Modify: `src/lib/pipeline/types.ts` (extend `VideoSegment`)
- Create: `src/lib/pipeline/chunkSummary.ts`
- Create: `tests/chunkSummary.test.ts`
- Modify: `src/workflows/transcribe-video.ts` (call the step, persist)

**Interfaces:**
- Consumes: `chatComplete` from `./openai`, `withConcurrency` + `TAG_BATCH_SIZE` from `./types`.
- Produces:
  - `VideoSegment` gains `summarizedText?: string` and `tools?: string[]`.
  - `parseChunkSummaries(text: string, count: number): { summarizedText: string; tools: string[] }[]` (pure).
  - `summarizeChunks(chunks: { mainTag: string; subTag: string; transcript: string }[]): Promise<{ summarizedText: string; tools: string[] }[]>`.

- [ ] **Step 1: Extend the type**

In `src/lib/pipeline/types.ts`, add two optional fields to `VideoSegment`:

```ts
export type VideoSegment = {
  mainTag: string;
  subTag: string;
  start: number;
  end: number;
  thumbnailPath: string | null;
  summarizedText?: string;
  tools?: string[];
};
```

- [ ] **Step 2: Write the failing test for the parser**

Create `tests/chunkSummary.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseChunkSummaries } from '@/lib/pipeline/chunkSummary'

describe('parseChunkSummaries', () => {
  it('reads summary + tools per chunk by index', () => {
    const raw = JSON.stringify({
      chunks: [
        { i: 0, summary: 'Loosen the cap nut.', tools: ['14mm spanner'] },
        { i: 1, summary: 'Check oil level.', tools: [] },
      ],
    })
    expect(parseChunkSummaries(raw, 2)).toEqual([
      { summarizedText: 'Loosen the cap nut.', tools: ['14mm spanner'] },
      { summarizedText: 'Check oil level.', tools: [] },
    ])
  })

  it('falls back to empty values on malformed output', () => {
    expect(parseChunkSummaries('not json', 2)).toEqual([
      { summarizedText: '', tools: [] },
      { summarizedText: '', tools: [] },
    ])
  })

  it('fills gaps for chunks the model omitted', () => {
    const raw = JSON.stringify({ chunks: [{ i: 0, summary: 'A', tools: ['x'] }] })
    expect(parseChunkSummaries(raw, 2)).toEqual([
      { summarizedText: 'A', tools: ['x'] },
      { summarizedText: '', tools: [] },
    ])
  })
})
```

- [ ] **Step 3: Run to verify failure**

Run: `npm test -- chunkSummary`
Expected: FAIL — cannot resolve `@/lib/pipeline/chunkSummary`.

- [ ] **Step 4: Implement the module**

Create `src/lib/pipeline/chunkSummary.ts`:

```ts
import { chatComplete } from "./openai";
import { withConcurrency, TAG_BATCH_SIZE } from "./types";

export type ChunkInput = { mainTag: string; subTag: string; transcript: string };
export type ChunkSummary = { summarizedText: string; tools: string[] };

// Never throws. A malformed model response degrades every chunk to empty values.
export function parseChunkSummaries(text: string, count: number): ChunkSummary[] {
  let arr: { i?: number; summary?: string; tools?: unknown }[] | null = null;
  try {
    const parsed = JSON.parse(text) as { chunks?: unknown };
    if (Array.isArray(parsed.chunks)) arr = parsed.chunks as typeof arr;
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
                  'For each transcript chunk write "summary": one plain sentence describing what happens, and "tools": an array of the physical tools/instruments named in that chunk (empty if none). Do not invent tools. Return ONLY: {"chunks":[{"i":0,"summary":"...","tools":["..."]}]}',
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
```

- [ ] **Step 5: Run to verify pass**

Run: `npm test -- chunkSummary`
Expected: PASS.

- [ ] **Step 6: Call it in the workflow and persist**

In `src/workflows/transcribe-video.ts`, after `topicSegments` are built and before they are saved, enrich them. Find where `topicSegments` and `transcriptSegments` are both available (the function returning `{ transcript, transcriptSegments, topicSegments }`). Add a step that computes the per-chunk summaries and writes them onto each segment:

```ts
// Enrich each chapter with a one-line summary + the tools named in it.
async function summarizeStep(
  topicSegments: VideoSegment[],
  transcriptSegments: TaggedSegment[],
): Promise<VideoSegment[]> {
  "use step";
  const inputs = topicSegments.map((seg) => ({
    mainTag: seg.mainTag,
    subTag: seg.subTag,
    transcript: transcriptSegments
      .filter((t) => t.start >= seg.start && t.start < seg.end)
      .map((t) => t.text.trim())
      .join(" "),
  }));
  const summaries = await summarizeChunks(inputs);
  return topicSegments.map((seg, i) => ({
    ...seg,
    summarizedText: summaries[i]?.summarizedText ?? "",
    tools: summaries[i]?.tools ?? [],
  }));
}
```

Import `summarizeChunks` at the top:

```ts
import { summarizeChunks } from "@/lib/pipeline/chunkSummary";
```

Then in `run()`, after `topicSegments` are produced and before the save step, call it:

```ts
topicSegments = await summarizeStep(topicSegments, transcriptSegments);
```

(Read the file to place this correctly relative to where `topicSegments` is finalized and where `saveStep` persists it. `summarizedText`/`tools` ride along in the `topicSegments` JSON that is already saved — no schema change.)

- [ ] **Step 7: Typecheck and build**

```bash
npx tsc --noEmit && OPENAI_API_KEY=sk-build-placeholder npm run build
```

Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/lib/pipeline/types.ts src/lib/pipeline/chunkSummary.ts tests/chunkSummary.test.ts src/workflows/transcribe-video.ts
git commit -m "feat(pipeline): per-chunk summarizedText and tools"
```

---

### Task 6: Tagger — reduce `other`

**Files:**
- Modify: `src/lib/pipeline/tag.ts`
- Create: `src/lib/pipeline/mergeOther.ts`
- Create: `tests/mergeOther.test.ts`

**Interfaces:**
- Produces: `mergeOrphanOther(segments: TaggedSegment[], maxSecs?: number): TaggedSegment[]` (pure) — absorbs a lone short `other` segment sitting between two same-tag non-`other` neighbours into the preceding segment's tag.

- [ ] **Step 1: Constrain the label set + log failures in `tag.ts`**

In `src/lib/pipeline/tag.ts`, change the system prompt so `m` must come from a fixed list, and log a failed batch. Replace the `content:` template's first two lines and the `catch`:

Prompt — replace the tag instructions with:

```ts
              content: `Tag each transcript segment with:
- "m": the phase, chosen ONLY from this list: introduction, overview, diagnosis, repair, testing, verification, safety, parts, conclusion, other. Use "other" ONLY when none of the others fit.
- "s": 2-5 word specific description (sub tag)
${phaseHint}
Return ONLY JSON — no input text: {"segments":[{"i":0,"m":"introduction","s":"Overview of the parts"},{"i":1,"m":"diagnosis","s":"Testing battery voltage"}]}`,
```

Catch — log the batch before falling back:

```ts
      } catch (err) {
        console.warn(`[tag] batch of ${batch.length} failed -> 'other':`, err);
        return batch.map(() => ({ mainTag: "other", subTag: "" }));
      }
```

- [ ] **Step 2: Write the failing test for the merge**

Create `tests/mergeOther.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mergeOrphanOther } from '@/lib/pipeline/mergeOther'

const seg = (start: number, end: number, mainTag: string) =>
  ({ id: start, start, end, text: '', mainTag, subTag: '' })

describe('mergeOrphanOther', () => {
  it('absorbs a short lone other between two same-tag segments', () => {
    const out = mergeOrphanOther([
      seg(0, 10, 'repair'),
      seg(10, 15, 'other'), // 5s orphan
      seg(15, 25, 'repair'),
    ])
    expect(out.map((s) => s.mainTag)).toEqual(['repair', 'repair', 'repair'])
  })

  it('leaves a long other alone', () => {
    const out = mergeOrphanOther([
      seg(0, 10, 'repair'),
      seg(10, 40, 'other'), // 30s, real content
      seg(40, 50, 'repair'),
    ])
    expect(out.map((s) => s.mainTag)).toEqual(['repair', 'other', 'repair'])
  })

  it('leaves an other between differing tags alone', () => {
    const out = mergeOrphanOther([
      seg(0, 10, 'diagnosis'),
      seg(10, 13, 'other'),
      seg(15, 25, 'repair'),
    ])
    expect(out.map((s) => s.mainTag)).toEqual(['diagnosis', 'other', 'repair'])
  })
})
```

- [ ] **Step 3: Run to verify failure**

Run: `npm test -- mergeOther`
Expected: FAIL — cannot resolve `@/lib/pipeline/mergeOther`.

- [ ] **Step 4: Implement it**

Create `src/lib/pipeline/mergeOther.ts`:

```ts
import type { TaggedSegment } from "./types";

// A lone `other` segment shorter than `maxSecs`, flanked by two segments that
// share the same non-`other` tag, is almost always filler mid-task. Absorb it so
// it does not surface as its own chapter. Longer `other` runs are left alone.
export function mergeOrphanOther(
  segments: TaggedSegment[],
  maxSecs = 8,
): TaggedSegment[] {
  return segments.map((seg, i) => {
    if (seg.mainTag !== "other") return seg;
    const prev = segments[i - 1];
    const next = segments[i + 1];
    const short = seg.end - seg.start < maxSecs;
    if (
      short &&
      prev &&
      next &&
      prev.mainTag !== "other" &&
      prev.mainTag === next.mainTag
    ) {
      return { ...seg, mainTag: prev.mainTag };
    }
    return seg;
  });
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npm test -- mergeOther`
Expected: PASS.

- [ ] **Step 6: Apply the merge after tagging**

In `src/lib/pipeline/tag.ts`, import and apply `mergeOrphanOther` to the final tagged segments before returning. At the top:

```ts
import { mergeOrphanOther } from "./mergeOther";
```

Change the final `return segments.map(...)` so its result is passed through the merge. Read the file: the function returns `segments.map((seg, i) => ({ ...seg, mainTag: ..., subTag: ... }))`. Wrap it:

```ts
  const tagged = segments.map((seg, i) => ({
    ...seg,
    mainTag: allTags[i]?.mainTag ?? "other",
    subTag: allTags[i]?.subTag ?? "",
  }));
  return mergeOrphanOther(tagged);
```

- [ ] **Step 7: Typecheck and full test run**

```bash
npx tsc --noEmit && npm test
```

Expected: exit 0; all tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/lib/pipeline/tag.ts src/lib/pipeline/mergeOther.ts tests/mergeOther.test.ts
git commit -m "feat(pipeline): constrain tag labels, log failed batches, merge orphan 'other'"
```

---

### Task 7: The chunk serializer

**Files:**
- Create: `src/lib/videoExtractionResponse.ts`
- Create: `tests/videoExtractionResponse.test.ts`

**Interfaces:**
- Consumes: `s3Key`, `getPresignedDownloadUrl` from `@/lib/s3` (for the default signer).
- Produces:
  - `type Signer = (storedUrl: string) => Promise<string>`
  - `buildExtractionResponse(video: VideoRow, sign?: Signer): Promise<ExtractionResponse>` — pure aside from the injected signer. `VideoRow` is the Prisma `Video` shape (uses `id`, `externalId`, `machineId`, `tenantId`, `title`, `description`, `createdAt`, `blobUrl`, `transcriptStatus`, `transcriptSegments`, `topicSegments`, `domainData`).

- [ ] **Step 1: Write the failing test**

Create `tests/videoExtractionResponse.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildExtractionResponse } from '@/lib/videoExtractionResponse'

const sign = async (u: string) => `${u}?sig=1`

const baseVideo = {
  id: 'v1',
  externalId: 'r-1',
  machineId: 'm-1',
  tenantId: 't-1',
  title: 'KRC Demo',
  description: 'desc',
  createdAt: new Date('2026-07-06T14:22:10.000Z'),
  blobUrl: 'https://acct.blob.core.windows.net/videosvc/videos/krc.mp4',
  transcriptStatus: 'DONE',
  transcriptSegments: [
    { id: 0, start: 12.4, end: 15, text: 'Alright, today the lube pump.' },
    { id: 1, start: 15, end: 18.9, text: 'It feeds oil to the bearings.' },
    { id: 2, start: 40, end: 44, text: 'Next chapter text.' },
  ],
  topicSegments: [
    { mainTag: 'intro', subTag: 'lube overview', start: 12.4, end: 18.9,
      thumbnailPath: 'https://acct.blob.core.windows.net/videosvc/thumbnails/v1/s0.jpg',
      summarizedText: 'The lube system feeds oil to the bearings.', tools: ['Multimeter'] },
    { mainTag: 'diagnosis', subTag: 'low flow', start: 40, end: 44,
      thumbnailPath: null, summarizedText: 'Check the flow.', tools: [] },
  ],
  domainData: {
    machine: 'Lubrication System', summary: 'Diagnosing low-lube-flow.',
    overview: 'The lube system keeps parts oiled.', machineIntro: [{ title: 'Float switch', detail: 'Detects oil level.' }],
  },
}

describe('buildExtractionResponse', () => {
  it('maps a DONE video into the chunk shape', async () => {
    const r = await buildExtractionResponse(baseVideo as never, sign)
    expect(r.resourceId).toBe('r-1')
    expect(r.machineId).toBe('m-1')
    expect(r.tenantId).toBe('t-1')
    expect(r.status).toBe('DONE')
    expect(r.chunkCount).toBe(2)
    expect(r.chunks).toHaveLength(2)

    const c0 = r.chunks[0]
    expect(c0.chunkId).toBe('v1-0')
    expect(c0.start).toBe(12.4)
    expect(c0.transcript).toBe('Alright, today the lube pump. It feeds oil to the bearings.')
    expect(c0.summarizedText).toBe('The lube system feeds oil to the bearings.')
    expect(c0.tools).toEqual(['Multimeter'])
    expect(c0.thumbnailUrl).toBe(
      'https://acct.blob.core.windows.net/videosvc/thumbnails/v1/s0.jpg?sig=1',
    )
    expect(c0.blobUrl).toBe('https://acct.blob.core.windows.net/videosvc/videos/krc.mp4?sig=1')
    expect(c0.videoSummary).toBe('Diagnosing low-lube-flow.')
    expect(c0.domainMetaData.machine).toBe('Lubrication System')
  })

  it('uses externalId as resourceId, falls back to id', async () => {
    const r = await buildExtractionResponse({ ...baseVideo, externalId: null } as never, sign)
    expect(r.resourceId).toBe('v1')
  })

  it('null thumbnailPath yields null thumbnailUrl (not signed)', async () => {
    const r = await buildExtractionResponse(baseVideo as never, sign)
    expect(r.chunks[1].thumbnailUrl).toBeNull()
  })

  it('empty domainData yields empty domainMetaData, not a throw', async () => {
    const r = await buildExtractionResponse({ ...baseVideo, domainData: null } as never, sign)
    expect(r.chunks[0].domainMetaData).toEqual({ machine: '', summary: '', overview: '', machineIntro: [] })
    expect(r.chunks[0].videoSummary).toBe('')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- videoExtractionResponse`
Expected: FAIL — cannot resolve the module.

- [ ] **Step 3: Implement it**

Create `src/lib/videoExtractionResponse.ts`:

```ts
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
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- videoExtractionResponse`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/lib/videoExtractionResponse.ts tests/videoExtractionResponse.test.ts
git commit -m "feat: chunk serializer for videoExtraction response"
```

---

### Task 8: `POST /api/v1/videoExtraction`

**Files:**
- Create: `src/app/api/v1/videoExtraction/route.ts`

**Interfaces:**
- Consumes: `prisma`, `parseStorageUrl`, `exists`, `start`, `transcribeVideoWorkflow`, `buildExtractionResponse`.
- Produces: the endpoint. Middleware already gates `/api/v1/*`.

- [ ] **Step 1: Create the route**

Create `src/app/api/v1/videoExtraction/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { exists } from '@/lib/s3'
import { parseStorageUrl } from '@/lib/storage/parseUrl'
import { start } from 'workflow/api'
import { transcribeVideoWorkflow } from '@/workflows/transcribe-video'
import { buildExtractionResponse } from '@/lib/videoExtractionResponse'

// Ingest a video by its blob URL and return the extracted chunks. Poll-based:
// the first call starts the pipeline and returns 202; repeat calls return 202
// while processing, 200 when DONE, 409 when FAILED. Idempotent on resourceId
// (stored as externalId). Gated by the API-key middleware.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const machineId = typeof body.machineId === 'string' ? body.machineId.trim() : ''
  const resourceId = typeof body.resourceId === 'string' ? body.resourceId.trim() : ''
  const tenantId = typeof body.tenantId === 'string' ? body.tenantId.trim() : ''
  const videoURL = typeof body.videoURL === 'string' ? body.videoURL.trim() : ''

  if (!machineId || !resourceId || !tenantId || !videoURL) {
    return NextResponse.json(
      { error: 'machineId, resourceId, tenantId and videoURL are required' },
      { status: 400 },
    )
  }

  // Existing resource: return current state, never reprocess.
  const existing = await prisma.video.findUnique({ where: { externalId: resourceId } })
  if (existing) return respond(existing)

  let parsed: { container: string; key: string }
  try {
    parsed = parseStorageUrl(videoURL)
  } catch {
    return NextResponse.json(
      { error: 'videoURL must point at the configured storage account' },
      { status: 400 },
    )
  }

  if (!(await exists(parsed.key, parsed.container))) {
    return NextResponse.json({ error: 'Video file not found in storage' }, { status: 404 })
  }

  const video = await prisma.video.create({
    data: {
      externalId: resourceId,
      machineId,
      tenantId,
      title: parsed.key.split('/').pop() || parsed.key,
      description: '',
      blobUrl: videoURL,
      transcriptStatus: 'PROCESSING',
    },
  })

  try {
    await start(transcribeVideoWorkflow, [video.id])
  } catch (err) {
    console.error('[videoExtraction] failed to start workflow:', err)
    await prisma.video.update({ where: { id: video.id }, data: { transcriptStatus: 'FAILED' } })
    return NextResponse.json({ error: 'Failed to start processing' }, { status: 500 })
  }

  return NextResponse.json(
    { resourceId, machineId, tenantId, status: 'PROCESSING', chunks: [], chunkCount: 0 },
    { status: 202 },
  )
}

type Row = Awaited<ReturnType<typeof prisma.video.findUnique>>

async function respond(video: NonNullable<Row>) {
  const s = video.transcriptStatus
  if (s === 'DONE') {
    return NextResponse.json(await buildExtractionResponse(video), { status: 200 })
  }
  if (s === 'FAILED') {
    return NextResponse.json(
      { resourceId: video.externalId ?? video.id, status: 'FAILED', error: 'processing failed' },
      { status: 409 },
    )
  }
  return NextResponse.json(
    {
      resourceId: video.externalId ?? video.id,
      machineId: video.machineId,
      tenantId: video.tenantId,
      status: video.transcriptStatus,
      chunks: [],
      chunkCount: 0,
    },
    { status: 202 },
  )
}
```

- [ ] **Step 2: Typecheck and build**

```bash
npx tsc --noEmit && OPENAI_API_KEY=sk-build-placeholder npm run build
```

Expected: exit 0; `/api/v1/videoExtraction` appears in the route table.

- [ ] **Step 3: Rebuild the Docker stack and check health**

```bash
docker compose up -d --build
curl -fsS http://localhost:3000/api/health
```

Expected: `{"status":"ok",...}`

- [ ] **Step 4: 400 on a missing field**

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/api/v1/videoExtraction \
  -H 'Content-Type: application/json' -d '{"machineId":"m"}'
```

Expected: `400`

- [ ] **Step 5: 400 on a foreign host**

```bash
curl -s -X POST http://localhost:3000/api/v1/videoExtraction -H 'Content-Type: application/json' \
  -d '{"machineId":"m","resourceId":"r-foreign","tenantId":"t","videoURL":"https://evil.example.com/x.mp4"}'
```

Expected: `{"error":"videoURL must point at the configured storage account"}`, status `400`.

- [ ] **Step 6: 404 on a missing blob in our bucket**

Build a URL from the local S3 config that is well-formed but points at a missing key:

```bash
BUCKET=$(grep -E "^AWS_S3_BUCKET=" .env.docker | cut -d= -f2-)
REGION=$(grep -E "^AWS_REGION=" .env.docker | cut -d= -f2-)
curl -s -X POST http://localhost:3000/api/v1/videoExtraction -H 'Content-Type: application/json' \
  -d "{\"machineId\":\"m\",\"resourceId\":\"r-missing\",\"tenantId\":\"t\",\"videoURL\":\"https://$BUCKET.s3.$REGION.amazonaws.com/videos/does-not-exist.mp4\"}"
```

Expected: `{"error":"Video file not found in storage"}`, status `404`. Confirm no row was created:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/api/v1/videos/r-missing
```

Expected: `404`.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/v1/videoExtraction/route.ts
git commit -m "feat(api): POST /api/v1/videoExtraction (poll-based chunk extraction)"
```

---

### Task 9: End-to-end + docs

**Files:**
- Modify: `docs/API.md`

- [ ] **Step 1: Seed a blob directly (no DB row)**

```bash
cd /home/shanks/Videos/youtube-clone
export AWS_ACCESS_KEY_ID=$(grep -E "^AWS_ACCESS_KEY_ID=" .env.docker | cut -d= -f2-)
export AWS_SECRET_ACCESS_KEY=$(grep -E "^AWS_SECRET_ACCESS_KEY=" .env.docker | cut -d= -f2-)
export AWS_DEFAULT_REGION=$(grep -E "^AWS_REGION=" .env.docker | cut -d= -f2-)
BUCKET=$(grep -E "^AWS_S3_BUCKET=" .env.docker | cut -d= -f2-)
REGION=$(grep -E "^AWS_REGION=" .env.docker | cut -d= -f2-)
aws s3 cp "How to Desolder SMD Resistor with Soldering Iron Quickly.mp4" "s3://$BUCKET/videos/vx-e2e.mp4" --content-type video/mp4
URL="https://$BUCKET.s3.$REGION.amazonaws.com/videos/vx-e2e.mp4"
echo "$URL"
```

- [ ] **Step 2: First call → 202 PROCESSING**

```bash
curl -s -X POST http://localhost:3000/api/v1/videoExtraction -H 'Content-Type: application/json' \
  -d "{\"machineId\":\"m-1\",\"resourceId\":\"vx-1\",\"tenantId\":\"t-1\",\"videoURL\":\"$URL\"}" -w '\nHTTP %{http_code}\n'
```

Expected: HTTP `202`, body `{"resourceId":"vx-1","machineId":"m-1","tenantId":"t-1","status":"PROCESSING","chunks":[],"chunkCount":0}`.

- [ ] **Step 3: Repeat immediately → 202, no second row**

Run the same command again. Expected: HTTP `202`, still PROCESSING. Confirm one row:

```bash
curl -s "http://localhost:3000/api/v1/videos/vx-1" | python3 -c 'import sys,json;print(json.load(sys.stdin)["externalId"])'
```

Expected: `vx-1`.

- [ ] **Step 4: Poll to DONE**

```bash
for i in $(seq 1 40); do
  S=$(curl -s -o /dev/null -w '%{http_code}' -X POST http://localhost:3000/api/v1/videoExtraction \
      -H 'Content-Type: application/json' \
      -d "{\"machineId\":\"m-1\",\"resourceId\":\"vx-1\",\"tenantId\":\"t-1\",\"videoURL\":\"$URL\"}")
  echo "$((i*5))s http=$S"; [ "$S" = "200" ] && break; sleep 5
done
```

Expected: reaches `200`.

- [ ] **Step 5: Inspect the full response**

```bash
curl -s -X POST http://localhost:3000/api/v1/videoExtraction -H 'Content-Type: application/json' \
  -d "{\"machineId\":\"m-1\",\"resourceId\":\"vx-1\",\"tenantId\":\"t-1\",\"videoURL\":\"$URL\"}" \
 | python3 -c '
import sys,json
d=json.load(sys.stdin)
print("status:", d["status"], "| chunkCount:", d["chunkCount"])
print("resourceId/machineId/tenantId:", d["resourceId"], d["machineId"], d["tenantId"])
c=d["chunks"][0] if d["chunks"] else {}
for k in ["chunkId","start","end","mainTag","subTag","summarizedText","tools","videoSummary"]:
    print(f"  chunk[0].{k}:", repr(c.get(k))[:70])
print("  chunk[0].domainMetaData.machine:", (c.get("domainMetaData") or {}).get("machine"))
print("  chunk[0].thumbnailUrl set:", bool(c.get("thumbnailUrl")))
'
```

Expected: `status: DONE`, `chunkCount > 0`, `chunkId` = `vx-...-0`, every chunk carries `videoSummary` + `domainMetaData` (repeated by design).

- [ ] **Step 6: Note the Azure-only control**

Do **not** assert the unsigned-thumbnail 403 here — the local S3 bucket is public. Record in the commit message that the signed-vs-unsigned control must be verified on Azure (private container), where the unsigned URL returns 403/409 and the signed one returns 200. (Already proven for the existing `/videos/{id}` path on Azure.)

- [ ] **Step 7: Clean up the test row**

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X DELETE http://localhost:3000/api/v1/videos/vx-1
```

Expected: `200`.

- [ ] **Step 8: Full unit run**

Run: `npm test`
Expected: all suites pass.

- [ ] **Step 9: Document the endpoint in `docs/API.md`**

Add near the `/ingest` entry:

```markdown
### POST `/api/v1/videoExtraction` **[key]**
Ingest a video by its storage URL and, once processed, return its chunks. Poll-based:
call with the same body until it returns `200`.
- **Request**
  ```json
  { "machineId": "string (required)", "resourceId": "string (required, your ID)",
    "tenantId": "string (required)",
    "videoURL": "https://<account>.blob.core.windows.net/<container>/<key> (required)" }
  ```
- **202** (processing) → `{ resourceId, machineId, tenantId, status: "PROCESSING", chunks: [], chunkCount: 0 }`
- **200** (done) → `{ resourceId, machineId, tenantId, status: "DONE", title, description, createdAt, chunks: [...], chunkCount }`
- **409** (failed) → `{ resourceId, status: "FAILED", error }`
- **400** missing field, or `videoURL` host is not the configured storage account
- **404** blob not found in that container
- **401** missing/invalid key
- Each chunk: `chunkId, start, end, mainTag, subTag, transcript, summarizedText, tools, thumbnailUrl (signed ~6h), blobUrl (signed ~6h), videoSummary, domainMetaData`.
- `videoSummary` and `domainMetaData` are video-level and repeated in every chunk.
- `videoURL` may point at any container in the configured storage account; other hosts are rejected.
```

- [ ] **Step 10: Commit**

```bash
git add docs/API.md
git commit -m "docs: document POST /api/v1/videoExtraction"
```

---

## Sync and push (only when explicitly asked)

Work happens in `youtube-clone`. To ship to the deploy repo:

```bash
SRC=/home/shanks/Videos/youtube-clone
DST=/home/shanks/Pictures/amby-ai-video-service
rsync -a --exclude='node_modules' --exclude='.next' "$SRC/src/" "$DST/src/"
rsync -a "$SRC/prisma/migrations/" "$DST/prisma/migrations/"
rsync -a "$SRC/tests/" "$DST/tests/"
for f in prisma/schema.prisma docs/API.md; do command cp -f "$SRC/$f" "$DST/$f"; done
```

Then in `$DST`: `npm install`, `npx prisma generate`, `npx tsc --noEmit`, `npm test`, review `git status`, confirm no real `.env` staged, commit, and push to `dev` only when the user asks. Remember `k8s/**` and `prisma/**` are deploy triggers — a push deploys, and the DB needs `machineId`/`tenantId` applied (the entrypoint runs `migrate deploy`; the new migration ships in the image).
