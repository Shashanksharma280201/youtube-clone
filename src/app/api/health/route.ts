import { NextResponse } from "next/server";
import { activeModels } from "@/lib/pipeline/openai";

// Lightweight liveness/readiness probe for container platforms (Azure Container
// Apps, Kubernetes). Returns 200 without touching the DB so it stays fast and
// doesn't fail the container when a downstream (Neon/S3) is briefly unavailable.
//
// It also reports the AI models this deployment is configured to use. Without this
// a model switch cannot be verified: if the key lacks access to the configured
// model, chatComplete() silently falls back to gpt-4o and the output looks fine.
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    ts: new Date().toISOString(),
    models: activeModels(),
  });
}
