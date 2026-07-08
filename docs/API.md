# Amby AI Video Service — API Reference

HTTP API for uploading videos, running the AI transcription + Machine-Guide pipeline, and reading the structured results. Intended for another workflow/service to consume this project as a service.

- **Base URL (local Docker):** `http://localhost:3000`
- **Base URL (prod):** your deployed origin (e.g. `https://<app>.azurecontainerapps.io`)
- **Content-Type:** `application/json` for all request bodies (except the S3 upload PUT, which is the raw file).
- **All timestamps** are ISO-8601 strings; all **`start`/`end`** fields in transcript/guide data are **seconds** (numbers).

---

## Versioning

The data API is versioned under **`/api/v1/`**. Breaking changes will ship as a new prefix (`/api/v2/`) so existing integrations keep working — pin to `v1`.

Two endpoints are **unversioned by convention** (framework/infra): `GET /api/health` (probe) and `/api/auth/*` (NextAuth). These are stable and not part of the versioned data contract.

---

## Authentication — read this first

The app currently authenticates **users** with NextAuth (cookie/session based). There is **no machine-to-machine API key yet**. So for a service integration:

| Endpoint group | Auth today |
|---|---|
| `GET` reads (videos, transcript, health, search) | **Public** — callable directly |
| Writes (`upload`, `transcribe`, `delete`, `like`) | **Session cookie** required (from a logged-in user) |

**Recommended for service-to-service:** add a shared **API key / bearer token** layer (a small middleware that accepts `Authorization: Bearer <API_KEY>` on the write endpoints and maps to a service user). This is a planned addition for the Azure deployment — until then, a consuming service must either (a) only use the public read endpoints, or (b) authenticate as a user and forward the `next-auth.session-token` cookie.

Endpoints below are marked **[public]**, **[session]**, or **[session + owner]**.

---

## Typical integration flow

```
1. POST /api/v1/upload                 -> { id, uploadUrl }        (create video row + get S3 URL)
2. PUT  <uploadUrl>  (raw file)     -> 200                       (upload the video to S3)
3. POST /api/v1/videos/{id}/transcribe -> { status, runId }         (kick off the AI pipeline)
4. GET  /api/v1/videos/{id}/transcript -> { status: PROCESSING }    (poll every few seconds)
   ... repeat until status = "DONE" (or "FAILED")
5. GET  /api/v1/videos/{id}            -> full video incl. domainData (the Machine Guide)
```

---

## Endpoints

### GET `/api/health` **[public]**
Liveness/readiness probe.
- **200** → `{ "status": "ok", "ts": "2026-07-08T12:00:00.000Z" }`

---

### POST `/api/v1/register` **[public]**
Create a user account.
- **Request**
  ```json
  { "name": "string", "email": "string", "password": "string (min 6 chars)" }
  ```
- **201** → `{ "id": "string", "name": "string", "email": "string", "createdAt": "ISO" }`
- **400** `{ "error": "All fields are required" | "Password must be at least 6 characters" }`
- **409** `{ "error": "Email already in use" }`

---

### `/api/auth/[...nextauth]` **[public]**
NextAuth handler (login, session, csrf). Credentials login is `POST /api/auth/callback/credentials` with `{ email, password }`; a successful login sets the `next-auth.session-token` cookie used by the `[session]` endpoints. Use the standard NextAuth client flow.

---

### POST `/api/v1/upload` **[session]**
Create a video record and get a **presigned S3 URL** to upload the file to. The server never receives the file bytes.
- **Request**
  ```json
  { "title": "string (required)", "description": "string (optional)",
    "filename": "string (required)", "contentType": "string (e.g. video/mp4)" }
  ```
- **201** → `{ "id": "videoId", "uploadUrl": "https://<bucket>.s3...(presigned PUT)" }`
- **400** `{ "error": "Title and filename are required" }`
- **401** `{ "error": "Unauthorized" }`
- **500** `{ "error": "Session expired — please sign out and sign in again" | "Upload failed" }`
- **Next step:** `PUT` the raw file bytes to `uploadUrl` with header `Content-Type: <same contentType>`. On success the video exists with `transcriptStatus: "PENDING"`.

---

### POST `/api/v1/videos/{id}/transcribe` **[session + owner]**
Start the durable AI pipeline (audio → Groq transcript → chapters → silent-frame vision → Machine Guide). Idempotent: only starts if the video is `NONE|PENDING|FAILED`.
- **Request:** none.
- **200 (started)** → `{ "status": "PROCESSING", "runId": "wrun_..." }`
- **200 (already running/done)** → `{ "status": "PROCESSING" | "DONE" }`
- **401** `{ "error": "Unauthorized" }` · **403** `{ "error": "Forbidden" }` · **404** `{ "error": "Not found" }`

---

### GET `/api/v1/videos/{id}/transcript` **[public]**
Poll pipeline status + read transcript/chapters. Use this to know when processing is done.
- **200** →
  ```json
  {
    "status": "NONE" | "PENDING" | "PROCESSING" | "DONE" | "FAILED",
    "transcript": "string | null",
    "segments": [ TranscriptSegment ] | null,
    "topicSegments": [ TopicSegment ] | null
  }
  ```
  When `status = "FAILED"`, `transcript` holds the failure message.
- **404** `{ "error": "Not found" }`

---

### GET `/api/v1/videos/{id}` **[public]**
Full video record — **including the structured Machine Guide (`domainData`)**. This is the main endpoint a consuming service reads after `status = DONE`.
- **200** → `Video` (see [Data models](#data-models)) with `user` and `_count` included.
- **404** `{ "error": "Not found" }`

---

### GET `/api/v1/videos` **[public]**
Paginated video feed (newest first), with optional title search.
- **Query params:** `limit` (default 12, max 48), `cursor` (video id to page after), `q` (title contains, case-insensitive).
- **200** →
  ```json
  {
    "items": [ { "id","title","blobUrl","views","createdAt","thumbnailUrl","user":{"name"} } ],
    "nextCursor": "string | null"
  }
  ```

---

### POST `/api/v1/videos/{id}/search-chapter` **[public]**
Semantic chapter search in any language (translates, then matches chapters). Returns matching chapters.
- **Request** `{ "query": "string" }`
- **200 (match)** → `{ "found": true, "results": [ { "index": number, "segment": TopicSegment } ] }`
- **200 (no match / irrelevant)** → `{ "found": false }`
- **404** `{ "error": "Not found" }` · **500** `{ "error": "Search failed" }`

---

### POST `/api/v1/videos/{id}/likes` **[session]**
Toggle the current user's like on a video.
- **Request:** none.
- **200** → `{ "liked": boolean, "count": number }`
- **401** `{ "error": "Please login or create an account" }`

---

### PATCH `/api/v1/videos/{id}/view` **[public]**
Increment the view counter (best-effort).
- **200** → `{ "ok": true }`

---

### DELETE `/api/v1/videos/{id}` **[session + owner]**
Permanently delete a video and everything derived from it (S3 blob, audio chunks, thumbnails, DB rows + likes/comments).
- **200** → `{ "deleted": true }`
- **401** `{ "error": "Unauthorized" }` · **403** `{ "error": "Forbidden" }` · **404** `{ "error": "Not found" }`

---

## Data models

### `Video` (from `GET /api/v1/videos/{id}`)
```ts
{
  id: string
  title: string
  description: string
  blobUrl: string                 // S3 URL of the source video
  userId: string
  createdAt: string               // ISO
  views: number
  thumbnailUrl: string | null     // first chapter thumbnail
  transcriptStatus: "NONE" | "PENDING" | "PROCESSING" | "DONE" | "FAILED"
  transcript: string | null       // full spoken transcript
  transcriptSegments: TranscriptSegment[] | null
  topicSegments: TopicSegment[] | null      // the chapters
  domainData: DomainData | null   // the Machine Guide (see below)
  user: { id: string, name: string }
  _count: { likes: number, comments: number }
}
```

#### Example — fully processed video (`transcriptStatus: "DONE"`)
Arrays are abbreviated to one representative entry each; real responses can contain many.
```json
{
  "id": "cmr4zvjav0001thok07kb2v9a",
  "title": "KRC Demo - Lube Pump 12.16.24",
  "description": "",
  "blobUrl": "https://video-testing.s3.ap-south-1.amazonaws.com/videos/1735900000-krc-lube-pump.mp4",
  "userId": "cmossu05o0006kkcb",
  "createdAt": "2026-07-06T14:22:10.000Z",
  "views": 3,
  "thumbnailUrl": "https://video-testing.s3.ap-south-1.amazonaws.com/thumbnails/cmr4zvjav.../segment-13400.jpg",
  "transcriptStatus": "DONE",
  "transcript": "Alright, today we're looking at the lube pump on the KRC ...",
  "transcriptSegments": [
    { "id": 0, "start": 12.4, "end": 18.9, "text": "The lube system feeds oil to the bearings.", "mainTag": "intro", "subTag": "lube system overview" }
  ],
  "topicSegments": [
    { "mainTag": "diagnosis", "subTag": "checking the float switch", "start": 134.0, "end": 172.5, "thumbnailPath": "https://video-testing.s3.ap-south-1.amazonaws.com/thumbnails/cmr4zvjav.../segment-13400.jpg" }
  ],
  "domainData": {
    "machine": "Lubrication System",
    "summary": "This video covers diagnosing a low-lube-flow alarm on the KRC machine and getting the pump running again.",
    "overview": "The lubrication system keeps the machine's moving parts oiled to reduce friction and wear. It has a lube tank, a pump, and sensors like a float switch that watches the oil level and tells the controller when flow is low.",
    "machineIntro": [
      { "title": "Float switch", "detail": "A sensor in the lube tank that detects the oil level and signals the control system.", "steps": [], "start": 88.0 }
    ],
    "preventiveMaintenance": [
      { "title": "Keep the lube tank topped up", "detail": "Low oil is the most common cause of a false low-flow alarm; check it on a schedule.", "steps": [ { "text": "Open the tank cap and check the level against the sight glass.", "expected": "Oil above the low mark, not in the red zone.", "visual": "the clear sight glass on the front of the lube tank", "start": 94.0 } ], "tools": [], "difficulty": "Easy", "time": "~5 min", "start": 94.0 }
    ],
    "errorCodes": [],
    "troubleshooting": [
      {
        "code": "",
        "title": "The machine shows a low lube flow alarm",
        "symptom": "A low lube flow alarm is displayed and the pump does not activate.",
        "story": "The low-lube-flow alarm means the lubrication system isn't delivering enough oil. The float switch - the sensor that reads the oil level - tells the controller how much oil is present. If the oil is genuinely low, or the switch is faulty or mis-wired, it trips this alarm. Rule out the simple cause (oil level) before suspecting the switch or its wiring.",
        "fix": [
          { "text": "Check the oil level in the lube tank.", "expected": "Oil level is adequate, not in the red zone.", "visual": "the sight glass on the front of the lube tank", "start": 94.0 },
          { "text": "Use a multimeter across the float switch terminals to check voltage and resistance.", "expected": "Voltage present; resistance changes as the float moves.", "visual": "the two terminals on the side of the float switch housing", "start": 1285.0 },
          { "text": "If the switch is confirmed faulty, jumper its connections to bypass it temporarily.", "expected": "The alarm clears, allowing the machine to run.", "visual": "the wiring connector at the control panel", "start": 1631.0 }
        ],
        "verify": "No low-lube alarm is shown and the machine operates normally.",
        "ifNotResolved": "Check for other electrical faults upstream or consult the machine manual for further diagnostics.",
        "tools": ["Multimeter", "Screwdriver"],
        "difficulty": "Medium",
        "time": "~30 min",
        "start": 134.0
      }
    ],
    "safety": [
      { "title": "Lock out power before probing wiring", "detail": "Live terminals can shock you and damage the controller.", "steps": ["Isolate and lock out the machine's power.", "Verify zero voltage before touching terminals."], "start": 1270.0 }
    ],
    "tools": ["Multimeter", "Screwdriver"],
    "parts": ["Float switch"],
    "specs": [
      { "label": "Lube tank level", "value": "above the low/red mark", "start": 94.0 }
    ],
    "glossary": [
      { "term": "Float switch", "definition": "A sensor that rises and falls with the oil level and signals when it's too low." },
      { "term": "Jumper", "definition": "A short wire used to bypass a component to test whether it is the fault." }
    ]
  },
  "user": { "id": "cmossu05o0006kkcb", "name": "shanks" },
  "_count": { "likes": 0, "comments": 0 }
}
```

#### Example — still processing (`transcriptStatus: "PROCESSING"`)
Before the pipeline finishes, the heavy fields are `null`. Poll until `transcriptStatus` is `DONE`.
```json
{
  "id": "cmr9abc0001xyz",
  "title": "New Upload",
  "description": "",
  "blobUrl": "https://video-testing.s3.ap-south-1.amazonaws.com/videos/1736330000-new.mp4",
  "userId": "cmossu05o0006kkcb",
  "createdAt": "2026-07-08T09:00:00.000Z",
  "views": 0,
  "thumbnailUrl": null,
  "transcriptStatus": "PROCESSING",
  "transcript": null,
  "transcriptSegments": null,
  "topicSegments": null,
  "domainData": null,
  "user": { "id": "cmossu05o0006kkcb", "name": "shanks" },
  "_count": { "likes": 0, "comments": 0 }
}
```

### `TranscriptSegment`
```ts
{ id: number, start: number, end: number, text: string,
  mainTag: string, subTag: string }   // seconds
```

### `TopicSegment` (a chapter)
```ts
{ mainTag: string, subTag: string, start: number, end: number,
  thumbnailPath: string | null }      // thumbnailPath = S3 URL
```

### `DomainData` — the Machine Guide
The structured, self-service maintenance guide. Empty sections are `[]`/`""`.
```ts
{
  machine: string                 // e.g. "Lubrication System"
  summary: string
  overview: string                // narrative "how this machine works"
  machineIntro: GuideItem[]
  preventiveMaintenance: Procedure[]
  errorCodes: DebugItem[]
  troubleshooting: DebugItem[]
  safety: GuideItem[]
  tools: string[]
  parts: string[]
  specs: { label: string, value: string, start: number | null }[]
  glossary: { term: string, definition: string }[]
}

// A guided fix (troubleshooting / error code), told as a teaching story:
DebugItem = {
  code: string                    // error code, or "" for a plain problem
  title: string
  symptom: string                 // one-line: what you notice
  story: string                   // teaching narrative (part + cause + how to diagnose)
  fix: Step[]                     // ordered resolution steps
  verify: string                  // how to confirm it's fixed
  ifNotResolved: string
  tools: string[]
  difficulty: "Easy" | "Medium" | "Hard" | ""
  time: string                    // e.g. "~30 min"
  start: number | null            // seconds into the video
}

Procedure = {                      // preventive maintenance
  title: string, detail: string, steps: Step[],
  tools: string[], difficulty: string, time: string, start: number | null
}

GuideItem = {                      // machine intro / safety notes
  title: string, detail: string, steps: string[], start: number | null
}

Step = {
  text: string                    // the action, plain words
  expected: string                // expected result after this step (or "")
  visual: string                  // vision-derived "where it is on screen" note (or "")
  start: number | null            // jump to this exact moment
}
```

---

## Status lifecycle

`PENDING` → `PROCESSING` → `DONE` (or `FAILED`). Poll `GET /api/v1/videos/{id}/transcript` until terminal, then read the full result from `GET /api/v1/videos/{id}`.

## Notes for integrators
- **Long jobs:** transcription of a 1–4hr video runs as a durable background workflow and can take many minutes to hours (it paces around the Groq rate limit). Poll, don't block.
- **Auth gap:** `upload`/`transcribe`/`delete` need a user session today. For a headless service, add the API-key middleware (planned) or drive them with a service-account session cookie.
- **Errors:** all error responses are `{ "error": "message" }` with the HTTP status codes listed per endpoint.
