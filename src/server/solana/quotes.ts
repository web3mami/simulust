import "server-only";
import { features, isProduction } from "@/server/env";
import { HttpError } from "@/server/http";
import { solana, WRAPPED_SOL_MINT } from "@/server/solana/config";

// Jupiter Price API v3. Works without a key at 0.5 req/s; a key (x-api-key)
// raises that. https://developers.jup.ag/docs/price/v3
const JUPITER_URL = `https://api.jup.ag/price/v3?ids=${WRAPPED_SOL_MINT}`;

// Pyth Crypto.SOL/USD. Hermes has required an API key (Authorization: Bearer)
// since the Pyth Core upgrade of 2026-08-26.
// https://docs.pyth.network/price-feeds/core/upgrade/preparing
export const PYTH_SOL_USD_FEED = "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";
const PYTH_URL = `https://hermes.pyth.network/v2/updates/price/latest?ids%5B%5D=0x${PYTH_SOL_USD_FEED}&parsed=true`;

export const MAX_DIVERGENCE = 0.01;
const MAX_PYTH_AGE_S = 120;
const MAX_PYTH_CONFIDENCE = 0.02;
const TIMEOUT_MS = 4_000;

export type SolQuote = {
  usdPerSol: number;
  jupiter: number | null;
  pyth: number | null;
  source: "jupiter+pyth" | "jupiter" | "dev";
  fetchedAt: string;
};

export class QuoteUnavailable extends HttpError {
  constructor(public detail: string) {
    super(503, "We can't price SOL right now. Pay with USDC, or try SOL again in a minute.", "quote_unavailable");
  }
}

type Fetch = typeof fetch;

async function getJson(fetchImpl: Fetch, url: string, headers: Record<string, string>) {
  const response = await fetchImpl(url, { headers, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as unknown;
}

export async function jupiterSolUsd(fetchImpl: Fetch = fetch, apiKey = solana.jupiterApiKey): Promise<number> {
  const body = (await getJson(fetchImpl, JUPITER_URL, apiKey ? { "x-api-key": apiKey } : {})) as Record<
    string,
    { usdPrice?: unknown } | undefined
  >;
  const price = Number(body?.[WRAPPED_SOL_MINT]?.usdPrice);
  if (!Number.isFinite(price) || price <= 0) throw new Error("Jupiter returned no SOL price");
  return price;
}

type HermesPrice = { price: string; conf: string; expo: number; publish_time: number };

export async function pythSolUsd(fetchImpl: Fetch = fetch, apiKey = solana.pythApiKey, now = Date.now()): Promise<number> {
  const body = (await getJson(fetchImpl, PYTH_URL, apiKey ? { Authorization: `Bearer ${apiKey}` } : {})) as {
    parsed?: { id?: string; price?: HermesPrice }[];
  };
  const entry = body?.parsed?.find((item) => item.id?.replace(/^0x/, "").toLowerCase() === PYTH_SOL_USD_FEED);
  const raw = entry?.price;
  if (!raw) throw new Error("Pyth returned no SOL/USD price");
  const scale = 10 ** raw.expo;
  const price = Number(raw.price) * scale;
  const conf = Number(raw.conf) * scale;
  if (!Number.isFinite(price) || price <= 0) throw new Error("Pyth price is invalid");
  if (now / 1000 - raw.publish_time > MAX_PYTH_AGE_S) throw new Error("Pyth price is stale");
  if (conf / price > MAX_PYTH_CONFIDENCE) throw new Error("Pyth price confidence is too wide");
  return price;
}

// Two independent sources must agree within 1% before we lock a SOL amount.
// On devnet without a Pyth key, Jupiter alone is accepted: devnet SOL has no value.
export async function fetchSolQuote(
  fetchImpl: Fetch = fetch,
  options: { requirePyth?: boolean; now?: number } = {},
): Promise<SolQuote> {
  const requirePyth = options.requirePyth ?? (solana.cluster === "mainnet" || Boolean(solana.pythApiKey));
  const [jupiter, pyth] = await Promise.allSettled([
    jupiterSolUsd(fetchImpl),
    requirePyth ? pythSolUsd(fetchImpl, solana.pythApiKey, options.now) : Promise.reject(new Error("skipped")),
  ]);
  const fetchedAt = new Date(options.now ?? Date.now()).toISOString();

  if (jupiter.status === "rejected") throw new QuoteUnavailable(`jupiter: ${String(jupiter.reason)}`);
  if (!requirePyth) return { usdPerSol: jupiter.value, jupiter: jupiter.value, pyth: null, source: "jupiter", fetchedAt };
  if (pyth.status === "rejected") throw new QuoteUnavailable(`pyth: ${String(pyth.reason)}`);

  const divergence = Math.abs(jupiter.value - pyth.value) / Math.min(jupiter.value, pyth.value);
  if (divergence > MAX_DIVERGENCE) {
    throw new QuoteUnavailable(`sources disagree by ${(divergence * 100).toFixed(2)}%`);
  }
  return {
    usdPerSol: (jupiter.value + pyth.value) / 2,
    jupiter: jupiter.value,
    pyth: pyth.value,
    source: "jupiter+pyth",
    fetchedAt,
  };
}

// A short cache keeps a burst of checkouts inside the price APIs' rate limits.
const CACHE_MS = 15_000;
let cached: { quote: SolQuote; at: number } | undefined;

export async function solQuote(): Promise<SolQuote> {
  // Local development with no treasury: nothing can be paid, so a fixed price
  // keeps simulated SOL checkouts working offline.
  if (!features.payments && !isProduction) {
    return { usdPerSol: 150, jupiter: null, pyth: null, source: "dev", fetchedAt: new Date().toISOString() };
  }
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.quote;
  try {
    const quote = await fetchSolQuote();
    cached = { quote, at: Date.now() };
    return quote;
  } catch (error) {
    if (error instanceof QuoteUnavailable) console.warn("SOL quote rejected:", error.detail);
    throw error;
  }
}

// USDC is 1:1 with USD at 6 decimals: one cent is 10,000 base units.
export function usdcUnitsFor(usdCents: number): bigint {
  return BigInt(usdCents) * BigInt(10_000);
}

// Lamports for a USD price, rounded up to the nearest 1,000 lamports so the
// amount shows cleanly at 6 decimals and never undercharges.
export function lamportsFor(usdCents: number, usdPerSol: number): bigint {
  if (!(usdPerSol > 0)) throw new Error("Invalid SOL price");
  const microUsdPerSol = BigInt(Math.round(usdPerSol * 1_000_000));
  const microUsd = BigInt(usdCents) * BigInt(10_000);
  const exact = (microUsd * BigInt(1_000_000_000) + microUsdPerSol - BigInt(1)) / microUsdPerSol;
  const step = BigInt(1000);
  return ((exact + step - BigInt(1)) / step) * step;
}
