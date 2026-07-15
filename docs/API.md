# Amby AI Video Service — API Reference

HTTP API for processing videos into a transcript, chapters, thumbnails, and a structured Machine Guide. Intended to be consumed by another service.

- **Content-Type:** `application/json` (except the presigned upload `PUT`, which is the raw file)
- **Timestamps** are ISO-8601. **`start`/`end`** are **seconds** (numbers).
- Versioned under **`/api/v1/`**. Pin to `v1`; breaking changes ship as `/api/v2/`.

## Authentication

Single service API key — no user accounts.

```bash
curl -H "Authorization: Bearer $SERVICE_API_KEY" https://<host>/api/v1/videos
```

A `/api/v1/*` request is allowed if it carries the key **or** is same-origin (so the built-in UI works). Otherwise `401 { "error": "Unauthorized" }`. `SERVICE_API_KEY` may be a comma-separated list for rotation; if unset, the gate is **open** (dev only). `GET /api/health` is never gated.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/v1/videoExtraction` | **Main endpoint.** Process a video by URL, get chunks back |
| `POST` | `/api/v1/ingest` | Register a video already in storage (simpler alternative) |
| `POST` | `/api/v1/upload` | Get a presigned URL to upload a file |
| `POST` | `/api/v1/videos/{id}/transcribe` | Start the pipeline for an uploaded video |
| `GET` | `/api/v1/videos/{id}/transcript` | Poll status; read transcript + chapters |
| `GET` | `/api/v1/videos/{id}` | Full record incl. `domainData` (Machine Guide) |
| `GET` | `/api/v1/videos` | Paginated feed (`limit`, `cursor`, `q`) |
| `POST` | `/api/v1/videos/{id}/search-chapter` | Semantic chapter search (any language) |
| `PATCH` | `/api/v1/videos/{id}/view` | Increment view counter |
| `DELETE` | `/api/v1/videos/{id}` | Delete video + blob + thumbnails + row |
| `GET` | `/api/health` | Liveness probe (open) |

`{id}` accepts either our generated id or the `resourceId`/`videoId` you supplied.

---

## POST `/api/v1/videoExtraction`

Give it a video already in storage; get back the video split into chunks (chapters), each with transcript, a one-line summary, tools, a signed thumbnail, and the machine guide.

**Synchronous — one call in, chunks out.** The request is held open while the video is
processed (typically 1–4 minutes) and returns `200` with the full result. You do not
need to poll.

**Idempotent on `resourceId`.** A repeat call never reprocesses:

- already finished → `200` with the same chunks, immediately
- still running (another caller got there first) → attaches to that run and waits for it
- a **new** `resourceId` → treated as a **new video** and processed from scratch. Generate
  the id **once**, before the first call, and reuse it. Do not generate a fresh id per retry.

If the connection drops, processing continues regardless — it runs outside the request and
survives a pod restart. Call again with the same `resourceId` to collect the result.

**Request** — all four fields required. `videoURL` may point at **any container in the configured storage account**; any other host is rejected with `400`.

```json
{
  "machineId": "haas-01",
  "resourceId": "your-unique-id-123",
  "tenantId": "tenant-abc",
  "videoURL": "https://<account>.blob.core.windows.net/videosvc/videos/solenoid.mp4"
}
```

**When done** (`200`) — one chunk shown; a 14-min video returns ~40:

```json
{
  "resourceId": "your-unique-id-123",
  "machineId": "haas-01",
  "tenantId": "tenant-abc",
  "status": "DONE",
  "title": "solenoid.mp4",
  "description": "",
  "createdAt": "2026-07-10T20:45:44.896Z",
  "chunkCount": 40,
  "chunks": [
    {
      "chunkId": "cmrfdvd3d0001zhyvgx9jomda-3",
      "start": 49.6,
      "end": 98.04,
      "mainTag": "air supply check",
      "subTag": "Checking supply pressure",
      "transcript": "The first thing you want to confirm is that you actually have adequate air pressure ...",
      "summarizedText": "The speaker checks that the machine has adequate air pressure during the tool change.",
      "tools": ["pressure gauge"],
      "thumbnailUrl": "https://<account>.blob.core.windows.net/videosvc/thumbnails/<id>/segment-3.jpg?sv=...&sig=...",
      "blobUrl": "https://<account>.blob.core.windows.net/videosvc/videos/solenoid.mp4?sv=...&sig=...",
      "videoSummary": "This video addresses common issues with the pneumatic system in Haas machines.",
      "domainMetaData": {
        "machine": "Haas machine pneumatic system",
        "summary": "This video addresses common issues with the pneumatic system in Haas machines.",
        "overview": "The pneumatic system uses compressed air to power devices. Solenoids control the airflow and need a clean, dry air source.",
        "machineIntro": [
          { "title": "Pneumatic System", "detail": "Uses compressed air to power devices; solenoids control the flow.", "steps": [], "start": 21 }
        ]
      }
    }
  ]
}
```

**Chunk fields**

| Field | Meaning |
|---|---|
| `chunkId` | `<video id>-<index>`, unique per chunk |
| `start` / `end` | chunk boundaries, seconds |
| `mainTag` / `subTag` | the phase (e.g. `diagnosis`) and a 2-5 word label |
| `transcript` | the spoken words in this chunk |
| `summarizedText` | one sentence describing what happens |
| `tools` | physical tools named in this chunk (may be empty) |
| `thumbnailUrl` | signed chapter thumbnail, ~6h (`null` if none) |
| `blobUrl` | signed source-video URL, ~6h |
| `videoSummary`, `domainMetaData` | video-level; **repeated in every chunk** |

**Status codes**

| Code | Meaning |
|---|---|
| `200` | Done — full body above. **The normal outcome.** |
| `202` | Still running after the 25-min cap. Body has `chunks: []`. Rare — see below |
| `409` | Failed → `{ resourceId, status: "FAILED", error }` |
| `400` | Missing field, or `videoURL` host is not the configured storage account |
| `404` | Blob not found in that container |
| `401` | Missing/invalid key |

> **Do not treat any 2xx as success.** `202` is a 2xx, so a bare `if (response.ok)`
> accepts it — and its body is `{"chunks": [], "status": "PROCESSING"}`. A client that
> does this records "success, zero chunks" and passes an empty result downstream.
> **Check for `200` specifically**, or check `status === "DONE"`.
>
> `202` now only happens if a video is still running after 25 minutes (the wait is capped
> below the ingress's 30-minute timeout). If you get one, poll with the same `resourceId`
> until you get `200`.

---

## Other endpoints

### POST `/api/v1/ingest`
Simpler alternative to `videoExtraction`: register a blob already in the **default** container and start the pipeline.
- **Request:** `{ "videoId": "ext-123", "videoName": "videos/pump.mp4", "title"?, "description"? }`
- **202** → `{ id, externalId, status: "PROCESSING", runId }` · **200** if already ingested (idempotent)
- **400** missing field · **404** blob not found · **401** · **500** failed to start
- Then poll `GET /api/v1/videos/{videoId}/transcript` → `GET /api/v1/videos/{videoId}`

### POST `/api/v1/upload`
Get a presigned URL; the file bytes never pass through this service.
- **Request:** `{ "title", "description"?, "filename", "contentType" }`
- **201** → `{ id, uploadUrl, uploadHeaders }`
- Then `PUT` the raw file to `uploadUrl` with `Content-Type` **plus every header in `uploadHeaders`** (`{ "x-ms-blob-type": "BlockBlob" }` for Azure, `{}` for S3). The video is then `PENDING`.
- **400** title/filename required · **401** · **500**

### POST `/api/v1/videos/{id}/transcribe`
Start the pipeline for an uploaded video. Idempotent (only starts if `NONE|PENDING|FAILED`).
- **200** → `{ status: "PROCESSING", runId }` or `{ status }` if already running/done · **404** · **401**

### GET `/api/v1/videos/{id}/transcript`
Poll status and read transcript + chapters.
- **200** → `{ status, transcript, segments: TranscriptSegment[]|null, topicSegments: TopicSegment[]|null }`
- `status`: `NONE | PENDING | PROCESSING | DONE | FAILED`. On `FAILED`, `transcript` holds the message.
- **404** not found

### GET `/api/v1/videos/{id}`
Full record including the Machine Guide (`domainData`). Read this after `DONE`.
- **200** → `Video` (below) · **404** not found

### GET `/api/v1/videos`
- **Query:** `limit` (default 12, max 48), `cursor`, `q` (title contains)
- **200** → `{ items: [{ id, title, blobUrl, views, createdAt, thumbnailUrl }], nextCursor }`

### POST `/api/v1/videos/{id}/search-chapter`
Semantic chapter search; translates the query first, so any language works.
- **Request:** `{ "query": "string" }`
- **200** → `{ found: true, results: [{ index, segment: TopicSegment }] }` or `{ found: false }`
- **404** · **500**

### PATCH `/api/v1/videos/{id}/view` → **200** `{ ok: true }`

### DELETE `/api/v1/videos/{id}`
Deletes the video, its blob, audio chunks, thumbnails, and row.
- **200** → `{ deleted: true }` · **404** · **401**

### GET `/api/health` (open)
- **200** → `{ status: "ok", ts: "..." }`

---

## Data models

```ts
Video = {
  id: string
  externalId: string | null        // your resourceId / videoId
  machineId: string | null
  tenantId: string | null
  title: string
  description: string
  blobUrl: string                  // storage URL of the source video
  createdAt: string                // ISO
  views: number
  thumbnailUrl: string | null      // first chapter thumbnail (signed)
  transcriptStatus: "NONE" | "PENDING" | "PROCESSING" | "DONE" | "FAILED"
  transcript: string | null
  transcriptSegments: TranscriptSegment[] | null
  topicSegments: TopicSegment[] | null      // the chapters
  domainData: DomainData | null             // the Machine Guide
}

TranscriptSegment = { id, start, end, text, mainTag, subTag }
TopicSegment      = { mainTag, subTag, start, end, thumbnailPath: string|null,
                      summarizedText?: string, tools?: string[] }
```

While processing, the heavy fields (`transcript`, `transcriptSegments`, `topicSegments`, `domainData`) are `null`.

### `DomainData` — the Machine Guide

Structured, self-service maintenance guide. Empty sections are `[]` / `""`.

```ts
DomainData = {
  machine: string                  // e.g. "Lubrication System"
  summary: string
  overview: string                 // narrative "how this machine works"
  machineIntro: GuideItem[]
  preventiveMaintenance: Procedure[]
  errorCodes: DebugItem[]
  troubleshooting: DebugItem[]
  safety: GuideItem[]
  tools: string[]
  parts: string[]
  specs: { label: string, value: string, start: number|null }[]
  glossary: { term: string, definition: string }[]
}

// A guided fix, told as a teaching story
DebugItem = {
  code: string                     // error code, or "" for a plain problem
  title: string
  symptom: string                  // one line: what you notice
  story: string                    // teaching narrative: part, cause, how to diagnose
  fix: Step[]                      // ordered resolution steps
  verify: string
  ifNotResolved: string
  tools: string[]
  difficulty: "Easy" | "Medium" | "Hard" | ""
  time: string                     // e.g. "~30 min"
  start: number | null             // seconds into the video
}

Procedure = { title, detail, steps: Step[], tools: string[],
              difficulty: string, time: string, start: number|null }

GuideItem = { title, detail, steps: string[], start: number|null }

Step = {
  text: string                     // the action, in plain words
  expected: string                 // what you should see after (or "")
  visual: string                   // vision-derived "where it is on screen" (or "")
  start: number | null             // jump to this exact moment
}
```

---

## Notes for integrators

- **Signed URLs expire.** `thumbnailUrl`, `blobUrl`, and `topicSegments[].thumbnailPath` are valid ~6 hours because the storage container is private. Fetch them promptly; re-request the video for fresh ones. Do not persist them.
- **Long jobs.** `videoExtraction` holds the request open until the video is done (up to 25 min), so set your client's read timeout to at least that. A very long video may exhaust the cap and return `202` — then poll with the same `resourceId` until `200`.
- **Reuse the `resourceId`.** It is the idempotency key. A fresh id on each retry starts a **new** run from scratch, re-paying for transcription, vision and the guide — and never converges.
- **Uploads** go straight to the object store and carry **no** API key (the presigned URL is the credential).
- **Errors** are always `{ "error": "message" }` with the status codes listed above.
