import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { deleteVideoCompletely } from '@/lib/deleteVideo'

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const video = await prisma.video.findUnique({
    where: { id: params.id },
    include: {
      user: { select: { id: true, name: true } },
      _count: { select: { likes: true, comments: true } },
    },
  })

  if (!video) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json(video)
}

// Permanently delete a video — only the uploader may do this.
export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const video = await prisma.video.findUnique({
    where: { id: params.id },
    select: { userId: true },
  })
  if (!video) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (video.userId !== session.user.id)
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await deleteVideoCompletely(params.id)
  return NextResponse.json({ deleted: true })
}
