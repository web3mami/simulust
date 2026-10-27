import { describe, expect, it } from "vitest";
import { fetchSolQuote, lamportsFor, PYTH_SOL_USD_FEED, QuoteUnavailable, usdcUnitsFor } from "@/server/solana/quotes";

const NOW = Date.parse("2026-10-26T12:00:00Z");

function mockFetch({ jupiter, pyth }: { jupiter: number | "down"; pyth: number | "down" }) {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.startsWith("https://api.jup.ag/")) {
      if (jupiter === "down") return new Response("unavailable", { status: 503 });
      return Response.json({ So11111111111111111111111111111111111111112: { usdPrice: jupiter, decimals: 9 } });
    }
    if (url.startsWith("https://hermes.pyth.network/")) {
      if (pyth === "down") return new Response("unauthorized", { status: 401 });
      return Response.json({
        parsed: [
          {
            id: PYTH_SOL_USD_FEED,
            price: { price: String(Math.round(pyth * 1e8)), conf: "5000000", expo: -8, publish_time: NOW / 1000 - 5 },
          },
        ],
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
}

describe("SOL quotes", () => {
  it("averages two sources that agree", async () => {
    const quote = await fetchSolQuote(mockFetch({ jupiter: 150, pyth: 150.9 }), { requirePyth: true, now: NOW });
    expect(quote.source).toBe("jupiter+pyth");
    expect(quote.usdPerSol).toBeCloseTo(150.45, 6);
  });

  it("rejects sources more than 1% apart", async () => {
    await expect(
      fetchSolQuote(mockFetch({ jupiter: 150, pyth: 152 }), { requirePyth: true, now: NOW }),
    ).rejects.toBeInstanceOf(QuoteUnavailable);
  });

  it("rejects when either source is down", async () => {
    await expect(
      fetchSolQuote(mockFetch({ jupiter: 150, pyth: "down" }), { requirePyth: true, now: NOW }),
    ).rejects.toBeInstanceOf(QuoteUnavailable);
    await expect(
      fetchSolQuote(mockFetch({ jupiter: "down", pyth: 150 }), { requirePyth: true, now: NOW }),
    ).rejects.toBeInstanceOf(QuoteUnavailable);
  });

  it("rejects a stale Pyth price", async () => {
    await expect(
      fetchSolQuote(mockFetch({ jupiter: 150, pyth: 150 }), { requirePyth: true, now: NOW + 10 * 60_000 }),
    ).rejects.toBeInstanceOf(QuoteUnavailable);
  });

  it("allows Jupiter alone only when the cross-check is off (devnet without a Pyth key)", async () => {
    const quote = await fetchSolQuote(mockFetch({ jupiter: 150, pyth: "down" }), { requirePyth: false, now: NOW });
    expect(quote).toMatchObject({ source: "jupiter", usdPerSol: 150, pyth: null });
  });
});

describe("amounts", () => {
  it("prices USDC 1:1 at 6 decimals", () => {
    expect(usdcUnitsFor(499)).toBe(BigInt(4_990_000));
    expect(usdcUnitsFor(1299)).toBe(BigInt(12_990_000));
  });

  it("rounds SOL up to a clean amount and never undercharges", () => {
    const lamports = lamportsFor(499, 150);
    expect(lamports % BigInt(1000)).toBe(BigInt(0));
    expect(Number(lamports) / 1e9 * 150).toBeGreaterThanOrEqual(4.99);
    expect(Number(lamports) / 1e9 * 150).toBeLessThan(4.991);
  });
});
