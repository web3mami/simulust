import { describe, expect, it, vi } from "vitest";

const TREASURY = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const PAYER = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const SECRET = "helius-test-secret";

vi.hoisted(() => {
  process.env.SOLANA_CLUSTER = "devnet";
  process.env.TREASURY_ADDRESS = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
  process.env.HELIUS_WEBHOOK_SECRET = "helius-test-secret";
});

const chain = vi.hoisted(() => ({ txs: new Map<string, unknown>(), statuses: new Map<string, string>() }));

vi.mock("@/server/solana/config", async (original) => {
  const actual = await original<typeof import("@/server/solana/config")>();
  const call = <T,>(value: T) => ({ send: async () => value });
  return {
    ...actual,
    rpc: () => ({
      getSignatureStatuses: (signatures: string[]) =>
        call({
          value: signatures.map((signature) =>
            chain.statuses.has(signature) ? { confirmationStatus: chain.statuses.get(signature), err: null } : null,
          ),
        }),
      getTransaction: (signature: string) => call(chain.txs.get(signature) ?? null),
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
const { POST } = await import("@/app/api/webhooks/helius/route");
const { FREE } = await import("@/lib/pricing");
const { eq } = await import("drizzle-orm");

function deliver(body: unknown, secret = SECRET) {
  return POST(
    new Request("http://localhost/api/webhooks/helius", {
      method: "POST",
      headers: { authorization: secret, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

function usdcPayment(reference: string, units: bigint) {
  const mint = USDC_MINTS.devnet;
  const key = (pubkey: string, signer = false) => ({ pubkey, signer, writable: false, source: "transaction" });
  return {
    blockTime: Math.floor(Date.now() / 1000),
    meta: {
      err: null,
      preBalances: [1_000_000_000, 2_039_280, 2_039_280, 0, 1],
      postBalances: [1_000_000_000 - 5000, 2_039_280, 2_039_280, 0, 1],
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
  };
}

describe("POST /api/webhooks/helius", () => {
  it("rejects a delivery without the shared secret", async () => {
    expect((await deliver([], "wrong")).status).toBe(401);
  });

  it("settles before answering, and asks for a redelivery while our RPC hasn't seen the payment", async () => {
    const owner = (await currentUser(
      new Request("http://localhost/api/me", { headers: { "x-dev-user": "helius-retry" } }),
    ))!;
    const order = await createOrder(owner, "credits-500", "USDC");
    const signature = "5".repeat(87);
    chain.txs.set(signature, usdcPayment(order.reference, order.amount));
    // Raw format, plus a malformed item that must not sink the batch.
    const body = [
      { signature: "junk", accountData: 5 },
      { transaction: { signatures: [signature], message: { accountKeys: [order.reference, TREASURY] } } },
    ];

    const early = await deliver(body);
    expect(early.status).toBe(503);
    expect(await balanceOf(owner.id)).toBe(FREE.signupCredits);

    chain.statuses.set(signature, "confirmed");
    const retry = await deliver(body);
    expect(retry.status).toBe(200);
    const [row] = await (await db()).select().from(orders).where(eq(orders.id, order.id));
    expect(row).toMatchObject({ status: "confirmed", signature });
    expect(await balanceOf(owner.id)).toBe(FREE.signupCredits + 500);

    // Helius may deliver the same transaction again: nothing more is credited.
    expect((await deliver(body)).status).toBe(200);
    expect(await balanceOf(owner.id)).toBe(FREE.signupCredits + 500);
  });

  it("asks for a redelivery of a batch with more than it reads at once, and credits a payment past the 100th on the retry", async () => {
    const user = async (handle: string) =>
      (await currentUser(new Request("http://localhost/api/me", { headers: { "x-dev-user": handle } })))!;
    const stranger = await createOrder(await user("helius-batch-stranger"), "credits-500", "USDC");
    // 120 fee-only transactions naming an order, so each has to be read to be ruled out.
    const junk = Array.from({ length: 120 }, () => {
      const signature = getBase58Decoder().decode(crypto.getRandomValues(new Uint8Array(64)));
      chain.txs.set(signature, {
        blockTime: Math.floor(Date.now() / 1000),
        meta: { err: null, preBalances: [5_000_000_000, 0], postBalances: [5_000_000_000 - 5000, 0] },
        transaction: { message: { accountKeys: [{ pubkey: PAYER, signer: true }, { pubkey: stranger.reference }] } },
      });
      chain.statuses.set(signature, "confirmed");
      return { transaction: { signatures: [signature], message: { accountKeys: [PAYER, stranger.reference] } } };
    });
    const owner = await user("helius-batch-owner");
    const order = await createOrder(owner, "credits-500", "USDC");
    const signature = "6".repeat(87);
    chain.txs.set(signature, usdcPayment(order.reference, order.amount));
    chain.statuses.set(signature, "confirmed");
    const body = [...junk, { transaction: { signatures: [signature], message: { accountKeys: [order.reference, TREASURY] } } }];

    expect((await deliver(body)).status).toBe(503);
    expect(await balanceOf(owner.id)).toBe(FREE.signupCredits);
    expect((await deliver(body)).status).toBe(200);
    const [row] = await (await db()).select().from(orders).where(eq(orders.id, order.id));
    expect(row).toMatchObject({ status: "confirmed", signature });
    expect(await balanceOf(owner.id)).toBe(FREE.signupCredits + 500);
  });
});
