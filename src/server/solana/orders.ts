import "server-only";
import { getAddressDecoder, isAddress } from "@solana/kit";
import { and, desc, eq, gt, gte, inArray, isNotNull, or, sql } from "drizzle-orm";
import { lockUser } from "@/server/credits";
import { db, type Tx } from "@/server/db";
import { orders, users, type Order, type User } from "@/server/db/schema";
import { HttpError, notFound } from "@/server/http";
import {
  LATE_PAYMENT_MS,
  ORDER_GRACE_MS,
  ORDER_TTL_MS,
  orderRecipient,
  SOL_DECIMALS,
  solana,
  USDC_DECIMALS,
} from "@/server/solana/config";
import { lamportsFor, solQuote, usdcUnitsFor } from "@/server/solana/quotes";
import { findProduct, type Product } from "@/lib/pricing";
import type { OrderDTO } from "@/lib/api-types";

export type Currency = "USDC" | "SOL";

// Keeps the credit ledger well inside the closed-loop prepaid range (see the
// build plan, section 4) and limits the damage of a stolen session.
export const DAILY_PURCHASE_CAP_CENTS = 100_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isOrderId(id: string) {
  return UUID.test(id);
}

// A fresh 32-byte reference per order. It only has to be unique and
// unguessable; it never signs, so it needs no private key.
export function newReference(): string {
  return getAddressDecoder().decode(crypto.getRandomValues(new Uint8Array(32)));
}

export function productFor(order: Pick<Order, "productId">): Product {
  const product = findProduct(order.productId);
  if (!product) throw new Error(`Order references unknown product ${order.productId}`);
  return product;
}

// Watched a little past the late window, so a payment whose block landed just
// inside it is still found.
const WATCH_AFTER_CLOSE_MS = LATE_PAYMENT_MS + ORDER_GRACE_MS;

// A payment may still be credited to this order: it's open, closed less than
// the late window ago, or holding a payment that waits on screening.
export function awaitingPayment(order: Order, now = Date.now()) {
  if (order.status === "pending") return true;
  if (order.status !== "expired" && order.status !== "underpaid") return false;
  return order.signature !== null || order.expiresAt.getTime() + WATCH_AFTER_CLOSE_MS > now;
}

// awaitingPayment as a query condition.
export function awaitingPaymentWhere(now = Date.now()) {
  return or(
    eq(orders.status, "pending"),
    and(
      inArray(orders.status, ["expired", "underpaid"]),
      or(isNotNull(orders.signature), gt(orders.expiresAt, new Date(now - WATCH_AFTER_CLOSE_MS))),
    ),
  );
}

// Paid orders and every order that could still be paid count toward the cap.
export async function spentToday(tx: Tx, userId: string, now: number) {
  const [row] = await tx
    .select({ cents: sql<number>`coalesce(sum(${orders.usdCents}), 0)::int` })
    .from(orders)
    .where(
      and(
        eq(orders.userId, userId),
        gte(orders.createdAt, new Date(now - 24 * 60 * 60_000)),
        or(inArray(orders.status, ["confirmed", "finalized"]), awaitingPaymentWhere(now)),
      ),
    );
  return row?.cents ?? 0;
}

export async function createOrder(user: User, productId: string, currency: Currency): Promise<Order> {
  const product = findProduct(productId);
  if (!product) throw new HttpError(400, "That product doesn't exist. Pick one from the shop.", "unknown_product");
  const recipient = orderRecipient();

  let amount: bigint;
  let mint: string | null = null;
  let quote: Record<string, unknown> | null = null;
  if (currency === "USDC") {
    amount = usdcUnitsFor(product.usdCents);
    mint = solana.usdcMint;
  } else {
    const sol = await solQuote();
    amount = lamportsFor(product.usdCents, sol.usdPerSol);
    quote = sol;
  }

  const database = await db();
  return database.transaction(async (tx) => {
    // The sum and the insert run under the user's lock, so concurrent
    // checkouts can't all see the same total and all pass the cap.
    await lockUser(tx, user.id);
    const now = Date.now();
    if ((await spentToday(tx, user.id, now)) + product.usdCents > DAILY_PURCHASE_CAP_CENTS) {
      throw new HttpError(
        429,
        "You've reached today's purchase limit. Unpaid checkouts count until an hour after they close, so try again later.",
        "purchase_limit",
      );
    }
    const [order] = await tx
      .insert(orders)
      .values({
        userId: user.id,
        productId: product.id,
        usdCents: product.usdCents,
        currency,
        mint,
        amount,
        recipient,
        reference: newReference(),
        quote,
        expiresAt: new Date(now + ORDER_TTL_MS),
      })
      .returning();
    return order;
  });
}

export async function findOrder(id: string): Promise<Order | null> {
  if (!isOrderId(id)) return null;
  const database = await db();
  const [order] = await database.select().from(orders).where(eq(orders.id, id)).limit(1);
  return order ?? null;
}

export async function requireOwnOrder(user: User, id: string): Promise<Order> {
  const order = await findOrder(id);
  if (!order || order.userId !== user.id) throw notFound("We couldn't find that order.");
  return order;
}

export async function listOrders(userId: string, limit = 20): Promise<Order[]> {
  const database = await db();
  return database.select().from(orders).where(eq(orders.userId, userId)).orderBy(desc(orders.createdAt)).limit(limit);
}

export function decimalsFor(currency: Currency) {
  return currency === "USDC" ? USDC_DECIMALS : SOL_DECIMALS;
}

// Base units to a plain decimal string ("4.99", "0.033267"): no exponent, no
// trailing zeros, which is what Solana Pay's amount field requires.
export function formatUnits(amount: bigint, decimals: number): string {
  const base = BigInt(10) ** BigInt(decimals);
  const whole = amount / base;
  const fraction = (amount % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

type Owner = Pick<User, "id" | "bannedAt">;

// The account an order belongs to, for checks made without a session. null
// once the account is deleted.
export async function ownerOf(order: Order): Promise<Owner | null> {
  if (!order.userId) return null;
  const database = await db();
  const [owner] = await database
    .select({ id: users.id, bannedAt: users.bannedAt })
    .from(users)
    .where(eq(users.id, order.userId))
    .limit(1);
  return owner ?? null;
}

// Open for a new payment. An order whose account was deleted, banned or
// locked for an age review isn't: its payment could only be refunded.
export function payable(order: Order, owner: Owner | null, now = Date.now()) {
  return (
    order.status === "pending" &&
    owner !== null &&
    owner.id === order.userId &&
    owner.bannedAt === null &&
    order.expiresAt.getTime() > now
  );
}

function enc(value: string) {
  return encodeURIComponent(value);
}

// Solana Pay transfer request: solana:<recipient>?amount=&spl-token=&reference=&label=&message=&memo=
// amount is in user units (not base units); label, message and memo are URL-encoded.
export function transferRequestUrl(order: Order): string {
  if (!isAddress(order.recipient)) return "";
  const product = productFor(order);
  const params = [
    `amount=${formatUnits(order.amount, decimalsFor(order.currency))}`,
    ...(order.currency === "USDC" && order.mint ? [`spl-token=${order.mint}`] : []),
    `reference=${order.reference}`,
    `label=${enc("Simulust")}`,
    `message=${enc(`${product.name}: ${product.credits.toLocaleString("en-US")} credits`)}`,
    `memo=${enc(order.id)}`,
  ];
  return `solana:${order.recipient}?${params.join("&")}`;
}

export function toOrderDTO(order: Order, owner: Owner | null): OrderDTO {
  // Where and how to pay only while the price is held, so an old order never
  // invites a payment that would arrive too late.
  const open = payable(order, owner);
  return {
    id: order.id,
    productId: order.productId,
    usdCents: order.usdCents,
    currency: order.currency,
    amount: order.amount.toString(),
    amountDisplay: `${formatUnits(order.amount, decimalsFor(order.currency))} ${order.currency}`,
    recipient: open ? order.recipient : "",
    reference: open ? order.reference : "",
    status: order.status,
    signature: order.signature,
    expiresAt: order.expiresAt.toISOString(),
    solanaPayUrl: open ? transferRequestUrl(order) : "",
  };
}
