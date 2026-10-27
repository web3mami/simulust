import "server-only";
import { address } from "@solana/kit";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, min, ne, or } from "drizzle-orm";
import { db } from "@/server/db";
import { checkedSignatures, extraPayments, orders, scanCursors, type Order } from "@/server/db/schema";
import { DEV_RECIPIENT, ORDER_GRACE_MS, solana } from "@/server/solana/config";
import { awaitingPayment, awaitingPaymentWhere } from "@/server/solana/orders";
import { finalize, markUnderpaid, settle } from "@/server/solana/settle";
import {
  accountKeys,
  checkSignature,
  fetchTransaction,
  judge,
  listSignatures,
  paysNothing,
  readSignature,
  signatureCommitments,
  type ChainResult,
  type Commitment,
  type Listed,
  type ParsedTransaction,
} from "@/server/solana/verify";

// Finality normally follows confirmation within seconds. An order still
// confirmed after this long needs a human to look at it.
const STUCK_CONFIRMED_MS = 10 * 60_000;

// Reconcile and webhook deliveries stop starting chain reads after this long,
// so a slow RPC or a flood of transactions can't run them past their 60 s limit.
const RECONCILE_BUDGET_MS = 40_000;
const WEBHOOK_BUDGET_MS = 40_000;

// Payments held for screening are retried first in each run, within this share
// of its budget, so a flood on the treasury can't crowd them out (nor they the scan).
const HELD_SHARE = 0.25;

// A Helius delivery reads at most this many transactions from the chain. The
// rest count as failed, so Helius delivers the batch again, and whatever was
// dealt with this time is passed over quickly then.
const WEBHOOK_READS = 100;

// One look at an order's reference reads at most READS_PER_LOOK transactions,
// oldest first. Anyone can name a reference in junk transactions; the ones that
// pay nothing are remembered, so the next look moves on to the rest. A look
// lists the reference back to when the order opened, but no more than
// LOOK_PAGES pages: more junk than that, named after a payment, hides it from
// polls (not from the treasury scan).
const READS_PER_LOOK = 5;
const LOOK_PAGE = 1000;
const LOOK_PAGES = 5;

// Per run, the treasury scan lists at most SCAN_PAGES pages of signatures on
// each account and reads at most SCAN_READS transactions, shared fairly between
// the accounts. Where it stopped is kept in scan_cursors for the next run.
const SCAN_PAGE = 1000;
const SCAN_PAGES = 3;
const SCAN_READS = 300;

// A listed transaction our RPC can't return is retried for this many runs, then
// passed over with an error to check it by hand, so it can't hold up the scan for good.
const STUCK_RUNS = 10;

// Wallets add one order reference to a payment. A transaction naming more of
// our orders than this was built by hand and is applied to none of them, so
// junk listing many public references costs one query, not a database
// transaction per order.
const MAX_ORDERS_PER_TX = 3;

const CHECKED_TTL_MS = 24 * 60 * 60_000;

async function apply(order: Order, result: ChainResult): Promise<boolean> {
  if (result.kind === "paid") {
    const outcome = await settle(order.id, result);
    return outcome.credited || outcome.status !== order.status;
  }
  if (result.kind === "underpaid") return markUnderpaid(order.id, result);
  return false;
}

// The signatures nothing has dealt with yet: not an order's payment, not kept
// for a refund, not checked already.
async function unchecked(signatures: string[]): Promise<Set<string>> {
  const database = await db();
  const known = await Promise.all([
    database.select({ signature: orders.signature }).from(orders).where(inArray(orders.signature, signatures)),
    database
      .select({ signature: extraPayments.signature })
      .from(extraPayments)
      .where(inArray(extraPayments.signature, signatures)),
    database
      .select({ signature: checkedSignatures.signature })
      .from(checkedSignatures)
      .where(inArray(checkedSignatures.signature, signatures)),
  ]);
  const seen = new Set(known.flat().map((row) => row.signature));
  return new Set(signatures.filter((signature) => !seen.has(signature)));
}

async function markChecked(signature: string) {
  const database = await db();
  await database.insert(checkedSignatures).values({ signature }).onConflictDoNothing();
}

// The orders a transaction names, or null when it names too many to be a payment.
async function ordersNamed(signature: string, tx: ParsedTransaction): Promise<Order[] | null> {
  const database = await db();
  const named = await database
    .select()
    .from(orders)
    .where(inArray(orders.reference, accountKeys(tx)))
    .limit(MAX_ORDERS_PER_TX + 1);
  if (named.length <= MAX_ORDERS_PER_TX) return named;
  console.warn(`Transaction ${signature} names more than ${MAX_ORDERS_PER_TX} orders, so it's applied to none of them.`);
  return null;
}

// Judges one transaction against every order whose reference it names, then
// marks it checked so it's never read again. Returns how many orders changed.
async function applyTransaction(signature: string, commitment: Commitment, tx: ParsedTransaction) {
  const named = (await ordersNamed(signature, tx)) ?? [];
  let updated = 0;
  for (const order of named) {
    const result = judge(tx, order, signature, commitment);
    // A short payment naming other orders too is never kept (markUnderpaid would do nothing).
    if (result.kind === "underpaid" && named.length > 1) continue;
    if (await apply(order, result)) updated++;
  }
  await markChecked(signature);
  return updated;
}

type Listing = { entries: Listed[]; complete: boolean };

// Lists `account` newest first, from below `before` (or the newest) down to
// `until` or to `since`, at most `pages` pages. complete: it got all the way.
async function listBack(
  account: string,
  { since, pages, pageSize, before, until }: { since: Date; pages: number; pageSize: number; before?: string; until?: string },
): Promise<Listing> {
  const entries: Listed[] = [];
  for (let page = 0; page < pages; page++) {
    const batch = await listSignatures(account, pageSize, { before, until });
    for (const entry of batch) {
      if (entry.blockTime && entry.blockTime < since) return { entries, complete: true };
      entries.push(entry);
    }
    if (batch.length < pageSize) return { entries, complete: true };
    before = batch[batch.length - 1].signature;
  }
  // Every page came back full: is anything left below?
  const [next] = await listSignatures(account, 1, { before, until });
  return { entries, complete: !next || Boolean(next.blockTime && next.blockTime < since) };
}

async function expire(order: Order, now: number) {
  // A payment already seen (waiting on screening) is never expired.
  if (order.status !== "pending" || order.signature || order.expiresAt.getTime() + ORDER_GRACE_MS > now) return false;
  const database = await db();
  const rows = await database
    .update(orders)
    .set({ status: "expired" })
    .where(and(eq(orders.id, order.id), eq(orders.status, "pending"), isNull(orders.signature)))
    .returning({ id: orders.id });
  return rows.length > 0;
}

// Looks for a payment carrying the order's reference (polling path). It lists
// the reference back to the order's opening and reads oldest first, so junk
// named after a payment doesn't hide it unless there's more of it than a look
// lists (LOOK_PAGES); the treasury scan finds it then. A full payment wins over
// an earlier short one.
async function findPayment(order: Order): Promise<ChainResult> {
  const since = new Date(order.createdAt.getTime() - ORDER_GRACE_MS);
  const { entries } = await listBack(order.reference, { since, pages: LOOK_PAGES, pageSize: LOOK_PAGE });
  const listed = entries.filter((entry) => !entry.failed).reverse();
  const fresh = await unchecked(listed.map((entry) => entry.signature));
  let short: ChainResult = { kind: "none" };
  let reads = 0;
  for (const entry of listed) {
    if (!fresh.has(entry.signature)) continue;
    if (reads++ === READS_PER_LOOK) break;
    const tx = await fetchTransaction(entry.signature);
    if (tx && (paysNothing(tx, order.recipient, solana.usdcMint) || !(await ordersNamed(entry.signature, tx)))) {
      await markChecked(entry.signature);
      continue;
    }
    const result = judge(tx, order, entry.signature, entry.commitment);
    if (result.kind === "paid") return result;
    if (result.kind === "underpaid" && short.kind === "none") short = result;
  }
  return short;
}

// Brings one order that may still take a payment up to date with the chain.
// Returns true if it changed.
export async function syncOrder(order: Order, now = Date.now()): Promise<boolean> {
  if (!awaitingPayment(order, now)) return false;
  // Simulated checkouts (no treasury in development) have nothing on chain to find.
  if (order.recipient !== DEV_RECIPIENT) {
    // A payment held for screening is retried as is, not swapped for another one.
    const result = order.signature ? await checkSignature(order, order.signature) : await findPayment(order);
    if (await apply(order, result)) return true;
  }
  return expire(order, now);
}

type Candidate = { signature: string; keys: string[] };

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function field(value: unknown, key: string): unknown {
  return value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

// Accepts Helius raw webhooks ({ transaction: { signatures, message: { accountKeys } } })
// and enhanced ones ({ signature, accountData[].account, instructions[].accounts }).
// Only signatures and addresses are taken from the payload; the payment itself
// is always re-read from our own RPC. A malformed item is skipped, never fatal
// to the rest of the batch.
export function webhookCandidates(payload: unknown): Candidate[] {
  if (!Array.isArray(payload)) return [];
  const out: Candidate[] = [];
  for (const item of payload) {
    const transaction = field(item, "transaction");
    const signature = asString(field(item, "signature")) ?? asString(list(field(transaction, "signatures"))[0]);
    if (!signature) continue;
    const keys = new Set<string>();
    const add = (value: unknown) => {
      const key = asString(value) ?? asString(field(value, "pubkey"));
      if (key) keys.add(key);
    };
    list(field(field(transaction, "message"), "accountKeys")).forEach(add);
    for (const entry of list(field(item, "accountData"))) add(field(entry, "account"));
    for (const instruction of list(field(item, "instructions"))) list(field(instruction, "accounts")).forEach(add);
    if (keys.size) out.push({ signature, keys: [...keys] });
  }
  return out;
}

// Checks every transaction in a Helius delivery against the orders it names,
// including settled ones, so a repeat payment is kept for a refund. Each
// transaction is read from the chain once, and one delivery reads at most
// WEBHOOK_READS. Returns how many orders changed and how many transactions
// failed, weren't reached (out of time or reads), or aren't known to our RPC
// yet; the caller asks Helius to redeliver when any did.
export async function processWebhook(
  payload: unknown,
  budgetMs = WEBHOOK_BUDGET_MS,
): Promise<{ updated: number; failed: number }> {
  const database = await db();
  const deadline = Date.now() + budgetMs;
  let updated = 0;
  let failed = 0;
  let reads = 0;
  for (const candidate of webhookCandidates(payload)) {
    if (Date.now() > deadline) {
      failed++;
      continue;
    }
    try {
      const named = await database.select().from(orders).where(inArray(orders.reference, candidate.keys));
      // Names none of our orders, or is already the payment of each order it
      // names (the reconcile job moves those to finalized).
      if (named.every((order) => order.signature === candidate.signature && !awaitingPayment(order))) continue;
      if (!(await unchecked([candidate.signature])).size) continue;
      if (reads === WEBHOOK_READS) {
        failed++;
        continue;
      }
      reads++;
      const reading = await readSignature(candidate.signature);
      if (reading.kind === "unseen") failed++;
      else if (reading.kind === "failed") await markChecked(candidate.signature);
      else updated += await applyTransaction(candidate.signature, reading.commitment, reading.tx);
    } catch (error) {
      console.error(`Webhook processing failed for ${candidate.signature}`, error);
      failed++;
    }
  }
  return { updated, failed };
}

// Where payments to `recipient` land: the wallet itself for SOL, its USDC
// account for USDC. Every payment names it.
async function paymentAccount(recipient: string, currency: Order["currency"]): Promise<string> {
  if (currency === "SOL") return recipient;
  const [account] = await findAssociatedTokenPda({
    owner: address(recipient),
    mint: solana.usdcMint,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  return account;
}

type Cursor = typeof scanCursors.$inferSelect;
type CursorState = Pick<Cursor, "until" | "marks" | "stuck" | "stuckRuns">;

const NEW_CURSOR: CursorState = { until: null, marks: [], stuck: null, stuckRuns: 0 };

// Saves where the scan got to on `account`. An overlapping run that saved first
// wins; whatever this one read is in checked_signatures, so the next run passes
// over it without reading it again.
async function saveCursor(account: string, previous: Cursor | undefined, next: CursorState) {
  const database = await db();
  if (!previous) {
    await database
      .insert(scanCursors)
      .values({ account, ...next })
      .onConflictDoNothing();
    return;
  }
  const same =
    previous.until === next.until &&
    previous.stuck === next.stuck &&
    previous.stuckRuns === next.stuckRuns &&
    previous.marks.join() === next.marks.join();
  if (same) return;
  await database
    .update(scanCursors)
    .set({ ...next, version: previous.version + 1, updatedAt: new Date() })
    .where(and(eq(scanCursors.account, account), eq(scanCursors.version, previous.version)));
}

// One account's part of a scan: what landed between where the scan got to and
// its last mark (or the newest), oldest first.
type Slice = { account: string; cursor: Cursor | undefined; entries: Listed[]; fresh: Set<string> };

// Reads one account's listed transactions oldest first, within its share of
// reads and time, then moves its cursor past everything dealt with in order.
async function scanSlice({ account, cursor, entries, fresh }: Slice, share: number, deadline: number) {
  const state = cursor ?? NEW_CURSOR;
  const passOver = state.stuckRuns >= STUCK_RUNS ? state.stuck : null;
  let until = state.until;
  // The oldest transaction not dealt with, and whether that's because our RPC
  // couldn't return it (rather than this run running out of reads or time).
  let blocked: { signature: string; stuck: boolean } | null = null;
  let reads = 0;
  let updated = 0;
  for (const entry of entries) {
    let dealt = entry.failed || !fresh.has(entry.signature);
    if (!dealt) {
      if (reads === share || Date.now() > deadline) {
        blocked ??= { signature: entry.signature, stuck: false };
        break;
      }
      reads++;
      let failure = false;
      try {
        const tx = await fetchTransaction(entry.signature);
        // Unknown to the node that answered: the next run reads it again.
        if (tx) {
          updated += await applyTransaction(entry.signature, entry.commitment, tx);
          dealt = true;
        }
      } catch (error) {
        console.error(`Reconcile failed for transaction ${entry.signature}`, error);
        failure = true;
      }
      if (!dealt && entry.signature === passOver) {
        console.error(
          `Treasury scan passed over ${entry.signature} on ${account}: unreadable for ${STUCK_RUNS} runs. Check it by hand.`,
        );
        dealt = true;
      } else if (failure) {
        // Most likely the RPC itself: leave the rest to the next run.
        blocked ??= { signature: entry.signature, stuck: true };
        break;
      }
    }
    if (!dealt) blocked ??= { signature: entry.signature, stuck: true };
    else if (!blocked) until = entry.signature;
  }

  let { stuck, stuckRuns } = state;
  if (blocked?.stuck) {
    stuckRuns = blocked.signature === stuck ? stuckRuns + 1 : 1;
    stuck = blocked.signature;
  } else if (blocked?.signature !== stuck) {
    stuck = null;
    stuckRuns = 0;
  }
  if (blocked) {
    const why = blocked.stuck ? "our RPC couldn't return it yet" : "out of reads or time";
    console.warn(`Treasury scan of ${account} is behind: it stopped at ${blocked.signature} (${why}); the next run carries on from there.`);
  }
  // Done with the gap below the last mark: the next run lists the one above it.
  const marks = blocked ? state.marks : state.marks.slice(0, -1);
  await saveCursor(account, cursor, { until, marks, stuck, stuckRuns });
  return { reads, updated };
}

// Reads what reached the treasury since the oldest order still waiting for a
// payment, instead of each order's reference. Anyone can flood references with
// junk for free, but only transactions that touch the treasury are listed
// here, and each is read once, however many orders are waiting. Each account is
// worked through oldest first from its cursor (see scan_cursors), so junk
// landing on it after a payment delays the payment by a few runs at most, and
// never pushes it out of reach.
async function scanTreasury(now: number, deadline: number) {
  const database = await db();
  const waiting = await database
    .select({ recipient: orders.recipient, currency: orders.currency, since: min(orders.createdAt) })
    .from(orders)
    .where(and(awaitingPaymentWhere(now), isNull(orders.signature), ne(orders.recipient, DEV_RECIPIENT)))
    .groupBy(orders.recipient, orders.currency);
  const groups = await Promise.all(
    waiting.flatMap(({ recipient, currency, since }) =>
      since
        ? // Allows for our clock and the chain's disagreeing a little.
          [paymentAccount(recipient, currency).then((account) => ({ account, since: new Date(since.getTime() - ORDER_GRACE_MS) }))]
        : [],
    ),
  );
  if (!groups.length) return { reads: 0, updated: 0 };
  const saved = await database
    .select()
    .from(scanCursors)
    .where(inArray(scanCursors.account, groups.map((group) => group.account)));
  const cursors = new Map(saved.map((cursor) => [cursor.account, cursor]));

  const slices: Slice[] = [];
  for (const { account, since } of groups) {
    if (Date.now() > deadline) break;
    const cursor = cursors.get(account);
    const state = cursor ?? NEW_CURSOR;
    try {
      const listing = await listBack(account, {
        since,
        pages: SCAN_PAGES,
        pageSize: SCAN_PAGE,
        before: state.marks.at(-1),
        until: state.until ?? undefined,
      });
      if (!listing.complete) {
        // More landed than one run lists: the next run lists on below this, and
        // reads oldest first once it gets to the bottom.
        const mark = listing.entries[listing.entries.length - 1].signature;
        console.warn(`Treasury scan of ${account} is behind: more to list than one run does; the next run carries on below ${mark}.`);
        await saveCursor(account, cursor, { ...state, marks: [...state.marks, mark] });
        continue;
      }
      const entries = listing.entries.reverse();
      const fresh = await unchecked(entries.filter((entry) => !entry.failed).map((entry) => entry.signature));
      slices.push({ account, cursor, entries, fresh });
    } catch (error) {
      console.error(`Treasury scan failed to list ${account}`, error);
    }
  }

  // Fair shares of reads and time: the account with least to read goes first
  // and leaves what it doesn't use to the rest, so a flood on one account can't
  // keep the scan from another.
  slices.sort((a, b) => a.fresh.size - b.fresh.size);
  let reads = 0;
  let updated = 0;
  for (const [i, slice] of slices.entries()) {
    const left = slices.length - i;
    const share = Math.floor((SCAN_READS - reads) / left);
    const sliceDeadline = Date.now() + Math.max(0, deadline - Date.now()) / left;
    try {
      const result = await scanSlice(slice, share, sliceDeadline);
      reads += result.reads;
      updated += result.updated;
    } catch (error) {
      console.error(`Treasury scan failed on ${slice.account}`, error);
    }
  }
  return { reads, updated };
}

// Safety net for missed or disabled webhooks: retries payments held for
// screening, settles payments to orders that can still take one, expires
// abandoned checkouts and marks confirmed payments finalized. Chain reads stop
// once the time budget is spent; the next run picks up where this one stopped.
export async function reconcile(
  now = Date.now(),
  { limit = 100, budgetMs = RECONCILE_BUDGET_MS } = {},
): Promise<{ checked: number; updated: number }> {
  const database = await db();
  const start = Date.now();
  const deadline = start + budgetMs;
  let checked = 0;
  let updated = 0;

  // Held payments first, by their own signature, oldest first, within their
  // own share of the budget.
  const heldDeadline = start + budgetMs * HELD_SHARE;
  const held = await database
    .select()
    .from(orders)
    .where(
      and(
        inArray(orders.status, ["pending", "expired", "underpaid"]),
        isNotNull(orders.signature),
        ne(orders.recipient, DEV_RECIPIENT),
      ),
    )
    .orderBy(asc(orders.createdAt))
    .limit(limit);
  for (const order of held) {
    if (Date.now() > heldDeadline) break;
    checked++;
    try {
      if (await syncOrder(order, now)) updated++;
    } catch (error) {
      console.error(`Reconcile failed for order ${order.id}`, error);
    }
  }

  try {
    const scan = await scanTreasury(now, deadline);
    checked += scan.reads;
    updated += scan.updated;
  } catch (error) {
    console.error("Treasury scan failed", error);
  }

  // Abandoned checkouts, in one statement so nothing above can crowd them out.
  const expired = await database
    .update(orders)
    .set({ status: "expired" })
    .where(
      and(eq(orders.status, "pending"), isNull(orders.signature), lt(orders.expiresAt, new Date(now - ORDER_GRACE_MS))),
    )
    .returning({ id: orders.id });
  updated += expired.length;

  // Newest first, so orders stuck at confirmed can't crowd fresh ones out of the batch.
  const confirmed = await database
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.status, "confirmed"),
        isNotNull(orders.signature),
        or(isNull(orders.confirmedAt), lt(orders.confirmedAt, new Date(now - 30_000))),
      ),
    )
    .orderBy(desc(orders.confirmedAt))
    .limit(limit);
  checked += confirmed.length;
  try {
    const statuses = confirmed.length ? await signatureCommitments(confirmed.map((order) => order.signature!)) : [];
    for (const [i, order] of confirmed.entries()) {
      const status = statuses[i];
      if (status === "finalized") {
        if (await finalize(order.id)) updated++;
      } else if (order.confirmedAt && order.confirmedAt.getTime() < now - STUCK_CONFIRMED_MS) {
        // Credits went out at confirmed. A payment that never finalizes may
        // have been dropped, so someone has to check it.
        const minutes = STUCK_CONFIRMED_MS / 60_000;
        console.error(`Order ${order.id} has been confirmed for over ${minutes} minutes (chain: ${status ?? "unknown"}).`);
      }
    }
  } catch (error) {
    console.error("Finalize check failed", error);
  }

  await database.delete(checkedSignatures).where(lt(checkedSignatures.createdAt, new Date(now - CHECKED_TTL_MS)));
  return { checked, updated };
}
