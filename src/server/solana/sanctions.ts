import "server-only";
import { env, isProduction } from "@/server/env";

// Solana addresses on OFAC's SDN list ("Digital Currency Address - SOL"), as
// extracted from sdn_advanced.xml by
// https://github.com/0xB10C/ofac-sanctioned-digital-currency-addresses (lists branch, 2026-10-26).
// Refresh from that list when OFAC publishes new designations. SANCTIONS_BLOCKLIST
// (comma-separated) adds more without a deploy.
const OFAC_SOL = [
  "42RLPACwZPx3vYYmxSueqsogfynBDqXK298EDsNoyoHi",
  "6wjqWWra8ombzaw6VHrG5xpQ972jCYF6bbHiFCbWmr4U",
  "Fc1EwQUZyTEagaDvA1utHXCcZNyG1x2PLt2DfNu1cJdH",
  "FuCC7GoYwt5TsNTjWL23Xx9UKCvC18chjMEFPL3vJDCC",
];

const STATIC_BLOCKLIST = new Set([
  ...OFAC_SOL,
  ...(process.env.SANCTIONS_BLOCKLIST ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean),
]);

// Chainalysis free sanctions screening API (OFAC SDN data, launched 2022).
// GET /api/v1/address/{address} with X-API-Key; { identifications: [...] }, empty when clean.
// Its Solana coverage is not documented publicly; confirm with Chainalysis when requesting a key.
const CHAINALYSIS_URL = "https://public.chainalysis.com/api/v1/address/";
const TIMEOUT_MS = 5_000;
const CACHE_MS = 60 * 60_000;

export type Screening = {
  blocked: boolean;
  source: "static" | "chainalysis" | "none" | "dev";
  detail?: string;
};

// The screening service could not give an answer. Callers must not credit the
// payment; they leave it for the reconcile job to retry.
export class ScreeningUnavailable extends Error {}

const cache = new Map<string, { result: Screening; at: number }>();

// Policy when Chainalysis is down: fail closed. The payment is recorded but not
// credited, and every reconcile run retries until the API answers. A paying user
// waits a few minutes in the worst case; a sanctioned payer is never credited
// because a third party was briefly unreachable.
export async function screen(address: string, fetchImpl: typeof fetch = fetch): Promise<Screening> {
  if (STATIC_BLOCKLIST.has(address)) return { blocked: true, source: "static", detail: "OFAC SDN list" };
  if (!env.chainalysisApiKey) {
    // Production requires the key at boot. If it's missing anyway, hold payments
    // rather than screen against four static addresses.
    if (isProduction) throw new ScreeningUnavailable("CHAINALYSIS_API_KEY is not set");
    return { blocked: false, source: "none" };
  }

  const hit = cache.get(address);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.result;

  let response: Response;
  try {
    response = await fetchImpl(`${CHAINALYSIS_URL}${encodeURIComponent(address)}`, {
      headers: { "X-API-Key": env.chainalysisApiKey, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new ScreeningUnavailable(`Chainalysis unreachable: ${String(error)}`);
  }
  if (!response.ok) throw new ScreeningUnavailable(`Chainalysis returned ${response.status}`);
  const body = (await response.json().catch(() => null)) as { identifications?: { name?: string }[] } | null;
  if (!body || !Array.isArray(body.identifications)) throw new ScreeningUnavailable("Chainalysis returned an unexpected body");

  const result: Screening = body.identifications.length
    ? { blocked: true, source: "chainalysis", detail: body.identifications.map((item) => item.name).filter(Boolean).join("; ") }
    : { blocked: false, source: "chainalysis" };
  if (cache.size > 5_000) cache.clear();
  cache.set(address, { result, at: Date.now() });
  return result;
}
