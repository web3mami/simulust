import { spawnSync } from "node:child_process";

// Whether python3 (3.9+) can run the GPU worker's own checks in a test. Under a
// heavily loaded machine one spawn can fail, so it's tried twice. In CI the
// parity tests must run: a missing Python fails the run instead of quietly
// skipping them.
export function hasPython() {
  for (let attempt = 0; attempt < 2; attempt++) {
    const probe = spawnSync("python3", ["-c", "import sys; assert sys.version_info >= (3, 9)"], { timeout: 30_000 });
    if (probe.status === 0) return true;
  }
  if (process.env.CI) throw new Error("python3 3.9 or newer is required for the worker parity tests.");
  return false;
}
