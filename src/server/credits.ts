import "server-only";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { db, type Db, type Tx } from "@/server/db";
import { creditBalances, creditLedger, messages, threads, type User } from "@/server/db/schema";
import { HttpError } from "@/server/http";
import { isMember } from "@/server/auth";
import { COSTS, FREE, MEMBER_DAILY_MESSAGE_CAP, type CostKey } from "@/lib/pricing";

type Reason = (typeof creditLedger.$inferInsert)["reason"];
type Ref = { type: string; id: string };

export class InsufficientCredits extends HttpError {
  constructor(public needed: number) {
    super(402, `You need ${needed} credits for that.`, "insufficient_credits");
  }
}

export async function balanceOf(userId: string, database?: Db | Tx) {
  const [row] = await (database ?? (await db()))
    .select({ balance: creditBalances.balance })
    .from(creditBalances)
    .where(eq(creditBalances.userId, userId))
    .limit(1);
  return row?.balance ?? 0;
}

// Takes credits atomically: the balance check and the decrement are one UPDATE,
// so two concurrent requests can never spend the same credit.
export async function spend(userId: string, amount: number, reason: Reason, ref?: Ref, outer?: Tx) {
  if (amount <= 0) return balanceOf(userId, outer);
  const run = async (tx: Tx) => {
    const [row] = await tx
      .update(creditBalances)
      .set({ balance: sql`${creditBalances.balance} - ${amount}`, updatedAt: new Date() })
      .where(and(eq(creditBalances.userId, userId), gte(creditBalances.balance, amount)))
      .returning({ balance: creditBalances.balance });
    if (!row) throw new InsufficientCredits(amount);
    await tx.insert(creditLedger).values({
      userId,
      delta: -amount,
      balanceAfter: row.balance,
      reason,
      refType: ref?.type,
      refId: ref?.id,
    });
    return row.balance;
  };
  return outer ? run(outer) : (await db()).transaction(run);
}

// Adds credits. For purchases, memberships and refunds the (reason, ref) pair is
// unique in the ledger, so replaying the same payment or refund grants nothing.
// Returns false when this grant had already been applied.
export async function grant(userId: string, amount: number, reason: Reason, ref?: Ref, outer?: Tx): Promise<boolean> {
  const run = async (tx: Tx) => {
    if (ref && (reason === "purchase" || reason === "membership" || reason === "refund")) {
      const [seen] = await tx
        .select({ id: creditLedger.id })
        .from(creditLedger)
        .where(and(eq(creditLedger.reason, reason), eq(creditLedger.refType, ref.type), eq(creditLedger.refId, ref.id)))
        .limit(1);
      if (seen) return false;
    }
    const [row] = await tx
      .insert(creditBalances)
      .values({ userId, balance: amount })
      .onConflictDoUpdate({
        target: creditBalances.userId,
        set: { balance: sql`${creditBalances.balance} + ${amount}`, updatedAt: new Date() },
      })
      .returning({ balance: creditBalances.balance });
    await tx.insert(creditLedger).values({
      userId,
      delta: amount,
      balanceAfter: row.balance,
      reason,
      refType: ref?.type,
      refId: ref?.id,
    });
    return true;
  };
  // Inside a caller's transaction a unique violation aborts that transaction, so
  // it has to propagate; the caller decides what a replay means.
  if (outer) return run(outer);
  try {
    return await (await db()).transaction(run);
  } catch (error) {
    // Two deliveries of the same payment racing: the unique index rejects the second.
    if (isUniqueViolation(error)) return false;
    throw error;
  }
}

// Gives back what was charged for a message or media item, never more: a refund
// for something that was never charged (a crash between creating the row and
// charging for it) grants nothing.
export async function refund(userId: string, amount: number, mediaOrMessageId: string) {
  const database = await db();
  const [row] = await database
    .select({ charged: sql<number>`coalesce(-sum(${creditLedger.delta}), 0)::int` })
    .from(creditLedger)
    .where(and(eq(creditLedger.userId, userId), eq(creditLedger.refId, mediaOrMessageId), lt(creditLedger.delta, 0)));
  const owed = Math.min(amount, row?.charged ?? 0);
  if (owed <= 0) return false;
  return grant(userId, owed, "refund", { type: "charge", id: mediaOrMessageId });
}

export function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: string; cause?: { code?: string } })?.code ?? (error as { cause?: { code?: string } })?.cause?.code;
  return code === "23505";
}

function startOfUtcDay(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export async function messagesSentToday(userId: string, tx?: Tx) {
  const database = tx ?? (await db());
  const [row] = await database
    .select({ count: sql<number>`count(*)::int` })
    .from(messages)
    .innerJoin(threads, eq(messages.threadId, threads.id))
    .where(and(eq(threads.userId, userId), eq(messages.role, "user"), gte(messages.createdAt, startOfUtcDay())));
  return row?.count ?? 0;
}

export async function freeMessagesLeft(user: User) {
  if (isMember(user)) return Math.max(0, MEMBER_DAILY_MESSAGE_CAP - (await messagesSentToday(user.id)));
  return Math.max(0, FREE.dailyMessages - (await messagesSentToday(user.id)));
}

// Members chat free up to a fair-use cap; everyone else gets a daily free
// allowance and then pays per message. Returns the credits charged. Callers
// count and save the message in one transaction under lockUser, so concurrent
// sends can't all see the same count and all go free.
export async function chargeForMessage(user: User, messageRef: string, tx?: Tx): Promise<number> {
  const sent = await messagesSentToday(user.id, tx);
  if (isMember(user)) {
    if (sent >= MEMBER_DAILY_MESSAGE_CAP) {
      throw new HttpError(429, "You've hit today's fair-use limit. It resets at midnight UTC.", "daily_cap");
    }
    return 0;
  }
  if (sent < FREE.dailyMessages) return 0;
  await spend(user.id, COSTS.message, "message", { type: "message", id: messageRef }, tx);
  return COSTS.message;
}

// Holds a per-user lock until the transaction ends.
export async function lockUser(tx: Tx, userId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);
}

export async function chargeFor(user: User, key: Exclude<CostKey, "message">, refId: string, tx?: Tx) {
  const reason: Reason = key === "voiceNote" ? "voice" : key;
  await spend(user.id, COSTS[key], reason, { type: key, id: refId }, tx);
  return COSTS[key];
}
