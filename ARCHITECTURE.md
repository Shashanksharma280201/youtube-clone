# Architecture

## Stack
| Layer | Tech |
|-------|------|
| Frontend | Next.js 14 App Router · Tailwind CSS |
| Auth | NextAuth.js (email + bcrypt) |
| Database | Neon PostgreSQL via Prisma |
| File Storage | Local filesystem (`public/uploads/`) |
| Transcription | Groq Whisper (LPU, ~10s) |
| AI Tagging | OpenAI GPT-4o-mini |
| Video Processing | ffmpeg-static (audio extract + thumbnails) |

---

## Full System Flow

```mermaid
flowchart TD
    Browser(["👤 Browser"])

    subgraph Pages["Pages (Client)"]
        PHome["/  · Home feed"]
        PUpload["/upload  · File picker + preview"]
        PTranscribe["/transcribe/[id]  · Live preview + transcript"]
        PWatch["/watch/[id]  · Watch + chapters"]
        PLogin["/login · /register"]
    end

    subgraph API["API Routes (Server)"]
        AUpload["/api/upload  POST"]
        ATranscribe["/api/videos/[id]/transcribe  POST"]
        ATranscript["/api/videos/[id]/transcript  GET"]
        AVideos["/api/videos  GET"]
        AVideo["/api/videos/[id]  GET"]
        ALikes["/api/videos/[id]/likes  GET·POST·DELETE"]
        AView["/api/videos/[id]/view  PATCH"]
        AAuth["/api/auth/[...nextauth]"]
        ARegister["/api/register  POST"]
    end

    subgraph Pipeline["Transcription Pipeline (inside /api/transcribe)"]
        P1["1 · ffmpeg\nextract audio → 16kHz mono MP3"]
        P2["2 · Groq Whisper\naudio → word-timestamped segments"]
        P3["3 · GPT-4o-mini\nbatch tag each segment\n(mainTag + subTag)"]
        P4["4 · ffmpeg × N\nextract 1 frame per chapter → JPEG thumbnail"]
        P5["5 · Save results to DB\n(transcriptSegments + topicSegments JSON)"]
    end

    subgraph Storage["Storage"]
        FS["Local Filesystem\npublic/uploads/videos/\npublic/uploads/thumbnails/"]
        DB[("Neon PostgreSQL\nUser · Video · Like · Comment")]
    end

    subgraph External["External APIs"]
        Groq["Groq API\nwhisper-large-v3"]
        OpenAI["OpenAI API\ngpt-4o-mini"]
    end

    %% Page → API wiring
    Browser --> PUpload
    PUpload -- "POST multipart/form-data" --> AUpload
    AUpload -- "write file" --> FS
    AUpload -- "create Video row (PENDING)" --> DB
    AUpload -- "returns {id}" --> PUpload
    PUpload -- "redirect → /transcribe/[id]" --> PTranscribe

    PTranscribe -- "POST (fire once)" --> ATranscribe
    PTranscribe -- "GET poll every 2s" --> ATranscript
    ATranscript -- "read transcriptStatus + segments" --> DB
    ATranscript --> PTranscribe

    ATranscribe --> P1
    P1 -- "read video" --> FS
    P1 --> P2
    P2 -- "audio file" --> Groq
    Groq -- "segments[]" --> P2
    P2 --> P3
    P3 -- "batch segments" --> OpenAI
    OpenAI -- "tagged segments[]" --> P3
    P3 --> P4
    P4 -- "write thumbnails" --> FS
    P4 --> P5
    P5 -- "update Video row (DONE)" --> DB

    PTranscribe -- "Watch button → /watch/[id]" --> PWatch
    PHome -- "click video card" --> PWatch
    PWatch -- "GET video + segments" --> AVideo
    AVideo -- "read" --> DB
    PWatch -- "PATCH (increment)" --> AView
    AView --> DB
    PWatch -- "GET · POST · DELETE" --> ALikes
    ALikes --> DB

    Browser --> PHome
    PHome -- "GET /api/videos" --> AVideos
    AVideos -- "read" --> DB

    Browser --> PLogin
    PLogin -- "POST credentials" --> AAuth
    PLogin -- "POST new user" --> ARegister
    AAuth --> DB
    ARegister -- "bcrypt hash + insert" --> DB
```

---

## Data Model

```mermaid
erDiagram
    User {
        string id PK
        string email
        string name
        string password
        datetime createdAt
    }
    Video {
        string id PK
        string title
        string description
        string blobUrl
        string userId FK
        int views
        enum transcriptStatus
        string transcript
        json transcriptSegments
        json topicSegments
        datetime createdAt
    }
    Like {
        string id PK
        string userId FK
        string videoId FK
        datetime createdAt
    }
    Comment {
        string id PK
        string text
        string userId FK
        string videoId FK
        datetime createdAt
    }

    User ||--o{ Video : uploads
    User ||--o{ Like : gives
    User ||--o{ Comment : writes
    Video ||--o{ Like : receives
    Video ||--o{ Comment : receives
```

---

## Upload → Watch in 60 seconds

```
User selects file
  → browser extracts thumbnail frame (canvas API) for preview
  → POST /api/upload → saved to public/uploads/videos/ + DB row created
  → redirect to /transcribe/[id]

/transcribe/[id] loads
  → POST /api/transcribe fires (once)
  → page polls GET /api/transcript every 2s

Pipeline (max 300s):
  ffmpeg extracts audio
  → Groq Whisper → N timed segments
  → GPT-4o-mini tags each segment (mainTag + subTag) in batches of 20
  → ffmpeg extracts 1 JPEG thumbnail per chapter (up to 10 parallel)
  → DB updated: status=DONE, transcriptSegments, topicSegments

Poll detects DONE → page shows transcript + chapter grid

User clicks "Watch" → /watch/[id] → full player + chapter sidebar
```
