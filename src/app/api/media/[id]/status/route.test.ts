import { describe, expect, it } from "vitest";
import { maxDuration } from "./route";

describe("media status route", () => {
  it("has time to finish a video a poll finds done", () => {
    // The worker poll (30 s), moderating six stills in two batches of three
    // (30 s each), and room to store the clip.
    expect(maxDuration).toBeGreaterThanOrEqual(30 + 2 * 30 + 20);
  });
});
