import { prisma } from './prisma'
import { videoWhere } from './videoWhere'

export { videoWhere }

// Full record, addressed by cuid or externalId.
export async function resolveVideo(idOrExternalId: string) {
  return prisma.video.findFirst({ where: videoWhere(idOrExternalId) })
}

// Just our primary key — for routes that then update or delete by id.
export async function resolveVideoId(idOrExternalId: string): Promise<string | null> {
  const v = await prisma.video.findFirst({
    where: videoWhere(idOrExternalId),
    select: { id: true },
  })
  return v?.id ?? null
}
