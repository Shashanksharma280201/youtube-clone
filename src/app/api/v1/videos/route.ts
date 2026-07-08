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
