"use client";

import Image, { getImageProps } from "next/image";
import { useState } from "react";
import { preload } from "react-dom";
import { useRouter } from "next/navigation";
import { useLogin } from "@privy-io/react-auth";
import { useLane } from "@/components/app-shell";
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

// The picture beside the form (above it on phones), matched to the lane the
// visitor is browsing.
function panelArt(lane?: string) {
  return `/hero/hero-pair-${lane === "anime" || lane === "guys" ? lane : "girls"}.jpg`;
}

const PANEL_SIZES = "(min-width: 768px) 430px, 100vw";

// Called when someone hovers or focuses Log in / Join, so the art is already
// downloaded when the modal opens.
export function preloadLoginArt(lane?: string) {
  const { props } = getImageProps({ src: panelArt(lane), alt: "", fill: true, sizes: PANEL_SIZES });
  preload(props.src, { as: "image", imageSrcSet: props.srcSet, imageSizes: props.sizes, fetchPriority: "high" });
}

const legalLink = "!text-[var(--ink)] underline underline-offset-2";

// Picture on the left, form on the right, in the modal or as a full page.
function Frame({ embedded, intent, children }: Props & { children: React.ReactNode }) {
  const { lane } = useLane();
  // Both options sign in or create an account, so the switch only changes the wording.
  const [mode, setMode] = useState<"login" | "signup">(intent ?? "login");
  const signup = mode === "signup";
  const card = (
    <div
      className={cx(
        "grid text-[var(--ink)] md:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]",
        embedded
          ? "bg-[var(--bg-2)]"
          : "w-full max-w-[880px] overflow-hidden rounded-3xl border border-[var(--line)] bg-[var(--bg-2)] shadow-[0_30px_80px_rgba(0,0,0,0.6)]",
      )}
    >
      <div className="relative h-52 overflow-hidden bg-[var(--surface)] sm:h-60 md:h-auto md:min-h-[600px]">
        <Image
          src={panelArt(lane)}
          alt=""
          fill
          sizes={PANEL_SIZES}
          loading="eager"
          fetchPriority="high"
          className="object-cover object-[50%_18%] md:object-center"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[var(--bg-2)] via-black/30 to-black/5 md:from-black/90 md:via-black/25 md:to-black/0" />
        <div className="absolute inset-x-0 bottom-0 p-5 md:p-8">
          <p className="text-xl font-bold leading-tight tracking-tight text-white md:text-[28px]">
            Meet an AI that <span className="text-[var(--accent)]">actually</span> remembers you.
          </p>
          <p className="mt-1.5 text-xs leading-5 text-white/75 md:mt-2 md:text-sm md:leading-6">
            Every character is a fictional adult and every image is AI-generated.
          </p>
        </div>
      </div>
      <div className="flex flex-col justify-center px-5 pb-7 pt-3 sm:px-10 md:py-12">
        <p className="hidden text-xl font-extrabold tracking-tight md:block">
          simu<span className="text-[var(--accent)]">lust</span>
        </p>
        <div
          role="group"
          aria-label="Sign up or log in"
          className="grid grid-cols-2 gap-1 rounded-full border border-[var(--line)] bg-[var(--surface)] p-1 md:mt-5"
        >
          {(["signup", "login"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={mode === option}
              onClick={() => setMode(option)}
              className={cx(
                "h-9 rounded-full text-sm font-semibold transition-[background-color,color] duration-150",
                mode === option ? "bg-[var(--accent)] text-[var(--accent-ink)]" : "text-[var(--muted)] hover:text-[var(--ink)]",
              )}
            >
              {option === "signup" ? "Sign up" : "Log in"}
            </button>
          ))}
        </div>
        <h1 id="login-title" className="mt-5 text-2xl font-bold leading-tight tracking-tight md:text-3xl">
          {signup ? "Join Simulust" : "Welcome back"}
        </h1>
        <p className="mt-1.5 text-sm leading-6 text-[var(--muted)]">
          {signup ? "Create your free account and start chatting." : "Pick up where you left off."}
        </p>
        {children}
        <p className="mt-4 text-center text-xs leading-5 text-[var(--muted)]">
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
      <div className="mt-6 flex flex-col gap-3">
        <button
          type="button"
          // The modal opens with focus on its first action.
          data-autofocus
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
        className="mt-6 flex flex-col gap-3"
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
          // The modal opens with focus on its first field.
          data-autofocus
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
        <button type="submit" className={buttonClass("primary", "lg", "w-full")}>
          Continue
        </button>
      </form>
    </Frame>
  );
}

export const LoginScreen = isPrivyConfigured() ? PrivyLoginScreen : DevLoginScreen;
