# POST /api/v1/videoExtraction — design

Date: 2026-07-10
Status: approved (design), pending implementation plan

## Problem

A sibling service needs one endpoint it can call with a video URL and, once processing finishes,
receive everything we extracted — chapters ("chunks") with transcript, thumbnail, tools, and the
machine guide.

The requested response body describes a **fully processed** video. Our pipeline takes minutes to
hours (download, Whisper, chapter tagging, frame vision, guide generation), so a request cannot stay
open until it completes.

Two further gaps:

- The caller's videos live in **per-tenant containers** (`bpl-*`, `manipal-hospitals-*`,
  `test-india-*`), not in our `videosvc` container. Our storage layer only reads `videosvc`.
- Two per-chunk fields do not exist yet: a one-sentence `summarizedText`, and the `tools` mentioned
  in that specific chunk. We have `subTag` (a deliberate 2-5 word label) and a video-level `tools`
  list, but neither is what the contract asks for.

## Goals

- `POST /api/v1/videoExtraction` matching the caller's request and response shape.
- Read a video from any container in our own storage account.
- Produce `summarizedText` and per-chunk `tools`.

## Non-goals

- No webhook. The caller polls the same endpoint.
- No removal of `POST /api/v1/ingest`. It stays as the simpler internal entry point.
- No reprocessing. A known `resourceId` returns its current state.

## Design

### 1. The endpoint

`POST /api/v1/videoExtraction`, idempotent, gated by the API-key middleware like every `/api/v1/*`
route.

Request:

```json
{ "machineId": "m-1", "resourceId": "r-1", "tenantId": "t-1",
  "videoURL": "https://stdatadevcentralindia.blob.core.windows.net/bpl-x/machine/pump.mp4" }
```

All four fields are required and must be non-empty strings.

Behaviour, driven by `transcriptStatus`:

| State | HTTP | Body |
|---|---|---|
| First call — row created, pipeline started | `202` | `{ resourceId, machineId, tenantId, status: "PROCESSING", chunks: [], chunkCount: 0 }` |
| Still running | `202` | same as above |
| Finished | `200` | the full body (below) |
| Pipeline failed | `409` | `{ resourceId, status: "FAILED", error: "<reason>" }` |

`status` is present on every response. It is additive to the caller's sample and harmless.

Idempotency keys on `resourceId`. A repeat call never creates a second row and never restarts the
pipeline.

Success body:

```json
{
  "resourceId": "r-1",
  "machineId": "m-1",
  "tenantId": "t-1",
  "status": "DONE",
  "title": "KRC Demo - Lube Pump 12.16.24",
  "description": "...",
  "createdAt": "2026-07-06T14:22:10.000Z",
  "chunks": [ /* see below */ ],
  "chunkCount": 100
}
```

### 2. Identity and new columns

`resourceId` reuses the existing unique `externalId` column. No new lookup path; every
`/api/v1/videos/{id}` route already resolves by it.

Two new nullable columns on `Video`, stored and echoed back:

```prisma
machineId String?
tenantId  String?
```

### 3. Reading the video URL

`parseStorageUrl(url)` turns a URL into `{ container, key }`.

- The host **must** match the active storage account (`AZURE_STORAGE_ACCOUNT`, or the S3 bucket host
  when S3 is the backend). Any other host → `400`. This is deliberate: without it the service would
  fetch arbitrary URLs on request, which is server-side request forgery from inside the cluster.
- The first path segment is the container, the remainder is the blob key.

The storage facade gains an optional container argument on the three read paths:

```ts
exists(key: string, container?: string): Promise<boolean>
getPresignedDownloadUrl(key: string, expiresIn?: number, container?: string): Promise<string>
downloadFromS3(key: string, localPath: string, container?: string): Promise<void>
```

Omitted means the default container, so every existing caller is unaffected. The Azure account key
already grants access to every container in the account; no new permissions are needed.

`blobUrl` on the `Video` row keeps storing the full URL. The pipeline stops using `s3Key(blobUrl)` and
uses `parseStorageUrl(blobUrl)` instead, so it can read from the tenant container it was given.

### 4. The new pipeline step

After chapters and the guide exist, one batched `gpt-4o-mini` call per group of chunks returns, for
each chunk, a one-sentence summary and the tools named in it:

```ts
// input:  [{ i, mainTag, subTag, transcript }]
// output: [{ i, summarizedText, tools }]
```

Results are persisted into `topicSegments`, so the endpoint only ever reads the database. This is the
same shape as the existing tagging call, one extra field each.

A chunk with no speech gets `summarizedText: ""` and `tools: []`. A failed call degrades to those
defaults rather than failing the video — the guide and chapters are still worth having.

### 5. Chunk serialization

One chunk per `topicSegment`, in order:

| Field | Source |
|---|---|
| `chunkId` | `` `${video.id}-${index}` `` |
| `start`, `end`, `mainTag`, `subTag` | the segment, as-is |
| `transcript` | `transcriptSegments` whose `start` falls in `[start, end)`, joined |
| `summarizedText`, `tools` | the new pipeline step |
| `thumbnailUrl` | segment's `thumbnailPath`, **signed** (6h) |
| `blobUrl` | the source video URL, **signed** (6h) |
| `videoSummary` | `domainData.summary` |
| `domainMetaData` | `{ machine, summary, overview, machineIntro }` from `domainData` |

`chunkCount` is `chunks.length`.

Both URLs are signed because the container is private (`allowBlobPublicAccess: false`); unsigned URLs
return `403`.

**Known cost, accepted.** `videoSummary` and `domainMetaData` are video-level and are repeated in
every chunk, matching the caller's sample. A 100-chunk video repeats the full `overview` and
`machineIntro` 100 times — plausibly 1-3 MB of duplicated JSON on an endpoint designed to be polled.
Gzip softens it. If response size becomes a problem, move both to the top level; that is a one-line
change on our side and a one-level change on the caller's.

### 6. Data flow

```
caller                       this service                    storage / postgres
  |                               |                                  |
  POST /videoExtraction --------> | parseStorageUrl(videoURL)        |
  {machineId,resourceId,          | reject foreign host -> 400       |
   tenantId,videoURL}             | exists(key, container) ------->  |
  <---- 202 PROCESSING            | create Video(externalId=...)     |
                                  | start durable workflow           |
                                  |                                  |
                                  | whisper -> chapters -> vision    |
                                  | -> guide -> chunk summaries      |
                                  |                                  |
  POST (same body) -------------> | status PROCESSING -> 202         |
  POST (same body) -------------> | status DONE -> serialize chunks  |
  <---- 200 full body             |   + sign thumbnail & blob URLs   |
```

### 7. Error handling

| Case | Response |
|---|---|
| Any of the four fields missing or blank | `400 { "error": "machineId, resourceId, tenantId and videoURL are required" }` |
| `videoURL` not a URL, or host is not our storage account | `400 { "error": "videoURL must point at the configured storage account" }` |
| Blob not found in that container | `404 { "error": "Video file not found in storage" }` |
| `resourceId` already known | current state, `202` or `200` or `409`. Never reprocesses |
| Workflow start fails | row marked `FAILED`, `500 { "error": "Failed to start processing" }` |
| Missing/invalid API key | `401` (middleware) |

### 8. Testing

- Unit: `parseStorageUrl` — valid Azure URL, valid S3 URL, foreign host rejected, URL with no
  container rejected.
- Unit: chunk serializer — transcript sliced by timestamp; `chunkId` format; empty `domainData`
  yields empty `domainMetaData` rather than throwing; a segment with `thumbnailPath: null` yields
  `thumbnailUrl: null`.
- Unit: the summary step's parser tolerates a malformed model response and falls back to
  `{ summarizedText: "", tools: [] }`.
- Integration (Docker, S3 backend): `400` on missing field, `400` on foreign host, `404` on missing
  blob, `202` on first call, `202` on repeat while processing, exactly one row created.
- End to end: ingest a real video, poll to `DONE`, then assert `chunkCount > 0`, every chunk has a
  non-empty `chunkId`, and a returned `thumbnailUrl` fetches **HTTP 200**.

The last assertion is the one that matters: a test checking only that the URL is a non-empty string
would pass while every image 403s.

## Risks

- Signed URLs expire after 6 hours. Documented for the caller.
- Repeating `domainMetaData` per chunk inflates the payload (see section 5).
- Cross-container reads widen the blast radius of the storage account key. The host check in
  `parseStorageUrl` is the control that keeps it to our own account.
- The chunk-summary step adds one cheap model call per batch and a small amount of pipeline time.
