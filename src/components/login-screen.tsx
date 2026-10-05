"use client";

import { useState } from "react";
import { signInWithGoogle } from "@/lib/google";
import type { Session } from "@/lib/session";
import { signInWithWallet } from "@/lib/wallet";

export function LoginScreen({
  onSignedIn,
  embedded = false,
  intent = "login",
}: {
  onSignedIn: (session: Session) => void;
  embedded?: boolean;
  intent?: "login" | "signup";
}) {
  const [pending, setPending] = useState<"google" | "wallet" | null>(null);
  const [error, setError] = useState("");

  async function run(
    provider: "google" | "wallet",
    signIn: () => Promise<Session>,
  ) {
    setPending(provider);
    setError("");
    try {
      onSignedIn(await signIn());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Sign-in failed.");
    } finally {
      setPending(null);
    }
  }

  return (
    <main
      className={
        embedded
          ? "bg-[var(--bg)] text-[var(--ink)]"
          : "min-h-screen bg-[var(--bg)] text-[var(--ink)]"
      }
    >
      <div
        className={
          embedded
            ? "px-6 pb-8"
            : "mx-auto flex min-h-screen max-w-md flex-col justify-center px-6"
        }
      >
        <p className="text-xs uppercase text-[var(--accent-2)]">Simulust</p>
        <h1 className="mt-4 text-4xl font-semibold leading-tight">
          {intent === "signup" ? "Sign up" : "Log in"}
        </h1>
        <p className="mt-4 text-[var(--muted)]">
          Google or a wallet. This account is 18+ only.
        </p>
        <div className="mt-8 flex flex-col gap-3">
          <button
            type="button"
            disabled={pending !== null}
            className="rounded-full bg-white px-5 py-3 text-sm font-medium text-black disabled:opacity-60"
            onClick={() => run("google", signInWithGoogle)}
          >
            {pending === "google" ? "Opening Google…" : "Continue with Google"}
          </button>
          <button
            type="button"
            disabled={pending !== null}
            className="rounded-full bg-[var(--accent)] px-5 py-3 text-sm font-medium text-white disabled:opacity-60"
            onClick={() => run("wallet", signInWithWallet)}
          >
            {pending === "wallet" ? "Waiting for wallet…" : "Connect wallet"}
          </button>
        </div>
        <p className="mt-4 text-sm text-[var(--muted)]">
          Browser wallets and WalletConnect. Base is the chain we use for pay.
        </p>
        {error ? (
          <p className="mt-4 text-sm text-[var(--accent)]" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </main>
  );
}
