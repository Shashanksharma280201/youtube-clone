# Ingest API + Azure deployment fixes — design

Date: 2026-07-09
Status: approved (design), pending implementation plan

## Problem

Two things, one release.

1. **Ingest API.** Another service (the ingestion pipeline) already writes a video
   file into our Azure Blob container. It needs to tell this service "process this
   file, and here is my ID for it". Afterwards it must be able to fetch the
   transcript, thumbnails, and Machine Guide using **its own** ID.

2. **The Azure deployment is not actually working end to end.** The UI loads, but
   that only exercises a single database read. The transcription pipeline and the
   thumbnail URLs are both broken on Azure. These are prerequisites, not extras —
   without them the Ingest API accepts a video and silently never processes it.

## Goals

- One new endpoint, `POST /api/v1/ingest`, that registers an existing blob and
  starts the pipeline.
- Callers can address a video by **their** ID everywhere the existing API takes an ID.
- Thumbnails returned by the API are actually fetchable from a private container.
- The pipeline actually runs on AKS.

## Non-goals

- No webhook/callback delivery. The caller polls the existing endpoints.
- No browser upload changes. Ingest is by reference; the file is already in storage.
- No new read endpoints. Existing routes learn to accept either ID.

## Design

### 1. `POST /api/v1/ingest`

Request:

```json
{ "videoId": "ext-123", "videoName": "videos/pump-repair.mp4",
  "title": "Pump repair", "description": "optional" }
```

- `videoName` is a blob **key inside the container we already use**
  (`AZURE_STORAGE_CONTAINER`). No new credentials, no second container.
- We verify the blob exists before accepting. Missing blob → `404`.
- We create the `Video` row with `externalId = videoId`,
  `blobUrl = storage.s3Url(videoName)`, `transcriptStatus = PENDING`,
  then start the same durable workflow that `POST /videos/{id}/transcribe` starts.
- Responds `202 Accepted` with `{ id, externalId, status: "PROCESSING" }`.

Idempotency: if `externalId` already exists we do **not** create a duplicate. We
return the existing record (`200`) with its current status. Re-processing is not
in scope for this change.

`title` defaults to `videoName` if omitted.

### 2. Schema: `externalId`

```prisma
model Video {
  id         String  @id @default(cuid())
  externalId String? @unique
  ...
}
```

Our cuid stays the primary key. The caller's ID is a separate, unique, nullable
column, so existing rows are unaffected and a caller cannot collide with our keys.

This is a real schema change and is the moment to stop using `prisma db push`
(see section 5).

### 3. Resolve-either lookup

A shared helper, used by every existing `/videos/[id]` route
(`GET`, `DELETE`, `transcript`, `transcribe`, `search-chapter`):

```ts
// Match our cuid first, then fall back to the caller's externalId.
export async function resolveVideo(idOrExternalId: string) {
  return prisma.video.findFirst({
    where: { OR: [{ id: idOrExternalId }, { externalId: idOrExternalId }] },
  })
}
```

`GET /api/v1/videos/ext-123` and `GET /api/v1/videos/<cuid>` both work. No new
routes, no duplicated read surface.

### 4. Storage: `exists()` and signed thumbnails

**`exists(key)`** is added to the storage facade so ingest can 404 on a missing
blob. Azure: `blockBlobClient.exists()`. S3: `HeadObjectCommand`.

**Signed thumbnails.** Today `uploadToS3()` returns `s3Url(key)` — a plain,
unsigned URL. Our Azure container is private, so those URLs return `403`. The
stored value stays a plain, stable key-based URL (it is the canonical record);
we sign **on read**.

When serializing a video for the API we replace `thumbnailUrl` and each
`topicSegments[].thumbnailPath` with a short-lived SAS download URL
(`getPresignedDownloadUrl`, 6h). This applies to `GET /videos/{id}` and the
`GET /videos` list.

Trade-off: returned thumbnail URLs expire. For an internal consumer that renders
or copies them promptly this is fine. If expiry ever becomes a problem, the
fallback is a proxy route that streams bytes through the pod — deliberately not
built now.

### 5. Azure prerequisites

These must land with the change, not after it.

- **Workflow engine env** (currently missing — this is why nothing would process):
  - `WORKFLOW_TARGET_WORLD=@workflow/world-postgres`
  - `WORKFLOW_POSTGRES_URL=postgresql://…/workflow-dev-cin?sslmode=require`
  - Requires a **second database** on the existing Postgres server.
- **Migrations instead of `db push`.** `docker-entrypoint.sh` currently runs
  `prisma db push` on every pod start. `db push` can drop columns on drift, has no
  history, and races across replicas. Replace with `prisma migrate deploy`, run
  once as a Kubernetes Job / init-container. Keep `db push` for local dev behind a
  flag.
- **`SERVICE_API_KEY` must be set.** If unset, the middleware leaves the API open,
  and the in-cluster address has no TLS and no VPN gate.
- **Storage CORS** is needed only for the browser upload page, not for ingest
  (ingest is by reference — no browser PUT). Still worth setting for the UI.

### 6. Data flow

```
ingestion service          this service                 azure blob / postgres
       |                        |                                |
  writes blob ------------------------------------------------> |
       |                        |                                |
  POST /api/v1/ingest --------> | storage.exists(videoName) ---> |
       |                        | create Video(externalId,…) --> |
       |  <---- 202 PROCESSING  | start durable workflow         |
       |                        |                                |
       |                        | (pipeline: whisper -> chapters |
       |                        |  -> thumbnails -> guide)       |
       |                        |                                |
  GET .../transcript --------->| resolveVideo() -> status       |
       |  <---- DONE            |                                |
  GET .../videos/ext-123 ----->| resolveVideo() + sign thumbs   |
       |  <---- full payload    |                                |
```

### 7. Error handling

| Case | Response |
|---|---|
| missing `videoId` or `videoName` | `400 {"error":"videoId and videoName are required"}` |
| blob not found in container | `404 {"error":"Video file not found in storage"}` |
| `externalId` already known | `200` existing record + current status (idempotent) |
| no / bad API key | `401 {"error":"Unauthorized"}` |
| workflow start fails | row marked `FAILED`; `500` |

The pipeline itself already marks `transcriptStatus = FAILED` and is retried by
the durable workflow, so ingest does not need its own retry logic.

### 8. Testing

- Unit: `resolveVideo()` matches by cuid and by externalId; `exists()` true/false
  on both backends.
- Integration (local Docker, S3 backend): `POST /ingest` for a blob that exists →
  `202`; for one that does not → `404`; twice with the same `externalId` → one row.
- End to end: ingest a real video, poll `GET /videos/{externalId}/transcript` until
  `DONE`, then `GET /videos/{externalId}` and assert transcript, non-empty
  `topicSegments`, and `domainData` are present, and that a returned thumbnail URL
  actually fetches `200`.

The last assertion is the one that catches the private-container bug; a test that
only checks the URL is a string would pass while the image 403s.

## Repository note (must be step 0)

`youtube-clone` (local dev copy) does **not** contain the teammate's
`src/lib/prisma.ts` fix or the updated `docker-entrypoint.sh`. Those exist only on
the `dev` branch of `amby-ai-video-service`. The two repos are not git-linked;
files are copied between them.

Before any work: copy those two files **down** into `youtube-clone`. Otherwise the
next sync silently reverts the fix that unblocked the Azure deployment.

## Risks

- Signed thumbnail URLs expire (6h). Accepted; documented for consumers.
- `resolveVideo` does an `OR` lookup. A caller-supplied ID that happens to equal a
  cuid would match ours first. Practically impossible and harmless.
- Switching to `migrate deploy` requires generating an initial migration from the
  current schema. On dev this is safe; on any DB with data, verify the baseline.
