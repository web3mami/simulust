import { afterEach, describe, expect, it, vi } from "vitest";

const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";

// Everything assertProductionConfig asks for, with R2 storage on mainnet.
const PRODUCTION: Record<string, string> = {
  NODE_ENV: "production",
  APP_URL: "https://simulust.example",
  DATABASE_URL: "postgres://u:p@db.example:6543/postgres",
  NEXT_PUBLIC_PRIVY_APP_ID: "privy-app",
  ADMIN_PRIVY_IDS: "did:privy:admin1, did:privy:admin2",
  LLM_BASE_URL: "https://llm.example/v1",
  LLM_API_KEY: "llm",
  MODERATION_BASE_URL: "https://moderation.example/v1",
  MODERATION_API_KEY: "moderation",
  MODERATION_MODEL: "openai/gpt-oss-safeguard-20b",
  VERIFF_API_KEY: "veriff",
  VERIFF_SHARED_SECRET: "veriff-secret",
  HIVE_API_KEY: "hive",
  HIVE_DEMOGRAPHIC_API_KEY: "hive-age",
  HIVE_CELEBRITY_API_KEY: "hive-celebrity",
  S3_ENDPOINT: "https://account.r2.cloudflarestorage.com",
  S3_REGION: "auto",
  S3_BUCKET: "media",
  S3_ACCESS_KEY_ID: "access",
  S3_SECRET_ACCESS_KEY: "secret",
  TREASURY_ADDRESS: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
  SOLANA_CLUSTER: "mainnet",
  SOLANA_RPC_URL: "https://mainnet.helius-rpc.com/?api-key=server",
  NEXT_PUBLIC_SOLANA_CLUSTER: "mainnet",
  NEXT_PUBLIC_SOLANA_RPC_URL: "https://mainnet.helius-rpc.com/?api-key=browser",
  HELIUS_WEBHOOK_SECRET: "helius",
  CRON_SECRET: "cron",
  CHAINALYSIS_API_KEY: "chainalysis",
  PYTH_API_KEY: "pyth",
  IMAGE_PROVIDER: "worker",
  IMAGE_API_URL: "https://gpu.example",
  IMAGE_API_KEY: "gpu",
  VIDEO_API_URL: "",
  VIDEO_API_KEY: "",
};

// "" counts as unset, the way read() and the inlined browser values treat it.
async function loadEnv(overrides: Record<string, string> = {}) {
  for (const [name, value] of Object.entries({ ...PRODUCTION, ...overrides })) vi.stubEnv(name, value);
  vi.resetModules();
  return import("@/server/env");
}

async function refusal(overrides: Record<string, string>) {
  const { assertProductionConfig } = await loadEnv(overrides);
  try {
    assertProductionConfig();
  } catch (error) {
    return (error as Error).message;
  }
  return null;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("assertProductionConfig", () => {
  it("accepts a complete production config", async () => {
    expect(await refusal({})).toBeNull();
  });

  it("checks nothing outside production", async () => {
    const empty = Object.fromEntries(Object.keys(PRODUCTION).map((name) => [name, ""]));
    expect(await refusal({ ...empty, NODE_ENV: "development" })).toBeNull();
  });

  it("requires the text classifier", async () => {
    for (const name of ["MODERATION_BASE_URL", "MODERATION_API_KEY", "MODERATION_MODEL"]) {
      expect(await refusal({ [name]: "" })).toContain("MODERATION_BASE_URL / MODERATION_API_KEY / MODERATION_MODEL");
    }
  });

  it("requires at least one admin, named by Privy user id", async () => {
    for (const ids of ["", " , ,"]) {
      expect(await refusal({ ADMIN_PRIVY_IDS: ids })).toBe("Refusing to start in production: missing ADMIN_PRIVY_IDS.");
    }
    // An email or a dev handle never matches a login, so it's no admin either.
    for (const ids of ["ops@simulust.example", "did:privy:admin1,admin"]) {
      expect(await refusal({ ADMIN_PRIVY_IDS: ids })).toContain("ADMIN_PRIVY_IDS must be Privy user ids (did:privy:...)");
    }
    const { env } = await loadEnv();
    expect(env.adminPrivyIds).toEqual(["did:privy:admin1", "did:privy:admin2"]);
  });

  it("requires sanctions screening", async () => {
    expect(await refusal({ CHAINALYSIS_API_KEY: "" })).toContain("CHAINALYSIS_API_KEY");
  });

  it("requires SOLANA_CLUSTER to be set explicitly", async () => {
    expect(await refusal({ SOLANA_CLUSTER: "", NEXT_PUBLIC_SOLANA_CLUSTER: "devnet" })).toBe(
      "Refusing to start in production: missing SOLANA_CLUSTER.",
    );
  });

  it("requires a public https APP_URL", async () => {
    expect(await refusal({ APP_URL: "" })).toMatch(/missing .*APP_URL/);
    for (const url of [
      "http://simulust.example",
      "https://localhost:3000",
      "https://127.0.0.1",
      "https://[::1]:3000",
      "https://app.localhost",
      "not a url",
    ]) {
      expect(await refusal({ APP_URL: url })).toContain("APP_URL must be the public https:// address");
    }
  });

  it("requires IMAGE_API_URL for the worker", async () => {
    const message = await refusal({ IMAGE_API_URL: "" });
    expect(message).toContain("IMAGE_API_URL");
    expect(message).not.toContain("IMAGE_PROVIDER=worker");
    expect(await refusal({ IMAGE_PROVIDER: "mock" })).toContain("IMAGE_PROVIDER=worker");
  });

  it("rejects S3_REGION=auto without S3_ENDPOINT", async () => {
    expect(await refusal({ S3_ENDPOINT: "" })).toContain("S3_REGION=auto needs S3_ENDPOINT");
    expect(await refusal({ S3_ENDPOINT: "", S3_REGION: "" })).toContain("S3_REGION=auto needs S3_ENDPOINT");
    expect(await refusal({ S3_ENDPOINT: "", S3_REGION: "eu-central-1" })).toBeNull();
  });

  it("requires the browser's values from the build", async () => {
    for (const name of ["NEXT_PUBLIC_PRIVY_APP_ID", "NEXT_PUBLIC_SOLANA_CLUSTER", "NEXT_PUBLIC_SOLANA_RPC_URL"]) {
      expect(await refusal({ [name]: "" })).toContain(`${name} was not set when the app was built`);
    }
  });

  it("refuses a browser built for the other cluster", async () => {
    expect(await refusal({ NEXT_PUBLIC_SOLANA_CLUSTER: "devnet" })).toContain(
      "the app was built for NEXT_PUBLIC_SOLANA_CLUSTER=devnet but SOLANA_CLUSTER=mainnet",
    );
    // The browser treats anything but "mainnet" as devnet.
    expect(await refusal({ NEXT_PUBLIC_SOLANA_CLUSTER: "mainnet-beta" })).toContain(
      "NEXT_PUBLIC_SOLANA_CLUSTER=mainnet-beta",
    );
  });

  it("lists every problem at once", async () => {
    const message = await refusal({ CRON_SECRET: "", APP_URL: "http://localhost:3000", S3_ENDPOINT: "" });
    expect(message).toMatch(/^Refusing to start in production: missing CRON_SECRET; APP_URL .*; S3_REGION=auto/);
  });
});

describe("SOLANA_CLUSTER", () => {
  it("defaults to devnet outside production", async () => {
    const { env } = await loadEnv({ NODE_ENV: "development", SOLANA_CLUSTER: "" });
    expect(env.solanaCluster).toBe("devnet");
  });

  it("stops the boot on anything but mainnet or devnet, in every environment", async () => {
    for (const NODE_ENV of ["development", "production"]) {
      await expect(loadEnv({ NODE_ENV, SOLANA_CLUSTER: "mainnet-beta" })).rejects.toThrow(
        'SOLANA_CLUSTER must be "mainnet" or "devnet", not "mainnet-beta".',
      );
    }
  });
});

describe("assertSolanaRpcCluster", () => {
  function rpcAnswers(hashes: Record<string, string | Error | number>) {
    const fetchMock = vi.fn(async (url: string) => {
      const answer = hashes[url];
      if (answer instanceof Error) throw answer;
      if (typeof answer === "number") return new Response("nope", { status: answer });
      return Response.json({ jsonrpc: "2.0", id: 1, result: answer });
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("accepts RPCs on the configured cluster", async () => {
    const { assertSolanaRpcCluster } = await loadEnv();
    const fetchMock = rpcAnswers({
      [PRODUCTION.SOLANA_RPC_URL]: MAINNET_GENESIS,
      [PRODUCTION.NEXT_PUBLIC_SOLANA_RPC_URL]: MAINNET_GENESIS,
    });
    await expect(assertSolanaRpcCluster()).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({ method: "getGenesisHash" });
    // Lets a domain-restricted browser key answer the server.
    expect(init.headers).toMatchObject({ origin: "https://simulust.example" });
  });

  it("refuses a server RPC on another cluster", async () => {
    const { assertSolanaRpcCluster } = await loadEnv();
    rpcAnswers({
      [PRODUCTION.SOLANA_RPC_URL]: DEVNET_GENESIS,
      [PRODUCTION.NEXT_PUBLIC_SOLANA_RPC_URL]: MAINNET_GENESIS,
    });
    await expect(assertSolanaRpcCluster()).rejects.toThrow(
      `Refusing to start in production: SOLANA_RPC_URL is not a mainnet RPC (genesis hash ${DEVNET_GENESIS}).`,
    );
  });

  it("refuses a browser RPC on another cluster", async () => {
    const { assertSolanaRpcCluster } = await loadEnv({
      SOLANA_CLUSTER: "devnet",
      NEXT_PUBLIC_SOLANA_CLUSTER: "devnet",
    });
    rpcAnswers({
      [PRODUCTION.SOLANA_RPC_URL]: DEVNET_GENESIS,
      [PRODUCTION.NEXT_PUBLIC_SOLANA_RPC_URL]: MAINNET_GENESIS,
    });
    await expect(assertSolanaRpcCluster()).rejects.toThrow("NEXT_PUBLIC_SOLANA_RPC_URL is not a devnet RPC");
  });

  it("only logs an RPC that doesn't answer, without its URL", async () => {
    const { assertSolanaRpcCluster } = await loadEnv();
    rpcAnswers({
      [PRODUCTION.SOLANA_RPC_URL]: new TypeError("fetch failed"),
      [PRODUCTION.NEXT_PUBLIC_SOLANA_RPC_URL]: 403,
    });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(assertSolanaRpcCluster()).resolves.toBeUndefined();
    expect(logged).toHaveBeenCalledTimes(2);
    expect(logged.mock.calls.flat().join(" ")).not.toContain("api-key");
  });

  it("does nothing outside production", async () => {
    const { assertSolanaRpcCluster } = await loadEnv({ NODE_ENV: "development" });
    const fetchMock = rpcAnswers({});
    await assertSolanaRpcCluster();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
