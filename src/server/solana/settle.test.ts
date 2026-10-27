import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { currentUser } from "@/server/auth";
import { balanceOf } from "@/server/credits";
import { db } from "@/server/db";
import { creditLedger, extraPayments, orders, users, type User } from "@/server/db/schema";
import { DAILY_PURCHASE_CAP_CENTS, newReference } from "@/server/solana/orders";
import { ScreeningUnavailable } from "@/server/solana/sanctions";
import { finalize, markUnderpaid, settle } from "@/server/solana/settle";
import type { Commitment, Payment } from "@/server/solana/verify";
import { lockForAgeReview } from "@/server/veriff";
import { FREE, MEMBERSHIP, findProduct } from "@/lib/pricing";

const TREASURY = "TreasuryWa11et1111111111111111111111111111";
const PAYER = "PayerWa11et11111111111111111111111111111111";
const OTHER = "0therWa11et11111111111111111111111111111111";
// On OFAC's SDN list (see sanctions.ts).
const SANCTIONED = "42RLPACwZPx3vYYmxSueqsogfynBDqXK298EDsNoyoHi";
const clean = async () => ({ blocked: false, source: "none" as const });
const HOUR = 60 * 60_000;

function paid(signature: string, payer: string, commitment: Commitment, extra: Partial<Payment> = {}): Payment {
  return { signature, payer, payers: [payer], received: BigInt(4_990_000), accounts: [], commitment, paidAt: null, ...extra };
}

async function user(handle: string): Promise<User> {
  const found = await currentUser(new Request("http://localhost/api/me", { headers: { "x-dev-user": handle } }));
  return found!;
}

async function order(owner: User, productId: string, values: Partial<typeof orders.$inferInsert> = {}) {
  const product = findProduct(productId)!;
  const database = await db();
  const [row] = await database
    .insert(orders)
    .values({
      userId: owner.id,
      productId,
      usdCents: product.usdCents,
      currency: "USDC",
      mint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
      amount: BigInt(product.usdCents) * BigInt(10_000),
      recipient: TREASURY,
      reference: newReference(),
      expiresAt: new Date(Date.now() + 15 * 60_000),
      ...values,
    })
    .returning();
  return row;
}

async function load(id: string) {
  const database = await db();
  const [row] = await database.select().from(orders).where(eq(orders.id, id));
  return row;
}

async function extrasFor(orderId: string) {
  const database = await db();
  return database.select().from(extraPayments).where(eq(extraPayments.orderId, orderId));
}

async function ledgerFor(userId: string, reason: "purchase" | "membership") {
  const database = await db();
  return database
    .select()
    .from(creditLedger)
    .where(and(eq(creditLedger.userId, userId), eq(creditLedger.reason, reason)));
}

describe("settle", () => {
  beforeAll(async () => {
    await db();
  });

  it("credits a payment once, however many times it is reported", async () => {
    const buyer = await user("settle-twice");
    const pack = await order(buyer, "credits-1100");
    const first = await settle(pack.id, paid("sig-twice-1", PAYER, "confirmed"), { screen: clean });
    const again = await settle(pack.id, paid("sig-twice-1", PAYER, "confirmed"), { screen: clean });
    const racing = await Promise.all([
      settle(pack.id, paid("sig-twice-1", PAYER, "confirmed"), { screen: clean }),
      settle(pack.id, paid("sig-twice-1", PAYER, "confirmed"), { screen: clean }),
    ]);

    expect(first).toMatchObject({ status: "confirmed", credited: true });
    expect(again).toMatchObject({ credited: false, reason: "already_settled" });
    expect(racing.every((result) => !result.credited)).toBe(true);
    expect(await balanceOf(buyer.id)).toBe(FREE.signupCredits + 1100);
    expect(await ledgerFor(buyer.id, "purchase")).toHaveLength(1);

    const row = await load(pack.id);
    expect(row).toMatchObject({ status: "confirmed", signature: "sig-twice-1", payer: PAYER });
    expect(row.confirmedAt).toBeInstanceOf(Date);
  });

  it("moves a confirmed order to finalized without crediting again", async () => {
    const buyer = await user("settle-finalize");
    const pack = await order(buyer, "credits-500");
    await settle(pack.id, paid("sig-final-1", PAYER, "confirmed"), { screen: clean });
    expect(await finalize(pack.id)).toBe(true);
    expect(await finalize(pack.id)).toBe(false);
    const late = await settle(pack.id, paid("sig-final-1", PAYER, "finalized"), { screen: clean });

    expect(late.credited).toBe(false);
    expect((await load(pack.id)).status).toBe("finalized");
    expect(await balanceOf(buyer.id)).toBe(FREE.signupCredits + 500);
  });

  it("refuses to let one transaction pay two orders", async () => {
    const buyer = await user("settle-shared-sig");
    const a = await order(buyer, "credits-500");
    const b = await order(buyer, "credits-500");
    await settle(a.id, paid("sig-shared", PAYER, "confirmed"), { screen: clean });
    const second = await settle(b.id, paid("sig-shared", PAYER, "confirmed"), { screen: clean });

    expect(second).toMatchObject({ credited: false, reason: "signature_used" });
    expect((await load(b.id)).status).toBe("pending");
    expect(await balanceOf(buyer.id)).toBe(FREE.signupCredits + 500);
  });

  it("starts and then extends a membership", async () => {
    const member = await user("settle-member");
    const now = new Date("2026-10-26T12:00:00Z");
    const first = await order(member, MEMBERSHIP.id);
    await settle(first.id, paid("sig-member-1", PAYER, "confirmed"), { screen: clean, now });

    const database = await db();
    const [afterFirst] = await database.select().from(users).where(eq(users.id, member.id));
    const day = 24 * 60 * 60_000;
    // memberUntil starts from max(now, memberUntil); with no membership yet that's the settle time.
    expect(afterFirst.memberUntil!.getTime()).toBe(now.getTime() + 30 * day);

    const later = new Date(now.getTime() + 5 * day);
    const second = await order(member, MEMBERSHIP.id, { expiresAt: new Date(later.getTime() + 15 * 60_000) });
    await settle(second.id, paid("sig-member-2", PAYER, "confirmed"), { screen: clean, now: later });
    const [afterSecond] = await database.select().from(users).where(eq(users.id, member.id));
    expect(afterSecond.memberUntil!.getTime()).toBe(now.getTime() + 60 * day);

    expect(await balanceOf(member.id)).toBe(FREE.signupCredits + 2 * MEMBERSHIP.credits);
    expect(await ledgerFor(member.id, "membership")).toHaveLength(2);
  });

  it("restarts a lapsed membership from today", async () => {
    const member = await user("settle-lapsed");
    const database = await db();
    const now = new Date("2026-10-26T12:00:00Z");
    await database.update(users).set({ memberUntil: new Date("2026-01-01T00:00:00Z") }).where(eq(users.id, member.id));
    const renewal = await order(member, MEMBERSHIP.id);
    await settle(renewal.id, paid("sig-lapsed-1", PAYER, "confirmed"), { screen: clean, now });
    const [row] = await database.select().from(users).where(eq(users.id, member.id));
    expect(row.memberUntil!.getTime()).toBe(now.getTime() + 30 * 24 * 60 * 60_000);
  });

  it("blocks a sanctioned payer and credits nothing", async () => {
    const buyer = await user("settle-blocked");
    const pack = await order(buyer, "credits-3000");
    const result = await settle(pack.id, paid("sig-blocked-1", SANCTIONED, "confirmed"));

    expect(result).toMatchObject({ status: "blocked", credited: false, reason: "blocked" });
    const row = await load(pack.id);
    expect(row).toMatchObject({ status: "blocked", payer: SANCTIONED, signature: "sig-blocked-1" });
    expect(await balanceOf(buyer.id)).toBe(FREE.signupCredits);
    expect(await ledgerFor(buyer.id, "purchase")).toHaveLength(0);

    const retry = await settle(pack.id, paid("sig-blocked-1", SANCTIONED, "finalized"));
    expect(retry.credited).toBe(false);
  });

  it("holds the payment without crediting while screening is down, then settles on retry", async () => {
    const buyer = await user("settle-screen-down");
    const pack = await order(buyer, "credits-500");
    const down = async (): Promise<never> => {
      throw new ScreeningUnavailable("timeout");
    };
    const held = await settle(pack.id, paid("sig-down-1", PAYER, "confirmed"), { screen: down });

    expect(held).toMatchObject({ status: "pending", credited: false, reason: "screening_unavailable" });
    expect(await load(pack.id)).toMatchObject({ status: "pending", signature: "sig-down-1" });
    expect(await balanceOf(buyer.id)).toBe(FREE.signupCredits);

    const later = await settle(pack.id, paid("sig-down-1", PAYER, "confirmed"), { screen: clean });
    expect(later.credited).toBe(true);
    expect(await balanceOf(buyer.id)).toBe(FREE.signupCredits + 500);
  });

  it("still credits a payment that lands after the checkout expired", async () => {
    const buyer = await user("settle-late");
    const pack = await order(buyer, "credits-500");
    const database = await db();
    await database.update(orders).set({ status: "expired" }).where(eq(orders.id, pack.id));
    const result = await settle(pack.id, paid("sig-late-1", PAYER, "confirmed"), { screen: clean });
    expect(result.credited).toBe(true);
  });

  it("credits a payment whose block landed inside the late window, even when screening answers later", async () => {
    const buyer = await user("settle-late-window");
    const closed = new Date(Date.now() - 3 * HOUR);
    const pack = await order(buyer, "credits-500", { status: "expired", expiresAt: closed });
    const paidAt = new Date(closed.getTime() + 50 * 60_000);
    const down = async (): Promise<never> => {
      throw new ScreeningUnavailable("timeout");
    };
    await settle(pack.id, paid("sig-window-1", PAYER, "confirmed", { paidAt }), { screen: down });
    expect(await load(pack.id)).toMatchObject({ status: "expired", signature: "sig-window-1" });

    const result = await settle(pack.id, paid("sig-window-1", PAYER, "confirmed", { paidAt }), { screen: clean });
    expect(result).toMatchObject({ status: "confirmed", credited: true });
  });

  it("keeps a payment that lands after the late window for a refund instead of crediting it", async () => {
    const buyer = await user("settle-too-late");
    const closed = new Date(Date.now() - 30 * 24 * HOUR);
    const pack = await order(buyer, "credits-500", { status: "expired", expiresAt: closed });
    const paidAt = new Date(closed.getTime() + HOUR + 60_000);
    const result = await settle(pack.id, paid("sig-too-late-1", PAYER, "confirmed", { paidAt }), { screen: clean });

    expect(result).toMatchObject({ status: "refund_due", credited: false, reason: "too_late" });
    const row = await load(pack.id);
    expect(row).toMatchObject({ status: "refund_due", signature: "sig-too-late-1", payer: PAYER });
    expect(row.error).toMatch(/61 minutes after the checkout closed/);
    const again = await settle(pack.id, paid("sig-too-late-1", PAYER, "finalized", { paidAt }), { screen: clean });
    expect(again.credited).toBe(false);
    expect(await balanceOf(buyer.id)).toBe(FREE.signupCredits);
    expect(await ledgerFor(buyer.id, "purchase")).toHaveLength(0);
  });

  it("judges a payment without a block time by when it settles, even on an order never marked expired", async () => {
    const buyer = await user("settle-no-block-time");
    const pack = await order(buyer, "credits-500", { expiresAt: new Date(Date.now() - 2 * HOUR) });
    const result = await settle(pack.id, paid("sig-no-time-1", PAYER, "confirmed"), { screen: clean });
    expect(result).toMatchObject({ status: "refund_due", credited: false, reason: "too_late" });
  });

  it("blocks when any signer or sender is listed, and records everyone screened", async () => {
    const buyer = await user("settle-any-listed");
    const pack = await order(buyer, "credits-500");
    const screened: string[] = [];
    const screen = async (address: string) => {
      screened.push(address);
      return { blocked: address === SANCTIONED, source: "static" as const };
    };
    // The refund address is the clean wallet; the sanctioned one only signed and sent less.
    const result = await settle(pack.id, paid("sig-decoy-1", PAYER, "confirmed", { payers: [SANCTIONED, PAYER] }), {
      screen,
    });

    expect(result).toMatchObject({ status: "blocked", credited: false, reason: "blocked" });
    expect(screened.sort()).toEqual([PAYER, SANCTIONED].sort());
    const row = await load(pack.id);
    expect(row).toMatchObject({ status: "blocked", payer: PAYER, signature: "sig-decoy-1" });
    expect(row.payers.sort()).toEqual([PAYER, SANCTIONED].sort());
    expect(row.error).toContain(SANCTIONED);
    expect(await balanceOf(buyer.id)).toBe(FREE.signupCredits);
  });

  it("holds the payment when any address can't be screened", async () => {
    const buyer = await user("settle-partial-screen");
    const pack = await order(buyer, "credits-500");
    const screen = async (address: string) => {
      if (address === OTHER) throw new ScreeningUnavailable("timeout");
      return { blocked: false, source: "chainalysis" as const };
    };
    const result = await settle(pack.id, paid("sig-partial-1", PAYER, "confirmed", { payers: [PAYER, OTHER] }), {
      screen,
    });
    expect(result).toMatchObject({ credited: false, reason: "screening_unavailable" });
    expect(await load(pack.id)).toMatchObject({ status: "pending", signature: "sig-partial-1", payers: [PAYER, OTHER] });
  });

  it("keeps a second payment to a settled order for a refund, once", async () => {
    const buyer = await user("settle-repeat");
    const pack = await order(buyer, "credits-500");
    await settle(pack.id, paid("sig-repeat-1", PAYER, "confirmed"), { screen: clean });
    const second = await settle(pack.id, paid("sig-repeat-2", OTHER, "confirmed"), { screen: clean });
    await settle(pack.id, paid("sig-repeat-2", OTHER, "finalized"), { screen: clean });

    expect(second).toMatchObject({ status: "confirmed", credited: false, reason: "repeat" });
    const row = await load(pack.id);
    expect(row).toMatchObject({ status: "confirmed", signature: "sig-repeat-1" });
    expect(await extrasFor(pack.id)).toEqual([
      expect.objectContaining({ signature: "sig-repeat-2", payer: OTHER, received: BigInt(4_990_000), reason: "repeat" }),
    ]);
    expect(await balanceOf(buyer.id)).toBe(FREE.signupCredits + 500);
  });

  it("treats a second payment as a repeat while the first waits on screening", async () => {
    const buyer = await user("settle-repeat-held");
    const pack = await order(buyer, "credits-500");
    const down = async (): Promise<never> => {
      throw new ScreeningUnavailable("timeout");
    };
    await settle(pack.id, paid("sig-held-1", PAYER, "confirmed"), { screen: down });
    const second = await settle(pack.id, paid("sig-held-2", PAYER, "confirmed"), { screen: clean });
    expect(second).toMatchObject({ credited: false, reason: "repeat" });

    const first = await settle(pack.id, paid("sig-held-1", PAYER, "confirmed"), { screen: clean });
    expect(first.credited).toBe(true);
    expect((await load(pack.id)).signature).toBe("sig-held-1");
    expect((await extrasFor(pack.id)).map((extra) => extra.signature)).toEqual(["sig-held-2"]);
  });

  it("keeps a short payment on record after a full one settles the order", async () => {
    const buyer = await user("settle-short");
    const pack = await order(buyer, "credits-500");
    const short = { signature: "sig-short-1", payer: PAYER, payers: [PAYER], received: BigInt(1_000_000), accounts: [] };
    expect(await markUnderpaid(pack.id, short)).toBe(true);
    expect(await markUnderpaid(pack.id, short)).toBe(false);
    expect((await load(pack.id)).status).toBe("underpaid");

    const full = await settle(pack.id, paid("sig-short-2", PAYER, "confirmed"), { screen: clean });
    expect(full.credited).toBe(true);
    const row = await load(pack.id);
    expect(row).toMatchObject({ status: "confirmed", signature: "sig-short-2", error: null });
    expect(await extrasFor(pack.id)).toEqual([
      expect.objectContaining({ signature: "sig-short-1", received: BigInt(1_000_000), reason: "short" }),
    ]);
  });

  it("keeps a payment for a deleted account for a refund", async () => {
    const buyer = await user("settle-deleted");
    const pack = await order(buyer, "credits-500");
    const database = await db();
    await database.delete(users).where(eq(users.id, buyer.id));
    const result = await settle(pack.id, paid("sig-deleted-1", PAYER, "confirmed"), { screen: clean });

    expect(result).toMatchObject({ status: "refund_due", credited: false, reason: "account_deleted" });
    expect(await load(pack.id)).toMatchObject({ status: "refund_due", userId: null, signature: "sig-deleted-1" });
  });

  it("keeps a payment to a banned account for a refund instead of crediting it", async () => {
    const buyer = await user("settle-banned");
    const pack = await order(buyer, "credits-500");
    const database = await db();
    await database.update(users).set({ bannedAt: new Date() }).where(eq(users.id, buyer.id));
    const result = await settle(pack.id, paid("sig-banned-1", PAYER, "confirmed"), { screen: clean });

    expect(result).toMatchObject({ status: "refund_due", credited: false, reason: "account_suspended" });
    expect(await load(pack.id)).toMatchObject({ status: "refund_due", signature: "sig-banned-1", payer: PAYER });
    expect(await ledgerFor(buyer.id, "purchase")).toHaveLength(0);
  });

  it("keeps a minor's payment for a refund when an age check locks the account while the checkout is open", async () => {
    const buyer = await user("settle-age-locked");
    const pack = await order(buyer, "credits-6500");
    const database = await db();
    await database.transaction((tx) => lockForAgeReview(tx, buyer.id, { note: "under 18" }));
    const result = await settle(pack.id, paid("sig-minor-1", PAYER, "confirmed", { received: pack.amount }), {
      screen: clean,
    });

    expect(result).toMatchObject({ status: "refund_due", credited: false, reason: "account_suspended" });
    expect(await balanceOf(buyer.id)).toBe(FREE.signupCredits);
  });

  it("refunds a late payment first seen after its checkout stopped counting toward the daily cap, once the cap is used", async () => {
    const buyer = await user("settle-cap-edge");
    const closed = new Date(Date.now() - 63 * 60_000);
    const late = await order(buyer, "credits-6500", { status: "expired", expiresAt: closed });
    // Checkouts opened after the late one stopped counting, up to the cap.
    const pack = findProduct("credits-6500")!;
    for (let spent = 0; spent + pack.usdCents <= DAILY_PURCHASE_CAP_CENTS; spent += pack.usdCents) {
      await order(buyer, pack.id, { status: "finalized" });
    }
    // Paid 59 minutes after it closed, but our RPC only saw it now.
    const paidAt = new Date(closed.getTime() + 59 * 60_000);
    const result = await settle(late.id, paid("sig-cap-edge-1", PAYER, "confirmed", { paidAt, received: late.amount }), {
      screen: clean,
    });

    expect(result).toMatchObject({ status: "refund_due", credited: false, reason: "over_limit" });
    expect(await ledgerFor(buyer.id, "purchase")).toHaveLength(0);

    // Seen while it still counted toward the cap, a late payment is credited:
    // the cap was checked when the checkout opened.
    const inTime = await order(buyer, "credits-500", { status: "expired", expiresAt: new Date(Date.now() - 30 * 60_000) });
    const credited = await settle(inTime.id, paid("sig-cap-edge-2", PAYER, "confirmed"), { screen: clean });
    expect(credited.credited).toBe(true);
  });
});

describe("payments kept for a refund", () => {
  it("never keeps a transaction that names several orders against any of them, and credits at most one", async () => {
    const buyer = await user("settle-multi-ref");
    const settled = await order(buyer, "credits-500");
    await settle(settled.id, paid("sig-multi-0", PAYER, "confirmed"), { screen: clean });
    const big = await order(buyer, "credits-6500");
    const small = await order(buyer, "credits-500");
    const accounts = [settled.reference, big.reference, small.reference];
    const shared = { accounts, received: BigInt(4_990_000) };

    // One 4.99 transfer naming all three: a repeat on the settled order, short
    // on the big one, enough for the small one.
    const repeat = await settle(settled.id, paid("sig-multi-1", OTHER, "confirmed", shared), { screen: clean });
    expect(repeat).toMatchObject({ credited: false, reason: "repeat" });
    expect(await markUnderpaid(big.id, { ...shared, signature: "sig-multi-1", payer: OTHER, payers: [OTHER] })).toBe(false);
    const credited = await settle(small.id, paid("sig-multi-1", OTHER, "confirmed", shared), { screen: clean });

    expect(credited).toMatchObject({ status: "confirmed", credited: true });
    expect(await load(big.id)).toMatchObject({ status: "pending", error: null });
    const database = await db();
    expect(await database.select().from(extraPayments).where(eq(extraPayments.signature, "sig-multi-1"))).toEqual([]);
    expect(await balanceOf(buyer.id)).toBe(FREE.signupCredits + 1000);
  });

  it("keeps each signature once, with what it actually sent, and never one that is some order's payment", async () => {
    const buyer = await user("settle-once");
    const first = await order(buyer, "credits-500");
    const second = await order(buyer, "credits-500");
    await settle(first.id, paid("sig-once-1", PAYER, "confirmed"), { screen: clean });
    await settle(second.id, paid("sig-once-2", PAYER, "confirmed"), { screen: clean });

    // Another order's own payment is never kept as a repeat here.
    await settle(first.id, paid("sig-once-2", PAYER, "confirmed", { accounts: [first.reference] }), { screen: clean });
    expect(await extrasFor(first.id)).toEqual([]);

    const extra = paid("sig-once-3", OTHER, "confirmed", { accounts: [first.reference], received: BigInt(7_000_000) });
    await settle(first.id, extra, { screen: clean });
    await settle(first.id, { ...extra, commitment: "finalized" }, { screen: clean });
    expect(await markUnderpaid(first.id, { ...extra, received: BigInt(1) })).toBe(false);
    expect(await extrasFor(first.id)).toEqual([
      expect.objectContaining({ signature: "sig-once-3", reason: "repeat", received: BigInt(7_000_000) }),
    ]);
  });
});
