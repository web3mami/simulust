"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLogin } from "@privy-io/react-auth";
import { sessionFromPrivyUser, type Session } from "@/lib/session";

export function LoginScreen({
  onSignedIn,
  embedded = false,
  intent = "login",
}: {
  onSignedIn?: (session: Session) => void;
  embedded?: boolean;
  intent?: "login" | "signup";
}) {
  const router = useRouter();
  const [pending, setPending] = useState<"google" | "twitter" | "wallet" | null>(null);
  const [error, setError] = useState("");

  const { login } = useLogin({
    onComplete: ({ user }) => {
      onSignedIn?.(sessionFromPrivyUser(user));
      setPending(null);
      router.replace("/profile");
    },
    onError: (code) => {
      setError(String(code || "Sign-in failed."));
      setPending(null);
    },
  });

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
        <h1 className="text-4xl font-semibold leading-tight">
          {intent === "signup" ? "Sign up" : "Log in"}
        </h1>
        <div className="mt-8 flex flex-col gap-3">
          <button
            type="button"
            disabled={pending !== null}
            className="rounded-full bg-white px-5 py-3 text-sm font-medium text-black disabled:opacity-60"
            onClick={() => {
              setPending("google");
              setError("");
              login({ loginMethods: ["google"] });
            }}
          >
            {pending === "google" ? "Opening Google…" : "Continue with Google"}
          </button>
          <button
            type="button"
            disabled={pending !== null}
            className="rounded-full bg-black px-5 py-3 text-sm font-medium text-white ring-1 ring-white/20 disabled:opacity-60"
            onClick={() => {
              setPending("twitter");
              setError("");
              login({ loginMethods: ["twitter"] });
            }}
          >
            {pending === "twitter" ? "Opening X…" : "Continue with X"}
          </button>
          <button
            type="button"
            disabled={pending !== null}
            className="rounded-full bg-[var(--accent)] px-5 py-3 text-sm font-medium text-white disabled:opacity-60"
            onClick={() => {
              setPending("wallet");
              setError("");
              login({ loginMethods: ["wallet"] });
            }}
          >
            {pending === "wallet" ? "Waiting for wallet…" : "Connect wallet"}
          </button>
        </div>
        {error ? (
          <p className="mt-4 text-sm text-[var(--accent)]" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </main>
  );
}
