import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

// The wallet JWT key, written on one line with "\n" escapes as hosts store it.
const P256_KEY = generateKeyPairSync("ec", { namedCurve: "P-256" })
  .privateKey.export({ type: "pkcs8", format: "pem" })
  .toString()
  .trim()
  .replace(/\n/g, "\\n");
const ADMIN_1 = "6f1c2a9e-3b4d-4e5f-8a7b-0c1d2e3f4a5b";
const ADMIN_2 = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";

// Everything assertProductionConfig asks for, with R2 storage on mainnet.
const PRODUCTION: Record<string, string> = {
  NODE_ENV: "production",
  APP_URL: "https://simulust.example",
  DATABASE_URL: "postgres://u:p@db.example:6543/postgres",
  NEXT_PUBLIC_PRIVY_APP_ID: "privy-app",
  AUTH_JWT_PRIVATE_KEY: P256_KEY,
  ADMIN_USER_IDS: `${ADMIN_1}, ${ADMIN_2.toUpperCase()}`,
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

  it("requires at least one admin, named by account id", async () => {
    for (const ids of ["", " , ,"]) {
      expect(await refusal({ ADMIN_USER_IDS: ids })).toBe("Refusing to start in production: missing ADMIN_USER_IDS.");
    }
    // A username could be taken by anyone at sign-up, so only ids count.
    for (const ids of ["admin", `${ADMIN_1},kate`, "did:privy:admin1", "ops@simulust.example"]) {
      expect(await refusal({ ADMIN_USER_IDS: ids })).toContain("ADMIN_USER_IDS must be account ids (UUIDs), not usernames");
    }
    const { env } = await loadEnv();
    expect(env.adminUserIds).toEqual([ADMIN_1, ADMIN_2]);
  });

  it("requires the wallet JWT key, as a P-256 key, when Privy is set", async () => {
    expect(await refusal({ AUTH_JWT_PRIVATE_KEY: "" })).toBe("Refusing to start in production: missing AUTH_JWT_PRIVATE_KEY.");
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const p384 = generateKeyPairSync("ec", { namedCurve: "P-384" }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    for (const key of ["not a key", rsa, p384]) {
      expect(await refusal({ AUTH_JWT_PRIVATE_KEY: key })).toContain("AUTH_JWT_PRIVATE_KEY must be an EC P-256 private key");
    }
    // With real newlines as well as "\n" escapes.
    expect(await refusal({ AUTH_JWT_PRIVATE_KEY: P256_KEY.replace(/\\n/g, "\n") })).toBeNull();
    // Without Privy there's no wallet to sign for; the missing app id is what's reported.
    expect(await refusal({ NEXT_PUBLIC_PRIVY_APP_ID: "", AUTH_JWT_PRIVATE_KEY: "" })).not.toContain("AUTH_JWT_PRIVATE_KEY");
  });

  it("no longer reads the old Privy login settings", async () => {
    const { env } = await loadEnv({ PRIVY_VERIFICATION_KEY: "-----BEGIN PUBLIC KEY-----", ADMIN_PRIVY_IDS: "did:privy:x" });
    expect(env).not.toHaveProperty("privyVerificationKey");
    expect(env).not.toHaveProperty("adminPrivyIds");
    expect(await refusal({ ADMIN_PRIVY_IDS: "did:privy:x" })).toBeNull();
  });

  it("requires Veriff only when explicit content needs an ID check", async () => {
    const noVeriff = { VERIFF_API_KEY: "", VERIFF_SHARED_SECRET: "" };
    // The default age gate asks for a date of birth, with no provider.
    expect(await refusal(noVeriff)).toBeNull();
    expect(await refusal({ ...noVeriff, AGE_VERIFICATION: "gate" })).toBeNull();
    const partial: Record<string, string>[] = [noVeriff, { VERIFF_API_KEY: "" }, { VERIFF_SHARED_SECRET: "" }];
    for (const missing of partial) {
      expect(await refusal({ ...missing, AGE_VERIFICATION: "id" })).toBe(
        "Refusing to start in production: missing VERIFF_API_KEY / VERIFF_SHARED_SECRET.",
      );
    }
    expect(await refusal({ AGE_VERIFICATION: "id" })).toBeNull();
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

describe("AGE_VERIFICATION", () => {
  it("defaults to the date-of-birth gate", async () => {
    for (const NODE_ENV of ["development", "production"]) {
      const { env } = await loadEnv({ NODE_ENV, AGE_VERIFICATION: "" });
      expect(env.ageVerification).toBe("gate");
    }
    expect((await loadEnv({ AGE_VERIFICATION: "id" })).env.ageVerification).toBe("id");
  });

  it("stops the boot on anything but gate or id", async () => {
    for (const value of ["veriff", "ID", "off"]) {
      await expect(loadEnv({ NODE_ENV: "development", AGE_VERIFICATION: value })).rejects.toThrow(
        `AGE_VERIFICATION must be "gate" or "id", not "${value}".`,
      );
    }
  });
});

describe("region blocking", () => {
  it("reads BLOCKED_REGIONS as country-region codes, blocking none by default", async () => {
    expect((await loadEnv({ NODE_ENV: "development", BLOCKED_REGIONS: "" })).env.blockedRegions).toEqual([]);
    const { env } = await loadEnv({ NODE_ENV: "development", BLOCKED_REGIONS: " us-tx, US-UT ,,GB-SCT" });
    expect(env.blockedRegions).toEqual(["US-TX", "US-UT", "GB-SCT"]);
  });

  it("stops the boot on a code that could never match", async () => {
    for (const value of ["TX", "US-TX,UT", "USA-TX", "US_TX", "US-"]) {
      await expect(loadEnv({ NODE_ENV: "development", BLOCKED_REGIONS: value })).rejects.toThrow(
        /BLOCKED_REGIONS entries must look like "US-TX"/,
      );
    }
  });

  it("reads the region from the platform's header, Vercel's by default", async () => {
    expect((await loadEnv({ GEO_REGION_HEADER: "" })).env.geoRegionHeader).toBe("x-vercel-ip-country-region");
    expect((await loadEnv({ GEO_REGION_HEADER: "CF-Region-Code" })).env.geoRegionHeader).toBe("cf-region-code");
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
