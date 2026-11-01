// One place that knows which outside services are configured. Every integration
// has a local stand-in so the app runs end to end with no accounts, but the
// stand-ins that would be unsafe in production (fake auth, fake age checks,
// unmoderated images) refuse to run there.
//
// No "server-only" import here: instrumentation loads this at boot. Nothing in
// it reaches the browser, because non-NEXT_PUBLIC variables are never bundled.

import { createPrivateKey, type KeyObject } from "node:crypto";

function read(name: string) {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
}

export const isProduction = process.env.NODE_ENV === "production";

const SOLANA_CLUSTERS = ["mainnet", "devnet"] as const;
type SolanaCluster = (typeof SOLANA_CLUSTERS)[number];

// Anything else ("mainnet-beta", a typo) would leave the USDC mint undefined, so
// it stops the boot in every environment.
function solanaCluster(): SolanaCluster {
  const value = read("SOLANA_CLUSTER") ?? "devnet";
  if (!(SOLANA_CLUSTERS as readonly string[]).includes(value)) {
    throw new Error(`SOLANA_CLUSTER must be "mainnet" or "devnet", not "${value}".`);
  }
  return value as SolanaCluster;
}

// What the browser bundle got. A literal process.env.NEXT_PUBLIC_* is inlined at
// build time in server code too, and a production build inlines unset ones as ""
// (next.config.ts), so these are the build's values; read() sees the runtime's.
const browserEnv = {
  privyAppId: process.env.NEXT_PUBLIC_PRIVY_APP_ID,
  solanaCluster: process.env.NEXT_PUBLIC_SOLANA_CLUSTER,
  solanaRpcUrl: process.env.NEXT_PUBLIC_SOLANA_RPC_URL,
};

function ageVerificationMode(value: string | undefined): "gate" | "id" {
  if (value === undefined || value === "gate") return "gate";
  if (value === "id") return "id";
  throw new Error(`AGE_VERIFICATION must be "gate" or "id", not "${value}".`);
}

// Country-region pairs (ISO 3166-2, e.g. "US-TX"). A bare region code would
// never match anything, so a typo stops the boot instead of silently letting a
// region through.
function blockedRegions(value: string | undefined): string[] {
  const codes = (value ?? "")
    .split(",")
    .map((code) => code.trim().toUpperCase())
    .filter(Boolean);
  const wrong = codes.filter((code) => !/^[A-Z]{2}-[A-Z0-9]{1,3}$/.test(code));
  if (wrong.length) {
    throw new Error(`BLOCKED_REGIONS entries must look like "US-TX" (country-region), not ${wrong.map((code) => `"${code}"`).join(", ")}.`);
  }
  return codes;
}

export const env = {
  appUrl: read("APP_URL") ?? "http://localhost:3000",

  databaseUrl: read("DATABASE_URL"),
  pgliteDir: read("PGLITE_DIR") ?? ".data/pglite",

  // Privy only makes each account's Solana wallet. Logins are our own
  // (username and password), handed to Privy as a short-lived JWT signed with
  // this key (src/server/wallet-token.ts). PEM, with "\n" escapes allowed.
  privyAppId: read("NEXT_PUBLIC_PRIVY_APP_ID"),
  authJwtPrivateKey: read("AUTH_JWT_PRIVATE_KEY")?.replace(/\\n/g, "\n"),
  allowDevAuth: !isProduction && read("ALLOW_DEV_AUTH") !== "0",
  // Account ids (users.id UUIDs, from /admin > Users), never usernames, so
  // nobody can sign up as an admin by taking a name.
  adminUserIds: (read("ADMIN_USER_IDS") ?? "")
    .split(",")
    .map((id) => id.trim().toLowerCase())
    .filter(Boolean),

  llmBaseUrl: read("LLM_BASE_URL"),
  llmApiKey: read("LLM_API_KEY"),
  llmModel: read("LLM_MODEL") ?? "deepseek-ai/DeepSeek-V3.1",
  llmPremiumModel: read("LLM_PREMIUM_MODEL"),
  llmUtilityModel: read("LLM_UTILITY_MODEL"),
  embedBaseUrl: read("EMBED_BASE_URL") ?? read("LLM_BASE_URL"),
  embedApiKey: read("EMBED_API_KEY") ?? read("LLM_API_KEY"),
  // memories.embedding is vector(1024), so the model must return 1024 dimensions.
  embedModel: read("EMBED_MODEL") ?? "BAAI/bge-m3",

  moderationBaseUrl: read("MODERATION_BASE_URL"),
  moderationApiKey: read("MODERATION_API_KEY"),
  moderationModel: read("MODERATION_MODEL"),

  imageApiUrl: read("IMAGE_API_URL"),
  imageApiKey: read("IMAGE_API_KEY"),
  imageProvider: (read("IMAGE_PROVIDER") ?? (read("IMAGE_API_URL") ? "worker" : "mock")) as
    | "worker"
    | "pollinations"
    | "mock",
  videoApiUrl: read("VIDEO_API_URL") ?? read("IMAGE_API_URL"),
  videoApiKey: read("VIDEO_API_KEY") ?? read("IMAGE_API_KEY"),
  hiveApiKey: read("HIVE_API_KEY"),
  allowUnmoderatedImages: !isProduction && read("ALLOW_UNMODERATED_IMAGES") !== "0",

  ttsBaseUrl: read("TTS_BASE_URL"),
  ttsApiKey: read("TTS_API_KEY"),
  ttsModel: read("TTS_MODEL") ?? "kokoro",

  s3Endpoint: read("S3_ENDPOINT"),
  s3Region: read("S3_REGION") ?? "auto",
  s3Bucket: read("S3_BUCKET"),
  s3AccessKeyId: read("S3_ACCESS_KEY_ID"),
  s3SecretAccessKey: read("S3_SECRET_ACCESS_KEY"),
  mediaDir: read("MEDIA_DIR") ?? ".data/media",

  solanaCluster: solanaCluster(),
  solanaRpcUrl: read("SOLANA_RPC_URL"),
  treasuryAddress: read("TREASURY_ADDRESS"),
  heliusWebhookSecret: read("HELIUS_WEBHOOK_SECRET"),
  cronSecret: read("CRON_SECRET"),
  chainalysisApiKey: read("CHAINALYSIS_API_KEY"),

  veriffApiKey: read("VERIFF_API_KEY"),
  veriffSharedSecret: read("VERIFF_SHARED_SECRET"),
  veriffBaseUrl: read("VERIFF_BASE_URL") ?? "https://stationapi.veriff.com",
  allowDevAgeCheck: !isProduction && read("ALLOW_DEV_AGE_CHECK") !== "0",
  // "gate" (default): adults confirm a date of birth of 18 or over, no ID.
  // "id": explicit content needs a completed ID check (Veriff) as well.
  ageVerification: ageVerificationMode(read("AGE_VERIFICATION")),

  blockedCountries: (read("BLOCKED_COUNTRIES") ?? "CU,IR,KP,SY,RU,BY")
    .split(",")
    .map((code) => code.trim().toUpperCase())
    .filter(Boolean),
  // States and provinces blocked like countries, e.g. "US-TX,US-UT": places
  // whose age-verification laws the operator hasn't met (see SETUP.md).
  blockedRegions: blockedRegions(read("BLOCKED_REGIONS")),
  // Only a header that the platform in front of the app sets, overwriting
  // whatever the client sent, can be trusted for the visitor's country and IP.
  // Vercel: x-vercel-ip-country and x-real-ip (the defaults). Cloudflare:
  // cf-ipcountry and cf-connecting-ip, but only if the origin accepts traffic
  // from Cloudflare alone; otherwise anyone can send them.
  geoCountryHeader: (read("GEO_COUNTRY_HEADER") ?? "x-vercel-ip-country").toLowerCase(),
  // The visitor's state or province, the part after the dash in ISO 3166-2
  // ("TX"; a full "US-TX" works too). Vercel: x-vercel-ip-country-region.
  // Cloudflare: cf-region-code, with the same caveat as cf-ipcountry.
  geoRegionHeader: (read("GEO_REGION_HEADER") ?? "x-vercel-ip-country-region").toLowerCase(),
  clientIpHeader: (read("CLIENT_IP_HEADER") ?? "x-real-ip").toLowerCase(),
};

export const features = {
  privy: Boolean(env.privyAppId),
  llm: Boolean(env.llmBaseUrl && env.llmApiKey),
  embeddings: Boolean(env.embedBaseUrl && env.embedApiKey),
  remoteModeration: Boolean(env.moderationBaseUrl && env.moderationApiKey && env.moderationModel),
  imageModeration: Boolean(env.hiveApiKey),
  tts: Boolean(env.ttsBaseUrl),
  s3: Boolean(env.s3Bucket && env.s3AccessKeyId && env.s3SecretAccessKey),
  payments: Boolean(env.treasuryAddress),
  veriff: Boolean(env.veriffApiKey && env.veriffSharedSecret),
};

// Video callbacks, Veriff's return link and the Solana Pay icon are built from it.
function isPublicHttps(value: string) {
  try {
    const url = new URL(value);
    const local = /^(localhost|127(\.\d+){3}|0\.0\.0\.0|\[::1?\])$|\.localhost$/i.test(url.hostname);
    return url.protocol === "https:" && !local;
  } catch {
    return false;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// The wallet JWT's signing key: an EC private key on P-256 (ES256), or null
// when the PEM isn't one.
export function p256PrivateKey(pem: string): KeyObject | null {
  try {
    const key = createPrivateKey(pem);
    return key.asymmetricKeyType === "ec" && key.asymmetricKeyDetails?.namedCurve === "prime256v1" ? key : null;
  } catch {
    return null;
  }
}

function refuse(problems: string[]) {
  if (problems.length) throw new Error(`Refusing to start in production: ${problems.join("; ")}.`);
}

// Called from instrumentation at boot. Production must not start with a stand-in
// in place of something that protects users or money, or with settings that
// only fail once users arrive.
export function assertProductionConfig() {
  if (!isProduction) return;
  const missing: string[] = [];
  const wrong: string[] = [];
  if (!read("APP_URL")) missing.push("APP_URL");
  else if (!isPublicHttps(env.appUrl)) wrong.push("APP_URL must be the public https:// address");
  if (!env.databaseUrl) missing.push("DATABASE_URL");
  if (!features.privy) missing.push("NEXT_PUBLIC_PRIVY_APP_ID");
  // Privy checks every wallet login against this key's public half (/api/auth/jwks).
  else if (!env.authJwtPrivateKey) missing.push("AUTH_JWT_PRIVATE_KEY");
  else if (!p256PrivateKey(env.authJwtPrivateKey)) wrong.push("AUTH_JWT_PRIVATE_KEY must be an EC P-256 private key (PKCS8 PEM)");
  // Only admins action reports (CSAM included) and lift age locks. Every request
  // resets is_admin from this list, so it can't be granted in the database instead.
  if (!env.adminUserIds.length) missing.push("ADMIN_USER_IDS");
  else if (env.adminUserIds.some((id) => !UUID.test(id))) {
    wrong.push("ADMIN_USER_IDS must be account ids (UUIDs), not usernames");
  }
  if (!features.llm) missing.push("LLM_BASE_URL / LLM_API_KEY");
  // The blocklist alone is English-only and easy to talk around.
  if (!features.remoteModeration) missing.push("MODERATION_BASE_URL / MODERATION_API_KEY / MODERATION_MODEL");
  // The default age gate needs no provider; ID checks need Veriff.
  if (env.ageVerification === "id" && !features.veriff) missing.push("VERIFF_API_KEY / VERIFF_SHARED_SECRET");
  if (!features.imageModeration) missing.push("HIVE_API_KEY");
  if (!features.s3) missing.push("S3_BUCKET / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY");
  // "auto" is R2's region. Against AWS it resolves to a host that doesn't exist.
  else if (!env.s3Endpoint && env.s3Region === "auto") {
    wrong.push("S3_REGION=auto needs S3_ENDPOINT; on AWS set the bucket's region");
  }
  if (!features.payments) missing.push("TREASURY_ADDRESS");
  // The devnet default would mean the devnet USDC mint and no Pyth cross-check.
  if (!read("SOLANA_CLUSTER")) missing.push("SOLANA_CLUSTER");
  if (!env.solanaRpcUrl) missing.push("SOLANA_RPC_URL");
  if (!env.heliusWebhookSecret) missing.push("HELIUS_WEBHOOK_SECRET");
  if (!env.cronSecret) missing.push("CRON_SECRET");
  // Without it, payers are only checked against a short static list.
  if (!env.chainalysisApiKey) missing.push("CHAINALYSIS_API_KEY");
  if (env.imageProvider !== "worker") missing.push("IMAGE_PROVIDER=worker");
  else if (!env.imageApiUrl) missing.push("IMAGE_API_URL");
  if (!env.imageApiKey) missing.push("IMAGE_API_KEY");
  if (env.videoApiUrl && !env.videoApiKey) missing.push("VIDEO_API_KEY");
  // Image moderation needs all three Hive projects: visual classes, apparent age, real people.
  if (!read("HIVE_DEMOGRAPHIC_API_KEY")) missing.push("HIVE_DEMOGRAPHIC_API_KEY");
  if (!read("HIVE_CELEBRITY_API_KEY")) missing.push("HIVE_CELEBRITY_API_KEY");
  // The browser runs on the build's values. A different app id means wallet
  // tokens Privy rejects (their audience is the server's app id); a different
  // cluster means payments the server never sees.
  for (const [name, value] of Object.entries({
    NEXT_PUBLIC_PRIVY_APP_ID: browserEnv.privyAppId,
    NEXT_PUBLIC_SOLANA_CLUSTER: browserEnv.solanaCluster,
    NEXT_PUBLIC_SOLANA_RPC_URL: browserEnv.solanaRpcUrl,
  })) {
    if (!value) wrong.push(`${name} was not set when the app was built`);
  }
  if (browserEnv.privyAppId && env.privyAppId && browserEnv.privyAppId !== env.privyAppId) {
    wrong.push("NEXT_PUBLIC_PRIVY_APP_ID differs from the one the app was built with; rebuild");
  }
  if (browserEnv.solanaCluster && browserEnv.solanaCluster !== env.solanaCluster) {
    wrong.push(
      `the app was built for NEXT_PUBLIC_SOLANA_CLUSTER=${browserEnv.solanaCluster} but SOLANA_CLUSTER=${env.solanaCluster}`,
    );
  }
  refuse([...(missing.length ? [`missing ${missing.join(", ")}`] : []), ...wrong]);
  if (env.solanaCluster === "mainnet" && !read("PYTH_API_KEY")) {
    console.warn("PYTH_API_KEY is not set: SOL checkout is off on mainnet (USDC still works).");
  }
}

const GENESIS_HASHES: Record<SolanaCluster, string> = {
  mainnet: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
  devnet: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
};

// null when the RPC didn't answer. The Origin header lets a domain-restricted
// browser key answer the server.
async function genesisHash(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", origin: new URL(env.appUrl).origin },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getGenesisHash" }),
      signal: AbortSignal.timeout(5_000),
    });
    const body = response.ok ? ((await response.json()) as { result?: unknown }) : null;
    return typeof body?.result === "string" ? body.result : null;
  } catch {
    return null;
  }
}

// Called from instrumentation after assertProductionConfig. A server RPC on the
// wrong cluster would credit devnet faucet SOL; a browser RPC on the wrong one
// sends payments where the server never looks. An RPC that doesn't answer is
// only logged, so a provider outage during a deploy can't take chat down too.
export async function assertSolanaRpcCluster() {
  if (!isProduction) return;
  const expected = GENESIS_HASHES[env.solanaCluster];
  const rpcs = { SOLANA_RPC_URL: env.solanaRpcUrl, NEXT_PUBLIC_SOLANA_RPC_URL: browserEnv.solanaRpcUrl };
  const wrong: string[] = [];
  await Promise.all(
    Object.entries(rpcs).map(async ([name, url]) => {
      if (!url) return;
      const hash = await genesisHash(url);
      if (hash === null) {
        console.error(`Couldn't confirm that ${name} is on ${env.solanaCluster}: getGenesisHash failed.`);
      } else if (hash !== expected) {
        wrong.push(`${name} is not a ${env.solanaCluster} RPC (genesis hash ${hash})`);
      }
    }),
  );
  refuse(wrong);
}
