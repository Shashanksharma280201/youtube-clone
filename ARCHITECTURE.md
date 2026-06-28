# Architecture

## Stack
| Layer | Tech |
|-------|------|
| Frontend | Next.js 14 App Router · Tailwind CSS |
| Auth | NextAuth.js (email + bcrypt) |
| Database | Neon PostgreSQL via Prisma |
| File Storage | AWS S3 (browser uploads directly via presigned URL) |
| Transcription | Groq Whisper (`whisper-large-v3-turbo`) |
| Tagging / Search / Vision | OpenAI GPT-4o-mini · GPT-4o |
| Video Processing | ffmpeg-static (audio · silence detect · thumbnails) |

---

## System Flow (top → bottom)

```mermaid
flowchart TD
    A([User logs in]) --> B([Upload a video])
    B --> C[Browser uploads file straight to S3<br/>via a presigned URL]
    C --> D[DB row created · status = PENDING]
    D --> E{{AI Pipeline runs}}
    E --> F[Chapters + transcript saved<br/>status = DONE]
    F --> G([Watch page])
    G --> H[Player + chapters + transcript]
    G --> I[Search a chapter in any language]
    G --> J[Like · View · Comment]
```

While the pipeline runs, the page polls every 2s until status is `DONE`.

---

## The AI Pipeline (top → bottom)

```mermaid
flowchart TD
    P1[1 · Download video from S3<br/>ffmpeg extracts audio] --> P2[2 · Groq Whisper<br/>speech → timed segments]
    P2 --> P3[3 · GPT-4o-mini<br/>tag spoken segments into chapters]
    P2 --> P4[4 · Detect silent gaps<br/>GPT-4o Vision describes the frame]
    P3 --> P5[5 · ffmpeg<br/>1 thumbnail per chapter → S3]
    P4 --> P5
    P5 --> P6[6 · Save transcript + chapters to DB]
```

| Step | What it does |
|------|--------------|
| 1 | Pull the video from S3, extract a 16kHz mono audio track. |
| 2 | Groq Whisper transcribes speech into timed segments (noise/hallucinations filtered). |
| 3 | GPT-4o-mini picks the video's phases and tags each segment → **chapters**. |
| 4 | Silent stretches get a frame described by GPT-4o Vision → so wordless videos also get chapters. |
| 5 | ffmpeg grabs one thumbnail per chapter and uploads it to S3. |
| 6 | Everything is saved to Postgres; status becomes `DONE`. |

---

## Data Model

```mermaid
flowchart TD
    User --> |uploads| Video
    User --> |gives| Like
    User --> |writes| Comment
    Video --> |has| Like
    Video --> |has| Comment
```

`Video.transcriptStatus`: `PENDING → PROCESSING → DONE` (or `FAILED`).
`transcriptSegments` = full timed transcript · `topicSegments` = the chapters (tag, time range, thumbnail).

---

## Key files

| File | Role |
|------|------|
| `src/app/api/upload/route.ts` | Presigned S3 URL + create `Video` row |
| `src/app/api/videos/[id]/transcribe/route.ts` | The full AI pipeline (steps 1–6) |
| `src/app/api/videos/[id]/transcript/route.ts` | Status / transcript polling |
| `src/app/api/videos/[id]/search-chapter/route.ts` | Multilingual chapter search |
| `src/lib/s3.ts` | S3 helpers (presign · upload · download) |
| `src/lib/auth.ts` · `src/lib/prisma.ts` | NextAuth config · Prisma client |
