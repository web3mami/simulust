import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const run = promisify(execFile);

// The deploy step (scripts/migrate.ts), run exactly as package.json runs it.
// Nothing listens on port 1, so it gets as far as connecting and stops there.
describe("npm run db:migrate", () => {
  it("compiles, loads the schema and seed, and connects", async () => {
    const failure = await run("npm", ["run", "--silent", "db:migrate"], {
      env: { ...process.env, DATABASE_URL: "postgres://user:pass@127.0.0.1:1/simulust" },
    }).then(
      () => null,
      (error: { code: number; stderr: string }) => error,
    );
    expect(failure?.code).toBe(1);
    expect(failure?.stderr).not.toContain("Top-level await");
    expect(failure?.stderr).toContain("ECONNREFUSED");
  });

  it("explains a missing DATABASE_URL", async () => {
    const failure = await run("npm", ["run", "--silent", "db:migrate"], {
      env: { ...process.env, DATABASE_URL: "" },
    }).then(
      () => null,
      (error: { code: number; stderr: string }) => error,
    );
    expect(failure?.code).toBe(1);
    expect(failure?.stderr).toContain("DATABASE_URL is not set");
  });
});
