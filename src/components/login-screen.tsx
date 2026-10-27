"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLogin } from "@privy-io/react-auth";
import { writeDevUser } from "@/lib/dev-user";
import { isPrivyConfigured } from "@/components/privy-app";
import { sessionFromPrivyUser, type Session } from "@/lib/session";
import { GoogleGlyph, MailIcon, WalletIcon, XGlyph } from "@/components/account/account-icons";
import { buttonClass, cx, inputClass } from "@/components/ui";

type Props = {
  onSignedIn?: (session: Session) => void;
  embedded?: boolean;
  intent?: "login" | "signup";
};

// The picture beside the form (above it on phones).
const PANEL_IMAGE = "/hero/hero-pair-girls.jpg";

const legalLink = "!text-[var(--ink)] underline underline-offset-2";

// Picture on the left, form on the right, in the modal or as a full page.
function Frame({ embedded, intent, children }: Props & { children: React.ReactNode }) {
  const signup = intent === "signup";
  const card = (
    <div
      className={cx(
        "grid text-[var(--ink)] md:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]",
        embedded
          ? "bg-[var(--bg-2)]"
          : "w-full max-w-[880px] overflow-hidden rounded-3xl border border-[var(--line)] bg-[var(--bg-2)] shadow-[0_30px_80px_rgba(0,0,0,0.6)]",
      )}
    >
      <div className="relative h-36 overflow-hidden sm:h-44 md:h-auto md:min-h-[580px]">
        <img
          src={PANEL_IMAGE}
          alt=""
          className="absolute inset-0 h-full w-full object-cover object-[50%_40%] md:object-center"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[var(--bg-2)] via-black/20 to-black/10 md:from-black/90 md:via-black/25 md:to-black/0" />
        <div className="absolute inset-x-0 bottom-0 hidden p-8 md:block">
          <p className="text-[28px] font-bold leading-tight tracking-tight text-white">
            Meet an AI that <span className="text-[var(--accent)]">actually</span> remembers you.
          </p>
          <p className="mt-2 text-sm leading-6 text-white/75">
            Every character is a fictional adult and every image is AI-generated.
          </p>
        </div>
      </div>
      <div className="flex flex-col justify-center px-6 pb-8 pt-2 sm:px-10 md:py-12">
        <p className="text-xl font-extrabold tracking-tight">
          simu<span className="text-[var(--accent)]">lust</span>
        </p>
        <h1 id="login-title" className="mt-4 text-3xl font-bold leading-tight tracking-tight">
          {signup ? "Sign up" : "Log in"}
        </h1>
        <p className="mt-1.5 text-sm leading-6 text-[var(--muted)]">
          {signup ? "Create your free account and start chatting." : "Welcome back. Pick up where you left off."}
        </p>
        {children}
        <p className="mt-5 text-center text-xs leading-5 text-[var(--muted)]">
          {signup
            ? "Already have an account? The same options log you in."
            : "New here? The same options create your free account."}
        </p>
        <p className="mt-4 border-t border-[var(--line)] pt-4 text-xs leading-5 text-[var(--muted)]">
          18+ only. By continuing you agree to the{" "}
          <a href="/terms" className={legalLink}>Terms</a> and{" "}
          <a href="/privacy" className={legalLink}>Privacy Policy</a>.
        </p>
      </div>
    </div>
  );
  if (embedded) return card;
  return <main className="flex min-h-screen items-center justify-center bg-[var(--bg)] px-4 py-10">{card}</main>;
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
      <div className="mt-7 flex flex-col gap-3">
        <button
          type="button"
          disabled={pending !== null}
          className={buttonClass("primary", "lg", "w-full")}
          onClick={() => start("email")}
        >
          <MailIcon />
          {pending === "email" ? "Opening email…" : "Continue with email"}
        </button>
        <div className="flex items-center gap-3 py-1 text-xs text-[var(--muted)]" aria-hidden>
          <span className="h-px flex-1 bg-[var(--line)]" />
          or
          <span className="h-px flex-1 bg-[var(--line)]" />
        </div>
        <button
          type="button"
          disabled={pending !== null}
          className={buttonClass("secondary", "lg", "w-full")}
          onClick={() => start("google")}
        >
          <GoogleGlyph />
          {pending === "google" ? "Opening Google…" : "Continue with Google"}
        </button>
        <button
          type="button"
          disabled={pending !== null}
          className={buttonClass("secondary", "lg", "w-full")}
          onClick={() => start("twitter")}
        >
          <XGlyph />
          {pending === "twitter" ? "Opening X…" : "Continue with X"}
        </button>
        <button
          type="button"
          disabled={pending !== null}
          className={buttonClass("secondary", "lg", "w-full")}
          onClick={() => start("wallet")}
        >
          <WalletIcon />
          {pending === "wallet" ? "Waiting for wallet…" : "Connect Solana wallet"}
        </button>
      </div>
      {error ? (
        <p className="mt-4 rounded-xl border border-red-500/35 bg-red-500/10 px-4 py-3 text-sm text-red-200" role="alert">
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
        className="mt-7 flex flex-col gap-3"
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
        <p className="rounded-xl border border-dashed border-[var(--line)] px-4 py-3 text-xs leading-5 text-[var(--muted)]">
          Dev login. Privy isn&apos;t configured, so pick any handle. Use &quot;admin&quot; for the admin console.
        </p>
        <input
          value={handle}
          onChange={(event) => setHandle(event.target.value)}
          className={cx(inputClass, "h-12 text-base")}
          aria-label="Dev handle"
        />
        <button type="submit" className={buttonClass("primary", "lg", "w-full")}>
          Continue
        </button>
      </form>
    </Frame>
  );
}

export const LoginScreen = isPrivyConfigured() ? PrivyLoginScreen : DevLoginScreen;
