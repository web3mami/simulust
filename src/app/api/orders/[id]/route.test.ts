import { describe, expect, it, vi } from "vitest";

const TREASURY = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const PAYER = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const MINUTE = 60_000;

vi.hoisted(() => {
  process.env.SOLANA_CLUSTER = "devnet";
  process.env.TREASURY_ADDRESS = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
});

const chain = vi.hoisted(() => ({
  txs: new Map<string, unknown>(),
  byAddress: new Map<string, { signature: string; err: null; confirmationStatus: string }[]>(),
  lookups: [] as string[],
  reads: 0,
}));

vi.mock("@/server/solana/config", async (original) => {
  const actual = await original<typeof import("@/server/solana/config")>();
  const call = <T,>(value: T) => ({ send: async () => value });
  return {
    ...actual,
    rpc: () => ({
      getSignatureStatuses: (signatures: string[]) =>
        call({ value: signatures.map((signature) => (chain.txs.has(signature) ? { confirmationStatus: "confirmed", err: null } : null)) }),
      getTransaction: (signature: string) => {
        chain.reads++;
        return call(chain.txs.get(signature) ?? null);
      },
      // Newest first, a page at a time, like a node.
      getSignaturesForAddress: (address: string, config: { limit: number; before?: string }) => {
        chain.lookups.push(address);
        const listed = chain.byAddress.get(address) ?? [];
        const start = config.before ? listed.findIndex((entry) => entry.signature === config.before) + 1 : 0;
        return call(listed.slice(start, start + config.limit));
      },
    }),
  };
});

const { getBase58Decoder } = await import("@solana/kit");
const { currentUser } = await import("@/server/auth");
const { balanceOf } = await import("@/server/credits");
const { db } = await import("@/server/db");
const { orders } = await import("@/server/db/schema");
const { USDC_MINTS } = await import("@/server/solana/config");
const { createOrder } = await import("@/server/solana/orders");
const { ScreeningUnavailable } = await import("@/server/solana/sanctions");
const { settle } = await import("@/server/solana/settle");
const { GET } = await import("@/app/api/orders/[id]/route");
const { FREE } = await import("@/lib/pricing");
const { eq } = await import("drizzle-orm");

async function closedOrder(handle: string, closedAgo: number) {
  const owner = (await currentUser(new Request("http://localhost/api/me", { headers: { "x-dev-user": handle } })))!;
  const order = await createOrder(owner, "credits-500", "USDC");
  const expiresAt = new Date(Date.now() - closedAgo);
  await (await db()).update(orders).set({ status: "expired", expiresAt }).where(eq(orders.id, order.id));
  return { owner, order: { ...order, status: "expired" as const, expiresAt } };
}

const newSignature = () => getBase58Decoder().decode(crypto.getRandomValues(new Uint8Array(64)));

function payOnChain(reference: string, units: bigint, landed: Date, signature = "4".repeat(87)) {
  const mint = USDC_MINTS.devnet;
  const key = (pubkey: string, signer = false) => ({ pubkey, signer, writable: false, source: "transaction" });
  chain.txs.set(signature, {
    blockTime: Math.floor(landed.getTime() / 1000),
    meta: {
      err: null,
      preBalances: [1_000_000_000, 0, 0, 0, 1],
      postBalances: [1_000_000_000 - 5000, 0, 0, 0, 1],
      preTokenBalances: [
        { accountIndex: 1, mint, owner: PAYER, uiTokenAmount: { amount: "100000000" } },
        { accountIndex: 2, mint, owner: TREASURY, uiTokenAmount: { amount: "0" } },
      ],
      postTokenBalances: [
        { accountIndex: 1, mint, owner: PAYER, uiTokenAmount: { amount: String(BigInt(100_000_000) - units) } },
        { accountIndex: 2, mint, owner: TREASURY, uiTokenAmount: { amount: String(units) } },
      ],
    },
    transaction: {
      message: {
        accountKeys: [
          key(PAYER, true),
          key("SrcAta1111111111111111111111111111111111111"),
          key("DstAta1111111111111111111111111111111111111"),
          key(reference),
          key("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
        ],
      },
    },
  });
  chain.byAddress.set(reference, [{ signature, err: null, confirmationStatus: "finalized" }]);
  return signature;
}

function poll(id: string, handle: string) {
  return GET(new Request(`http://localhost/api/orders/${id}`, { headers: { "x-dev-user": handle } }), {
    params: Promise.resolve({ id }),
  });
}

describe("GET /api/orders/[id]", () => {
  it("re-checks a checkout that closed within the hour and credits a payment that landed late", async () => {
    const { owner, order } = await closedOrder("poll-late", 20 * MINUTE);
    const signature = payOnChain(order.reference, order.amount, new Date(Date.now() - 5 * MINUTE));

    const response = await poll(order.id, "poll-late");
    const { order: dto } = await response.json();
    expect(dto).toMatchObject({ status: "finalized", signature });
    expect(await balanceOf(owner.id)).toBe(FREE.signupCredits + 500);
  });

  it("leaves a checkout that closed long ago alone and offers no way to pay it", async () => {
    const { order } = await closedOrder("poll-stale", 3 * 60 * MINUTE);
    chain.lookups.length = 0;

    const body = await (await poll(order.id, "poll-stale")).json();
    expect(body).toMatchObject({ order: { status: "expired", solanaPayUrl: "", recipient: "", reference: "" }, watching: false });
    expect(chain.lookups).toEqual([]);
  });

  it("keeps the checkout watching a payment held for final checks after the checkout closed", async () => {
    const { order } = await closedOrder("poll-held", MINUTE);
    const held = await settle(
      order.id,
      {
        signature: "sigHELD1",
        payer: PAYER,
        payers: [PAYER],
        received: order.amount,
        accounts: [order.reference],
        commitment: "confirmed",
        paidAt: new Date(Date.now() - 2 * MINUTE),
      },
      {
        screen: async () => {
          throw new ScreeningUnavailable("Chainalysis down");
        },
      },
    );
    expect(held).toMatchObject({ status: "expired", reason: "screening_unavailable" });

    const body = await (await poll(order.id, "poll-held")).json();
    expect(body).toMatchObject({ order: { status: "expired", signature: "sigHELD1" }, watching: true });
  });

  it("reads only a few transactions per poll of a reference flooded with junk", async () => {
    const owner = (await currentUser(new Request("http://localhost/api/me", { headers: { "x-dev-user": "poll-junk" } })))!;
    const order = await createOrder(owner, "credits-500", "USDC");
    const junk = Array.from({ length: 30 }, () => {
      const signature = getBase58Decoder().decode(crypto.getRandomValues(new Uint8Array(64)));
      chain.txs.set(signature, {
        blockTime: Math.floor(Date.now() / 1000),
        meta: { err: null, preBalances: [5_000_000_000, 0], postBalances: [5_000_000_000 - 5000, 0] },
        transaction: { message: { accountKeys: [{ pubkey: PAYER, signer: true }, { pubkey: order.reference }] } },
      });
      return { signature, err: null, confirmationStatus: "confirmed" };
    });
    chain.byAddress.set(order.reference, junk);

    chain.reads = 0;
    const body = await (await poll(order.id, "poll-junk")).json();
    expect(body).toMatchObject({ order: { status: "pending" }, watching: true });
    expect(chain.reads).toBe(5);
  });

  it("finds a late payment on the next poll however much junk names the reference after it", async () => {
    const { owner, order } = await closedOrder("poll-buried", 5 * MINUTE);
    const signature = payOnChain(order.reference, order.amount, new Date(Date.now() - 3 * MINUTE), newSignature());
    const junk = Array.from({ length: 1500 }, () => {
      const junkSignature = newSignature();
      chain.txs.set(junkSignature, {
        blockTime: Math.floor(Date.now() / 1000),
        meta: { err: null, preBalances: [5_000_000_000, 0], postBalances: [5_000_000_000 - 5000, 0] },
        transaction: { message: { accountKeys: [{ pubkey: PAYER, signer: true }, { pubkey: order.reference }] } },
      });
      return { signature: junkSignature, err: null, confirmationStatus: "confirmed" };
    });
    chain.byAddress.set(order.reference, [...junk.reverse(), ...chain.byAddress.get(order.reference)!]);

    chain.reads = 0;
    const { order: dto } = await (await poll(order.id, "poll-buried")).json();
    expect(dto).toMatchObject({ status: "finalized", signature });
    expect(chain.reads).toBe(1);
    expect(await balanceOf(owner.id)).toBe(FREE.signupCredits + 500);
  });
});
