import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { start } from "workflow/api";
import { transcribeVideoWorkflow } from "@/workflows/transcribe-video";

// The heavy lifting runs in a durable Workflow (see src/workflows/transcribe-video.ts):
// it survives the function timeout and paces around Groq's hourly quota. This route
// marks the video PROCESSING and kicks off the workflow. Access is gated by the API
// key (middleware) / same-origin UI — no user/ownership.
export async function POST(_: Request, { params }: { params: { id: string } }) {
  const video = await prisma.video.findUnique({
    where: { id: params.id },
    select: { transcriptStatus: true },
  });
  if (!video) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Atomic claim: flip to PROCESSING only if the video isn't already running/done.
  // This is a single conditional UPDATE, so two concurrent POSTs (e.g. a React
  // StrictMode double-fire) can't both pass — exactly one matches a row and starts
  // a run; the other matches 0 rows and bails. Prevents duplicate workflows.
  const claim = await prisma.video.updateMany({
    where: { id: params.id, transcriptStatus: { in: ["NONE", "PENDING", "FAILED"] } },
    data: { transcriptStatus: "PROCESSING" },
  });
  if (claim.count === 0)
    return NextResponse.json({ status: video.transcriptStatus });

  const run = await start(transcribeVideoWorkflow, [params.id]);
  return NextResponse.json({ status: "PROCESSING", runId: run.runId });
}
