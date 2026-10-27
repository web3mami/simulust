import "server-only";
import { address, createSolanaRpc, isAddress, type Address } from "@solana/kit";
import { env, features, isProduction } from "@/server/env";
import { HttpError } from "@/server/http";

// Circle's canonical USDC mints, both classic SPL Token with 6 decimals.
// https://developers.circle.com/stablecoins/usdc-contract-addresses (checked 2026-10-26)
export const USDC_MINTS = {
  mainnet: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  devnet: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
} as const;

export const USDC_DECIMALS = 6;
export const SOL_DECIMALS = 9;
export const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";

const PUBLIC_RPC = {
  mainnet: "https://api.mainnet-beta.solana.com",
  devnet: "https://api.devnet.solana.com",
} as const;

// How long a checkout holds its price. Fifteen minutes covers a wallet round
// trip without leaving a SOL quote open long enough to drift far.
export const ORDER_TTL_MS = 15 * 60_000;

// Payments seen this soon after expiry still count: the user signed in time and
// the network was slow.
export const ORDER_GRACE_MS = 2 * 60_000;

// A payment whose block lands up to this long after the checkout closed is
// still credited at the held price. Later ones are kept for a refund by hand:
// an old SOL quote must not stay payable while the price moves.
export const LATE_PAYMENT_MS = 60 * 60_000;

// Stored as the recipient on orders created in development without a treasury,
// so simulated checkouts work. Never a valid address, so nothing can be paid to it.
export const DEV_RECIPIENT = "dev-unconfigured";

function read(name: string) {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
}

export const solana = {
  cluster: env.solanaCluster,
  rpcUrl: env.solanaRpcUrl ?? PUBLIC_RPC[env.solanaCluster],
  usdcMint: address(USDC_MINTS[env.solanaCluster]),
  // Not in env.ts yet (see the payments report): price feed keys.
  jupiterApiKey: read("JUPITER_API_KEY"),
  pythApiKey: read("PYTH_API_KEY"),
};

let cachedTreasury: Address | null | undefined;

export function treasury(): Address | null {
  if (cachedTreasury !== undefined) return cachedTreasury;
  const raw = env.treasuryAddress;
  if (!raw) return (cachedTreasury = null);
  if (!isAddress(raw)) throw new Error("TREASURY_ADDRESS is not a valid Solana address.");
  return (cachedTreasury = address(raw));
}

export function requireTreasury(): Address {
  const value = features.payments ? treasury() : null;
  if (!value) throw new HttpError(503, "Payments aren't configured yet.", "payments_unconfigured");
  return value;
}

// Development without a treasury still creates orders so the checkout can be
// simulated end to end. Production never gets here (it refuses to boot).
export function orderRecipient(): string {
  const value = features.payments ? treasury() : null;
  if (value) return value;
  if (isProduction) throw new HttpError(503, "Payments aren't configured yet.", "payments_unconfigured");
  return DEV_RECIPIENT;
}

let client: ReturnType<typeof createSolanaRpc> | undefined;

export function rpc() {
  client ??= createSolanaRpc(solana.rpcUrl);
  return client;
}
