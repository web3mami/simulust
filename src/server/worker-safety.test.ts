import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { hasPython } from "@/test/python";

// The GPU worker's own tagger decisions (workers/media/test_safety.py): the
// age check, the one-person check with its clip rule, and that no request
// field turns either off. They need no model and no packages, so they run here
// and, through npm test, in CI, where a missing Python fails the run.

const python = hasPython();

describe.skipIf(!python)("the worker's tagger checks", () => {
  it("pass their Python tests", () => {
    const result = spawnSync("python3", ["-I", path.resolve("workers/media/test_safety.py")], {
      encoding: "utf8",
      timeout: 60_000,
      // Only what python3 needs, so a threshold or BLOCKED_NAMES in the developer's shell can't leak in.
      env: { NODE_ENV: "test", PATH: process.env.PATH ?? "" },
    });
    expect(result.status, result.stderr || String(result.error)).toBe(0);
    // unittest reports on stderr; a file that ran nothing would also exit 0.
    expect(result.stderr).toMatch(/\bRan [1-9]\d* tests?\b/);
    expect(result.stderr).toMatch(/^OK\b/m);
  });
});
