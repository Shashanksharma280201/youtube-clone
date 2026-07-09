import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveVideoId } from "@/lib/video";
import { start } from "workflow/api";
import { transcribeVideoWorkflow } from "@/workflows/transcribe-video";

// The heavy lifting runs in a durable Workflow (see src/workflows/transcribe-video.ts):
// it survives the function timeout and paces around the transcription rate limit. This
// route marks the video PROCESSING and kicks off the workflow. Access is gated by the
// API key (middleware) / same-origin UI. `id` may be a cuid or an externalId.
export async function POST(_: Request, { params }: { params: { id: string } }) {
  const id = await resolveVideoId(params.id);
  if (!id) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Atomic claim: flip to PROCESSING only if the video isn't already running/done.
  // This is a single conditional UPDATE, so two concurrent POSTs (e.g. a React
  // StrictMode double-fire) can't both pass — exactly one matches a row and starts
  // a run; the other matches 0 rows and bails. Prevents duplicate workflows.
  const claim = await prisma.video.updateMany({
    where: { id, transcriptStatus: { in: ["NONE", "PENDING", "FAILED"] } },
    data: { transcriptStatus: "PROCESSING" },
  });
  if (claim.count === 0) {
    const current = await prisma.video.findUnique({
      where: { id },
      select: { transcriptStatus: true },
    });
    return NextResponse.json({ status: current?.transcriptStatus });
  }

  const run = await start(transcribeVideoWorkflow, [id]);
  return NextResponse.json({ status: "PROCESSING", runId: run.runId });
}
