import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function POST(_: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) {
    return NextResponse.json({ error: 'Please login or create an account' }, { status: 401 })
  }

  const videoId = params.id
  const userId = session.user.id

  const existingLike = await prisma.like.findUnique({
    where: {
      userId_videoId: { userId, videoId }
    }
  })

  if (existingLike) {
    await prisma.like.delete({ where: { id: existingLike.id } })
  } else {
    await prisma.like.create({ data: { userId, videoId } })
  }

  const likeCount = await prisma.like.count({ where: { videoId } })

  return NextResponse.json({ liked: !existingLike, count: likeCount })
}
