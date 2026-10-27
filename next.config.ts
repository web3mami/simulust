import type { NextConfig } from "next";
import { PHASE_PRODUCTION_BUILD } from "next/constants";

// Inlined into the browser bundle at build time, so the deployed browser keeps
// whatever the build saw: without them it shows the dev login and pays on devnet.
const BROWSER_ENV = ["NEXT_PUBLIC_PRIVY_APP_ID", "NEXT_PUBLIC_SOLANA_CLUSTER", "NEXT_PUBLIC_SOLANA_RPC_URL"];

function browserEnvProblems() {
  const problems = BROWSER_ENV.filter((name) => !process.env[name]?.trim()).map((name) => `${name} is not set`);
  const cluster = process.env.NEXT_PUBLIC_SOLANA_CLUSTER;
  const serverCluster = process.env.SOLANA_CLUSTER?.trim();
  if (cluster && cluster !== "mainnet" && cluster !== "devnet") {
    problems.push(`NEXT_PUBLIC_SOLANA_CLUSTER must be "mainnet" or "devnet", not "${cluster}"`);
  } else if (cluster && serverCluster && cluster !== serverCluster) {
    problems.push(`NEXT_PUBLIC_SOLANA_CLUSTER (${cluster}) differs from SOLANA_CLUSTER (${serverCluster})`);
  }
  return problems;
}

export default function config(phase: string): NextConfig {
  const nextConfig: NextConfig = {
    reactStrictMode: false,
    // PGlite ships WASM and data files that must be loaded from node_modules at runtime.
    serverExternalPackages: ["@electric-sql/pglite", "@electric-sql/pglite-pgvector"],
    images: {
      // AVIF first (smallest), WebP where it isn't supported.
      formats: ["image/avif", "image/webp"],
      // Only our own static art is resized. Generated media (/api/media/...)
      // needs the viewer's login, which the optimizer doesn't have, so it is
      // shown as is (unoptimized).
      localPatterns: [
        { pathname: "/characters/**", search: "" },
        { pathname: "/hero/**", search: "" },
        { pathname: "/creator/**", search: "" },
      ],
    },
  };
  if (phase !== PHASE_PRODUCTION_BUILD) return nextConfig;

  return {
    ...nextConfig,
    // Inline unset ones as "" too, into server code as well, so the server's boot
    // check compares its runtime config with exactly what the browser got.
    env: Object.fromEntries(BROWSER_ENV.map((name) => [name, process.env[name] ?? ""])),
    compiler: {
      // A hook rather than a throw here: `next typegen` (npm run typecheck) loads
      // this config in the build phase too. ALLOW_DEV_BUILD=1 builds without the
      // values for a local check; that build refuses to start in production.
      runAfterProductionCompile: async () => {
        const problems = browserEnvProblems();
        if (problems.length && process.env.ALLOW_DEV_BUILD !== "1") {
          throw new Error(
            `Production build refused: ${problems.join("; ")}. Fix them, or set ALLOW_DEV_BUILD=1 for a local check build.`,
          );
        }
      },
    },
  };
}
