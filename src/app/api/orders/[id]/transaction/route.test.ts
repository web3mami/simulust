import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.SOLANA_CLUSTER = "devnet";
  process.env.TREASURY_ADDRESS = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
});

const { currentUser } = await import("@/server/auth");
const { balanceOf } = await import("@/server/credits");
const { db } = await import("@/server/db");
const { orders, users } = await import("@/server/db/schema");
const { createOrder } = await import("@/server/solana/orders");
const { settle } = await import("@/server/solana/settle");
const { lockForAgeReview } = await import("@/server/veriff");
const { GET, POST } = await import("@/app/api/orders/[id]/transaction/route");
const { MIN_REMAINING_MS } = await import("@/lib/checkout");
const { FREE } = await import("@/lib/pricing");
const { eq } = await import("drizzle-orm");

const PAYER = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";

async function owner(handle: string) {
  return (await currentUser(new Request("http://localhost/api/me", { headers: { "x-dev-user": handle } })))!;
}

const build = (id: string) =>
  call(POST, id, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ account: PAYER }),
  });

function call(handler: typeof GET | typeof POST, id: string, init: RequestInit = {}) {
  return handler(new Request(`http://localhost/api/orders/${id}/transaction`, init), {
    params: Promise.resolve({ id }),
  });
}

describe("Solana Pay transaction request", () => {
  it("refuses to build a payment for an order whose account was deleted", async () => {
    const order = await createOrder(await owner("tx-route-orphan"), "credits-6500", "USDC");
    expect((await call(GET, order.id)).status).toBe(200);

    // What account deletion leaves behind: the order outlives the user, unlinked.
    await (await db()).update(orders).set({ userId: null }).where(eq(orders.id, order.id));
    const label = await call(GET, order.id);
    const built = await build(order.id);

    expect(label.status).toBe(410);
    expect(built.status).toBe(410);
    expect(await built.json()).toMatchObject({ code: "order_closed" });
  });

  it("closes a minor's open checkout once an age check locks the account, and refunds a payment sent anyway", async () => {
    const minor = await owner("tx-route-age-locked");
    const order = await createOrder(minor, "credits-6500", "USDC");
    expect((await call(GET, order.id)).status).toBe(200);

    await (await db()).transaction((tx) => lockForAgeReview(tx, minor.id, { note: "Veriff read an under-18 birth date." }));
    expect((await call(GET, order.id)).status).toBe(410);
    expect((await build(order.id)).status).toBe(410);

    const payment = {
      signature: "sig-tx-route-minor",
      payer: PAYER,
      payers: [PAYER],
      received: order.amount,
      accounts: [order.reference],
      commitment: "confirmed" as const,
      paidAt: null,
    };
    const result = await settle(order.id, payment, { screen: async () => ({ blocked: false, source: "none" as const }) });
    expect(result).toMatchObject({ status: "refund_due", credited: false });
    expect(await balanceOf(minor.id)).toBe(FREE.signupCredits);
  });

  it("closes a banned account's open checkout", async () => {
    const banned = await owner("tx-route-banned");
    const order = await createOrder(banned, "credits-500", "USDC");
    await (await db()).update(users).set({ bannedAt: new Date() }).where(eq(users.id, banned.id));
    expect((await call(GET, order.id)).status).toBe(410);
  });

  it("stops building payments when as little of the price hold is left as the checkout stops offering them", async () => {
    const buyer = await owner("tx-route-last-minute");
    const order = await createOrder(buyer, "credits-500", "USDC");
    const hold = async (ms: number) =>
      (await db()).update(orders).set({ expiresAt: new Date(Date.now() + ms) }).where(eq(orders.id, order.id));

    // The checkout offers to pay only while more than MIN_REMAINING_MS is left.
    await hold(MIN_REMAINING_MS + 10_000);
    expect((await call(GET, order.id)).status).toBe(200);
    await hold(45_000);
    expect((await call(GET, order.id)).status).toBe(410);
    expect(await (await build(order.id)).json()).toMatchObject({ code: "order_closed" });
  });
});
