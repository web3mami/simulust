import { describe, expect, it, vi } from "vitest";
import {
  AccountRole,
  decompileTransactionMessage,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  type Instruction,
} from "@solana/kit";
import type { Order } from "@/server/db/schema";

const TREASURY = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const PAYER = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const BLOCKHASH = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

vi.hoisted(() => {
  process.env.TREASURY_ADDRESS = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
  process.env.SOLANA_CLUSTER = "devnet";
});

const chain = vi.hoisted(() => ({ treasuryAtaExists: false, usdc: "100000000", lamports: BigInt(5_000_000_000) }));

vi.mock("@/server/solana/config", async (original) => {
  const actual = await original<typeof import("@/server/solana/config")>();
  const call = <T,>(value: T) => ({ send: async () => value });
  return {
    ...actual,
    rpc: () => ({
      getTokenAccountBalance: () => call({ value: { amount: chain.usdc, decimals: 6 } }),
      getAccountInfo: () => call({ value: chain.treasuryAtaExists ? { data: ["", "base64"] } : null }),
      getBalance: () => call({ value: chain.lamports }),
      getLatestBlockhash: () =>
        call({ value: { blockhash: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", lastValidBlockHeight: BigInt(1000) } }),
    }),
  };
});

const { buildPaymentTransaction } = await import("@/server/solana/transaction");
const { newReference } = await import("@/server/solana/orders");
const { USDC_MINTS } = await import("@/server/solana/config");

function order(overrides: Partial<Order>): Order {
  return {
    id: "6f1c0e43-5f7b-4d1e-9a3a-1b2c3d4e5f60",
    userId: "00000000-0000-4000-8000-000000000000",
    productId: "credits-500",
    usdCents: 499,
    currency: "USDC",
    mint: USDC_MINTS.devnet,
    amount: BigInt(4_990_000),
    recipient: TREASURY,
    reference: newReference(),
    quote: null,
    status: "pending",
    signature: null,
    payer: null,
    payers: [],
    error: null,
    expiresAt: new Date(Date.now() + 10 * 60_000),
    confirmedAt: null,
    finalizedAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function decode(base64: string) {
  const transaction = getTransactionDecoder().decode(getBase64Encoder().encode(base64));
  const message = decompileTransactionMessage(getCompiledTransactionMessageDecoder().decode(transaction.messageBytes));
  return { transaction, message };
}

describe("buildPaymentTransaction", () => {
  it("builds an unsigned USDC transferChecked with the reference, memo and treasury account", async () => {
    const pay = order({});
    const { transaction, message } = decode((await buildPaymentTransaction(pay, PAYER)).transaction);

    expect(message.feePayer.address).toBe(PAYER);
    expect(Object.values(transaction.signatures).every((signature) => signature === null)).toBe(true);
    expect("blockhash" in message.lifetimeConstraint && message.lifetimeConstraint.blockhash).toBe(BLOCKHASH);

    const [createAta, transfer, memo] = message.instructions;
    expect(createAta.programAddress).toBe("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
    expect(transfer.programAddress).toBe("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
    const accounts = transfer.accounts!;
    expect(accounts[1].address).toBe(USDC_MINTS.devnet);
    // The payer is also the fee payer, so the compiled message makes it a writable signer.
    expect(accounts[3]).toMatchObject({ address: PAYER, role: AccountRole.WRITABLE_SIGNER });
    expect(accounts[4]).toMatchObject({ address: pay.reference, role: AccountRole.READONLY });
    expect(memo.programAddress).toBe("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
    expect(new TextDecoder().decode(memo.data)).toBe(pay.id);
  });

  it("skips creating the treasury token account when it exists", async () => {
    chain.treasuryAtaExists = true;
    const { message } = decode((await buildPaymentTransaction(order({}), PAYER)).transaction);
    expect([...message.instructions].map((instruction: Instruction) => instruction.programAddress)).toEqual([
      "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
    ]);
  });

  it("builds a SOL system transfer with the reference", async () => {
    const pay = order({ currency: "SOL", mint: null, amount: BigInt(33_267_000) });
    const { message } = decode((await buildPaymentTransaction(pay, PAYER)).transaction);
    const [transfer] = message.instructions;
    expect(transfer.programAddress).toBe("11111111111111111111111111111111");
    expect(transfer.accounts!.map((account) => account.address)).toEqual([PAYER, TREASURY, pay.reference]);
    expect(transfer.accounts![2].role).toBe(AccountRole.READONLY);
  });

  it("tells the payer when the wallet can't cover the order", async () => {
    chain.usdc = "1000000";
    await expect(buildPaymentTransaction(order({}), PAYER)).rejects.toMatchObject({ status: 400, code: "insufficient_funds" });
    chain.usdc = "100000000";
  });

  it("refuses an address that isn't a wallet", async () => {
    await expect(buildPaymentTransaction(order({}), "not-an-address")).rejects.toMatchObject({ status: 400 });
  });
});
