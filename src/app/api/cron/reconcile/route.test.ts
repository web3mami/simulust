import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.CRON_SECRET = "cron-test-secret";
});

// reconcile here only finishes once the media sweep has started, the way a
// payments run held up by a slow chain would.
const work = vi.hoisted(() => {
  let start = () => {};
  const started = new Promise<void>((resolve) => (start = resolve));
  return { started, start: () => start(), reconcileFails: false, swept: 0 };
});

vi.mock("@/server/solana/reconcile", () => ({
  reconcile: async () => {
    await work.started;
    if (work.reconcileFails) throw new Error("RPC down");
    return { checked: 3, updated: 1 };
  },
}));
vi.mock("@/server/media", () => ({
  abandonedMedia: async () => {
    work.start();
    work.swept++;
    return [];
  },
  failAbandoned: async (row: unknown) => row,
}));
vi.mock("@/server/video", () => ({ stuckVideos: async () => [], refreshVideo: async (row: unknown) => row }));
vi.mock("@/server/ratelimit", () => ({ pruneRateLimits: async () => 2 }));

const { GET } = await import("@/app/api/cron/reconcile/route");

const run = () =>
  GET(new Request("http://localhost/api/cron/reconcile", { headers: { authorization: "Bearer cron-test-secret" } }));

describe("GET /api/cron/reconcile", () => {
  it("sweeps media while payments are still being reconciled", { timeout: 2_000 }, async () => {
    const response = await run();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      checked: 3,
      updated: 1,
      prunedRateLimits: 2,
      abandonedMedia: 0,
      settledVideos: 0,
    });
  });

  it("still sweeps media when reconciling payments fails", async () => {
    work.reconcileFails = true;
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const swept = work.swept;
    const response = await run();
    errors.mockRestore();
    expect(response.status).toBe(500);
    expect(work.swept).toBe(swept + 1);
  });
});
