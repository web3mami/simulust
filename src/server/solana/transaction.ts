import "server-only";
import {
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createNoopSigner,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  isAddress,
  lamports,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Instruction,
} from "@solana/kit";
import { getAddMemoInstruction } from "@solana-program/memo";
import { getTransferSolInstruction } from "@solana-program/system";
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  getTransferCheckedInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import type { Order } from "@/server/db/schema";
import { env } from "@/server/env";
import { HttpError } from "@/server/http";
import { requireTreasury, rpc, solana, USDC_DECIMALS } from "@/server/solana/config";
import { formatUnits, productFor } from "@/server/solana/orders";

// Rough upper bound for the network fee when the wallet pays its own fee.
const FEE_HEADROOM_LAMPORTS = BigInt(50_000);

// Solana Pay transaction request, GET: what the wallet shows before it asks
// for the account. The icon must be an absolute URL to an SVG, PNG or WebP.
export function transactionRequestLabel() {
  return {
    label: "Simulust",
    icon: `${env.appUrl.replace(/\/$/, "")}/api/orders/solana-pay-icon.png`,
  };
}

// The reference rides along as a read-only, non-signer account on the transfer
// instruction, so getSignaturesForAddress(reference) finds the payment. The
// token and system programs ignore extra accounts.
function withReference<T extends Instruction>(instruction: T, reference: Address): T {
  return {
    ...instruction,
    accounts: [...(instruction.accounts ?? []), { address: reference, role: AccountRole.READONLY }],
  };
}

async function usdcBalance(tokenAccount: Address): Promise<bigint> {
  try {
    const { value } = await rpc().getTokenAccountBalance(tokenAccount, { commitment: "confirmed" }).send();
    return BigInt(value.amount);
  } catch {
    return BigInt(0);
  }
}

export type PaymentTransaction = { transaction: string; message: string };

// Builds the unsigned payment for `account` to sign. The fee payer is the payer;
// Privy's gas sponsorship swaps in its own fee payer for embedded wallets.
export async function buildPaymentTransaction(order: Order, account: string): Promise<PaymentTransaction> {
  if (!isAddress(account)) throw new HttpError(400, "That isn't a Solana wallet address.", "invalid_account");
  const treasury = requireTreasury();
  if (order.recipient !== treasury) {
    throw new HttpError(410, "This checkout was created for an old payment address. Start a new one.", "stale_order");
  }
  const payer = address(account);
  if (payer === treasury) throw new HttpError(400, "Pay from your own wallet, not the Simulust treasury.", "invalid_account");

  const signer = createNoopSigner(payer);
  const reference = address(order.reference);
  const instructions: Instruction[] = [];
  const due = formatUnits(order.amount, order.currency === "USDC" ? USDC_DECIMALS : 9);

  if (order.currency === "USDC") {
    const mint = solana.usdcMint;
    if (order.mint !== mint) throw new HttpError(410, "This checkout uses a different token. Start a new one.", "stale_order");
    const [[source], [destination]] = await Promise.all([
      findAssociatedTokenPda({ owner: payer, mint, tokenProgram: TOKEN_PROGRAM_ADDRESS }),
      findAssociatedTokenPda({ owner: treasury, mint, tokenProgram: TOKEN_PROGRAM_ADDRESS }),
    ]);
    const [held, treasuryAccount] = await Promise.all([
      usdcBalance(source),
      rpc().getAccountInfo(destination, { encoding: "base64", commitment: "confirmed" }).send(),
    ]);
    if (held < order.amount) {
      throw new HttpError(
        400,
        `This wallet has ${formatUnits(held, USDC_DECIMALS)} USDC and the order needs ${due}. Add USDC and try again.`,
        "insufficient_funds",
      );
    }
    if (!treasuryAccount.value) {
      instructions.push(
        getCreateAssociatedTokenIdempotentInstruction({ payer: signer, ata: destination, owner: treasury, mint }),
      );
    }
    instructions.push(
      withReference(
        getTransferCheckedInstruction({
          source,
          mint,
          destination,
          authority: signer,
          amount: order.amount,
          decimals: USDC_DECIMALS,
        }),
        reference,
      ),
    );
  } else {
    const { value: balance } = await rpc().getBalance(payer, { commitment: "confirmed" }).send();
    if (balance < order.amount + FEE_HEADROOM_LAMPORTS) {
      throw new HttpError(
        400,
        `This wallet has ${formatUnits(balance, 9)} SOL and the order needs ${due} plus a small network fee. Add SOL and try again.`,
        "insufficient_funds",
      );
    }
    instructions.push(
      withReference(getTransferSolInstruction({ source: signer, destination: treasury, amount: lamports(order.amount) }), reference),
    );
  }
  instructions.push(getAddMemoInstruction({ memo: order.id }));

  const { value: blockhash } = await rpc().getLatestBlockhash({ commitment: "confirmed" }).send();
  const message = pipe(
    // Legacy messages are the most widely supported by Solana Pay wallets.
    createTransactionMessage({ version: "legacy" }),
    (draft) => setTransactionMessageFeePayerSigner(signer, draft),
    (draft) => setTransactionMessageLifetimeUsingBlockhash(blockhash, draft),
    (draft) => appendTransactionMessageInstructions(instructions, draft),
  );
  const transaction = getBase64EncodedWireTransaction(compileTransaction(message));
  const product = productFor(order);
  return {
    transaction,
    message: `${product.name}: ${product.credits.toLocaleString("en-US")} credits for ${due} ${order.currency}`,
  };
}
