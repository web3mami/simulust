import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

vi.hoisted(() => {
  process.env.SOLANA_CLUSTER = "devnet";
  process.env.TREASURY_ADDRESS = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
});

const { currentUser } = await import("@/server/auth");
const { db } = await import("@/server/db");
const { orders } = await import("@/server/db/schema");
const { HttpError } = await import("@/server/http");
const { createOrder, DAILY_PURCHASE_CAP_CENTS, payable, toOrderDTO } = await import("@/server/solana/orders");

const MINUTE = 60_000;

async function user(handle: string) {
  return (await currentUser(new Request("http://localhost/api/me", { headers: { "x-dev-user": handle } })))!;
}

async function spent(userId: string) {
  const rows = await (await db()).select().from(orders).where(eq(orders.userId, userId));
  return rows.reduce((sum, row) => sum + row.usdCents, 0);
}

function isCapError(error: unknown) {
  return error instanceof HttpError && error.code === "purchase_limit";
}

describe("createOrder", () => {
  it("lets only as many concurrent checkouts through as fit under the daily cap", async () => {
    const buyer = await user("orders-race");
    const database = await db();
    // 19 paid Inferno packs: $949.81, room for one more.
    for (let i = 0; i < 19; i++) {
      const order = await createOrder(buyer, "credits-6500", "USDC");
      await database.update(orders).set({ status: "finalized" }).where(eq(orders.id, order.id));
    }
    const burst = await Promise.allSettled(Array.from({ length: 10 }, () => createOrder(buyer, "credits-6500", "USDC")));

    expect(burst.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(burst.every((result) => result.status === "fulfilled" || isCapError(result.reason))).toBe(true);
    expect(await spent(buyer.id)).toBeLessThanOrEqual(DAILY_PURCHASE_CAP_CENTS);
  });

  it("counts closed checkouts that can still be paid late toward the cap", async () => {
    const buyer = await user("orders-late-cap");
    const database = await db();
    for (let i = 0; i < 20; i++) await createOrder(buyer, "credits-6500", "USDC");
    await expect(createOrder(buyer, "credits-6500", "USDC")).rejects.toSatisfy(isCapError);

    // Closed half an hour ago: a payment could still be credited, so they still count.
    await database
      .update(orders)
      .set({ status: "expired", expiresAt: new Date(Date.now() - 30 * MINUTE) })
      .where(eq(orders.userId, buyer.id));
    await expect(createOrder(buyer, "credits-6500", "USDC")).rejects.toSatisfy(isCapError);

    // Past the late window they can't be paid any more and stop counting.
    await database
      .update(orders)
      .set({ expiresAt: new Date(Date.now() - 2 * 60 * MINUTE) })
      .where(eq(orders.userId, buyer.id));
    await expect(createOrder(buyer, "credits-6500", "USDC")).resolves.toMatchObject({ status: "pending" });
  });
});

describe("toOrderDTO", () => {
  it("hands out payment details only while the order is open", async () => {
    const buyer = await user("orders-dto");
    const order = await createOrder(buyer, "credits-500", "USDC");
    expect(toOrderDTO(order, buyer).solanaPayUrl).toMatch(/^solana:7xKX.*reference=/);
    expect(toOrderDTO(order, buyer).reference).toBe(order.reference);

    for (const closed of [
      { ...order, status: "expired" as const },
      { ...order, expiresAt: new Date(Date.now() - MINUTE) },
      { ...order, status: "refund_due" as const },
    ]) {
      expect(toOrderDTO(closed, buyer)).toMatchObject({ solanaPayUrl: "", recipient: "", reference: "" });
    }
  });

  it("treats an order whose account was deleted, banned or locked for an age review as closed", async () => {
    const buyer = await user("orders-orphan");
    const order = await createOrder(buyer, "credits-500", "USDC");
    expect(payable(order, buyer)).toBe(true);
    expect(payable({ ...order, userId: null }, null)).toBe(false);

    const banned = { ...buyer, bannedAt: new Date() };
    expect(payable(order, banned)).toBe(false);
    expect(toOrderDTO(order, banned)).toMatchObject({ solanaPayUrl: "", recipient: "", reference: "" });
  });
});
