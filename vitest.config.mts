import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    env: { PGLITE_DIR: "memory://", ALLOW_DEV_AUTH: "1" },
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(root, "src"),
      "server-only": path.resolve(root, "scripts/empty.ts"),
    },
  },
});
