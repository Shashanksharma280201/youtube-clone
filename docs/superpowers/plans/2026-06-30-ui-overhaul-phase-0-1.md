# UI Overhaul — Phase 0 (Foundation) + Phase 1 (Home) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a dark-neutral + red shadcn/ui foundation and rebuild the home page with real thumbnails, a calmer card, and infinite-scroll lazy loading.

**Architecture:** Initialize shadcn/ui with CSS-variable theming (dark zinc base, red primary). Keep the old `nb-*`/`yt-*` Tailwind tokens working via a compatibility shim so unmigrated pages don't break. Rebuild `VideoCard`/`VideoGrid` on shadcn primitives; serve thumbnails through `next/image`; paginate `/api/videos` with a cursor and load pages on scroll via `IntersectionObserver`.

**Tech Stack:** Next.js 14 (App Router), TypeScript, Tailwind CSS, shadcn/ui, Prisma + Neon, AWS S3.

## Global Constraints

- Next.js **14.2.29**, App Router. Do not upgrade Next.
- Tailwind config is `tailwind.config.ts`; global CSS is `src/app/globals.css`.
- `cn()` util lives in `src/lib/utils.ts` (already exists — extend, don't replace).
- shadcn components go in `src/components/ui/*`.
- Two separate Neon databases: **local** (`.env` / `.env.local`) and **production** (Vercel env). Every schema/data change must be applied to BOTH.
- Verification loop (no unit-test harness in this repo): `npx tsc --noEmit`, `npx next build`, and concrete page/API checks. Use `/home/shanks/.nvm/versions/node/v24.15.0/bin/` binaries; prefix shell with `export PATH="/usr/bin:/bin:$PATH"` if `curl`/`node` aren't found.
- Dev server: `./node_modules/.bin/next dev -p 3005` (port 3005).
- Commit after each task. Push to `main` only when explicitly asked (auto-deploys to Vercel).

---

## File Structure

- `components.json` — shadcn config (create)
- `src/lib/utils.ts` — `cn()` helper (modify/confirm)
- `src/app/globals.css` — theme CSS variables + base layer (modify)
- `tailwind.config.ts` — wire shadcn tokens + keep compat tokens (modify)
- `src/components/ui/*` — shadcn primitives (create via CLI)
- `next.config.mjs` — add S3 host to `remotePatterns` (modify)
- `src/components/VideoCard.tsx` — rebuild on shadcn Card + `next/image` (rewrite)
- `src/components/VideoGrid.tsx` — infinite-scroll client (rewrite)
- `src/app/api/videos/route.ts` — cursor pagination (modify)
- `src/app/page.tsx` — pass first page + cursor to grid (modify)
- `scripts/backfill-thumbnails.mjs` — one-off backfill (create, not shipped to runtime)

---

## Task 1: Initialize shadcn/ui + dark-neutral-red theme

**Files:**
- Create: `components.json`
- Modify: `src/lib/utils.ts`, `src/app/globals.css`, `tailwind.config.ts`

**Interfaces:**
- Produces: `cn(...inputs)` from `@/lib/utils`; CSS vars `--background --foreground --card --card-foreground --primary --primary-foreground --muted --muted-foreground --accent --border --input --ring --radius`; Tailwind tokens `bg-background text-foreground border-border bg-card bg-primary text-primary-foreground bg-muted text-muted-foreground ring-ring`.

- [ ] **Step 1: Confirm `cn()` exists**

Run: `grep -n "export function cn" src/lib/utils.ts`
Expected: a match. If absent, add:
```ts
import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"
export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)) }
```
And install deps: `npm i clsx tailwind-merge class-variance-authority lucide-react tailwindcss-animate`

- [ ] **Step 2: Create `components.json`**

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": true,
  "tsx": true,
  "tailwind": {
    "config": "tailwind.config.ts",
    "css": "src/app/globals.css",
    "baseColor": "zinc",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": { "components": "@/components", "utils": "@/lib/utils", "ui": "@/components/ui" }
}
```

- [ ] **Step 3: Add theme CSS variables to `globals.css`**

At the top of `src/app/globals.css`, after the `@tailwind` directives, add a dark-only theme (the app is dark-first; apply tokens on `:root` so no theme toggle is needed):
```css
@layer base {
  :root {
    --background: 0 0% 7%;          /* near-black */
    --foreground: 0 0% 98%;
    --card: 0 0% 10%;
    --card-foreground: 0 0% 98%;
    --popover: 0 0% 9%;
    --popover-foreground: 0 0% 98%;
    --primary: 0 72% 51%;           /* YouTube-ish red */
    --primary-foreground: 0 0% 100%;
    --secondary: 0 0% 15%;
    --secondary-foreground: 0 0% 98%;
    --muted: 0 0% 15%;
    --muted-foreground: 0 0% 64%;
    --accent: 0 0% 18%;
    --accent-foreground: 0 0% 98%;
    --destructive: 0 72% 51%;
    --destructive-foreground: 0 0% 100%;
    --border: 0 0% 18%;
    --input: 0 0% 18%;
    --ring: 0 72% 51%;
    --radius: 0.625rem;
  }
  * { @apply border-border; }
  body { @apply bg-background text-foreground; }
}
```

- [ ] **Step 4: Wire tokens in `tailwind.config.ts`**

In `theme.extend.colors`, add (KEEP existing `nb-*`/`yt-*` colors — do not remove yet):
```ts
colors: {
  // ...existing nb-*/yt-* stay...
  border: "hsl(var(--border))",
  input: "hsl(var(--input))",
  ring: "hsl(var(--ring))",
  background: "hsl(var(--background))",
  foreground: "hsl(var(--foreground))",
  primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
  secondary: { DEFAULT: "hsl(var(--secondary))", foreground: "hsl(var(--secondary-foreground))" },
  destructive: { DEFAULT: "hsl(var(--destructive))", foreground: "hsl(var(--destructive-foreground))" },
  muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
  accent: { DEFAULT: "hsl(var(--accent))", foreground: "hsl(var(--accent-foreground))" },
  popover: { DEFAULT: "hsl(var(--popover))", foreground: "hsl(var(--popover-foreground))" },
  card: { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--card-foreground))" },
},
borderRadius: { lg: "var(--radius)", md: "calc(var(--radius) - 2px)", sm: "calc(var(--radius) - 4px)" },
```
And add `require("tailwindcss-animate")` to `plugins`.

- [ ] **Step 5: Verify build**

Run: `export PATH="/usr/bin:/bin:$PATH"; npx tsc --noEmit && npx next build 2>&1 | tail -5`
Expected: build succeeds, route table prints.

- [ ] **Step 6: Commit**

```bash
git add components.json src/lib/utils.ts src/app/globals.css tailwind.config.ts package.json package-lock.json
git commit -m "feat(ui): init shadcn + dark-neutral-red theme tokens"
```

---

## Task 2: Add base shadcn primitives

**Files:**
- Create: `src/components/ui/{button,card,badge,skeleton,progress,avatar,dropdown-menu,input,label,sonner,alert-dialog}.tsx`

**Interfaces:**
- Produces: `Button`, `Card/CardHeader/CardContent/CardFooter`, `Badge`, `Skeleton`, `Progress`, `Avatar/AvatarImage/AvatarFallback`, `DropdownMenu*`, `Input`, `Label`, `Toaster` (sonner), `AlertDialog*` — all from `@/components/ui/<name>`.

- [ ] **Step 1: Add components via CLI**

Run:
```bash
export PATH="/usr/bin:/bin:$PATH"
npx shadcn@latest add button card badge skeleton progress avatar dropdown-menu input label sonner alert-dialog --yes
```
Expected: files created under `src/components/ui/`.

- [ ] **Step 2: Verify they exist + typecheck**

Run: `ls src/components/ui && npx tsc --noEmit`
Expected: the files listed; tsc clean.

- [ ] **Step 3: Mount the Toaster** in `src/app/layout.tsx`

Add `import { Toaster } from "@/components/ui/sonner"` and render `<Toaster />` just before `</body>`.

- [ ] **Step 4: Verify build**

Run: `export PATH="/usr/bin:/bin:$PATH"; npx next build 2>&1 | tail -5`
Expected: success.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui src/app/layout.tsx package.json package-lock.json
git commit -m "feat(ui): add base shadcn primitives + toaster"
```

---

## Task 3: Verify the theme doesn't break existing pages (compat check)

**Files:** none (verification task); fix `globals.css`/`tailwind.config.ts` only if something breaks.

**Interfaces:**
- Consumes: tokens from Task 1, primitives from Task 2.

- [ ] **Step 1: Start dev server**

Run: `pkill -f 'next dev'; sleep 1; ./node_modules/.bin/next dev -p 3005 > /tmp/dev.log 2>&1 & sleep 20; curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3005/`
Expected: `200`.

- [ ] **Step 2: Smoke each existing page**

Run: `for p in / /login /register /upload; do curl -s -o /dev/null -w "$p %{http_code}\n" http://localhost:3005$p; done`
Expected: all `200` (or `/upload` may redirect to login → `200`/`307`). No `500`.

- [ ] **Step 3: Confirm old tokens still resolve**

The `nb-*`/`yt-*` classes must still render (they're untouched in `tailwind.config.ts`). If any page 500s due to a removed token, re-add it. Do NOT remove old tokens in this phase.

- [ ] **Step 4: Commit (if any fix was needed)**

```bash
git add -A && git commit -m "fix(ui): keep legacy tokens working alongside shadcn theme"
```
(If nothing changed, skip.)

---

## Task 4: Backfill `thumbnailUrl` (local + production)

**Files:**
- Create: `scripts/backfill-thumbnails.mjs`

**Interfaces:**
- Consumes: `Video.topicSegments` (JSON array with `thumbnailPath`), `Video.thumbnailUrl` (column added earlier).
- Produces: every DONE video has `thumbnailUrl` set when a chapter thumbnail exists.

- [ ] **Step 1: Write the backfill script**

```js
// scripts/backfill-thumbnails.mjs — run with DATABASE_URL pointing at the target DB
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const vids = await p.video.findMany({ select: { id: true, topicSegments: true, thumbnailUrl: true } });
let n = 0;
for (const v of vids) {
  if (v.thumbnailUrl) continue;
  const segs = Array.isArray(v.topicSegments) ? v.topicSegments : [];
  const thumb = segs.find((s) => s && s.thumbnailPath)?.thumbnailPath ?? null;
  if (thumb) { await p.video.update({ where: { id: v.id }, data: { thumbnailUrl: thumb } }); n++; }
}
console.log(`backfilled ${n}/${vids.length}`);
await p.$disconnect();
```

- [ ] **Step 2: Run against LOCAL DB**

Run: `export PATH="/usr/bin:/bin:$PATH"; node -e "require('dotenv').config({path:'.env.local',quiet:true})" ; DATABASE_URL="$(grep '^DATABASE_URL' .env.local | sed -E 's/^DATABASE_URL=//' | tr -d '\"')" node scripts/backfill-thumbnails.mjs`
Expected: `backfilled N/M`.

- [ ] **Step 3: Run against PRODUCTION DB**

Run: `export PATH="/usr/bin:/bin:$PATH"; vercel env pull scratch/.env.prod --environment=production --yes >/dev/null 2>&1; DATABASE_URL="$(grep '^DATABASE_URL' scratch/.env.prod | sed -E 's/^DATABASE_URL=//' | tr -d '\"')" node scripts/backfill-thumbnails.mjs; rm -f scratch/.env.prod`
Expected: `backfilled N/M` (the old prod videos get thumbnails).

- [ ] **Step 4: Commit**

```bash
git add scripts/backfill-thumbnails.mjs
git commit -m "chore: backfill thumbnailUrl from topicSegments (local + prod)"
```

---

## Task 5: Serve thumbnails via `next/image`

**Files:**
- Modify: `next.config.mjs`, `src/components/VideoCard.tsx`

**Interfaces:**
- Consumes: `thumbnailUrl` (S3 URL like `https://<bucket>.s3.<region>.amazonaws.com/thumbnails/...`).
- Produces: optimized, lazy-loaded thumbnails.

- [ ] **Step 1: Allow the S3 host in `remotePatterns`**

In `next.config.mjs`, add to `images.remotePatterns`:
```js
{ protocol: 'https', hostname: '*.s3.*.amazonaws.com' },
{ protocol: 'https', hostname: '*.s3.amazonaws.com' },
```

- [ ] **Step 2: Use `next/image` in `VideoCard`**

Replace the raw `<img src={thumbnailUrl} .../>` with:
```tsx
import Image from "next/image"
// inside the thumbnail container (which must be `relative`):
<Image src={thumbnailUrl} alt={title} fill sizes="(max-width:768px) 100vw, 25vw"
  className="object-cover" />
```
`next/image` is lazy by default. Keep the placeholder branch for `!thumbnailUrl`.

- [ ] **Step 3: Verify build + image loads**

Run: `export PATH="/usr/bin:/bin:$PATH"; npx next build 2>&1 | tail -5`
Then start dev and check an optimized image URL responds:
`curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3005/_next/image?url=$(node -e "console.log(encodeURIComponent('REPLACE_WITH_A_REAL_THUMB_URL'))")&w=640&q=75"`
Expected: build OK; image route `200`.

- [ ] **Step 4: Commit**

```bash
git add next.config.mjs src/components/VideoCard.tsx
git commit -m "feat(home): optimized lazy thumbnails via next/image"
```

---

## Task 6: Rebuild `VideoCard` on shadcn Card (remove hover animation)

**Files:**
- Modify: `src/components/VideoCard.tsx`

**Interfaces:**
- Consumes: props `{ id, title, thumbnailUrl, views, createdAt, user:{name} }`, `cn`, `Card`, `Skeleton`, `Avatar`, `formatViews`, `timeAgo`.
- Produces: a `VideoCard` with NO scale/zoom hover; calm hover (border/elevation); dark-neutral theme.

- [ ] **Step 1: Rewrite the card**

Use shadcn `Card` and theme tokens. Remove `group-hover:scale-*` and the zoom overlay. Hover = `hover:border-primary/40 hover:bg-card/80 transition-colors`. Thumbnail container `relative aspect-video rounded-lg overflow-hidden bg-muted`. Title `text-foreground`, channel/meta `text-muted-foreground`. Avatar via shadcn `Avatar` with `AvatarFallback` = first letter. Keep `Link href={/watch/${id}}`.

- [ ] **Step 2: Verify visually**

Start dev, open `http://localhost:3005/`. Confirm: thumbnails show, **no zoom on hover**, dark-neutral look, red accents.

- [ ] **Step 3: Verify build**

Run: `export PATH="/usr/bin:/bin:$PATH"; npx tsc --noEmit && npx next build 2>&1 | tail -3`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add src/components/VideoCard.tsx
git commit -m "feat(home): redesign VideoCard on shadcn Card, remove hover zoom"
```

---

## Task 7: Cursor-paginate `/api/videos`

**Files:**
- Modify: `src/app/api/videos/route.ts`

**Interfaces:**
- Produces: `GET /api/videos?cursor=<id|empty>&limit=<n>&q=<str>` → `{ items: VideoCardData[], nextCursor: string | null }` where `VideoCardData = { id, title, blobUrl, views, createdAt, thumbnailUrl, user:{name} }`.

- [ ] **Step 1: Implement cursor pagination**

```ts
export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

const SELECT = { id:true, title:true, blobUrl:true, views:true, createdAt:true, thumbnailUrl:true, user:{ select:{ name:true } } } as const

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const limit = Math.min(Number(searchParams.get('limit')) || 12, 48)
  const cursor = searchParams.get('cursor') || undefined
  const q = searchParams.get('q')?.trim() || undefined
  const items = await prisma.video.findMany({
    where: q ? { title: { contains: q, mode: 'insensitive' } } : undefined,
    orderBy: { createdAt: 'desc' },
    select: SELECT,
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  })
  const hasMore = items.length > limit
  const page = hasMore ? items.slice(0, limit) : items
  return NextResponse.json({ items: page, nextCursor: hasMore ? page[page.length-1].id : null })
}
```

- [ ] **Step 2: Verify the endpoint**

Run: `curl -s "http://localhost:3005/api/videos?limit=3" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log('items',j.items.length,'nextCursor',j.nextCursor)})"`
Expected: `items 3 nextCursor <id>`. Then `?cursor=<that id>&limit=3` returns the next 3.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/videos/route.ts
git commit -m "feat(api): cursor-paginate /api/videos"
```

---

## Task 8: Infinite-scroll `VideoGrid`

**Files:**
- Modify: `src/components/VideoGrid.tsx`, `src/app/page.tsx`

**Interfaces:**
- Consumes: `/api/videos?cursor=&limit=`, `VideoCard`, `Skeleton`.
- Produces: a client grid that renders the SSR first page then appends pages on scroll.

- [ ] **Step 1: Make `page.tsx` fetch the first page + pass cursor**

`getVideos` (the cached server fn) returns the first page via the same select + `take: limit+1` logic; pass `initialItems` and `initialCursor` to `<VideoGrid>`. Keep `unstable_cache` with `revalidate: 60, tags: ['videos']` but cache ONLY the light first page (small payload).

- [ ] **Step 2: Rewrite `VideoGrid` as a client infinite-scroll list**

```tsx
'use client'
import { useEffect, useRef, useState, useCallback } from 'react'
import VideoCard from './VideoCard'
import { Skeleton } from '@/components/ui/skeleton'

type V = { id:string; title:string; blobUrl:string; thumbnailUrl?:string|null; views:number; createdAt:string|Date; user:{name:string} }

export default function VideoGrid({ initialItems, initialCursor }: { initialItems: V[]; initialCursor: string|null }) {
  const [items, setItems] = useState<V[]>(initialItems)
  const [cursor, setCursor] = useState<string|null>(initialCursor)
  const [loading, setLoading] = useState(false)
  const sentinel = useRef<HTMLDivElement>(null)

  const loadMore = useCallback(async () => {
    if (loading || !cursor) return
    setLoading(true)
    const res = await fetch(`/api/videos?cursor=${cursor}&limit=12`)
    const data = await res.json()
    setItems((prev) => [...prev, ...data.items])
    setCursor(data.nextCursor)
    setLoading(false)
  }, [cursor, loading])

  useEffect(() => {
    const el = sentinel.current
    if (!el) return
    const io = new IntersectionObserver((e) => { if (e[0].isIntersecting) loadMore() }, { rootMargin: '600px' })
    io.observe(el)
    return () => io.disconnect()
  }, [loadMore])

  if (items.length === 0) return /* keep existing empty state markup */ null

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-5 gap-y-8">
        {items.map((v) => <VideoCard key={v.id} {...v} />)}
        {loading && Array.from({length:4}).map((_,i)=>(
          <div key={`s${i}`}><Skeleton className="aspect-video rounded-lg" /><Skeleton className="h-4 w-3/4 mt-3" /></div>
        ))}
      </div>
      {cursor && <div ref={sentinel} className="h-10" />}
    </>
  )
}
```
Preserve the existing empty-state markup (copy it into the `items.length===0` branch).

- [ ] **Step 3: Verify scroll loads more**

Open `http://localhost:3005/`, scroll down → more cards append (if >12 videos exist). Network shows `/api/videos?cursor=...` calls. With ≤12 videos, no extra fetch (correct).

- [ ] **Step 4: Verify build**

Run: `export PATH="/usr/bin:/bin:$PATH"; npx tsc --noEmit && npx next build 2>&1 | tail -3`
Expected: success.

- [ ] **Step 5: Commit**

```bash
git add src/components/VideoGrid.tsx src/app/page.tsx
git commit -m "feat(home): infinite-scroll lazy loading of videos"
```

---

## Self-Review

**Spec coverage (Phase 0+1):**
- Theme/colors (Phase 0) → Tasks 1–3 ✓
- Thumbnails not loading (#1) → Tasks 4 (backfill) + 5 (next/image) ✓
- Card redesign, remove hover (#4) → Task 6 ✓
- Lazy load on scroll (#5) → Tasks 7 (pagination) + 8 (infinite scroll) ✓
- Items #2 (progress), #3 remaining pages, #6 manage page → deferred to later plans (Phases 2–4), by design.

**Placeholder scan:** Task 5 Step 3 and Task 6 Step 1 reference "REPLACE_WITH_A_REAL_THUMB_URL" / prose card layout — these are intentional (a real URL is environment-specific; the card layout is fully specified by tokens + the listed classes). No "TBD/TODO/handle edge cases".

**Type consistency:** `VideoCardData`/`V` shape (`id,title,blobUrl,thumbnailUrl,views,createdAt,user.name`) is identical across Tasks 7 and 8 and matches `VideoCard` props. `/api/videos` returns `{items,nextCursor}` consumed verbatim in Task 8.

## Next plans (after this ships)
- `phase-2-progress-tracking` — `transcriptStage`/`transcriptProgress` + workflow stage writes + `/transcribe` progress bar.
- `phase-3-remaining-pages` — Navbar/login/register/upload/watch/processing → shadcn.
- `phase-4-manage-delete` — hidden `/manage` page + `DELETE /api/videos/[id]` complete deletion.
