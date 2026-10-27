"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { CloseIcon, HeartIcon, LockIcon } from "@/components/icons";
import { LoginScreen } from "@/components/login-screen";
import { isPrivyConfigured } from "@/components/privy-app";
import { sessionFromPrivyUser, type Session } from "@/lib/session";
import type { Features, Me, MeResponse } from "@/lib/api-types";
import { readDevUser, writeDevUser } from "@/lib/dev-user";
import { buttonClass } from "@/components/ui";

type AuthIntent = "login" | "signup";

export type AuthValue = {
  ready: boolean;
  session: Session | null;
  me: Me | null;
  features: Features | null;
  // The account is banned (or locked for an age review): the server answers
  // 403 to everything.
  suspended: boolean;
  refreshMe: () => Promise<void>;
  getToken: () => Promise<string | null>;
  signOut: () => void;
  openLogin: () => void;
  openSignup: () => void;
};

const SessionContext = createContext<AuthValue | null>(null);

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) {
    throw new Error("useSession must be used inside AuthProvider");
  }
  return value;
}

// Loads /api/me whenever the signed-in identity changes.
function useMe(identity: string | null, getToken: () => Promise<string | null>) {
  const [me, setMe] = useState<Me | null>(null);
  const [features, setFeatures] = useState<Features | null>(null);
  const [suspended, setSuspended] = useState<Suspension>(false);

  const refreshMe = useCallback(async () => {
    const token = await getToken();
    const response = await fetch("/api/me", {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      cache: "no-store",
    }).catch(() => null);
    if (response?.status === 403) {
      const body = (await response.json().catch(() => null)) as { code?: string } | null;
      setSuspended(body?.code === "age_locked" ? "age_locked" : "policy");
      setMe(null);
      return;
    }
    if (!response?.ok) return;
    const body = (await response.json()) as MeResponse;
    setSuspended(false);
    setMe(body.me);
    setFeatures(body.features);
  }, [getToken]);

  useEffect(() => {
    // Fetch on mount and whenever the signed-in identity changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshMe();
  }, [identity, refreshMe]);

  return { me: identity ? me : null, features, suspension: identity ? suspended : false, refreshMe };
}

type Suspension = false | "policy" | "age_locked";

function SuspendedNotice({ reason, onSignOut }: { reason: Exclude<Suspension, false>; onSignOut: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-black/80 backdrop-blur-sm"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="suspended-title"
    >
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="w-full max-w-md rounded-3xl border border-[var(--line)] bg-[var(--bg-2)] p-6 text-[var(--ink)] shadow-[0_30px_80px_rgba(0,0,0,0.6)] sm:p-8">
          <span aria-hidden className="flex h-12 w-12 items-center justify-center rounded-full bg-red-500/15 text-red-300">
            <LockIcon className="h-6 w-6" />
          </span>
          <h2 id="suspended-title" className="mt-4 text-2xl font-bold tracking-tight">
            {reason === "age_locked" ? "This account is locked" : "This account is suspended"}
          </h2>
          <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
            {reason === "age_locked"
              ? "An age check showed a birth date under 18, so the account is locked while we review it. If that's wrong, contact support and we'll look again. Support can also send you a copy of your data or delete it."
              : "It broke the content policy. To appeal, or to get a copy of your data or have it deleted, contact support and include your account email or wallet address."}
          </p>
          {/* A locked account can't reach the chat, where crisis resources usually show. */}
          <div className="mt-5 flex gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
            <HeartIcon className="mt-0.5 h-5 w-5 text-[var(--accent)]" />
            <p className="text-sm leading-6 text-[var(--muted)]">
              If you&apos;re having thoughts of hurting yourself: in the US and Canada call or text{" "}
              <a href="tel:988" className="font-semibold !text-[var(--ink)] underline underline-offset-2">988</a>; in the UK
              and Ireland call Samaritans on{" "}
              <a href="tel:116123" className="font-semibold !text-[var(--ink)] underline underline-offset-2">116 123</a>;
              anywhere else,{" "}
              <a
                href="https://findahelpline.com"
                target="_blank"
                rel="noreferrer"
                className="font-semibold !text-[var(--ink)] underline underline-offset-2"
              >
                findahelpline.com
              </a>
              .
            </p>
          </div>
          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row">
            <a href="/content-policy" className={buttonClass("secondary", "lg", "flex-1 !text-[var(--ink)]")}>
              Content policy
            </a>
            <button type="button" onClick={onSignOut} className={buttonClass("primary", "lg", "flex-1")}>
              Sign out
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Image on the left and the sign-in options on the right (LoginScreen draws
// both); this is the overlay and the close button.
function LoginModal({
  open,
  intent,
  onClose,
}: {
  open: boolean;
  intent: AuthIntent;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-black/75 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="login-title"
    >
      <div className="flex min-h-full items-center justify-center p-3 sm:p-6">
        <div className="relative w-full max-w-[880px] overflow-hidden rounded-3xl border border-[var(--line)] bg-[var(--bg-2)] shadow-[0_30px_80px_rgba(0,0,0,0.6)]">
          <button
            type="button"
            aria-label="Close"
            className="absolute right-3 top-3 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur transition-colors hover:bg-black/70"
            onClick={onClose}
          >
            <CloseIcon />
          </button>
          <LoginScreen embedded intent={intent} onSignedIn={onClose} />
        </div>
      </div>
    </div>
  );
}

function PrivyAuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { ready, authenticated, user, logout, getAccessToken } = usePrivy();
  const [loginOpen, setLoginOpen] = useState(false);
  const [authIntent, setAuthIntent] = useState<AuthIntent>("login");
  const named = useRef<string | null>(null);

  const session = ready && authenticated && user ? sessionFromPrivyUser(user) : null;
  const getToken = useCallback(async () => (authenticated ? getAccessToken() : null), [authenticated, getAccessToken]);
  const { me, features, suspension, refreshMe } = useMe(session ? user!.id : null, getToken);

  useEffect(() => {
    if (!ready || !session) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoginOpen(false);
    if (new URLSearchParams(window.location.search).has("privy_oauth_code")) router.replace("/profile");
  }, [ready, session, router]);

  // Give new accounts a display name from their login, once.
  useEffect(() => {
    if (!me || !session || me.displayName !== "You" || named.current === me.id) return;
    named.current = me.id;
    void (async () => {
      const token = await getToken();
      await fetch("/api/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ displayName: session.display.slice(0, 40) }),
      });
      await refreshMe();
    })();
  }, [me, session, getToken, refreshMe]);

  function signOut() {
    void logout();
  }

  return (
    <SessionContext.Provider
      value={{
        ready,
        session,
        me,
        features,
        suspended: Boolean(suspension),
        refreshMe,
        getToken,
        signOut,
        openLogin: () => {
          setAuthIntent("login");
          setLoginOpen(true);
        },
        openSignup: () => {
          setAuthIntent("signup");
          setLoginOpen(true);
        },
      }}
    >
      {children}
      <LoginModal open={loginOpen} intent={authIntent} onClose={() => setLoginOpen(false)} />
      {suspension ? <SuspendedNotice reason={suspension} onSignOut={signOut} /> : null}
    </SessionContext.Provider>
  );
}

// Local development without a Privy app id: sign in with any handle. The server
// only honours this when NODE_ENV isn't production.
function DevAuthProvider({ children }: { children: React.ReactNode }) {
  const [handle, setHandle] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [authIntent, setAuthIntent] = useState<AuthIntent>("login");

  useEffect(() => {
    // Read the dev cookie once on mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHandle(readDevUser());
    setReady(true);
    function onChange() {
      setHandle(readDevUser());
      setLoginOpen(false);
    }
    window.addEventListener("simulust-dev-login", onChange);
    return () => window.removeEventListener("simulust-dev-login", onChange);
  }, []);

  const getToken = useCallback(async () => null, []);
  const { me, features, suspension, refreshMe } = useMe(handle, getToken);
  const session: Session | null = handle ? { provider: "email", display: handle, detail: `dev:${handle}` } : null;

  function devSignOut() {
    writeDevUser(null);
    setHandle(null);
  }

  return (
    <SessionContext.Provider
      value={{
        ready,
        session,
        me,
        features,
        suspended: Boolean(suspension),
        refreshMe,
        getToken,
        signOut: devSignOut,
        openLogin: () => {
          setAuthIntent("login");
          setLoginOpen(true);
        },
        openSignup: () => {
          setAuthIntent("signup");
          setLoginOpen(true);
        },
      }}
    >
      {children}
      <LoginModal open={loginOpen} intent={authIntent} onClose={() => setLoginOpen(false)} />
      {suspension ? <SuspendedNotice reason={suspension} onSignOut={devSignOut} /> : null}
    </SessionContext.Provider>
  );
}

export const AuthProvider = isPrivyConfigured() ? PrivyAuthProvider : DevAuthProvider;
