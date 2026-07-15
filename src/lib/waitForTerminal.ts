// Wait for a video row to reach a terminal state (DONE or FAILED).
//
// This is what makes POST /api/v1/videoExtraction synchronous: the handler holds
// the request open and polls the row here until the pipeline finishes, instead of
// returning 202 with an empty chunk list and making the caller poll.
//
// Why polling a row rather than awaiting the workflow: the workflow is durable and
// runs outside the request (it survives a pod restart; the request does not). The
// row is the single source of truth both sides agree on, so a caller that reconnects
// — or a second caller on the same resourceId — sees the same state without the
// pipeline having to know anyone is listening.
//
// Returns the row once terminal, or null if the deadline passes first (the caller
// then falls back to 202, i.e. today's poll-based behaviour) or if the row vanishes.
// It never throws on timeout: a slow video is not an error, it is just slow.

const TERMINAL = new Set(["DONE", "FAILED"]);

export function isTerminal(status: string): boolean {
  return TERMINAL.has(status);
}

export type Pollable = { transcriptStatus: string };

export type WaitOpts = {
  timeoutMs: number;
  pollMs: number;
  // Injectable so tests run instantly instead of sleeping for real.
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

export async function waitForTerminal<T extends Pollable>(
  load: () => Promise<T | null>,
  opts: WaitOpts,
): Promise<T | null> {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const deadline = now() + opts.timeoutMs;

  for (;;) {
    const row = await load();
    if (!row) return null;
    if (isTerminal(row.transcriptStatus)) return row;
    // Checked after the load, so a row that finishes exactly on the deadline is
    // still returned rather than reported as a timeout.
    if (now() >= deadline) return null;
    await sleep(opts.pollMs);
  }
}
