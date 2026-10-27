import { describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";

const TREASURY = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const PAYER = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const ATTACKER = "HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH";
const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
const MINUTE = 60_000;

vi.hoisted(() => {
  process.env.SOLANA_CLUSTER = "devnet";
  process.env.TREASURY_ADDRESS = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
});

type Status = "confirmed" | "finalized" | "failed";
type FakeTx = { blockTime: number; transaction: { message: { accountKeys: { pubkey: string }[] } } };

// A fake chain whose getSignaturesForAddress answers like a real node: every
// indexed transaction that names the address, newest first. `unreadable`
// signatures are listed, but getTransaction doesn't return them yet.
const chain = vi.hoisted(() => ({
  txs: new Map<string, unknown>(),
  statuses: new Map<string, string>(),
  indexed: [] as string[],
  unreadable: new Set<string>(),
  statusConfigs: [] as unknown[],
  screeningDown: false,
  readDelayMs: 0,
  calls: { getTransaction: 0, getSignaturesForAddress: 0, getSignatureStatuses: 0 },
}));

vi.mock("@/server/solana/config", async (original) => {
  const actual = await original<typeof import("@/server/solana/config")>();
  const call = <T,>(value: T, delayMs = 0) => ({
    send: async () => {
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
      return value;
    },
  });
  const names = (signature: string, address: string) =>
    (chain.txs.get(signature) as FakeTx).transaction.message.accountKeys.some((key) => key.pubkey === address);
  return {
    ...actual,
    rpc: () => ({
      getSignatureStatuses: (signatures: string[], config: unknown) => {
        chain.calls.getSignatureStatuses++;
        chain.statusConfigs.push(config);
        return call({
          value: signatures.map((signature) => {
            const status = chain.statuses.get(signature);
            if (!status) return null;
            return status === "failed"
              ? { confirmationStatus: "confirmed", err: { InstructionError: [0, "Custom"] } }
              : { confirmationStatus: status, err: null };
          }),
        });
      },
      getTransaction: (signature: string) => {
        chain.calls.getTransaction++;
        return call(chain.unreadable.has(signature) ? null : (chain.txs.get(signature) ?? null), chain.readDelayMs);
      },
      getSignaturesForAddress: (address: string, config: { limit: number; before?: string; until?: string }) => {
        chain.calls.getSignaturesForAddress++;
        const named = chain.indexed.filter((signature) => names(signature, address)).reverse();
        // Nothing below a `before` the node doesn't know; down to the end past an `until` it doesn't meet.
        const start = config.before ? named.indexOf(config.before) + 1 : 0;
        if (config.before && !start) return call([]);
        const stop = config.until ? named.indexOf(config.until) : -1;
        const end = Math.min(stop >= start ? stop : named.length, start + config.limit);
        return call(
          named.slice(start, end).map((signature) => ({
            signature,
            err: chain.statuses.get(signature) === "failed" ? { InstructionError: [0, "Custom"] } : null,
            confirmationStatus: chain.statuses.get(signature) === "finalized" ? "finalized" : "confirmed",
            blockTime: (chain.txs.get(signature) as FakeTx).blockTime,
          })),
        );
      },
    }),
  };
});

// Counts what reconcile asks of settlement.
vi.mock("@/server/solana/settle", async (original) => {
  const actual = await original<typeof import("@/server/solana/settle")>();
  return { ...actual, settle: vi.fn(actual.settle), markUnderpaid: vi.fn(actual.markUnderpaid) };
});

vi.mock("@/server/solana/sanctions", async (original) => {
  const actual = await original<typeof import("@/server/solana/sanctions")>();
  return {
    ...actual,
    screen: async (address: string) => {
      if (chain.screeningDown) throw new actual.ScreeningUnavailable("Chainalysis unreachable");
      return actual.screen(address);
    },
  };
});

const { address, getBase58Decoder } = await import("@solana/kit");
const { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } = await import("@solana-program/token");
const { currentUser } = await import("@/server/auth");
const { balanceOf } = await import("@/server/credits");
const { db } = await import("@/server/db");
const { checkedSignatures, extraPayments, orders, scanCursors } = await import("@/server/db/schema");
const { USDC_MINTS } = await import("@/server/solana/config");
const { newReference, toOrderDTO } = await import("@/server/solana/orders");
const { lamportsFor, usdcUnitsFor } = await import("@/server/solana/quotes");
const { processWebhook, reconcile, syncOrder, webhookCandidates } = await import("@/server/solana/reconcile");
const { markUnderpaid, settle } = await import("@/server/solana/settle");
const { findProduct, FREE } = await import("@/lib/pricing");

const [TREASURY_ATA] = await findAssociatedTokenPda({
  owner: address(TREASURY),
  mint: address(USDC_MINTS.devnet),
  tokenProgram: TOKEN_PROGRAM_ADDRESS,
});

const newSignature = () => getBase58Decoder().decode(crypto.getRandomValues(new Uint8Array(64)));
const key = (pubkey: string, signer = false) => ({ pubkey, signer, writable: false, source: "transaction" });
const seconds = (date: Date) => Math.floor(date.getTime() / 1000);

async function user(handle: string) {
  return (await currentUser(new Request("http://localhost/api/me", { headers: { "x-dev-user": handle } })))!;
}

async function load(id: string) {
  const [row] = await (await db()).select().from(orders).where(eq(orders.id, id));
  return row;
}

async function extrasFor(signatures: string[]) {
  return (await db()).select().from(extraPayments).where(inArray(extraPayments.signature, signatures));
}

function resetCalls() {
  chain.calls = { getTransaction: 0, getSignaturesForAddress: 0, getSignatureStatuses: 0 };
}

// A USDC transfer to the treasury's token account, naming every reference given.
function usdcTx(references: string | string[], units: bigint, landed = new Date(), from = PAYER) {
  const mint = USDC_MINTS.devnet;
  const refs = typeof references === "string" ? [references] : references;
  const balance = (accountIndex: number, owner: string, amount: bigint) => ({
    accountIndex,
    mint,
    owner,
    uiTokenAmount: { amount: amount.toString() },
  });
  const start = BigInt(1_000_000_000);
  return {
    blockTime: seconds(landed),
    meta: {
      err: null,
      preBalances: [1_000_000_000, 2_039_280, 2_039_280, ...refs.map(() => 0), 1],
      postBalances: [1_000_000_000 - 5000, 2_039_280, 2_039_280, ...refs.map(() => 0), 1],
      preTokenBalances: [balance(1, from, start), balance(2, TREASURY, BigInt(0))],
      postTokenBalances: [balance(1, from, start - units), balance(2, TREASURY, units)],
    },
    transaction: {
      message: {
        accountKeys: [
          key(from, true),
          key("SrcAta1111111111111111111111111111111111111"),
          key(TREASURY_ATA),
          ...refs.map((reference) => key(reference)),
          key(TOKEN_PROGRAM),
        ],
      },
    },
  };
}

function solTx(reference: string, lamports: bigint, landed = new Date()) {
  return {
    blockTime: seconds(landed),
    meta: {
      err: null,
      preBalances: [10_000_000_000, 50_000_000, 0, 1],
      postBalances: [10_000_000_000 - Number(lamports) - 5000, 50_000_000 + Number(lamports), 0, 1],
      preTokenBalances: [],
      postTokenBalances: [],
    },
    transaction: { message: { accountKeys: [key(PAYER, true), key(TREASURY), key(reference), key(SYSTEM_PROGRAM)] } },
  };
}

// A memo naming references: moves nothing to the treasury, and costs only a fee.
function junkTx(references: string[]) {
  return {
    blockTime: seconds(new Date()),
    meta: {
      err: null,
      preBalances: [5_000_000_000, ...references.map(() => 0), 1],
      postBalances: [5_000_000_000 - 5000, ...references.map(() => 0), 1],
      preTokenBalances: [],
      postTokenBalances: [],
    },
    transaction: { message: { accountKeys: [key(ATTACKER, true), ...references.map((r) => key(r)), key(MEMO_PROGRAM)] } },
  };
}

// Puts a transaction on our fake chain. Unindexed, getSignaturesForAddress
// doesn't list it yet.
function land(tx: unknown, status: Status | null, indexed = true) {
  const signature = newSignature();
  chain.txs.set(signature, tx);
  if (status) chain.statuses.set(signature, status);
  if (indexed) chain.indexed.push(signature);
  return signature;
}

async function usdcOrder(handle: string, values: Partial<typeof orders.$inferInsert> = {}, productId = "credits-500") {
  const owner = await user(handle);
  const product = findProduct(productId)!;
  const [order] = await (await db())
    .insert(orders)
    .values({
      userId: owner.id,
      productId: product.id,
      usdCents: product.usdCents,
      currency: "USDC",
      mint: USDC_MINTS.devnet,
      amount: usdcUnitsFor(product.usdCents),
      recipient: TREASURY,
      reference: newReference(),
      expiresAt: new Date(Date.now() + 15 * MINUTE),
      ...values,
    })
    .returning();
  return { owner, order };
}

const delivery = (signature: string, reference: string) => [
  { signature, accountData: [{ account: reference }, { account: TREASURY }] },
];

// Helius's raw format, with every account the transaction names.
const rawDelivery = (signature: string) => [
  {
    transaction: {
      signatures: [signature],
      message: { accountKeys: (chain.txs.get(signature) as FakeTx).transaction.message.accountKeys.map((k) => k.pubkey) },
    },
  },
];

describe("late payments", () => {
  it("credits a payment that lands within the hour after the checkout closed", async () => {
    const { owner, order } = await usdcOrder("reconcile-late-ok", {
      status: "expired",
      expiresAt: new Date(Date.now() - 30 * MINUTE),
    });
    const signature = land(usdcTx(order.reference, order.amount), "confirmed");

    expect(await processWebhook(delivery(signature, order.reference))).toEqual({ updated: 1, failed: 0 });
    expect((await load(order.id)).status).toBe("confirmed");
    expect(await balanceOf(owner.id)).toBe(FREE.signupCredits + 500);
  });

  it("keeps a payment to a long-expired order for a refund instead of honouring its old quote", async () => {
    const owner = await user("reconcile-stale-quote");
    const product = findProduct("credits-6500")!;
    const locked = lamportsFor(product.usdCents, 150);
    const opened = new Date(Date.now() - 90 * 24 * 60 * MINUTE);
    const [order] = await (await db())
      .insert(orders)
      .values({
        userId: owner.id,
        productId: product.id,
        usdCents: product.usdCents,
        currency: "SOL",
        amount: locked,
        recipient: TREASURY,
        reference: newReference(),
        quote: { usdPerSol: 150 },
        status: "expired",
        createdAt: opened,
        expiresAt: new Date(opened.getTime() + 15 * MINUTE),
      })
      .returning();
    expect(toOrderDTO(order, owner)).toMatchObject({ solanaPayUrl: "", recipient: "", reference: "" });

    const signature = land(solTx(order.reference, locked), "confirmed");
    await processWebhook(delivery(signature, order.reference));

    expect(await load(order.id)).toMatchObject({ status: "refund_due", signature, payer: PAYER });
    expect(await balanceOf(owner.id)).toBe(FREE.signupCredits);
  });

  it("asks Helius to redeliver when our RPC doesn't know the payment yet, and reconcile still finds it", async () => {
    const { owner, order } = await usdcOrder("reconcile-rpc-lag", {
      createdAt: new Date(Date.now() - 25 * MINUTE),
      expiresAt: new Date(Date.now() - 10 * MINUTE),
    });
    await reconcile();
    expect((await load(order.id)).status).toBe("expired");

    const tx = usdcTx(order.reference, order.amount, new Date(Date.now() - 5 * MINUTE));
    const signature = land(tx, null, false);
    expect(await processWebhook(delivery(signature, order.reference))).toEqual({ updated: 0, failed: 1 });

    chain.statuses.set(signature, "finalized");
    chain.indexed.push(signature);
    await reconcile();
    expect(await load(order.id)).toMatchObject({ status: "finalized", signature });
    expect(await balanceOf(owner.id)).toBe(FREE.signupCredits + 500);
  });

  it("settles a top-up to an underpaid order without a webhook, and keeps the short payment on record", async () => {
    const { owner, order } = await usdcOrder("reconcile-top-up");
    const short = land(usdcTx(order.reference, order.amount / BigInt(2)), "confirmed");
    await processWebhook(delivery(short, order.reference));
    expect((await load(order.id)).status).toBe("underpaid");

    const full = land(usdcTx(order.reference, order.amount), "finalized");
    await reconcile();
    expect(await load(order.id)).toMatchObject({ status: "finalized", signature: full });
    expect(await extrasFor([short, full])).toEqual([
      expect.objectContaining({ signature: short, orderId: order.id, reason: "short", received: order.amount / BigInt(2) }),
    ]);
    expect(await balanceOf(owner.id)).toBe(FREE.signupCredits + 500);
  });

  it("retries a late payment held during a screening outage once screening is back", async () => {
    const { owner, order } = await usdcOrder("reconcile-screen-down", {
      status: "expired",
      expiresAt: new Date(Date.now() - 30 * MINUTE),
    });
    const signature = land(usdcTx(order.reference, order.amount), "finalized");
    chain.screeningDown = true;
    await processWebhook(delivery(signature, order.reference));
    chain.screeningDown = false;
    expect(await load(order.id)).toMatchObject({ status: "expired", signature });

    // Hours later the order is outside the late window, but the payment landed inside it.
    await reconcile(Date.now() + 3 * 60 * MINUTE);
    expect((await load(order.id)).status).toBe("finalized");
    expect(await balanceOf(owner.id)).toBe(FREE.signupCredits + 500);
  });
});

describe("reconcile", () => {
  it("expires abandoned checkouts even when payments held for screening fill the batch", async () => {
    const { order: abandoned } = await usdcOrder("reconcile-head-of-line", {
      expiresAt: new Date(Date.now() - 10 * MINUTE),
    });
    chain.screeningDown = true;
    for (let i = 0; i < 3; i++) {
      const { order } = await usdcOrder("reconcile-head-of-line", { createdAt: new Date("2000-01-01T00:00:00Z") });
      await processWebhook(delivery(land(usdcTx(order.reference, order.amount), "confirmed"), order.reference));
    }
    await reconcile(Date.now(), { limit: 1 });
    chain.screeningDown = false;
    expect((await load(abandoned.id)).status).toBe("expired");
  });

  it("stops reading the chain once its time budget is spent", async () => {
    const { order: abandoned } = await usdcOrder("reconcile-budget", { expiresAt: new Date(Date.now() - 10 * MINUTE) });
    const { order: paid } = await usdcOrder("reconcile-budget");
    land(usdcTx(paid.reference, paid.amount), "confirmed");
    resetCalls();
    await reconcile(Date.now(), { budgetMs: -1 });

    expect(chain.calls.getTransaction).toBe(0);
    expect((await load(paid.id)).status).toBe("pending");
    expect((await load(abandoned.id)).status).toBe("expired");
  });
});

describe("processWebhook", () => {
  it("keeps a second payment to a settled order for a refund", async () => {
    const { owner, order } = await usdcOrder("reconcile-repeat");
    const first = land(usdcTx(order.reference, order.amount), "confirmed");
    const second = land(usdcTx(order.reference, order.amount), "confirmed");
    await processWebhook(delivery(first, order.reference));
    await processWebhook(delivery(second, order.reference));
    await processWebhook(delivery(second, order.reference));

    expect((await load(order.id)).signature).toBe(first);
    expect(await extrasFor([first, second])).toEqual([
      expect.objectContaining({ signature: second, orderId: order.id, payer: PAYER, reason: "repeat" }),
    ]);
    expect(await balanceOf(owner.id)).toBe(FREE.signupCredits + 500);
  });

  it("doesn't ask for redelivery of a transaction that failed on chain", async () => {
    const { order } = await usdcOrder("reconcile-failed-tx");
    const signature = land(usdcTx(order.reference, order.amount), "failed");
    expect(await processWebhook(delivery(signature, order.reference))).toEqual({ updated: 0, failed: 0 });
    expect((await load(order.id)).status).toBe("pending");
  });

  it("settles the good items of a batch that also carries malformed ones", async () => {
    const { owner, order } = await usdcOrder("reconcile-malformed");
    const signature = land(usdcTx(order.reference, order.amount), "confirmed");
    const payload = [
      { signature: "bad-1", accountData: 5 },
      { signature: "bad-2", instructions: [{ accounts: 7 }, null] },
      { transaction: { signatures: ["bad-3"], message: { accountKeys: 3 } } },
      null,
      ...delivery(signature, order.reference),
    ];
    expect(webhookCandidates(payload)).toEqual([{ signature, keys: [order.reference, TREASURY] }]);
    expect(await processWebhook(payload)).toEqual({ updated: 1, failed: 0 });
    expect(await balanceOf(owner.id)).toBe(FREE.signupCredits + 500);
  });

  it("asks for a redelivery of what it had no time left for", async () => {
    const { order } = await usdcOrder("reconcile-webhook-budget");
    const signature = land(usdcTx(order.reference, order.amount), "confirmed");
    expect(await processWebhook(delivery(signature, order.reference), -1)).toEqual({ updated: 0, failed: 1 });
    expect((await load(order.id)).status).toBe("pending");
  });
});

// One transaction naming several orders' references (ATK-PAY-1). Wallets add
// one reference; settled orders' references are public on chain.
describe("a payment naming several orders", () => {
  // Strangers' settled orders, each paid by its own transaction (their references are public).
  async function settledStrangers(count: number, handle: string) {
    const strangers = [];
    for (let i = 0; i < count; i++) {
      const { owner, order } = await usdcOrder(`${handle}-${i}`, {}, i % 2 ? "credits-500" : "credits-6500");
      const own = land(usdcTx(order.reference, order.amount), i % 3 ? "finalized" : "confirmed");
      await processWebhook(rawDelivery(own));
      expect((await load(order.id)).signature).toBe(own);
      strangers.push({ owner, order, balance: await balanceOf(owner.id) });
    }
    return strangers;
  }

  it("credits the attacker's own order once and keeps nothing for a refund on strangers' settled orders", async () => {
    const strangers = await settledStrangers(2, "atk-multi-victim");
    const { owner: attacker, order: mine } = await usdcOrder("atk-multi-attacker");
    const warnings = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const t = land(usdcTx([...strangers.map(({ order }) => order.reference), mine.reference], mine.amount, new Date(), ATTACKER), "confirmed");
    resetCalls();
    await processWebhook(rawDelivery(t));
    await processWebhook(rawDelivery(t));
    const warned = warnings.mock.calls.filter((args) => args.join(" ").includes(t));
    warnings.mockRestore();

    // Read from the chain once, however many orders it names.
    expect(chain.calls.getTransaction).toBe(1);
    expect(await balanceOf(attacker.id)).toBe(FREE.signupCredits + 500);
    expect(await load(mine.id)).toMatchObject({ status: "confirmed", signature: t });
    expect(await extrasFor([t])).toEqual([]);
    expect(warned).toEqual([]);
    for (const { owner, order, balance } of strangers) {
      expect(await balanceOf(owner.id)).toBe(balance);
      expect((await load(order.id)).signature).not.toBe(t);
    }
  });

  it("applies a transaction naming more than a few orders to none of them, with no database transaction per order", async () => {
    const strangers = await settledStrangers(8, "atk-many-victim");
    const { owner: attacker, order: mine } = await usdcOrder("atk-many-attacker");
    const warnings = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const t = land(usdcTx([...strangers.map(({ order }) => order.reference), mine.reference], mine.amount, new Date(), ATTACKER), "confirmed");
    vi.mocked(settle).mockClear();
    vi.mocked(markUnderpaid).mockClear();
    await processWebhook(rawDelivery(t));
    await processWebhook(rawDelivery(t));
    await syncOrder(await load(mine.id));
    const warned = warnings.mock.calls.filter((args) => args.join(" ").includes(t));
    warnings.mockRestore();

    expect(vi.mocked(settle)).not.toHaveBeenCalled();
    expect(vi.mocked(markUnderpaid)).not.toHaveBeenCalled();
    expect(warned).toHaveLength(1);
    expect(await load(mine.id)).toMatchObject({ status: "pending", signature: null });
    expect(await balanceOf(attacker.id)).toBe(FREE.signupCredits);
    expect(await extrasFor([t])).toEqual([]);
    for (const { owner, order, balance } of strangers) {
      expect(await balanceOf(owner.id)).toBe(balance);
      expect((await load(order.id)).signature).not.toBe(t);
    }
  });

  it("is refunded at most once: refund_due on one order is never also a repeat on another", async () => {
    const { order: old } = await usdcOrder("atk-multi-own", {
      status: "expired",
      expiresAt: new Date(Date.now() - 3 * 60 * MINUTE),
    });
    const { order: paid } = await usdcOrder("atk-multi-own");
    await processWebhook(rawDelivery(land(usdcTx(paid.reference, paid.amount), "confirmed")));
    const t = land(usdcTx([old.reference, paid.reference], paid.amount, new Date(), ATTACKER), "confirmed");
    await processWebhook(rawDelivery(t));

    expect(await load(old.id)).toMatchObject({ status: "refund_due", signature: t });
    expect(await extrasFor([t])).toEqual([]);
  });

  it("leaves every order it names alone when it pays none of them in full", async () => {
    const pending = [];
    for (let i = 0; i < 5; i++) pending.push((await usdcOrder("atk-multi-short")).order);
    const t = land(usdcTx(pending.map((order) => order.reference), BigInt(1_000_000), new Date(), ATTACKER), "confirmed");
    await processWebhook(rawDelivery(t));

    for (const order of pending) expect(await load(order.id)).toMatchObject({ status: "pending", error: null });
    expect(await extrasFor([t])).toEqual([]);
  });

  it("credits the order it covers and books nothing short against the other, without a webhook", async () => {
    const { owner, order: small } = await usdcOrder("atk-multi-reconcile");
    const { order: big } = await usdcOrder("atk-multi-reconcile", {}, "credits-6500");
    const t = land(usdcTx([small.reference, big.reference], small.amount, new Date(), ATTACKER), "confirmed");
    await syncOrder(await load(big.id));
    await reconcile();

    expect(await load(small.id)).toMatchObject({ status: "confirmed", signature: t });
    expect(await load(big.id)).toMatchObject({ status: "pending", error: null });
    expect(await extrasFor([t])).toEqual([]);
    expect(await balanceOf(owner.id)).toBe(FREE.signupCredits + 500);
  });

  it("keeps dust sent to a stranger's settled order once per transaction, for no more than arrived", async () => {
    const { order } = await usdcOrder("atk-dust-victim");
    await processWebhook(rawDelivery(land(usdcTx(order.reference, order.amount), "finalized")));
    const dust = [];
    for (let i = 0; i < 30; i++) {
      const signature = land(usdcTx(order.reference, BigInt(1), new Date(), ATTACKER), "confirmed");
      dust.push(signature);
      await processWebhook(rawDelivery(signature));
      await processWebhook(rawDelivery(signature));
    }
    const kept = await extrasFor(dust);
    expect(kept).toHaveLength(30);
    expect(kept.reduce((sum, row) => sum + row.received, BigInt(0))).toBe(BigInt(30));
    expect((await load(order.id)).status).toBe("finalized");
  });
});

// References flooded with junk transactions (ATK-PAY-2): they name a reference
// but send the treasury nothing, so they cost only a fee and no webhook fires.
describe("junk naming references", () => {
  it("costs each look at an order a few reads, and each junk transaction is read once", async () => {
    const { order } = await usdcOrder("atk-junk-look");
    for (let i = 0; i < 30; i++) land(junkTx([order.reference]), "confirmed");
    const reads = [];
    for (let look = 0; look < 8; look++) {
      resetCalls();
      await syncOrder(await load(order.id));
      reads.push(chain.calls.getTransaction);
    }
    expect(reads).toEqual([5, 5, 5, 5, 5, 5, 0, 0]);
  });

  it("can't keep reconcile from crediting a recently closed order paid late", async () => {
    // Out of the way: orders earlier tests left waiting.
    await (await db()).update(orders).set({ status: "failed" }).where(inArray(orders.status, ["pending", "expired", "underpaid"]));
    const spam = [];
    for (let i = 0; i < 100; i++) {
      const { order } = await usdcOrder("atk-junk-spam", {
        status: "expired",
        createdAt: new Date(Date.now() - 20 * MINUTE),
        expiresAt: new Date(Date.now() - 5 * MINUTE),
      });
      spam.push(order.reference);
    }
    for (let i = 0; i < 25; i++) land(junkTx(spam), "confirmed");
    const { owner: victim, order } = await usdcOrder("atk-junk-victim", {
      status: "expired",
      createdAt: new Date(Date.now() - 19 * MINUTE),
      expiresAt: new Date(Date.now() - 4 * MINUTE),
    });
    land(usdcTx(order.reference, order.amount, new Date(Date.now() - 5 * MINUTE)), "finalized");

    resetCalls();
    await reconcile();
    expect((await load(order.id)).status).toBe("finalized");
    expect(await balanceOf(victim.id)).toBe(FREE.signupCredits + 500);
    expect(chain.calls.getSignaturesForAddress).toBe(1);
    expect(chain.calls.getTransaction).toBeLessThan(5);
  });
});

describe("finalizing", () => {
  it("searches the full status history, and orders stuck at confirmed don't hold up newer ones", async () => {
    const owner = await user("reconcile-stuck");
    const database = await db();
    const product = findProduct("credits-500")!;
    const base = {
      userId: owner.id,
      productId: product.id,
      usdCents: product.usdCents,
      currency: "USDC" as const,
      mint: USDC_MINTS.devnet,
      amount: usdcUnitsFor(product.usdCents),
      recipient: TREASURY,
      status: "confirmed" as const,
      expiresAt: new Date(),
    };
    const dayAgo = new Date(Date.now() - 24 * 60 * MINUTE);
    await database.insert(orders).values(
      Array.from({ length: 100 }, () => ({
        ...base,
        reference: newReference(),
        signature: newSignature(),
        confirmedAt: dayAgo,
      })),
    );
    const fresh = land(usdcTx("unused", BigInt(1)), "finalized", false);
    const [order] = await database
      .insert(orders)
      .values({ ...base, reference: newReference(), signature: fresh, confirmedAt: new Date(Date.now() - MINUTE) })
      .returning();

    const alerts = vi.spyOn(console, "error").mockImplementation(() => undefined);
    chain.statusConfigs.length = 0;
    resetCalls();
    await reconcile(Date.now(), { limit: 100 });
    const alerted = alerts.mock.calls.filter(([message]) => String(message).includes("has been confirmed for over"));
    alerts.mockRestore();

    expect((await load(order.id)).status).toBe("finalized");
    expect(alerted.length).toBeGreaterThan(0);
    // One status lookup for the whole batch.
    expect(chain.calls.getSignatureStatuses).toBe(1);
    expect(chain.statusConfigs.length).toBeGreaterThan(0);
    for (const config of chain.statusConfigs) expect(config).toEqual({ searchTransactionHistory: true });
  });
});

// The treasury scan starts afresh: nothing else waiting, nothing listed, no cursor.
async function freshScan() {
  const database = await db();
  await database.update(orders).set({ status: "failed" }).where(inArray(orders.status, ["pending", "expired", "underpaid"]));
  await database.delete(scanCursors);
  chain.indexed.length = 0;
  chain.unreadable.clear();
  chain.readDelayMs = 0;
}

async function cursorFor(account: string) {
  const [row] = await (await db()).select().from(scanCursors).where(eq(scanCursors.account, account));
  return row;
}

// A payment the webhook missed, then junk landing on the treasury after it
// (R3-PAY-1). The attacker sees the payment, and its reference, in the
// treasury's public history; each junk transaction costs only a fee.
describe("junk landing on the treasury after a payment the webhook missed", () => {
  async function missedPayment(handle: string) {
    const { owner, order } = await usdcOrder(handle, { createdAt: new Date(Date.now() - 5 * MINUTE) });
    const paid = land(usdcTx(order.reference, order.amount, new Date(Date.now() - 2 * MINUTE)), "finalized");
    return { owner, order, paid };
  }

  it("credits it on the second run after a burst of 3,000 naming the USDC account and the reference, and reads each one once", async () => {
    await freshScan();
    const { owner, order, paid } = await missedPayment("burst-victim");
    // Someone else's checkout stays open, so the scan carries on after the victim's.
    await usdcOrder("burst-other", { createdAt: new Date(Date.now() - 5 * MINUTE) });
    for (let i = 0; i < 3000; i++) land(junkTx([TREASURY_ATA, order.reference]), "confirmed");
    const newest = chain.indexed[chain.indexed.length - 1];

    const warnings = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const reads = [];
    const statuses = [];
    for (let run = 0; run < 13; run++) {
      resetCalls();
      await reconcile();
      reads.push(chain.calls.getTransaction);
      statuses.push((await load(order.id)).status);
    }
    const behind = warnings.mock.calls.filter(([message]) => String(message).includes("is behind"));
    warnings.mockRestore();

    // Run 1 lists the burst and leaves a mark below it; run 2 reads below the mark.
    expect(statuses.slice(0, 2)).toEqual(["pending", "finalized"]);
    expect(await load(order.id)).toMatchObject({ status: "finalized", signature: paid });
    expect(await balanceOf(owner.id)).toBe(FREE.signupCredits + 500);
    expect(reads).toEqual([0, 1, 300, 300, 300, 300, 300, 300, 300, 300, 300, 300, 0]);
    expect(behind.length).toBeGreaterThan(0);
    expect(await cursorFor(TREASURY_ATA)).toMatchObject({ until: newest, marks: [] });
  });

  it("credits it within four runs after a burst of 10,000, listing a few pages per run", async () => {
    await freshScan();
    const { owner, order } = await missedPayment("burst-10k-victim");
    for (let i = 0; i < 10_000; i++) land(junkTx([TREASURY_ATA, order.reference]), "confirmed");

    const warnings = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const runs = [];
    for (let run = 0; run < 4 && (await load(order.id)).status === "pending"; run++) {
      resetCalls();
      await reconcile();
      runs.push({ lists: chain.calls.getSignaturesForAddress, reads: chain.calls.getTransaction });
    }
    warnings.mockRestore();

    expect((await load(order.id)).status).toBe("finalized");
    expect(await balanceOf(owner.id)).toBe(FREE.signupCredits + 500);
    for (const { lists, reads } of runs) {
      expect(lists).toBeLessThanOrEqual(4);
      expect(reads).toBeLessThanOrEqual(300);
    }
  });

  it("credits it on the second run while 300 more land before every run", async () => {
    await freshScan();
    const { order } = await missedPayment("burst-sustained-victim");
    for (let i = 0; i < 3000; i++) land(junkTx([TREASURY_ATA, order.reference]), "confirmed");
    const warnings = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const statuses = [];
    for (let run = 0; run < 2; run++) {
      for (let i = 0; i < 300; i++) land(junkTx([TREASURY_ATA]), "confirmed");
      await reconcile();
      statuses.push((await load(order.id)).status);
    }
    warnings.mockRestore();
    expect(statuses).toEqual(["pending", "finalized"]);
  });

  it("lets the owner's next poll find it too, with no more than five reads", async () => {
    await freshScan();
    const { owner, order, paid } = await missedPayment("burst-poll-victim");
    for (let i = 0; i < 3000; i++) land(junkTx([TREASURY_ATA, order.reference]), "confirmed");
    const warnings = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await reconcile();
    warnings.mockRestore();
    expect((await load(order.id)).status).toBe("pending");

    resetCalls();
    expect(await syncOrder(await load(order.id))).toBe(true);
    expect(chain.calls.getTransaction).toBe(1);
    expect(await load(order.id)).toMatchObject({ status: "finalized", signature: paid });
    expect(await balanceOf(owner.id)).toBe(FREE.signupCredits + 500);
  });

  it("finds a late payment on the owner's first poll however much junk names only the reference after it", async () => {
    await freshScan();
    const { owner, order } = await usdcOrder("burst-poll-late", {
      status: "expired",
      createdAt: new Date(Date.now() - 20 * MINUTE),
      expiresAt: new Date(Date.now() - 5 * MINUTE),
    });
    land(usdcTx(order.reference, order.amount, new Date(Date.now() - 3 * MINUTE)), "finalized");
    for (let i = 0; i < 150; i++) land(junkTx([order.reference]), "confirmed");

    resetCalls();
    expect(await syncOrder(await load(order.id))).toBe(true);
    expect(chain.calls.getTransaction).toBe(1);
    expect((await load(order.id)).status).toBe("finalized");
    expect(await balanceOf(owner.id)).toBe(FREE.signupCredits + 500);
  });

  it("reads a payment our RPC couldn't return yet on a later run instead of moving past it", async () => {
    await freshScan();
    const { owner, order, paid } = await missedPayment("scan-unreadable-victim");
    chain.unreadable.add(paid);
    for (let i = 0; i < 10; i++) land(junkTx([TREASURY_ATA]), "confirmed");
    const warnings = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const reads = [];
    for (let run = 0; run < 2; run++) {
      resetCalls();
      await reconcile();
      reads.push(chain.calls.getTransaction);
    }
    expect((await load(order.id)).status).toBe("pending");
    // The junk after it is read once; the payment is tried again every run.
    expect(reads).toEqual([11, 1]);

    chain.unreadable.delete(paid);
    await reconcile();
    warnings.mockRestore();
    expect(await load(order.id)).toMatchObject({ status: "finalized", signature: paid });
    expect(await balanceOf(owner.id)).toBe(FREE.signupCredits + 500);
    expect(await cursorFor(TREASURY_ATA)).toMatchObject({ until: chain.indexed[chain.indexed.length - 1], stuck: null });
  });

  it("passes over a transaction our RPC never returns after ten runs, with an error to check it by hand", async () => {
    await freshScan();
    await usdcOrder("scan-stuck-waiting");
    const lost = land(junkTx([TREASURY_ATA]), "confirmed");
    chain.unreadable.add(lost);
    const warnings = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const reads = [];
    for (let run = 0; run < 12; run++) {
      resetCalls();
      await reconcile();
      reads.push(chain.calls.getTransaction);
    }
    const passed = errors.mock.calls.filter(([message]) => String(message).includes(`passed over ${lost}`));
    warnings.mockRestore();
    errors.mockRestore();

    expect(reads).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0]);
    expect(passed).toHaveLength(1);
    expect(await cursorFor(TREASURY_ATA)).toMatchObject({ until: lost, stuck: null, stuckRuns: 0 });
  });

  it("skips dust naming many settled orders' references without a database transaction per order", async () => {
    await freshScan();
    const strangers = [];
    for (let i = 0; i < 8; i++) {
      const { order } = await usdcOrder(`scan-many-${i}`);
      await processWebhook(rawDelivery(land(usdcTx(order.reference, order.amount), "finalized")));
      strangers.push(order.reference);
    }
    const { order: waiting } = await usdcOrder("scan-many-waiting");
    const dust = land(usdcTx(strangers, BigInt(1), new Date(), ATTACKER), "confirmed");
    vi.mocked(settle).mockClear();
    vi.mocked(markUnderpaid).mockClear();
    const warnings = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await reconcile();
    warnings.mockRestore();

    expect(vi.mocked(settle)).not.toHaveBeenCalled();
    expect(vi.mocked(markUnderpaid)).not.toHaveBeenCalled();
    expect(await extrasFor([dust])).toEqual([]);
    expect(await (await db()).select().from(checkedSignatures).where(eq(checkedSignatures.signature, dust))).toHaveLength(1);
    expect((await load(waiting.id)).status).toBe("pending");
  });
});

describe("one reconcile run shares its reads and time", () => {
  it("doesn't let a flood on the treasury's USDC account keep the scan from the treasury wallet, or the other way round", async () => {
    await freshScan();
    const product = findProduct("credits-500")!;
    const { owner: usdcOwner, order: usdc } = await usdcOrder("fair-usdc", { createdAt: new Date(Date.now() - 4 * MINUTE) });
    const { owner: solOwner, order: sol } = await usdcOrder("fair-sol", {
      currency: "SOL",
      mint: null,
      amount: lamportsFor(product.usdCents, 150),
      createdAt: new Date(Date.now() - 4 * MINUTE),
    });
    land(usdcTx(usdc.reference, usdc.amount, new Date(Date.now() - 2 * MINUTE)), "finalized");
    land(solTx(sol.reference, sol.amount, new Date(Date.now() - 2 * MINUTE)), "finalized");
    for (let i = 0; i < 300; i++) {
      land(junkTx([TREASURY_ATA]), "confirmed");
      land(junkTx([TREASURY]), "confirmed");
    }

    const warnings = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    resetCalls();
    await reconcile();
    warnings.mockRestore();

    expect(chain.calls.getTransaction).toBeLessThanOrEqual(300);
    expect((await load(usdc.id)).status).toBe("finalized");
    expect((await load(sol.id)).status).toBe("finalized");
    expect(await balanceOf(usdcOwner.id)).toBe(FREE.signupCredits + 500);
    expect(await balanceOf(solOwner.id)).toBe(FREE.signupCredits + 500);
  });

  it("retries a payment held for screening before a slow, flooded scan can use up the time", async () => {
    await freshScan();
    const { owner, order } = await usdcOrder("fair-held", { createdAt: new Date(Date.now() - 6 * MINUTE) });
    const signature = land(usdcTx(order.reference, order.amount, new Date(Date.now() - 5 * MINUTE)), "finalized");
    chain.screeningDown = true;
    await processWebhook(delivery(signature, order.reference));
    chain.screeningDown = false;
    expect((await load(order.id)).signature).toBe(signature);
    await usdcOrder("fair-held-waiting", { createdAt: new Date(Date.now() - 3 * MINUTE) });

    chain.readDelayMs = 10;
    for (let i = 0; i < 300; i++) land(junkTx([TREASURY_ATA]), "confirmed");
    const warnings = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await reconcile(Date.now(), { budgetMs: 2000 });
    warnings.mockRestore();
    chain.readDelayMs = 0;

    expect((await load(order.id)).status).toBe("finalized");
    expect(await balanceOf(owner.id)).toBe(FREE.signupCredits + 500);
  });
});

describe("large webhook deliveries", () => {
  it("reads past the 100th item of a delivery", async () => {
    await freshScan();
    const junk = Array.from({ length: 100 }, () => {
      const signature = land(junkTx([TREASURY_ATA]), "confirmed");
      return { signature, accountData: [{ account: TREASURY_ATA }] };
    });
    const { owner, order } = await usdcOrder("webhook-batch-victim");
    const signature = land(usdcTx(order.reference, order.amount), "confirmed", false);

    expect(await processWebhook([...junk, ...delivery(signature, order.reference)])).toEqual({ updated: 1, failed: 0 });
    expect(await balanceOf(owner.id)).toBe(FREE.signupCredits + 500);
  });

  it("asks for a redelivery of what it had no reads left for, and reads on from there next time", async () => {
    await freshScan();
    const { order: stranger } = await usdcOrder("webhook-batch-stranger");
    await processWebhook(rawDelivery(land(usdcTx(stranger.reference, stranger.amount), "finalized")));
    // Each names a settled order, so each has to be read to be ruled out.
    const junk = Array.from({ length: 120 }, () => rawDelivery(land(junkTx([TREASURY_ATA, stranger.reference]), "confirmed"))[0]);
    const { owner, order } = await usdcOrder("webhook-batch-late");
    const payload = [...junk, ...rawDelivery(land(usdcTx(order.reference, order.amount), "confirmed", false))];

    resetCalls();
    expect(await processWebhook(payload)).toEqual({ updated: 0, failed: 21 });
    expect((await load(order.id)).status).toBe("pending");
    expect(await processWebhook(payload)).toEqual({ updated: 1, failed: 0 });
    expect(chain.calls.getTransaction).toBe(121);
    expect(await balanceOf(owner.id)).toBe(FREE.signupCredits + 500);
  });
});
