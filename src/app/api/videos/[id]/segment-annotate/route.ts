import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { visualSegment } from "@/lib/roboflow";

export const maxDuration = 60;

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { segmentIndex, frameBase64, clickX, clickY, isPositive = true } = await req.json();
  if (typeof segmentIndex !== "number" || !frameBase64 || typeof clickX !== "number" || typeof clickY !== "number") {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const video = await prisma.video.findUnique({ where: { id: params.id } });
  if (!video) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (video.userId !== session.user.id)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const topicSegments = Array.isArray(video.topicSegments)
    ? (video.topicSegments as Record<string, unknown>[])
    : [];

  if (segmentIndex < 0 || segmentIndex >= topicSegments.length)
    return NextResponse.json({ error: "Invalid segment index" }, { status: 400 });

  try {
    const masks = await visualSegment(frameBase64, [{ x: clickX, y: clickY, positive: isPositive }]);

    const updated = topicSegments.map((seg, i) =>
      i === segmentIndex
        ? { ...seg, annotationFrames: [{ time: seg.start, masks }] }
        : seg
    );

    await prisma.video.update({
      where: { id: params.id },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: { topicSegments: updated as any },
    });

    return NextResponse.json({ masks });
  } catch (err) {
    console.error("[segment-annotate]", err);
    return NextResponse.json({ error: "Annotation failed" }, { status: 500 });
  }
}
