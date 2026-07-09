import { PrismaClient } from '@prisma/client'
import { PrismaNeon } from '@prisma/adapter-neon'
import { Pool, neonConfig } from '@neondatabase/serverless'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

function useNeonAdapter(): boolean {
  if (process.env.PRISMA_USE_NEON === 'true') return true
  if (process.env.PRISMA_USE_NEON === 'false') return false
  const url = process.env.DATABASE_URL ?? ''
  return url.includes('neon.tech') || url.includes('neon.database')
}

function createClient() {
  // Neon serverless driver only works with Neon hosts. Azure Postgres / RDS use
  // the standard Prisma engine (TCP), which is what we run on AKS.
  if (useNeonAdapter()) {
    if (typeof WebSocket !== 'undefined') {
      neonConfig.webSocketConstructor = WebSocket
    }
    const pool = new Pool({ connectionString: process.env.DATABASE_URL })
    return new PrismaClient({ adapter: new PrismaNeon(pool) })
  }
  return new PrismaClient()
}

export const prisma = globalForPrisma.prisma ?? createClient()
globalForPrisma.prisma = prisma
