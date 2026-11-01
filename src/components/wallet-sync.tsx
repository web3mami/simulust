"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { usePrivy, useSubscribeToJwtAuthWithFlag, type User } from "@privy-io/react-auth";
import { useCreateWallet } from "@privy-io/react-auth/solana";
import { useSession } from "@/components/auth-gate";
import { walletOf } from "@/lib/session";

// Every account gets a Solana wallet, made by Privy. Privy has no username and
// password login, so it uses JWT-based auth instead: our server signs a short
// token for the signed-in account (GET /api/auth/wallet-token) and Privy trusts
// it. This component keeps Privy signed in as whoever our session says, creates
// the embedded wallet the first time (createOnLogin doesn't fire for JWT auth),
// and tells the server its address. Privy's own login is never used.

export type WalletStatus = {
  // none: signed out, or Privy isn't configured. setting-up: Privy is syncing
  // or creating the wallet. unavailable: it failed; pay another way.
  state: "none" | "setting-up" | "ready" | "unavailable";
  address: string | null;
  // The account it's for, so nothing uses one account's wallet for another.
  userId: string | null;
};

const NONE: WalletStatus = { state: "none", address: null, userId: null };

// A tiny store, so the checkout can show "Setting up your wallet" without
// living inside this component.
let current: WalletStatus = NONE;
const listeners = new Set<() => void>();

function publish(next: WalletStatus) {
  if (next.state === current.state && next.address === current.address && next.userId === current.userId) return;
  current = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useWalletStatus() {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => NONE,
  );
}

// Privy calls this whenever it re-syncs. It must never throw: a throw signs
// Privy out. No token (signed out, or the server has no Privy key) is undefined.
export async function walletToken(): Promise<string | undefined> {
  try {
    const response = await fetch("/api/auth/wallet-token", { cache: "no-store" });
    if (!response.ok) return undefined;
    const body = (await response.json().catch(() => null)) as { token?: unknown } | null;
    return typeof body?.token === "string" && body.token ? body.token : undefined;
  } catch {
    return undefined;
  }
}

// The account id our token gave Privy (the JWT's sub).
export function customUserId(user: Pick<User, "linkedAccounts">) {
  for (const account of user.linkedAccounts) {
    if (account.type === "custom_auth") return account.customUserId;
  }
  return null;
}

export function embeddedSolanaAddress(user: Pick<User, "linkedAccounts">) {
  for (const account of user.linkedAccounts) {
    if (
      account.type === "wallet" &&
      account.chainType === "solana" &&
      (account.walletClientType === "privy" || account.walletClientType === "privy-v2")
    ) {
      return account.address;
    }
  }
  return null;
}

// What the checkout and account pages see, from where the sync has got to.
export function walletStatusFor({
  userId,
  address,
  sync,
  failed,
}: {
  userId: string | null;
  // The embedded wallet of Privy's user, once that user is this account.
  address: string | null;
  // Privy's JWT sync state.
  sync: string;
  // Making the wallet failed for this account.
  failed: boolean;
}): WalletStatus {
  if (!userId) return NONE;
  if (address) return { state: "ready", address, userId };
  if (sync === "not-enabled" || sync === "error" || failed) return { state: "unavailable", address: null, userId };
  return { state: "setting-up", address: null, userId };
}

// The live status as far as this account may see it: all of it while it's for
// the account signed in now, otherwise none. Right after a switch, the store
// can still hold the previous account's wallet (or its "setting up"), and the
// account pages must never show that one as this account's.
export function walletStatusOf(status: WalletStatus, userId: string | null | undefined): WalletStatus {
  return userId && status.userId === userId ? status : NONE;
}

// The wallet a checkout may pay from: the embedded wallet synced for the
// account signed in now, and only once it's ready. Right after a switch from
// one account to another, Privy can still hold the previous account's wallet;
// that one must never pay for this account's order.
export function payingWallet<W extends { address: string; standardWallet: { features: object } }>(
  wallets: readonly W[],
  status: WalletStatus,
  userId: string | null,
): W | undefined {
  if (status.state !== "ready" || !status.address || !userId || status.userId !== userId) return undefined;
  return wallets.find((wallet) => wallet.address === status.address && "privy:" in wallet.standardWallet.features);
}

// Rendered by AuthProvider once it knows who's signed in, only when Privy is
// configured (its hooks need PrivyProvider above them), and kept mounted for
// the whole visit, signed in or not. AuthProvider keys it by account: Privy
// only re-syncs when signed-in flips, so going straight from one account to
// another remounts it, and a fresh mount syncs afresh.
export function WalletSync() {
  const { ready, me, refreshMe } = useSession();
  const privy = usePrivy();
  const { createWallet } = useCreateWallet();
  // Which account a wallet was asked for, and which address was last sent to
  // the server: each happens once, even when effects run twice.
  const creating = useRef<string | null>(null);
  const saved = useRef<string | null>(null);
  const [failedFor, setFailedFor] = useState<string | null>(null);

  const { state } = useSubscribeToJwtAuthWithFlag({
    isAuthenticated: Boolean(me),
    isLoading: !ready,
    // Module-level, so it's the same function on every render.
    getExternalJwt: walletToken,
  });

  // Privy's user, but only once it's the same account as our session: a stale
  // Privy session from someone else never gets a wallet made or saved.
  const privyUser = privy.ready && privy.authenticated ? privy.user : null;
  const mine = privyUser && me && customUserId(privyUser) === me.id ? privyUser : null;
  const address = mine ? embeddedSolanaAddress(mine) : null;
  const userId = me?.id ?? null;

  useEffect(() => {
    if (!userId || !mine || address || creating.current === userId) return;
    creating.current = userId;
    createWallet().catch((error: unknown) => {
      console.warn("Couldn't create the embedded Solana wallet", error);
      setFailedFor(userId);
    });
  }, [userId, mine, address, createWallet]);

  // Tell the server, so payments and the account page know the address.
  const known = walletOf(me);
  useEffect(() => {
    if (!userId || !address || known === address) return;
    const key = `${userId}:${address}`;
    if (saved.current === key) return;
    saved.current = key;
    fetch("/api/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ walletAddress: address }),
    })
      .then((response) => {
        if (response.ok) void refreshMe();
        else saved.current = null;
      })
      .catch(() => {
        saved.current = null;
      });
  }, [userId, address, known, refreshMe]);

  useEffect(() => {
    publish(walletStatusFor({ userId, address, sync: state.status, failed: failedFor === userId }));
  }, [userId, address, state.status, failedFor]);

  // Nothing from this account outlives it: the next account's mount starts
  // from none, not from this wallet.
  useEffect(() => () => publish(NONE), []);

  return null;
}
