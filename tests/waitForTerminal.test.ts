import { describe, it, expect } from "vitest";
import { waitForTerminal, isTerminal } from "@/lib/waitForTerminal";

// A fake clock: sleep() advances time instead of waiting, so a 25-minute timeout
// runs in microseconds and the tests assert on real elapsed-time behaviour.
function fakeClock() {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
    advance: (ms: number) => {
      t += ms;
    },
  };
}

// Yields the given statuses one per load(), repeating the last one forever.
function loaderOf(statuses: string[]) {
  let i = 0;
  const calls = { count: 0 };
  const load = async () => {
    calls.count++;
    const s = statuses[Math.min(i, statuses.length - 1)];
    i++;
    return { transcriptStatus: s, id: "v1" };
  };
  return { load, calls };
}

describe("isTerminal", () => {
  it("treats DONE and FAILED as terminal", () => {
    expect(isTerminal("DONE")).toBe(true);
    expect(isTerminal("FAILED")).toBe(true);
  });

  it("treats in-flight states as non-terminal", () => {
    for (const s of ["NONE", "PENDING", "PROCESSING"]) expect(isTerminal(s)).toBe(false);
  });
});

describe("waitForTerminal", () => {
  it("returns immediately when the row is already DONE, without sleeping", async () => {
    const clock = fakeClock();
    const { load, calls } = loaderOf(["DONE"]);

    const row = await waitForTerminal(load, { timeoutMs: 60_000, pollMs: 3000, ...clock });

    expect(row?.transcriptStatus).toBe("DONE");
    expect(calls.count).toBe(1);
    expect(clock.now()).toBe(0); // never slept
  });

  it("polls while PROCESSING and returns the row once it reaches DONE", async () => {
    const clock = fakeClock();
    const { load, calls } = loaderOf(["PROCESSING", "PROCESSING", "PROCESSING", "DONE"]);

    const row = await waitForTerminal(load, { timeoutMs: 60_000, pollMs: 3000, ...clock });

    expect(row?.transcriptStatus).toBe("DONE");
    expect(calls.count).toBe(4);
    expect(clock.now()).toBe(9000); // slept 3 times between 4 loads
  });

  it("returns the FAILED row rather than timing out — a failure is an answer", async () => {
    const clock = fakeClock();
    const { load } = loaderOf(["PROCESSING", "FAILED"]);

    const row = await waitForTerminal(load, { timeoutMs: 60_000, pollMs: 3000, ...clock });

    expect(row?.transcriptStatus).toBe("FAILED");
  });

  it("returns null when the deadline passes — the caller falls back to 202", async () => {
    const clock = fakeClock();
    const { load } = loaderOf(["PROCESSING"]); // never finishes

    const row = await waitForTerminal(load, { timeoutMs: 10_000, pollMs: 3000, ...clock });

    expect(row).toBeNull();
    // Bounded: it gave up rather than polling forever.
    expect(clock.now()).toBeGreaterThanOrEqual(10_000);
  });

  it("returns a row that finishes exactly on the deadline, not a timeout", async () => {
    const clock = fakeClock();
    let first = true;
    const load = async () => {
      if (first) {
        first = false;
        return { transcriptStatus: "PROCESSING" };
      }
      return { transcriptStatus: "DONE" };
    };

    // pollMs === timeoutMs: the second load happens exactly at the deadline.
    const row = await waitForTerminal(load, { timeoutMs: 3000, pollMs: 3000, ...clock });

    expect(row?.transcriptStatus).toBe("DONE");
  });

  it("returns null when the row disappears mid-wait", async () => {
    const clock = fakeClock();
    let n = 0;
    const load = async () => (n++ === 0 ? { transcriptStatus: "PROCESSING" } : null);

    const row = await waitForTerminal(load, { timeoutMs: 60_000, pollMs: 3000, ...clock });

    expect(row).toBeNull();
  });

  it("does not sleep at all when the timeout is zero", async () => {
    const clock = fakeClock();
    const { load, calls } = loaderOf(["PROCESSING"]);

    const row = await waitForTerminal(load, { timeoutMs: 0, pollMs: 3000, ...clock });

    expect(row).toBeNull();
    expect(calls.count).toBe(1);
    expect(clock.now()).toBe(0);
  });
});
