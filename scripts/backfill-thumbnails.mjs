// scripts/backfill-thumbnails.mjs — run with DATABASE_URL pointing at the target DB.
// Sets Video.thumbnailUrl from the first chapter thumbnail for videos processed
// before the thumbnailUrl column existed. Idempotent (skips already-set rows).
import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();
const vids = await p.video.findMany({ select: { id: true, topicSegments: true, thumbnailUrl: true } });
let n = 0;
for (const v of vids) {
  if (v.thumbnailUrl) continue;
  const segs = Array.isArray(v.topicSegments) ? v.topicSegments : [];
  const thumb = segs.find((s) => s && s.thumbnailPath)?.thumbnailPath ?? null;
  if (thumb) {
    await p.video.update({ where: { id: v.id }, data: { thumbnailUrl: thumb } });
    n++;
  }
}
console.log(`backfilled ${n}/${vids.length}`);
await p.$disconnect();
