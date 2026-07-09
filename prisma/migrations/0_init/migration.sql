-- CreateEnum
CREATE TYPE "TranscriptStatus" AS ENUM ('NONE', 'PENDING', 'PROCESSING', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "Video" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "blobUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "views" INTEGER NOT NULL DEFAULT 0,
    "transcriptStatus" "TranscriptStatus" NOT NULL DEFAULT 'NONE',
    "transcript" TEXT,
    "transcriptSegments" JSONB,
    "topicSegments" JSONB,
    "thumbnailUrl" TEXT,
    "domainData" JSONB,

    CONSTRAINT "Video_pkey" PRIMARY KEY ("id")
);

