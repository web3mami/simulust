"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLogin } from "@privy-io/react-auth";
import { writeDevUser } from "@/lib/dev-user";
import { isPrivyConfigured } from "@/components/privy-app";
import { sessionFromPrivyUser, type Session } from "@/lib/session";

type Props = {
  onSignedIn?: (session: Session) => void;
  embedded?: boolean;
  intent?: "login" | "signup";
};

function Frame({ embedded, intent, children }: Props & { children: React.ReactNode }) {
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
        {children}
        <p className="mt-6 text-xs leading-5 text-[var(--muted)]">
          18+ only. By continuing you agree to the{" "}
          <a href="/terms" className="underline">Terms</a> and{" "}
          <a href="/privacy" className="underline">Privacy Policy</a>.
        </p>
      </div>
    </main>
  );
}

function PrivyLoginScreen({ onSignedIn, embedded = false, intent = "login" }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState<"email" | "google" | "twitter" | "wallet" | null>(null);
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

  function start(method: "email" | "google" | "twitter" | "wallet") {
    setPending(method);
    setError("");
    login({ loginMethods: [method] });
  }

  return (
    <Frame embedded={embedded} intent={intent}>
      <div className="mt-8 flex flex-col gap-3">
        <button
          type="button"
          disabled={pending !== null}
          className="rounded-full bg-white px-5 py-3 text-sm font-medium text-black disabled:opacity-60"
          onClick={() => start("google")}
        >
          {pending === "google" ? "Opening Google…" : "Continue with Google"}
        </button>
        <button
          type="button"
          disabled={pending !== null}
          className="rounded-full bg-black px-5 py-3 text-sm font-medium text-white ring-1 ring-white/20 disabled:opacity-60"
          onClick={() => start("twitter")}
        >
          {pending === "twitter" ? "Opening X…" : "Continue with X"}
        </button>
        <button
          type="button"
          disabled={pending !== null}
          className="rounded-full border border-white/20 px-5 py-3 text-sm font-medium text-[var(--ink)] disabled:opacity-60"
          onClick={() => start("email")}
        >
          {pending === "email" ? "Opening email…" : "Continue with email"}
        </button>
        <button
          type="button"
          disabled={pending !== null}
          className="rounded-full bg-[var(--accent)] px-5 py-3 text-sm font-medium text-white disabled:opacity-60"
          onClick={() => start("wallet")}
        >
          {pending === "wallet" ? "Waiting for wallet…" : "Connect Solana wallet"}
        </button>
      </div>
      {error ? (
        <p className="mt-4 text-sm text-[var(--accent)]" role="alert">
          {error}
        </p>
      ) : null}
    </Frame>
  );
}

// Without NEXT_PUBLIC_PRIVY_APP_ID (local development only), sign in with any
// handle. "admin" gets the admin console.
function DevLoginScreen({ onSignedIn, embedded = false, intent = "login" }: Props) {
  const router = useRouter();
  const [handle, setHandle] = useState("tester");

  return (
    <Frame embedded={embedded} intent={intent}>
      <form
        className="mt-8 flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          const clean = handle.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 32);
          if (!clean) return;
          writeDevUser(clean);
          window.dispatchEvent(new Event("simulust-dev-login"));
          onSignedIn?.({ provider: "email", display: clean, detail: `dev:${clean}` });
          router.replace("/profile");
        }}
      >
        <p className="text-sm leading-6 text-[var(--muted)]">
          Dev login. Privy isn&apos;t configured, so pick any handle. Use &quot;admin&quot; for the admin console.
        </p>
        <input
          value={handle}
          onChange={(event) => setHandle(event.target.value)}
          className="rounded-full border border-[var(--line)] bg-[var(--bg)] px-4 py-3"
          aria-label="Dev handle"
        />
        <button type="submit" className="rounded-full bg-[var(--gold)] px-5 py-3 text-sm font-medium !text-[#12110F]">
          Continue
        </button>
      </form>
    </Frame>
  );
}

export const LoginScreen = isPrivyConfigured() ? PrivyLoginScreen : DevLoginScreen;
