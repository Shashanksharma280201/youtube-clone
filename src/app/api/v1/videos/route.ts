export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { signThumbnails } from '@/lib/signUrls'

const SELECT = { id:true, title:true, blobUrl:true, views:true, createdAt:true, thumbnailUrl:true } as const

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
  // Capture the cursor before signing: signThumbnails returns copies.
  const nextCursor = hasMore ? page[page.length - 1].id : null
  const signed = await Promise.all(page.map((v) => signThumbnails(v)))
  return NextResponse.json({ items: signed, nextCursor })
}
