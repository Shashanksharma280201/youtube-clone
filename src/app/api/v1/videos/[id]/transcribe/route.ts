import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { start } from "workflow/api";
import { transcribeVideoWorkflow } from "@/workflows/transcribe-video";

// The heavy lifting now runs in a durable Workflow (see src/workflows/transcribe-video.ts):
// it survives the function timeout and paces around Groq's hourly quota. This route
// just authorizes, marks the video PROCESSING, and kicks off the workflow.
export async function POST(_: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const video = await prisma.video.findUnique({
    where: { id: params.id },
    select: { userId: true, transcriptStatus: true },
  });
  if (!video) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (video.userId !== session.user.id)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

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
