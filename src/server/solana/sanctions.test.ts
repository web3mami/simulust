import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

// Production with CHAINALYSIS_API_KEY missing.
vi.mock("@/server/env", async (original) => {
  const actual = await original<typeof import("@/server/env")>();
  return { ...actual, isProduction: true, env: { ...actual.env, chainalysisApiKey: undefined } };
});

const { db } = await import("@/server/db");
const { orders } = await import("@/server/db/schema");
const { newReference } = await import("@/server/solana/orders");
const { screen, ScreeningUnavailable } = await import("@/server/solana/sanctions");
const { settle } = await import("@/server/solana/settle");

const CLEAN = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const SANCTIONED = "42RLPACwZPx3vYYmxSueqsogfynBDqXK298EDsNoyoHi";

describe("screen in production without a Chainalysis key", () => {
  it("still blocks an address on the static list", async () => {
    await expect(screen(SANCTIONED)).resolves.toMatchObject({ blocked: true, source: "static" });
  });

  it("refuses to pass any other address", async () => {
    await expect(screen(CLEAN)).rejects.toBeInstanceOf(ScreeningUnavailable);
  });

  it("makes settle hold the payment instead of crediting it", async () => {
    const database = await db();
    const [order] = await database
      .insert(orders)
      .values({
        productId: "credits-500",
        usdCents: 499,
        currency: "USDC",
        amount: BigInt(4_990_000),
        recipient: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
        reference: newReference(),
        expiresAt: new Date(Date.now() + 15 * 60_000),
      })
      .returning();
    const payment = {
      signature: "sig-no-key-1",
      payer: CLEAN,
      payers: [CLEAN],
      received: order.amount,
      accounts: [order.reference],
      commitment: "confirmed" as const,
      paidAt: null,
    };

    expect(await settle(order.id, payment)).toMatchObject({ credited: false, reason: "screening_unavailable" });
    const [row] = await database.select().from(orders).where(eq(orders.id, order.id));
    expect(row).toMatchObject({ status: "pending", signature: "sig-no-key-1", error: "Waiting for sanctions screening." });
  });
});
