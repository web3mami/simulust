import "server-only";
import { and, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { grant, isUniqueViolation, lockUser } from "@/server/credits";
import { db, type Db, type Tx } from "@/server/db";
import { extraPayments, orders, users, type ExtraPayment, type Order } from "@/server/db/schema";
import { LATE_PAYMENT_MS } from "@/server/solana/config";
import { awaitingPayment, DAILY_PURCHASE_CAP_CENTS, productFor, spentToday } from "@/server/solana/orders";
import { screen as sanctionsScreen, ScreeningUnavailable, type Screening } from "@/server/solana/sanctions";
import type { Payment, ShortPayment } from "@/server/solana/verify";

export type SettleResult = {
  status: Order["status"];
  credited: boolean;
  reason?:
    | "already_settled"
    | "repeat"
    | "blocked"
    | "signature_used"
    | "not_payable"
    | "screening_unavailable"
    | "too_late"
    | "account_deleted"
    | "account_suspended"
    | "over_limit";
};

type Options = { screen?: (address: string) => Promise<Screening>; now?: Date };

// Orders a payment can still land on. Expired orders count: the user paid the
// amount we asked for, just late (how late is checked against the block time).
const SETTLEABLE: Order["status"][] = ["pending", "expired", "underpaid"];

// Refund runbook: refunds are by hand, one per signature (a refund_due order's
// own payment, or a row in extra_payments), each after screening its payer.
const REFUND = "Screen the payer, then refund this signature by hand.";

// Wallets add one order reference to a payment. A transaction naming other
// orders' references too was built by hand, so it's never kept against any of
// them: one payment would otherwise be listed for a refund on every order it names.
async function namesOtherOrders(database: Db | Tx, orderId: string, accounts: string[]) {
  const [other] = await database
    .select({ id: orders.id })
    .from(orders)
    .where(and(inArray(orders.reference, accounts), ne(orders.id, orderId)))
    .limit(1);
  return Boolean(other);
}

// Keeps a payment that reached the treasury but isn't credited, for support to
// refund by hand: one row per signature, with what it actually sent. Nothing is
// kept for a transaction that names other orders, is already some order's
// payment, or is kept already.
async function recordExtra(database: Db | Tx, orderId: string, payment: ShortPayment, reason: ExtraPayment["reason"]) {
  if (await namesOtherOrders(database, orderId, payment.accounts)) return false;
  const [paid] = await database
    .select({ id: orders.id })
    .from(orders)
    .where(eq(orders.signature, payment.signature))
    .limit(1);
  if (paid) return false;
  const rows = await database
    .insert(extraPayments)
    .values({ signature: payment.signature, orderId, reason, payer: payment.payer, received: payment.received })
    .onConflictDoNothing()
    .returning({ signature: extraPayments.signature });
  if (rows.length) {
    console.warn(`Order ${orderId}: ${reason} payment ${payment.signature} of ${payment.received} base units kept. ${REFUND}`);
  }
  return rows.length > 0;
}

// Screens every address. Any listed one blocks; otherwise an unavailable
// screening service holds the payment.
async function screenAll(addresses: string[], screen: (address: string) => Promise<Screening>) {
  const results = await Promise.allSettled(
    addresses.map(async (address) => ({ address, screening: await screen(address) })),
  );
  for (const result of results) {
    if (result.status === "fulfilled" && result.value.screening.blocked) return result.value;
  }
  const failure = results.find((result) => result.status === "rejected");
  if (failure) throw failure.reason;
  return null;
}

// Credits one verified payment, exactly once. Everything happens in one database
// transaction with the order row locked, so concurrent webhook deliveries,
// polls and reconcile runs serialize here.
export async function settle(orderId: string, payment: Payment, options: Options = {}): Promise<SettleResult> {
  const screen = options.screen ?? sanctionsScreen;
  const { signature, payer, commitment } = payment;
  const payers = [...new Set([...payment.payers, ...(payer ? [payer] : [])])];
  const now = options.now ?? new Date();
  const database = await db();
  try {
    return await database.transaction(async (tx) => {
      const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update").limit(1);
      if (!order) throw new Error(`Order ${orderId} not found`);

      // A second payment for an order that already has one: keep it for a refund.
      if (order.signature && order.signature !== signature) {
        await recordExtra(tx, order.id, payment, "repeat");
        return { status: order.status, credited: false, reason: "repeat" };
      }
      if (order.status === "confirmed" && commitment === "finalized") {
        await tx.update(orders).set({ status: "finalized", finalizedAt: now }).where(eq(orders.id, order.id));
        return { status: "finalized", credited: false, reason: "already_settled" };
      }
      if (order.signature && !SETTLEABLE.includes(order.status)) {
        return { status: order.status, credited: false, reason: "already_settled" };
      }
      if (!SETTLEABLE.includes(order.status)) return { status: order.status, credited: false, reason: "not_payable" };

      // One transaction can carry several references; it may only pay one order.
      const [taken] = await tx
        .select({ id: orders.id })
        .from(orders)
        .where(and(eq(orders.signature, signature), ne(orders.id, order.id)))
        .limit(1);
      if (taken) return { status: order.status, credited: false, reason: "signature_used" };

      const record = { signature, payer, payers };
      const listed = await screenAll(payers, screen);
      if (listed) {
        const { source, detail } = listed.screening;
        const error = `Sanctions match on ${listed.address} (${source}${detail ? `: ${detail}` : ""})`;
        await tx.update(orders).set({ ...record, status: "blocked", error }).where(eq(orders.id, order.id));
        return { status: "blocked", credited: false, reason: "blocked" };
      }

      // Nothing is credited; the payment stays on the order for support to refund.
      const refund = async (reason: SettleResult["reason"], error: string): Promise<SettleResult> => {
        await tx.update(orders).set({ ...record, status: "refund_due", error }).where(eq(orders.id, order.id));
        return { status: "refund_due", credited: false, reason };
      };

      // Too late for the held price.
      const paidAt = payment.paidAt ?? now;
      const lateBy = paidAt.getTime() - order.expiresAt.getTime();
      if (lateBy > LATE_PAYMENT_MS) {
        const minutes = Math.round(lateBy / 60_000);
        console.warn(`Order ${order.id} was paid ${minutes} minutes after it closed (${signature}). ${REFUND}`);
        return refund("too_late", `Paid ${minutes} minutes after the checkout closed. ${REFUND}`);
      }

      // The account was deleted while this checkout was open (orders outlive accounts).
      if (!order.userId) return refund("account_deleted", `Account deleted before payment arrived. ${REFUND}`);
      const userId = order.userId;

      // The user's lock orders this after an age lock or ban landing at the same
      // time, and after checkouts being opened against the daily cap.
      await lockUser(tx, userId);
      const [owner] = await tx.select({ bannedAt: users.bannedAt }).from(users).where(eq(users.id, userId));
      if (owner?.bannedAt) {
        // A banned account, or a minor's account locked by an age check, can't buy credits.
        return refund("account_suspended", `Account suspended or locked for an age review when the payment arrived. ${REFUND}`);
      }
      // First seen after the checkout stopped counting toward the daily cap, so
      // newer checkouts may have used its room.
      const counted = awaitingPayment(order, now.getTime());
      if (!counted && (await spentToday(tx, userId, now.getTime())) + order.usdCents > DAILY_PURCHASE_CAP_CENTS) {
        return refund("over_limit", `Over the daily purchase limit by the time the payment was seen. ${REFUND}`);
      }

      await tx
        .update(orders)
        .set({
          ...record,
          status: commitment,
          error: null,
          confirmedAt: now,
          finalizedAt: commitment === "finalized" ? now : null,
        })
        .where(eq(orders.id, order.id));

      const product = productFor(order);
      const credited = await grant(
        userId,
        product.credits,
        product.memberDays ? "membership" : "purchase",
        { type: "order", id: order.id },
        tx,
      );
      if (credited && product.memberDays) {
        const stamp = now.toISOString();
        // Prepaid time stacks: a renewal before expiry adds to the remaining days.
        await tx
          .update(users)
          .set({
            memberUntil: sql`greatest(coalesce(${users.memberUntil}, ${stamp}::timestamptz), ${stamp}::timestamptz) + make_interval(days => ${product.memberDays})`,
          })
          .where(eq(users.id, userId));
      }
      return { status: commitment, credited };
    });
  } catch (error) {
    if (!(error instanceof ScreeningUnavailable)) throw error;
    // Fail closed: remember the payment so the user sees it arrived and the
    // reconcile job retries, but credit nothing until screening answers.
    console.warn(`Sanctions screening unavailable for order ${orderId}:`, error.message);
    let held: { status: Order["status"] }[];
    try {
      held = await database
        .update(orders)
        .set({ signature, payer, payers, error: "Waiting for sanctions screening." })
        .where(
          and(
            eq(orders.id, orderId),
            inArray(orders.status, SETTLEABLE),
            or(isNull(orders.signature), eq(orders.signature, signature)),
          ),
        )
        .returning({ status: orders.status });
    } catch (failure) {
      if (!isUniqueViolation(failure)) throw failure;
      return { status: "pending", credited: false, reason: "signature_used" };
    }
    // The order took another payment meanwhile: this one is a repeat.
    if (!held.length) await recordExtra(database, orderId, payment, "repeat");
    return { status: held[0]?.status ?? "pending", credited: false, reason: "screening_unavailable" };
  }
}

// The payment was found but short. Nothing is credited; support refunds or
// credits the difference by hand. A short transaction naming other orders too
// changes nothing.
export async function markUnderpaid(orderId: string, payment: ShortPayment) {
  const database = await db();
  return database.transaction(async (tx) => {
    if (await namesOtherOrders(tx, orderId, payment.accounts)) return false;
    const recorded = await recordExtra(tx, orderId, payment, "short");
    // The signature stays out of the unique column so a later full payment can still settle.
    const flagged = await tx
      .update(orders)
      .set({
        status: "underpaid",
        payer: payment.payer,
        error: `Short payment ${payment.signature}: received ${payment.received} base units.`,
      })
      .where(and(eq(orders.id, orderId), inArray(orders.status, ["pending", "expired"]), isNull(orders.signature)))
      .returning({ id: orders.id });
    return recorded || flagged.length > 0;
  });
}

export async function finalize(orderId: string, now = new Date()) {
  const database = await db();
  const rows = await database
    .update(orders)
    .set({ status: "finalized", finalizedAt: now })
    .where(and(eq(orders.id, orderId), eq(orders.status, "confirmed")))
    .returning({ id: orders.id });
  return rows.length > 0;
}
