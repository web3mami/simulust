import { describe, expect, it } from "vitest";
import { validatePayment, type OrderTerms, type ParsedTransaction } from "@/server/solana/verify";

const USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const OTHER_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const TREASURY = "TreasuryWa11et1111111111111111111111111111";
const PAYER = "PayerWa11et11111111111111111111111111111111";
const PAYER_ATA = "PayerAta111111111111111111111111111111111111";
const TREASURY_ATA = "TreasuryAta1111111111111111111111111111111";
const REFERENCE = "Reference1111111111111111111111111111111111";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const SYSTEM_PROGRAM = "11111111111111111111111111111111";

const usdcOrder: OrderTerms = { currency: "USDC", amount: BigInt(4_990_000), recipient: TREASURY, reference: REFERENCE };
const solOrder: OrderTerms = { currency: "SOL", amount: BigInt(33_267_000), recipient: TREASURY, reference: REFERENCE };

function key(pubkey: string, signer = false, writable = false) {
  return { pubkey, signer, writable, source: "transaction" as const };
}

function usdcTransfer({
  sent = BigInt(4_990_000),
  mint = USDC,
  err = null as unknown,
  withReference = true,
  treasuryAtaExisted = true,
} = {}): ParsedTransaction {
  const accountKeys = [
    key(PAYER, true, true),
    key(PAYER_ATA, false, true),
    key(TREASURY_ATA, false, true),
    key(mint),
    ...(withReference ? [key(REFERENCE)] : []),
    key(TOKEN_PROGRAM),
  ];
  const balance = (accountIndex: number, owner: string, amount: bigint) => ({
    accountIndex,
    mint,
    owner,
    programId: TOKEN_PROGRAM,
    uiTokenAmount: { amount: amount.toString(), decimals: 6, uiAmount: null, uiAmountString: "" },
  });
  return {
    meta: {
      err,
      preBalances: [1_000_000, 2_039_280, 2_039_280, 1_461_600, 0, 1],
      postBalances: [995_000, 2_039_280, 2_039_280, 1_461_600, 0, 1],
      preTokenBalances: [
        balance(1, PAYER, BigInt(10_000_000)),
        ...(treasuryAtaExisted ? [balance(2, TREASURY, BigInt(7_000_000))] : []),
      ],
      postTokenBalances: [balance(1, PAYER, BigInt(10_000_000) - sent), balance(2, TREASURY, (treasuryAtaExisted ? BigInt(7_000_000) : BigInt(0)) + sent)],
    },
    transaction: { message: { accountKeys } },
  };
}

function solTransfer({ sent = 33_267_000, feePayer = PAYER } = {}): ParsedTransaction {
  const sponsored = feePayer !== PAYER;
  const accountKeys = [
    key(feePayer, true, true),
    ...(sponsored ? [key(PAYER, true, true)] : []),
    key(TREASURY, false, true),
    key(REFERENCE),
    key(SYSTEM_PROGRAM),
  ];
  const pre = sponsored ? [5_000_000, 100_000_000, 50_000_000, 0, 1] : [100_000_000, 50_000_000, 0, 1];
  const post = sponsored
    ? [4_995_000, 100_000_000 - sent, 50_000_000 + sent, 0, 1]
    : [100_000_000 - sent - 5_000, 50_000_000 + sent, 0, 1];
  return {
    meta: { err: null, preBalances: pre, postBalances: post, preTokenBalances: [], postTokenBalances: [] },
    transaction: { message: { accountKeys } },
  };
}

describe("validatePayment", () => {
  it("accepts a full USDC payment and names the sender", () => {
    const verdict = validatePayment(usdcTransfer(), usdcOrder, USDC);
    expect(verdict).toEqual({ ok: true, received: BigInt(4_990_000), payer: PAYER, payers: [PAYER] });
  });

  it("accepts a USDC payment that created the treasury token account", () => {
    const verdict = validatePayment(usdcTransfer({ treasuryAtaExisted: false }), usdcOrder, USDC);
    expect(verdict.ok).toBe(true);
    expect(verdict.received).toBe(BigInt(4_990_000));
  });

  it("accepts an overpayment", () => {
    expect(validatePayment(usdcTransfer({ sent: BigInt(5_000_000) }), usdcOrder, USDC).ok).toBe(true);
  });

  it("rejects a token that isn't canonical USDC", () => {
    const verdict = validatePayment(usdcTransfer({ mint: OTHER_MINT }), usdcOrder, USDC);
    expect(verdict).toMatchObject({ ok: false, reason: "wrong_asset" });
  });

  it("rejects an underpayment and reports what arrived", () => {
    const verdict = validatePayment(usdcTransfer({ sent: BigInt(4_000_000) }), usdcOrder, USDC);
    expect(verdict).toMatchObject({ ok: false, reason: "underpaid", received: BigInt(4_000_000), payer: PAYER });
  });

  it("rejects a transaction without the order's reference", () => {
    const verdict = validatePayment(usdcTransfer({ withReference: false }), usdcOrder, USDC);
    expect(verdict).toMatchObject({ ok: false, reason: "missing_reference" });
  });

  it("rejects a failed transaction even if balances look right", () => {
    const verdict = validatePayment(usdcTransfer({ err: { InstructionError: [1, "Custom"] } }), usdcOrder, USDC);
    expect(verdict).toMatchObject({ ok: false, reason: "failed" });
  });

  it("rejects a missing transaction", () => {
    expect(validatePayment(null, usdcOrder, USDC)).toMatchObject({ ok: false, reason: "not_found" });
  });

  it("does not count SOL sent to a USDC order", () => {
    expect(validatePayment(solTransfer(), usdcOrder, USDC)).toMatchObject({ ok: false, reason: "wrong_asset" });
  });

  it("accepts a full SOL payment by the treasury's lamport change", () => {
    const verdict = validatePayment(solTransfer(), solOrder, USDC);
    expect(verdict).toEqual({ ok: true, received: BigInt(33_267_000), payer: PAYER, payers: [PAYER] });
  });

  it("names the real sender when someone else paid the fee, and screens both", () => {
    const sponsor = "SponsorFeePayer11111111111111111111111111111";
    const verdict = validatePayment(solTransfer({ feePayer: sponsor }), solOrder, USDC);
    expect(verdict).toEqual({ ok: true, received: BigInt(33_267_000), payer: PAYER, payers: [sponsor, PAYER] });
  });

  it("screens a signer who paid us even when a bigger transfer in the same transaction went elsewhere", () => {
    const decoy = "DecoyWa11et11111111111111111111111111111111";
    const elsewhere = "E1sewhere1111111111111111111111111111111111";
    const tx: ParsedTransaction = {
      meta: {
        err: null,
        preBalances: [5_000_000_000, 5_000_000_000, 0, 0, 0, 1],
        postBalances: [5_000_000_000 - 33_267_000 - 10_000, 4_000_000_000, 33_267_000, 1_000_000_000, 0, 1],
        preTokenBalances: [],
        postTokenBalances: [],
      },
      transaction: {
        message: {
          accountKeys: [
            key(PAYER, true, true),
            key(decoy, true, true),
            key(TREASURY, false, true),
            key(elsewhere, false, true),
            key(REFERENCE),
            key(SYSTEM_PROGRAM),
          ],
        },
      },
    };
    const verdict = validatePayment(tx, solOrder, USDC);
    expect(verdict).toMatchObject({ ok: true, payer: decoy });
    expect(verdict.payers).toEqual([PAYER, decoy]);
  });

  it("screens every owner the USDC left, signer or not", () => {
    const tx = usdcTransfer();
    const delegateOwner = "De1egatedOwner111111111111111111111111111111";
    const balance = (accountIndex: number, owner: string, amount: string) => ({
      accountIndex,
      mint: USDC,
      owner,
      uiTokenAmount: { amount },
    });
    const withDelegate: ParsedTransaction = {
      ...tx,
      meta: {
        ...tx.meta!,
        preTokenBalances: [...tx.meta!.preTokenBalances!, balance(3, delegateOwner, "2000000")],
        postTokenBalances: [...tx.meta!.postTokenBalances!, balance(3, delegateOwner, "1000000")],
      },
    };
    expect(validatePayment(withDelegate, usdcOrder, USDC).payers).toEqual([PAYER, delegateOwner]);
  });

  it("rejects a short SOL payment", () => {
    const verdict = validatePayment(solTransfer({ sent: 33_000_000 }), solOrder, USDC);
    expect(verdict).toMatchObject({ ok: false, reason: "underpaid", received: BigInt(33_000_000) });
  });

  it("reads bigint balances from the RPC client", () => {
    const tx = solTransfer();
    const asBigints: ParsedTransaction = {
      ...tx,
      meta: { ...tx.meta!, preBalances: tx.meta!.preBalances.map(BigInt), postBalances: tx.meta!.postBalances.map(BigInt) },
    };
    expect(validatePayment(asBigints, solOrder, USDC).ok).toBe(true);
  });
});
