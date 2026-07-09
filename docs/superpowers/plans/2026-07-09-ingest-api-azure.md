# Ingest API + Azure Deployment Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `POST /api/v1/ingest` so an external service can register a video already sitting in Azure Blob and have it processed, then fetch transcript, thumbnails, and Machine Guide by its own ID — and fix the Azure deployment defects that would otherwise make ingest silently do nothing.

**Architecture:** Ingest is by reference: the caller passes a blob name plus their own ID. We verify the blob exists, store the caller's ID in a new unique `externalId` column, and start the existing durable workflow. A single `resolveVideo()` helper teaches every existing `/videos/[id]` route to accept either our cuid or the caller's ID, so no new read endpoints are needed. Because the Azure container is private, stored thumbnail URLs are unsigned and return 403; we sign them on read.

**Tech Stack:** Next.js 14 App Router, TypeScript, Prisma (Postgres), Vercel Workflow DevKit (`workflow/api`), Azure Blob (`@azure/storage-blob`) / AWS S3 behind a storage facade, Vitest (added by this plan).

## Global Constraints

- No emojis anywhere — code, comments, docs, or output.
- Do not commit real secrets. `.env`, `.env.docker`, `.env.local`, `.env.vercel.local` stay gitignored. `.env.docker.example` is a safe template and IS committed.
- Never migrate or alter the production Neon database. Local testing uses the Docker stack.
- The storage facade keeps its historical `s3*` naming (`s3Url`, `s3Key`, `uploadToS3`). The names do not imply AWS — Azure Blob is selected when `AZURE_STORAGE_ACCOUNT` + `AZURE_STORAGE_KEY` + `AZURE_STORAGE_CONTAINER` are all set, otherwise AWS S3.
- Azure Blob is the priority backend; S3 is the fallback.
- Work happens in `/home/shanks/Videos/youtube-clone`. It is synced to `/home/shanks/Pictures/amby-ai-video-service` and pushed from there. The two repos are **not** git-linked.
- Do not push to any git remote unless explicitly asked.

---

### Task 1: Sync the teammate's Azure fixes down (Step 0)

`youtube-clone` does not contain the `prisma.ts` fix or the updated `docker-entrypoint.sh` that unblocked the Azure deployment. They exist only on the `dev` branch of `amby-ai-video-service`. Every later task builds on them, and a later sync in the other direction would silently revert them. This must be first.

**Files:**
- Modify: `src/lib/prisma.ts` (replace entirely)
- Modify: `docker-entrypoint.sh` (replace entirely)

**Interfaces:**
- Consumes: nothing.
- Produces: `prisma` client that uses the Neon driver only for Neon hosts and the standard driver for Azure Postgres. No signature change — `import { prisma } from '@/lib/prisma'` still works.

- [ ] **Step 1: Copy both files down from the Pictures dev branch**

```bash
cd /home/shanks/Pictures/amby-ai-video-service
git fetch origin dev
git show origin/dev:src/lib/prisma.ts > /home/shanks/Videos/youtube-clone/src/lib/prisma.ts
git show origin/dev:docker-entrypoint.sh > /home/shanks/Videos/youtube-clone/docker-entrypoint.sh
```

- [ ] **Step 2: Verify both fixes are present**

```bash
cd /home/shanks/Videos/youtube-clone
grep -c "useNeonAdapter" src/lib/prisma.ts     # expect 2
grep -c "prisma db push" docker-entrypoint.sh  # expect 1
```

Expected: `2` then `1`. If either is `0`, the copy failed — stop.

- [ ] **Step 3: Confirm the project still typechecks and builds**

```bash
npx tsc --noEmit && OPENAI_API_KEY=sk-build-placeholder npm run build
```

Expected: exit 0, route table printed.

- [ ] **Step 4: Commit**

```bash
git add src/lib/prisma.ts docker-entrypoint.sh
git commit -m "chore: sync Azure Postgres prisma fix and entrypoint from dev"
```

---

### Task 2: Add a test harness (Vitest)

The repo has no test framework. Later tasks are written test-first, so the runner comes first. Only pure logic is unit-tested; database and storage paths are covered by the end-to-end task.

**Files:**
- Create: `vitest.config.ts`
- Create: `tests/smoke.test.ts`
- Modify: `package.json` (add `test` script + devDependency)

**Interfaces:**
- Produces: `npm test` runs Vitest over `tests/**/*.test.ts`; `@/…` resolves to `src/…`.

- [ ] **Step 1: Install Vitest**

```bash
cd /home/shanks/Videos/youtube-clone
npm install -D vitest --no-audit --no-fund
```

- [ ] **Step 2: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
  resolve: { alias: { '@': resolve(__dirname, 'src') } },
})
```

- [ ] **Step 3: Add the `test` script to `package.json`**

In the `"scripts"` block, add:

```json
"test": "vitest run"
```

- [ ] **Step 4: Write a smoke test that fails**

Create `tests/smoke.test.ts`:

```ts
import { describe, it, expect } from 'vitest'

describe('harness', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2)
  })
})
```

- [ ] **Step 5: Run the tests**

Run: `npm test`
Expected: PASS, `1 passed`.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vitest.config.ts tests/smoke.test.ts
git commit -m "test: add vitest harness"
```

---

### Task 3: Add `exists()` to the storage facade

Ingest must return `404` when the caller names a blob that is not there. The facade has no existence check.

**Files:**
- Modify: `src/lib/storage/types.ts`
- Modify: `src/lib/storage/s3.ts`
- Modify: `src/lib/storage/azure.ts`
- Modify: `src/lib/s3.ts`

**Interfaces:**
- Consumes: `StorageBackend` from Task 0 codebase (already exists).
- Produces: `exists(key: string): Promise<boolean>` exported from `@/lib/s3`.

- [ ] **Step 1: Add `exists` to the `StorageBackend` interface**

In `src/lib/storage/types.ts`, inside `export interface StorageBackend {`, add after `s3Key`:

```ts
  // True when the object is present. Used to validate an ingest request.
  exists(key: string): Promise<boolean>
```

- [ ] **Step 2: Run typecheck to verify it fails**

Run: `npx tsc --noEmit`
Expected: FAIL — `s3Backend` and `azureBackend` are missing the `exists` property.

- [ ] **Step 3: Implement `exists` for S3**

In `src/lib/storage/s3.ts`, add `HeadObjectCommand` to the existing `@aws-sdk/client-s3` import list, then add this function above `export const s3Backend`:

```ts
async function exists(key: string): Promise<boolean> {
  try {
    await client().send(new HeadObjectCommand({ Bucket: BUCKET(), Key: key }))
    return true
  } catch (err) {
    const e = err as { name?: string; $metadata?: { httpStatusCode?: number } }
    if (e.$metadata?.httpStatusCode === 404 || e.name === 'NotFound' || e.name === 'NoSuchKey') {
      return false
    }
    throw err
  }
}
```

Then add `exists,` to the `s3Backend` object literal.

- [ ] **Step 4: Implement `exists` for Azure**

In `src/lib/storage/azure.ts`, add this function above `export const azureBackend`:

```ts
async function exists(key: string): Promise<boolean> {
  return blob(key).exists()
}
```

Then add `exists,` to the `azureBackend` object literal.

- [ ] **Step 5: Re-export from the facade**

In `src/lib/s3.ts`, add below `export const s3Key = backend.s3Key`:

```ts
export const exists = backend.exists
```

- [ ] **Step 6: Run typecheck to verify it passes**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/lib/storage/types.ts src/lib/storage/s3.ts src/lib/storage/azure.ts src/lib/s3.ts
git commit -m "feat(storage): add exists() to the storage facade"
```

---

### Task 4: Add the `externalId` column and switch to real migrations

`externalId` is the caller's ID. This is the first real schema change, which is the moment to stop using `prisma db push` in production.

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/…` (generated)

**Interfaces:**
- Produces: `Video.externalId: string | null`, unique. Prisma types regenerate so `prisma.video.findUnique({ where: { externalId } })` compiles.

The target database already has tables but **no migration history**. Running
`prisma migrate dev` against it would prompt a full **reset and drop the data**.
It must be baselined first. Every command below uses `migrate diff` / `migrate
deploy`, which never touch a shadow database and never reset.

- [ ] **Step 1: Confirm which database you are pointed at**

```bash
cd /home/shanks/Videos/youtube-clone
grep -E "^(DATABASE_URL|DIRECT_URL)=" .env.docker | sed -E 's#://[^@]*@#://***@#'
```

Expected: the isolated dev database. If this is the production Neon host
(`quiet-grass-56117836` / `ep-royal-unit`), **stop** — never migrate production.

- [ ] **Step 2: Baseline the existing schema as migration `0_init`**

Do this **before** touching `schema.prisma`, so `0_init` describes the database as
it exists today.

```bash
mkdir -p prisma/migrations/0_init
npx prisma migrate diff \
  --from-empty \
  --to-schema-datamodel prisma/schema.prisma \
  --script > prisma/migrations/0_init/migration.sql
```

- [ ] **Step 3: Mark the baseline as already applied**

```bash
npx prisma migrate resolve --applied 0_init
```

Expected: `Migration 0_init marked as applied.` This creates the
`_prisma_migrations` table and records the baseline without running the SQL.

- [ ] **Step 4: Verify the database is now in a clean migration state**

```bash
npx prisma migrate status
```

Expected: `Database schema is up to date!`

- [ ] **Step 5: Add the column to the schema**

In `prisma/schema.prisma`, inside `model Video`, add directly under the `id` line:

```prisma
  // ID supplied by the ingesting service. Our cuid stays the primary key.
  externalId         String?          @unique
```

- [ ] **Step 6: Generate the delta migration from the live database**

```bash
mkdir -p prisma/migrations/1_add_external_id
npx prisma migrate diff \
  --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma \
  --script > prisma/migrations/1_add_external_id/migration.sql
```

`--from-schema-datasource` reads the **live database**; `--to-schema-datamodel`
reads the **edited schema file**. The diff between them is the migration.

- [ ] **Step 7: Verify the migration SQL is exactly what you expect**

```bash
cat prisma/migrations/1_add_external_id/migration.sql
```

Expected, and nothing else:

```sql
ALTER TABLE "Video" ADD COLUMN "externalId" TEXT;
CREATE UNIQUE INDEX "Video_externalId_key" ON "Video"("externalId");
```

If any `DROP` statement appears, the schema file and the database have drifted.
**Stop** and reconcile before continuing — applying it would lose data.

- [ ] **Step 8: Apply it and regenerate the client**

```bash
npx prisma migrate deploy
npx prisma generate
```

Expected: `1 migration applied` (`1_add_external_id`).

- [ ] **Step 9: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 10: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(db): baseline migrations and add unique externalId to Video"
```

---

### Task 5: Resolve a video by either ID

Callers address videos by `externalId`; the UI uses our cuid. One helper, used by every existing `/videos/[id]` route.

**Files:**
- Create: `src/lib/videoWhere.ts` (pure — no prisma import, so it is unit-testable)
- Create: `src/lib/video.ts` (DB access)
- Create: `tests/videoWhere.test.ts`
- Modify: `src/app/api/v1/videos/[id]/route.ts`
- Modify: `src/app/api/v1/videos/[id]/transcript/route.ts`
- Modify: `src/app/api/v1/videos/[id]/transcribe/route.ts`
- Modify: `src/app/api/v1/videos/[id]/search-chapter/route.ts`

**Interfaces:**
- Consumes: `prisma` from `@/lib/prisma`.
- Produces:
  - `videoWhere(idOrExternalId: string): { OR: [{ id: string }, { externalId: string }] }`
  - `resolveVideo(idOrExternalId: string): Promise<Video | null>`
  - `resolveVideoId(idOrExternalId: string): Promise<string | null>`

- [ ] **Step 1: Write the failing test**

Create `tests/videoWhere.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { videoWhere } from '@/lib/videoWhere'

describe('videoWhere', () => {
  it('matches either our cuid or the caller externalId', () => {
    expect(videoWhere('ext-123')).toEqual({
      OR: [{ id: 'ext-123' }, { externalId: 'ext-123' }],
    })
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `@/lib/videoWhere`.

- [ ] **Step 3: Implement the pure helper**

Create `src/lib/videoWhere.ts`:

```ts
// A video may be addressed by our primary key (cuid) or by the externalId the
// ingesting service supplied. Kept free of prisma imports so it is unit-testable.
export function videoWhere(idOrExternalId: string) {
  return { OR: [{ id: idOrExternalId }, { externalId: idOrExternalId }] }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test`
Expected: PASS, `2 passed`.

- [ ] **Step 5: Implement the DB helpers**

Create `src/lib/video.ts`:

```ts
import { prisma } from './prisma'
import { videoWhere } from './videoWhere'

export { videoWhere }

// Full record, addressed by cuid or externalId.
export async function resolveVideo(idOrExternalId: string) {
  return prisma.video.findFirst({ where: videoWhere(idOrExternalId) })
}

// Just our primary key — for routes that then update or delete by id.
export async function resolveVideoId(idOrExternalId: string): Promise<string | null> {
  const v = await prisma.video.findFirst({
    where: videoWhere(idOrExternalId),
    select: { id: true },
  })
  return v?.id ?? null
}
```

- [ ] **Step 6: Use it in `GET`/`DELETE` of `src/app/api/v1/videos/[id]/route.ts`**

Replace the whole file with:

```ts
import { NextResponse } from 'next/server'
import { resolveVideo } from '@/lib/video'
import { deleteVideoCompletely } from '@/lib/deleteVideo'

// Full video record (including domainData — the Machine Guide).
// `id` may be our cuid or the ingesting service's externalId.
export async function GET(_: Request, { params }: { params: { id: string } }) {
  const video = await resolveVideo(params.id)
  if (!video) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(video)
}

// Permanently delete a video + all derived data (blob, audio, thumbnails, row).
export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  const video = await resolveVideo(params.id)
  if (!video) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const deleted = await deleteVideoCompletely(video.id)
  if (!deleted) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ deleted: true })
}
```

- [ ] **Step 7: Use it in `src/app/api/v1/videos/[id]/transcript/route.ts`**

Replace the whole file with:

```ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { videoWhere } from '@/lib/videoWhere'

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const video = await prisma.video.findFirst({
    where: videoWhere(params.id),
    select: {
      transcriptStatus: true,
      transcript: true,
      transcriptSegments: true,
      topicSegments: true,
    },
  })

  if (!video) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({
    status: video.transcriptStatus,
    transcript: video.transcript,
    segments: video.transcriptSegments,
    topicSegments: video.topicSegments,
  })
}
```

- [ ] **Step 8: Use it in `src/app/api/v1/videos/[id]/transcribe/route.ts`**

Replace the body of `POST` so it resolves first, then claims by our real `id`. Keep the atomic-claim comment and logic — only the lookup changes:

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveVideoId } from "@/lib/video";
import { start } from "workflow/api";
import { transcribeVideoWorkflow } from "@/workflows/transcribe-video";

// The heavy lifting runs in a durable Workflow (see src/workflows/transcribe-video.ts).
// This route marks the video PROCESSING and kicks off the workflow. Access is gated by
// the API key (middleware) / same-origin UI. `id` may be a cuid or an externalId.
export async function POST(_: Request, { params }: { params: { id: string } }) {
  const id = await resolveVideoId(params.id);
  if (!id) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Atomic claim: flip to PROCESSING only if the video isn't already running/done.
  // This is a single conditional UPDATE, so two concurrent POSTs can't both pass —
  // exactly one matches a row and starts a run; the other matches 0 rows and bails.
  const claim = await prisma.video.updateMany({
    where: { id, transcriptStatus: { in: ["NONE", "PENDING", "FAILED"] } },
    data: { transcriptStatus: "PROCESSING" },
  });
  if (claim.count === 0) {
    const current = await prisma.video.findUnique({
      where: { id },
      select: { transcriptStatus: true },
    });
    return NextResponse.json({ status: current?.transcriptStatus });
  }

  const run = await start(transcribeVideoWorkflow, [id]);
  return NextResponse.json({ status: "PROCESSING", runId: run.runId });
}
```

- [ ] **Step 9: Use it in `src/app/api/v1/videos/[id]/search-chapter/route.ts`**

Change the import line `import { prisma } from '@/lib/prisma'` to also import the resolver:

```ts
import { resolveVideo } from '@/lib/video'
```

and replace

```ts
  const video = await prisma.video.findUnique({ where: { id: params.id } })
```

with

```ts
  const video = await resolveVideo(params.id)
```

Remove the now-unused `import { prisma } from '@/lib/prisma'` line if nothing else in the file uses `prisma`.

- [ ] **Step 10: Typecheck and build**

```bash
npx tsc --noEmit && OPENAI_API_KEY=sk-build-placeholder npm run build
```

Expected: exit 0.

- [ ] **Step 11: Commit**

```bash
git add src/lib/videoWhere.ts src/lib/video.ts tests/videoWhere.test.ts "src/app/api/v1/videos/[id]"
git commit -m "feat(api): address videos by cuid or externalId"
```

---

### Task 6: Sign thumbnail URLs on read

`uploadToS3()` stores a plain, unsigned object URL. A private Azure container returns 403 for those. Sign them when handing them to callers.

**Files:**
- Create: `src/lib/signUrls.ts`
- Create: `tests/signUrls.test.ts`
- Modify: `src/app/api/v1/videos/[id]/route.ts`
- Modify: `src/app/api/v1/videos/route.ts`

**Interfaces:**
- Consumes: `s3Key`, `getPresignedDownloadUrl` from `@/lib/s3`.
- Produces: `signThumbnails<T>(video: T, sign?: Signer): Promise<T>` where
  `type Signer = (storedUrl: string) => Promise<string>`.

- [ ] **Step 1: Write the failing test**

Create `tests/signUrls.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { signThumbnails } from '@/lib/signUrls'

const fakeSigner = async (url: string) => `${url}?sig=abc`

describe('signThumbnails', () => {
  it('signs thumbnailUrl and every topicSegments thumbnailPath', async () => {
    const out = await signThumbnails(
      {
        thumbnailUrl: 'https://acct.blob.core.windows.net/c/thumbnails/a.jpg',
        topicSegments: [
          { mainTag: 'intro', thumbnailPath: 'https://acct.blob.core.windows.net/c/thumbnails/b.jpg' },
          { mainTag: 'silent', thumbnailPath: null },
        ],
      },
      fakeSigner,
    )

    expect(out.thumbnailUrl).toBe('https://acct.blob.core.windows.net/c/thumbnails/a.jpg?sig=abc')
    expect(out.topicSegments[0].thumbnailPath).toBe(
      'https://acct.blob.core.windows.net/c/thumbnails/b.jpg?sig=abc',
    )
    expect(out.topicSegments[1].thumbnailPath).toBeNull()
  })

  it('leaves a video without thumbnails untouched', async () => {
    const out = await signThumbnails({ thumbnailUrl: null, topicSegments: null }, fakeSigner)
    expect(out.thumbnailUrl).toBeNull()
    expect(out.topicSegments).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `@/lib/signUrls`.

- [ ] **Step 3: Implement it**

Create `src/lib/signUrls.ts`:

```ts
import { s3Key, getPresignedDownloadUrl } from './s3'

const THUMB_TTL_SECONDS = 6 * 3600

// Receives the stored (unsigned) URL and returns a fetchable one. Injectable so
// the transform can be tested without touching a storage backend.
export type Signer = (storedUrl: string) => Promise<string>

const defaultSigner: Signer = (storedUrl) =>
  getPresignedDownloadUrl(s3Key(storedUrl), THUMB_TTL_SECONDS)

type WithThumbs = { thumbnailUrl?: unknown; topicSegments?: unknown }

// Thumbnails are stored as plain object URLs. Private containers reject those, so
// mint short-lived signed URLs whenever we hand a video to a caller.
export async function signThumbnails<T extends WithThumbs>(
  video: T,
  sign: Signer = defaultSigner,
): Promise<T> {
  const out = { ...video } as T & WithThumbs

  if (typeof out.thumbnailUrl === 'string' && out.thumbnailUrl) {
    out.thumbnailUrl = await sign(out.thumbnailUrl)
  }

  if (Array.isArray(out.topicSegments)) {
    out.topicSegments = await Promise.all(
      out.topicSegments.map(async (seg) => {
        const path = (seg as { thumbnailPath?: unknown })?.thumbnailPath
        if (typeof path !== 'string' || !path) return seg
        return { ...(seg as object), thumbnailPath: await sign(path) }
      }),
    )
  }

  return out as T
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test`
Expected: PASS, `4 passed`.

- [ ] **Step 5: Sign in `GET /api/v1/videos/[id]`**

In `src/app/api/v1/videos/[id]/route.ts`, add the import:

```ts
import { signThumbnails } from '@/lib/signUrls'
```

and change the `GET` return line from

```ts
  return NextResponse.json(video)
```

to

```ts
  return NextResponse.json(await signThumbnails(video))
```

- [ ] **Step 6: Sign in the `GET /api/v1/videos` list**

In `src/app/api/v1/videos/route.ts`, add the import:

```ts
import { signThumbnails } from '@/lib/signUrls'
```

and replace

```ts
  return NextResponse.json({ items: page, nextCursor: hasMore ? page[page.length-1].id : null })
```

with

```ts
  const nextCursor = hasMore ? page[page.length - 1].id : null
  const items = await Promise.all(page.map((v) => signThumbnails(v)))
  return NextResponse.json({ items, nextCursor })
```

Note: `nextCursor` is captured before signing because signing returns copies.

- [ ] **Step 7: Typecheck and build**

```bash
npx tsc --noEmit && OPENAI_API_KEY=sk-build-placeholder npm run build
```

Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/lib/signUrls.ts tests/signUrls.test.ts src/app/api/v1/videos/route.ts "src/app/api/v1/videos/[id]/route.ts"
git commit -m "fix(api): return signed thumbnail URLs so private containers work"
```

---

### Task 7: `POST /api/v1/ingest`

**Files:**
- Create: `src/app/api/v1/ingest/route.ts`

**Interfaces:**
- Consumes: `exists`, `s3Url` from `@/lib/s3`; `start` + `transcribeVideoWorkflow`.
- Produces: `POST /api/v1/ingest` accepting `{ videoId, videoName, title?, description? }`.

The middleware already gates `/api/v1/:path*`, so this route inherits API-key auth with no extra work.

- [ ] **Step 1: Create the route**

Create `src/app/api/v1/ingest/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { exists, s3Url } from '@/lib/s3'
import { start } from 'workflow/api'
import { transcribeVideoWorkflow } from '@/workflows/transcribe-video'

// Register a video that another service has already written into our storage
// container, then start the durable pipeline. `videoName` is a blob key inside
// AZURE_STORAGE_CONTAINER (or the S3 bucket, whichever backend is active).
// Access is gated by the API key (middleware).
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const videoId = typeof body.videoId === 'string' ? body.videoId.trim() : ''
  const videoName = typeof body.videoName === 'string' ? body.videoName.trim() : ''

  if (!videoId || !videoName) {
    return NextResponse.json({ error: 'videoId and videoName are required' }, { status: 400 })
  }

  // Idempotent: re-ingesting the same externalId returns the existing record
  // rather than creating a duplicate or restarting the pipeline.
  const existing = await prisma.video.findUnique({ where: { externalId: videoId } })
  if (existing) {
    return NextResponse.json({
      id: existing.id,
      externalId: videoId,
      status: existing.transcriptStatus,
    })
  }

  if (!(await exists(videoName))) {
    return NextResponse.json({ error: 'Video file not found in storage' }, { status: 404 })
  }

  const video = await prisma.video.create({
    data: {
      externalId: videoId,
      title: typeof body.title === 'string' && body.title.trim() ? body.title.trim() : videoName,
      description: typeof body.description === 'string' ? body.description : '',
      blobUrl: s3Url(videoName),
      transcriptStatus: 'PROCESSING',
    },
  })

  try {
    const run = await start(transcribeVideoWorkflow, [video.id])
    return NextResponse.json(
      { id: video.id, externalId: videoId, status: 'PROCESSING', runId: run.runId },
      { status: 202 },
    )
  } catch (err) {
    console.error('[ingest] failed to start workflow:', err)
    await prisma.video.update({
      where: { id: video.id },
      data: { transcriptStatus: 'FAILED' },
    })
    return NextResponse.json({ error: 'Failed to start processing' }, { status: 500 })
  }
}
```

- [ ] **Step 2: Typecheck and build**

```bash
npx tsc --noEmit && OPENAI_API_KEY=sk-build-placeholder npm run build
```

Expected: exit 0, and `/api/v1/ingest` appears in the printed route table.

- [ ] **Step 3: Rebuild and restart the Docker stack**

```bash
docker compose up -d --build
curl -fsS http://localhost:3000/api/health
```

Expected: `{"status":"ok",...}`

- [ ] **Step 4: Verify 400 on a missing field**

```bash
KEY=$(grep -E "^SERVICE_API_KEY=" .env.docker | cut -d= -f2-)
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/api/v1/ingest \
  -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' -d '{"videoId":"x"}'
```

Expected: `400`

- [ ] **Step 5: Verify 404 on a blob that does not exist**

```bash
curl -s -X POST http://localhost:3000/api/v1/ingest \
  -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d '{"videoId":"ext-missing","videoName":"videos/does-not-exist.mp4"}'
```

Expected: `{"error":"Video file not found in storage"}` with status `404`.

- [ ] **Step 6: Verify 401 without the API key**

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/api/v1/ingest \
  -H 'Content-Type: application/json' -d '{"videoId":"a","videoName":"b"}'
```

Expected: `401`

- [ ] **Step 7: Commit**

```bash
git add src/app/api/v1/ingest/route.ts
git commit -m "feat(api): add POST /api/v1/ingest to register an existing blob"
```

---

### Task 8: Fail loudly on missing workflow config, and use migrations

Ingest currently would accept a video and never process it if the workflow env is unset — a silent failure. Make the container refuse to start instead. Replace `db push`-on-boot with `migrate deploy`.

**Files:**
- Modify: `docker-entrypoint.sh`
- Modify: `.env.docker.example`

**Interfaces:**
- Produces: container exits non-zero when `WORKFLOW_TARGET_WORLD` / `WORKFLOW_POSTGRES_URL` are missing. `RUN_DB_PUSH=true` opts back into `db push` for local dev.

- [ ] **Step 1: Rewrite `docker-entrypoint.sh`**

```sh
#!/bin/sh
set -e

# The durable transcription pipeline needs a Workflow world. Without it the API
# accepts videos and silently never processes them, so refuse to start.
if [ -z "$WORKFLOW_TARGET_WORLD" ] || [ -z "$WORKFLOW_POSTGRES_URL" ]; then
  echo "[entrypoint] FATAL: WORKFLOW_TARGET_WORLD and WORKFLOW_POSTGRES_URL must both be set."
  echo "[entrypoint]   WORKFLOW_TARGET_WORLD=@workflow/world-postgres"
  echo "[entrypoint]   WORKFLOW_POSTGRES_URL=postgresql://.../workflow?sslmode=require"
  exit 1
fi

# Create/upgrade the Workflow engine tables. Idempotent, safe on every start.
echo "[entrypoint] Setting up the Workflow Postgres world..."
n=0
until node node_modules/@workflow/world-postgres/bin/setup.js; do
  n=$((n + 1))
  if [ "$n" -ge 10 ]; then
    echo "[entrypoint] Workflow DB not ready after $n tries — giving up."
    exit 1
  fi
  echo "[entrypoint] Workflow DB not ready (attempt $n) — retrying in 3s..."
  sleep 3
done

# Schema. `db push` is a prototyping tool: it can drop columns on drift, keeps no
# history, and races across replicas. Production applies versioned migrations.
# Set RUN_DB_PUSH=true only for throwaway local databases.
if [ -n "$DATABASE_URL" ]; then
  if [ "${RUN_DB_PUSH:-false}" = "true" ]; then
    echo "[entrypoint] RUN_DB_PUSH=true — pushing schema (dev only)..."
    node_modules/.bin/prisma db push --skip-generate
  else
    echo "[entrypoint] Applying Prisma migrations..."
    n=0
    until node_modules/.bin/prisma migrate deploy; do
      n=$((n + 1))
      if [ "$n" -ge 10 ]; then
        echo "[entrypoint] Migrations failed after $n tries — giving up."
        exit 1
      fi
      echo "[entrypoint] Database not ready (attempt $n) — retrying in 3s..."
      sleep 3
    done
  fi
fi

echo "[entrypoint] Starting Next.js on ${HOSTNAME:-0.0.0.0}:${PORT:-3000}..."
exec node_modules/.bin/next start -H "${HOSTNAME:-0.0.0.0}" -p "${PORT:-3000}"
```

- [ ] **Step 2: Ensure `prisma/migrations` ships in the image**

Confirm the runner stage already copies the prisma directory:

```bash
grep -n "COPY --from=builder /app/prisma" Dockerfile
```

Expected: one match. `migrate deploy` needs `prisma/migrations`, which lives inside it. If there is no match, add `COPY --from=builder /app/prisma ./prisma` to the runner stage.

- [ ] **Step 3: Document the new variables in `.env.docker.example`**

Append:

```
# --- Workflow engine (durable transcription pipeline) ---
# Required. The container refuses to start without these.
WORKFLOW_TARGET_WORLD=@workflow/world-postgres
WORKFLOW_POSTGRES_URL=postgres://world:world@workflow-db:5432/world

# Set to true ONLY for a throwaway local database. Production uses migrations.
# RUN_DB_PUSH=false
```

- [ ] **Step 4: Verify the guard trips**

```bash
docker compose run --rm -e WORKFLOW_TARGET_WORLD= -e WORKFLOW_POSTGRES_URL= app 2>&1 | head -3
echo "exit=$?"
```

Expected: the FATAL message, non-zero exit.

- [ ] **Step 5: Verify the normal path still boots**

```bash
docker compose up -d --build
sleep 20
curl -fsS http://localhost:3000/api/health
docker compose logs app | grep -i "Applying Prisma migrations"
```

Expected: health `ok`, and the migrations line present.

- [ ] **Step 6: Commit**

```bash
git add docker-entrypoint.sh .env.docker.example
git commit -m "fix(deploy): require workflow config and apply migrations instead of db push"
```

---

### Task 9: End-to-end validation and API docs

The assertion that matters is fetching a returned thumbnail URL and getting `200`. A test that only checks the URL is a non-empty string passes while the image 403s — that is the live bug.

**Files:**
- Modify: `docs/API.md`

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Put a test video into the storage backend under a known key**

Ingest requires a blob that exists with **no `Video` row pointing at it**. Do not
use `POST /api/v1/upload` to seed it: that route creates a row, and deleting the
row afterwards (`DELETE /videos/{id}` → `deleteVideoCompletely`) also deletes the
blob. Write the object directly instead.

```bash
cd /home/shanks/Videos/youtube-clone
KEY=$(grep -E "^SERVICE_API_KEY=" .env.docker | cut -d= -f2-)
FILE="How to Desolder SMD Resistor with Soldering Iron Quickly.mp4"
BLOB="videos/ingest-e2e.mp4"
```

For the **S3** backend (what `.env.docker` uses locally):

```bash
export AWS_ACCESS_KEY_ID=$(grep -E "^AWS_ACCESS_KEY_ID=" .env.docker | cut -d= -f2-)
export AWS_SECRET_ACCESS_KEY=$(grep -E "^AWS_SECRET_ACCESS_KEY=" .env.docker | cut -d= -f2-)
export AWS_DEFAULT_REGION=$(grep -E "^AWS_REGION=" .env.docker | cut -d= -f2-)
BUCKET=$(grep -E "^AWS_S3_BUCKET=" .env.docker | cut -d= -f2-)

aws s3 cp "$FILE" "s3://$BUCKET/$BLOB" --content-type video/mp4
aws s3 ls "s3://$BUCKET/$BLOB"
```

For the **Azure** backend, the equivalent is:

```bash
az storage blob upload \
  --account-name "$AZURE_STORAGE_ACCOUNT" --account-key "$AZURE_STORAGE_KEY" \
  --container-name "$AZURE_STORAGE_CONTAINER" \
  --name "$BLOB" --file "$FILE" --content-type video/mp4 --overwrite
```

Expected: the `aws s3 ls` (or `az`) command lists the object. `echo "$BLOB"` is the
value passed as `videoName` in the next step.

- [ ] **Step 2: Ingest by reference**

```bash
curl -s -X POST http://localhost:3000/api/v1/ingest \
  -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d "{\"videoId\":\"ext-e2e-1\",\"videoName\":\"$BLOB\",\"title\":\"Ingest e2e\"}" -w '\nHTTP %{http_code}\n'
```

Expected: HTTP `202`, body `{"id":"…","externalId":"ext-e2e-1","status":"PROCESSING","runId":"…"}`

- [ ] **Step 3: Verify idempotency**

Run the exact same command again.
Expected: HTTP `200`, same `id`, no new row, no new `runId`.

- [ ] **Step 4: Poll by the caller's ID until terminal**

```bash
for i in $(seq 1 60); do
  S=$(curl -s http://localhost:3000/api/v1/videos/ext-e2e-1/transcript -H "Authorization: Bearer $KEY" \
      | python3 -c 'import sys,json;print(json.load(sys.stdin)["status"])')
  echo "$((i*5))s status=$S"; case "$S" in DONE|FAILED) break;; esac; sleep 5
done
```

Expected: reaches `DONE`. If it stays `PROCESSING` forever, the workflow world is misconfigured (Task 8 guard should have caught it).

- [ ] **Step 5: Fetch everything by the caller's ID**

```bash
curl -s http://localhost:3000/api/v1/videos/ext-e2e-1 -H "Authorization: Bearer $KEY" \
 | python3 -c '
import sys,json
d=json.load(sys.stdin)
print("externalId:", d["externalId"])
print("status:", d["transcriptStatus"])
print("transcriptSegments:", len(d.get("transcriptSegments") or []))
print("topicSegments:", len(d.get("topicSegments") or []))
print("guide keys:", sorted((d.get("domainData") or {}).keys())[:5])
print("thumbnailUrl:", (d.get("thumbnailUrl") or "")[:90])
'
```

Expected: `externalId: ext-e2e-1`, status `DONE`, non-zero segment counts.

- [ ] **Step 6: Prove the thumbnail URL actually fetches (the real test)**

```bash
THUMB=$(curl -s http://localhost:3000/api/v1/videos/ext-e2e-1 -H "Authorization: Bearer $KEY" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin).get("thumbnailUrl") or "")')
test -n "$THUMB" && curl -s -o /dev/null -w 'thumbnail HTTP %{http_code}\n' "$THUMB"
```

Expected: `thumbnail HTTP 200`. A `403` means signing is not applied — go back to Task 6.

- [ ] **Step 7: Clean up the test row**

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X DELETE http://localhost:3000/api/v1/videos/ext-e2e-1 -H "Authorization: Bearer $KEY"
```

Expected: `200`.

- [ ] **Step 8: Run the unit tests once more**

Run: `npm test`
Expected: PASS, `4 passed`.

- [ ] **Step 9: Document the endpoint in `docs/API.md`**

Add to the endpoint list near `POST /api/v1/upload`:

```markdown
### POST `/api/v1/ingest` **[key]**
Register a video that already exists in the storage container and start the pipeline.
Use this when another service wrote the file directly to Azure Blob / S3.
- **Request**
  ```json
  { "videoId": "ext-123 (required, your ID)",
    "videoName": "videos/pump-repair.mp4 (required, blob key in the container)",
    "title": "string (optional, defaults to videoName)",
    "description": "string (optional)" }
  ```
- **202** → `{ "id": "cuid", "externalId": "ext-123", "status": "PROCESSING", "runId": "..." }`
- **200** → same shape, when `videoId` was already ingested (idempotent; no duplicate, no restart)
- **400** `{ "error": "videoId and videoName are required" }`
- **404** `{ "error": "Video file not found in storage" }`
- **401** `{ "error": "Unauthorized" }`
- **500** `{ "error": "Failed to start processing" }`
- **Next step:** poll `GET /api/v1/videos/{videoId}/transcript` until `DONE`, then
  `GET /api/v1/videos/{videoId}` for the full payload.
```

Also add, under "Notes for integrators":

```markdown
- **Addressing videos:** every `/api/v1/videos/{id}` route accepts either the `id` we
  generated or the `videoId` you supplied to `/ingest` (stored as `externalId`).
- **Thumbnails:** `thumbnailUrl` and `topicSegments[].thumbnailPath` are short-lived
  signed URLs (valid ~6 hours). Fetch or copy them promptly; re-request the video to
  get fresh ones.
```

Finally, update the `Video` data model section to include `externalId: string | null`.

- [ ] **Step 10: Commit**

```bash
git add docs/API.md
git commit -m "docs: document POST /api/v1/ingest, externalId addressing, signed thumbnails"
```

---

## Azure operator checklist (not code — hand to the infra team)

These are the deployment-side changes this plan depends on. Nothing here is done by the code tasks above.

- [ ] Create a **second database** on `psql-data-dev-centralindia-01` (e.g. `workflow-dev-cin`) for the Workflow engine.
- [ ] Add App Config keys (label `video-service`):
  - `WORKFLOW_TARGET_WORLD=@workflow/world-postgres`
  - `WORKFLOW_POSTGRES_URL=postgresql://<user>:<pass>@psql-data-dev-centralindia-01.postgres.database.azure.com:5432/workflow-dev-cin?sslmode=require`
- [ ] Confirm `SERVICE_API_KEY` is set. If unset, the API is open to anything in the cluster (the in-cluster address has no TLS and no VPN gate). Store it in Key Vault, not plaintext App Config. Same for `AZURE_STORAGE_KEY`.
- [ ] Ensure `DATABASE_URL` and `DIRECT_URL` end with `?sslmode=require`.
- [ ] Run migrations **once** as a Kubernetes Job or init-container (`prisma migrate deploy`), not per-pod. The entrypoint guard from Task 8 will hard-fail a pod whose workflow config is missing.
- [ ] Keep the `videosvc` container **private**. Signed URLs (Task 6) handle access. Do not enable anonymous access.
- [ ] Set Blob CORS on `stdatadevcentralindia` — needed only for the browser upload page, not for ingest: allowed origins `https://video.dev.cin.ambypro.ai`, methods `PUT, GET, HEAD, OPTIONS`, allowed headers `x-ms-blob-type, content-type`, max age `3600`.
- [ ] Keep at least **1 replica** running — the transcription worker lives inside the pod. Scaling to zero stops job processing.
- [ ] Give the pod enough CPU/memory for ffmpeg plus vision calls; the dev resource limits were reduced and long videos may be OOM-killed.

## Sync and push (only when explicitly asked)

Work happens in `youtube-clone`. To ship:

```bash
SRC=/home/shanks/Videos/youtube-clone
DST=/home/shanks/Pictures/amby-ai-video-service
rsync -a --exclude='node_modules' --exclude='.next' "$SRC/src/" "$DST/src/"
for f in Dockerfile docker-entrypoint.sh docs/API.md package.json package-lock.json \
         .env.docker.example vitest.config.ts prisma/schema.prisma; do
  command cp -f "$SRC/$f" "$DST/$f"
done
rsync -a "$SRC/prisma/migrations/" "$DST/prisma/migrations/"
rsync -a "$SRC/tests/" "$DST/tests/"
```

Note: `cp` is aliased to `cp -i` in this shell and silently declines overwrites when
there is no tty. Always use `command cp -f`.

Then, in `$DST`: verify `git status`, confirm no real `.env` file is staged, commit,
and push to `dev` only when the user asks.
