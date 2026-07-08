import { NextResponse } from "next/server";

// Lightweight liveness/readiness probe for container platforms (Azure Container
// Apps, Kubernetes). Returns 200 without touching the DB so it stays fast and
// doesn't fail the container when a downstream (Neon/S3) is briefly unavailable.
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ status: "ok", ts: new Date().toISOString() });
}
