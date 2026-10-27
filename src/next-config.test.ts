import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER } from "next/constants";
import { afterEach, describe, expect, it, vi } from "vitest";
import config from "../next.config";

const BROWSER = {
  NEXT_PUBLIC_PRIVY_APP_ID: "privy-app",
  NEXT_PUBLIC_SOLANA_CLUSTER: "mainnet",
  NEXT_PUBLIC_SOLANA_RPC_URL: "https://mainnet.helius-rpc.com/?api-key=browser",
};
const EMPTY = Object.fromEntries(Object.keys(BROWSER).map((name) => [name, ""]));

function load(overrides: Record<string, string> = {}, phase = PHASE_PRODUCTION_BUILD) {
  for (const [name, value] of Object.entries({ SOLANA_CLUSTER: "", ALLOW_DEV_BUILD: "", ...BROWSER, ...overrides })) {
    vi.stubEnv(name, value);
  }
  return config(phase);
}

// What `next build` does after compiling; `next typegen` loads the config only.
async function build(overrides: Record<string, string> = {}) {
  const loaded = load(overrides);
  await loaded.compiler?.runAfterProductionCompile?.({ projectDir: ".", distDir: ".next" });
  return loaded;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("next.config production build", () => {
  it("inlines the browser's values, server code included", async () => {
    expect((await build({ SOLANA_CLUSTER: "mainnet" })).env).toEqual(BROWSER);
  });

  it("refuses a build without them", async () => {
    for (const name of Object.keys(BROWSER)) {
      await expect(build({ [name]: "" })).rejects.toThrow(`${name} is not set`);
    }
  });

  it("refuses a cluster the browser would read as devnet", async () => {
    await expect(build({ NEXT_PUBLIC_SOLANA_CLUSTER: "mainnet-beta" })).rejects.toThrow(
      'NEXT_PUBLIC_SOLANA_CLUSTER must be "mainnet" or "devnet", not "mainnet-beta"',
    );
  });

  it("refuses a browser cluster that differs from the server's", async () => {
    await expect(build({ SOLANA_CLUSTER: "devnet" })).rejects.toThrow(
      "NEXT_PUBLIC_SOLANA_CLUSTER (mainnet) differs from SOLANA_CLUSTER (devnet)",
    );
  });

  it("builds without them on ALLOW_DEV_BUILD=1, inlining empty values the boot check rejects", async () => {
    expect((await build({ ...EMPTY, ALLOW_DEV_BUILD: "1" })).env).toEqual(EMPTY);
  });

  it("lets next typegen load the config without them", () => {
    expect(load(EMPTY).env).toEqual(EMPTY);
  });

  it("leaves development and next start alone", () => {
    for (const phase of [PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_SERVER]) {
      const loaded = load(EMPTY, phase);
      expect(loaded.env).toBeUndefined();
      expect(loaded.compiler).toBeUndefined();
    }
  });
});
