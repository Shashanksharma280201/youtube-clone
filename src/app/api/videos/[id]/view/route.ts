import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function PATCH(_: Request, { params }: { params: { id: string } }) {
  try {
    await prisma.video.update({
      where: { id: params.id },
      data: { views: { increment: 1 } },
    })
  } catch { /* non-fatal — view count is best-effort */ }
  return NextResponse.json({ ok: true })
}
