import "server-only";
import { address, signature as toSignature } from "@solana/kit";
import type { Order } from "@/server/db/schema";
import { rpc, solana } from "@/server/solana/config";

// The slice of a jsonParsed getTransaction response that validation reads.
// Numbers may arrive as bigint (kit's RPC client) or number (JSON fixtures).
type Num = number | bigint | string;

// tsconfig targets ES2017, which has no bigint literals.
const ZERO = BigInt(0);
type AccountKey = string | { pubkey: string; signer?: boolean };
type TokenBalance = { accountIndex: number; mint: string; owner?: string; uiTokenAmount: { amount: string } };

export type ParsedTransaction = {
  blockTime?: Num | null;
  meta: {
    err: unknown;
    preBalances: readonly Num[];
    postBalances: readonly Num[];
    preTokenBalances?: readonly TokenBalance[] | null;
    postTokenBalances?: readonly TokenBalance[] | null;
    loadedAddresses?: { readonly: readonly string[]; writable: readonly string[] } | null;
  } | null;
  transaction: { message: { accountKeys: readonly AccountKey[] } };
};

export type OrderTerms = Pick<Order, "currency" | "amount" | "recipient" | "reference">;

// payer is where a refund would go: the address the paid asset left in the
// largest amount. payers is everyone to screen: every signer and every owner
// the paid asset left, so a sanctioned wallet can't hide behind a bigger decoy
// transfer in the same transaction.
export type Verdict =
  | { ok: true; received: bigint; payer: string | null; payers: string[] }
  | {
      ok: false;
      reason: "not_found" | "failed" | "missing_reference" | "wrong_asset" | "underpaid";
      received: bigint;
      payer: string | null;
      payers: string[];
    };

// Every account the transaction names, including ones loaded from lookup tables.
export function accountKeys(tx: ParsedTransaction): string[] {
  const keys = tx.transaction.message.accountKeys.map((key) => (typeof key === "string" ? key : key.pubkey));
  const loaded = tx.meta?.loadedAddresses;
  return loaded ? [...keys, ...loaded.writable, ...loaded.readonly] : keys;
}

type Delta = { owner: string | undefined; delta: bigint };

// Net change per token account for one mint, keyed by account index.
function tokenDeltas(tx: ParsedTransaction, mint: string): Delta[] {
  const deltas = new Map<number, Delta>();
  const apply = (balances: readonly TokenBalance[] | null | undefined, sign: bigint) => {
    for (const balance of balances ?? []) {
      if (balance.mint !== mint) continue;
      const entry = deltas.get(balance.accountIndex) ?? { owner: balance.owner, delta: ZERO };
      entry.owner ??= balance.owner;
      entry.delta += sign * BigInt(balance.uiTokenAmount.amount);
      deltas.set(balance.accountIndex, entry);
    }
  };
  apply(tx.meta?.preTokenBalances, BigInt(-1));
  apply(tx.meta?.postTokenBalances, BigInt(1));
  return [...deltas.values()];
}

function signers(tx: ParsedTransaction): string[] {
  const keys = tx.transaction.message.accountKeys;
  const marked = keys.flatMap((key) => (typeof key !== "string" && key.signer ? [key.pubkey] : []));
  if (marked.length) return marked;
  // Without signer flags, the fee payer (always the first key) is the one signer we know.
  const first = keys[0];
  return first ? [typeof first === "string" ? first : first.pubkey] : [];
}

function debited(entries: Delta[], recipient: string): string[] {
  return entries.flatMap((entry) =>
    entry.owner && entry.owner !== recipient && entry.delta < ZERO ? [entry.owner] : [],
  );
}

function biggestSender(entries: Delta[], recipient: string): string | null {
  let best: { owner: string; delta: bigint } | null = null;
  for (const entry of entries) {
    if (!entry.owner || entry.owner === recipient || entry.delta >= ZERO) continue;
    if (!best || entry.delta < best.delta) best = { owner: entry.owner, delta: entry.delta };
  }
  return best?.owner ?? null;
}

// Decides whether one on-chain transaction pays an order. Pure: the caller
// fetches the transaction from our own RPC, never from a webhook payload.
export function validatePayment(tx: ParsedTransaction | null, order: OrderTerms, usdcMint: string): Verdict {
  const nothing = { received: ZERO, payer: null, payers: [] };
  if (!tx || !tx.meta) return { ok: false, reason: "not_found", ...nothing };
  if (tx.meta.err !== null && tx.meta.err !== undefined) return { ok: false, reason: "failed", ...nothing };

  const keys = accountKeys(tx);
  if (!keys.includes(order.reference)) return { ok: false, reason: "missing_reference", ...nothing };

  let received = ZERO;
  let entries: Delta[];
  if (order.currency === "USDC") {
    entries = tokenDeltas(tx, usdcMint);
    received = entries.filter((entry) => entry.owner === order.recipient).reduce((sum, entry) => sum + entry.delta, ZERO);
  } else {
    const index = keys.indexOf(order.recipient);
    if (index >= 0 && index < tx.meta.preBalances.length) {
      received = BigInt(tx.meta.postBalances[index]) - BigInt(tx.meta.preBalances[index]);
    }
    entries = keys.slice(0, tx.meta.preBalances.length).map((owner, i) => ({
      owner,
      delta: BigInt(tx.meta!.postBalances[i]) - BigInt(tx.meta!.preBalances[i]),
    }));
  }

  // No balance went down (odd, but possible with wrapped flows): fall back to the fee payer.
  const payer = biggestSender(entries, order.recipient) ?? keys[0] ?? null;
  const payers = [...new Set([...signers(tx), ...debited(entries, order.recipient)])].filter(
    (key) => key !== order.recipient,
  );
  if (received <= ZERO) return { ok: false, reason: "wrong_asset", received: ZERO, payer, payers };
  if (received < order.amount) return { ok: false, reason: "underpaid", received, payer, payers };
  return { ok: true, received, payer, payers };
}

// The transaction failed, or moved neither USDC nor SOL to the recipient, so
// it can't pay any order. That never changes, so callers remember it.
export function paysNothing(tx: ParsedTransaction, recipient: string, usdcMint: string): boolean {
  if (!tx.meta) return false;
  if (tx.meta.err !== null && tx.meta.err !== undefined) return true;
  const usdc = tokenDeltas(tx, usdcMint)
    .filter((entry) => entry.owner === recipient)
    .reduce((sum, entry) => sum + entry.delta, ZERO);
  const index = accountKeys(tx).indexOf(recipient);
  const sol =
    index >= 0 && index < tx.meta.preBalances.length
      ? BigInt(tx.meta.postBalances[index]) - BigInt(tx.meta.preBalances[index])
      : ZERO;
  return usdc <= ZERO && sol <= ZERO;
}

export type Commitment = "confirmed" | "finalized";

// A payment that covers its order, as read from our own RPC.
export type Payment = {
  signature: string;
  payer: string | null;
  payers: string[];
  // What reached the treasury in the order's currency: the whole transaction's
  // amount, however many orders it names.
  received: bigint;
  // Every account the transaction names. Wallets add one order reference; a
  // transaction naming several can pay at most one of them and is never kept
  // against the others for a refund.
  accounts: string[];
  commitment: Commitment;
  // When the block landed (null if the RPC doesn't know): decides whether a
  // payment after the checkout closed is still on time.
  paidAt: Date | null;
};

export type ShortPayment = Pick<Payment, "signature" | "payer" | "payers" | "received" | "accounts">;

// unseen: our RPC doesn't know the signature yet, so asking again later may help.
export type ChainResult =
  | ({ kind: "paid" } & Payment)
  | ({ kind: "underpaid" } & ShortPayment)
  | { kind: "none" }
  | { kind: "unseen" };

// Version 1 transactions are live on devnet (Oct 2026) and the RPC refuses to
// return them to a client that only admits version 0. Wallets building their
// own transfer can send one, so we admit it. kit 5's types stop at 0; the
// jsonParsed shape is the same.
const MAX_TX_VERSION = 1 as unknown as 0;

// kit's RPC client has no timeout of its own; a hung call would hold up a
// whole reconcile run or webhook delivery.
const RPC_TIMEOUT_MS = 10_000;

function timeout() {
  return { abortSignal: AbortSignal.timeout(RPC_TIMEOUT_MS) };
}

export async function fetchTransaction(signature: string): Promise<ParsedTransaction | null> {
  const tx = await rpc()
    .getTransaction(toSignature(signature), {
      encoding: "jsonParsed",
      maxSupportedTransactionVersion: MAX_TX_VERSION,
      commitment: "confirmed",
    })
    .send(timeout());
  return tx as unknown as ParsedTransaction | null;
}

function blockDate(tx: ParsedTransaction | null): Date | null {
  return tx?.blockTime === null || tx?.blockTime === undefined ? null : new Date(Number(tx.blockTime) * 1000);
}

export function judge(tx: ParsedTransaction | null, order: Order, signature: string, commitment: Commitment): ChainResult {
  const verdict = validatePayment(tx, order, solana.usdcMint);
  const { payer, payers, received } = verdict;
  const accounts = tx ? accountKeys(tx) : [];
  if (verdict.ok) return { kind: "paid", signature, payer, payers, received, accounts, commitment, paidAt: blockDate(tx) };
  if (verdict.reason === "underpaid") return { kind: "underpaid", signature, payer, payers, received, accounts };
  return { kind: "none" };
}

// One getSignatureStatuses call answers for up to this many signatures.
const STATUS_BATCH = 256;

// Without searchTransactionHistory the RPC only answers from its recent status
// cache (about a minute of slots), so older signatures would read as unknown.
// null: the RPC doesn't know the signature yet, or has it only at "processed".
export async function signatureCommitments(signatures: string[]): Promise<(Commitment | "failed" | null)[]> {
  const out: (Commitment | "failed" | null)[] = [];
  for (let i = 0; i < signatures.length; i += STATUS_BATCH) {
    const { value } = await rpc()
      .getSignatureStatuses(signatures.slice(i, i + STATUS_BATCH).map(toSignature), { searchTransactionHistory: true })
      .send(timeout());
    for (const status of value) {
      if (!status) out.push(null);
      else if (status.err) out.push("failed");
      else if (status.confirmationStatus === "finalized" || status.confirmationStatus === "confirmed") {
        out.push(status.confirmationStatus);
      } else out.push(null);
    }
  }
  return out;
}

export async function signatureCommitment(signature: string): Promise<Commitment | "failed" | null> {
  const [commitment] = await signatureCommitments([signature]);
  return commitment ?? null;
}

// One known signature as our RPC sees it (webhook path).
export type Reading =
  | { kind: "read"; commitment: Commitment; tx: ParsedTransaction }
  | { kind: "failed" }
  | { kind: "unseen" };

export async function readSignature(signature: string): Promise<Reading> {
  const commitment = await signatureCommitment(signature);
  if (commitment === "failed") return { kind: "failed" };
  if (!commitment) return { kind: "unseen" };
  const tx = await fetchTransaction(signature);
  return tx ? { kind: "read", commitment, tx } : { kind: "unseen" };
}

// Checks one known signature against an order.
export async function checkSignature(order: Order, signature: string): Promise<ChainResult> {
  const reading = await readSignature(signature);
  if (reading.kind !== "read") return reading.kind === "failed" ? { kind: "none" } : reading;
  return judge(reading.tx, order, signature, reading.commitment);
}

export type Listed = { signature: string; commitment: Commitment; blockTime: Date | null; failed: boolean };

// Transactions that name `account`, newest first. `before` continues below the
// last signature of a previous page; `until` stops above a signature already
// dealt with. Neither bound is itself listed.
export async function listSignatures(
  account: string,
  limit: number,
  { before, until }: { before?: string; until?: string } = {},
): Promise<Listed[]> {
  const entries = await rpc()
    .getSignaturesForAddress(address(account), {
      limit,
      commitment: "confirmed",
      ...(before ? { before: toSignature(before) } : {}),
      ...(until ? { until: toSignature(until) } : {}),
    })
    .send(timeout());
  return entries.map((entry) => ({
    signature: entry.signature,
    commitment: entry.confirmationStatus === "finalized" ? "finalized" : "confirmed",
    blockTime: entry.blockTime === null || entry.blockTime === undefined ? null : new Date(Number(entry.blockTime) * 1000),
    failed: Boolean(entry.err),
  }));
}
