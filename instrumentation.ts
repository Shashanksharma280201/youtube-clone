// Starts the Workflow "world" when the server boots. On Vercel this is a no-op
// (the Vercel world is managed); self-hosted (Docker/Azure) with
// WORKFLOW_TARGET_WORLD=@workflow/world-postgres this launches the graphile-worker
// that processes transcription workflow steps in-process.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "edge") {
    const { getWorld } = await import("workflow/runtime");
    await getWorld().start?.();
  }
}
