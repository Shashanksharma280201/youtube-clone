# UI/UX Overhaul — Design Spec

**Date:** 2026-06-30
**Status:** Approved direction, pending spec review

## Goal

Improve the whole webapp's UI/UX. Six concrete asks:

1. Home page shows **video thumbnails** (currently blank).
2. **Live progress** during transcription so users see which step is running.
3. **Improve site colors** across all pages.
4. **Replace the home-page hover animation** with a better UI, using **shadcn/ui** components.
5. **Lazy load on scroll** — load data/images for elements as they enter the viewport, not all at once.
6. **Hidden URL-only management page** to completely delete a user's uploaded videos.

## Decisions (from brainstorming)

- **Theme:** dark, neutral (near-black / zinc), video-first — NOT the old violet "Nebula" look.
- **Accent:** red (YouTube-like).
- **Component system:** **full migration to shadcn/ui** across pages.
- **Progress:** **real step tracking** — the workflow writes its current stage to the DB; the page shows the true step.
- **Rollout:** **phased** — each phase independently shippable and reviewable.

## Why thumbnails are blank (root cause)

`getVideos` now selects the new `thumbnailUrl` column, but production videos processed **before that column existed have `thumbnailUrl = null`** → placeholders. The thumbnail data still lives in each video's `topicSegments`. Fix = backfill `thumbnailUrl` on production from `topicSegments`. (S3 objects are already publicly reachable — verified HTTP 200.)

---

## Foundation (Phase 0) — shadcn + theme

- Initialize shadcn/ui: `components.json`, `cn()` util (`src/lib/utils.ts` already has utils — extend), CSS-variable theming in `globals.css`, Tailwind config wired to shadcn tokens.
- Define a **dark zinc base + red primary** theme using shadcn semantic tokens (`--background`, `--card`, `--primary`, `--muted`, `--border`, `--ring`, …).
- Map/retire the ad-hoc `nb-*` / `yt-*` Tailwind tokens to the new semantic ones so existing markup keeps working during migration (compatibility shim, removed as pages migrate).
- Add base primitives: `button, card, badge, skeleton, progress, avatar, dropdown-menu, input, label, sonner` (toasts), `alert-dialog` (delete confirm).

**Unit boundaries:** theme tokens (globals.css) · shadcn primitives (`src/components/ui/*`) · app components consume primitives.

## Phase 1 — Home page (items 1, 4, 5)

- **Thumbnails (#1):**
  - Backfill `thumbnailUrl` on the **production** DB from `topicSegments[0].thumbnailPath`.
  - Render thumbnails with **`next/image`** (add the S3 host `*.s3.*.amazonaws.com` to `next.config` `remotePatterns`) → resizing, CDN caching, native lazy loading.
- **Card redesign (#4):** rebuild `VideoCard` on shadcn `Card`. **Remove the scale/zoom hover animation;** replace with a calm hover (subtle border/elevation + accent ring). Clean metadata row (avatar, title, channel, views·time). `Skeleton` while images/data load.
- **Lazy load on scroll (#5):**
  - Make `/api/videos` **cursor-paginated** (`?cursor=&limit=`), returning `{ items, nextCursor }`, selecting only light columns + `thumbnailUrl`.
  - Client `VideoGrid` becomes an **infinite-scroll** list: render the first page server-side, then fetch the next page when an `IntersectionObserver` sentinel near the bottom becomes visible. Show `Skeleton` cards while fetching.

## Phase 2 — Progress tracking (item 2)

- **Data model:** add to `Video`: `transcriptStage String?` (human label) and `stageIndex Int?` / `stageTotal Int?` (for the bar), or a single `transcriptProgress Int?` (0–100). Chosen shape: `transcriptStage` (label) + `transcriptProgress` (0–100).
- **Workflow writes stage** at each step (a tiny `setStage(videoId, label, pct)` step):
  `Uploading ✓ → Preparing audio → Transcribing (i/N) → Tagging → Detecting silence & scenes → Generating chapters → Done`.
- **`/transcribe` page** polls `/transcript` (already polling) which now also returns `transcriptStage`/`transcriptProgress`; renders a shadcn **`Progress`** bar + live stage label, replacing the vague "Transcribing…" spinner. On `FAILED`, show the message.

## Phase 3 — Remaining pages

Migrate to the shadcn theme/components for consistency: **Navbar** (with avatar + dropdown), **login**, **register**, **upload**, **watch**, **processing**. Keep behavior identical; restyle only. Watch page keeps the chapter rail (tags already fixed to black-on-white — re-evaluate under the new theme; likely use a shadcn `Badge`).

## Phase 4 — Hidden video management / delete page (item 6)

- **Route:** `/manage` — **not linked anywhere**; auth-required. Shows **the logged-in user's own** videos in a table/list with status + a **Delete** action (shadcn `AlertDialog` confirm).
- **API:** `DELETE /api/videos/[id]` — verifies the session user **owns** the video, then deletes it **completely**: S3 video blob + `thumbnails/{id}/` + `audio/{id}/` prefixes, and DB `Like`/`Comment`/`Video` rows. Reuse a `deleteVideoCompletely(videoId)` helper in `src/lib/s3.ts`.
- Safe-by-default: ownership check server-side; confirmation dialog client-side. (Assumption: deletes only the current user's videos, not an all-videos admin tool. Flag if you want admin-wide.)

---

## Cross-cutting

- **Data model changes:** `Video.transcriptStage`, `Video.transcriptProgress` (Phase 2). Apply via `prisma db push` to **both** local and **production** DBs (they're separate — the recent `thumbnailUrl` miss taught us this).
- **API changes:** `/api/videos` paginated (Phase 1); `DELETE /api/videos/[id]` (Phase 4); `/transcript` returns stage fields (Phase 2).
- **Deploy:** push to `main` → Vercel auto-deploy. Remember to run schema changes against the **production** Neon DB.
- **Memory:** the `project_redesign_nebula` memory is superseded by this dark-neutral-red + shadcn direction; update it once shipped.

## Out of scope (YAGNI)

- No new video features (likes/comments logic unchanged).
- No SAM3/annotation UI work.
- No auth/provider changes.
- Management page is per-user delete only (no bulk admin, no edit).

## Risks

- **Full shadcn migration is large** — mitigated by phasing; the `nb-*`/`yt-*` compatibility shim lets pages migrate one at a time without breaking others.
- **Two databases** — every schema change must hit local AND production.
- **next/image + S3** — must add the S3 host to `remotePatterns` or images 500; verify the optimizer works with the bucket region.
