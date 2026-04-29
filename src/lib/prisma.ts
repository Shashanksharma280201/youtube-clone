import { PrismaClient } from '@prisma/client'  // imports all the prisma functions like prisma.user.create() or prisma.video.findMany()

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}
// this creates a communication between db and codebase and avoids a new connection with the db on hot reload.
// mentioning prisma as the globalThis 

export const prisma =
  globalForPrisma.prisma ?? new PrismaClient()



if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
