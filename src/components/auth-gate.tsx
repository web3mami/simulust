"use client";

import { createContext, useCallback, useContext, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AGE_REFUSED_EVENT, isOpenPath } from "@/components/age-gate";
import { CloseIcon, HeartIcon, LockIcon } from "@/components/icons";
import { LoginScreen } from "@/components/login-screen";
import { isPrivyConfigured } from "@/components/privy-app";
import { WalletSync } from "@/components/wallet-sync";
import { sessionFromMe, type Session } from "@/lib/session";
import type { Features, Me, MeResponse } from "@/lib/api-types";
import { writeDevUser } from "@/lib/dev-user";
import { buttonClass } from "@/components/ui";

type AuthIntent = "login" | "signup";

export type AuthValue = {
  // The first /api/me has answered: until then nobody knows who this is.
  ready: boolean;
  session: Session | null;
  me: Me | null;
  features: Features | null;
  // The account is banned (or locked for an age review): the server answers
  // 403 to everything.
  suspended: boolean;
  refreshMe: () => Promise<void>;
  // The session is an httpOnly cookie that same-origin requests carry on their
  // own, so there's no token to attach. Kept for callers that still ask.
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

type Suspension = false | "policy" | "age_locked";

const noToken = async () => null;

// What every modal here does while open: the page behind stops scrolling,
// focus moves in (to the control marked data-autofocus, else the panel) and Tab stays
// inside, Escape closes it if it can be closed, and focus goes back to
// whatever opened it.
function useModal(open: boolean, onClose?: () => void) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useEffectEvent(() => onClose?.());
  const closable = Boolean(onClose);

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = document.documentElement;
    const overflow = root.style.overflow;
    root.style.overflow = "hidden";
    const start = panel.current?.querySelector<HTMLElement>("[data-autofocus]") ?? panel.current;
    start?.focus({ preventScroll: true });

    function onKey(event: KeyboardEvent) {
      const box = panel.current;
      if (!box) return;
      // Keys inside another layer on top (Privy's wallet window) are its business.
      const inside = box.contains(event.target as Node) || event.target === document.body;
      if (event.key === "Escape" && closable && inside) {
        event.preventDefault();
        close();
      } else if (event.key === "Tab" && inside) {
        const focusable = Array.from(
          box.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), textarea, select:not([disabled]), [tabindex]:not([tabindex="-1"])'),
        );
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === box)) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      root.style.overflow = overflow;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [open, closable]);

  return panel;
}

function SuspendedNotice({ reason, onSignOut }: { reason: Exclude<Suspension, false>; onSignOut: () => void }) {
  // No way to dismiss it: only focus and scroll are handled.
  const panel = useModal(true);
  return (
    <div
      className="animate-fade-in fixed inset-0 z-50 overflow-y-auto bg-black/80 backdrop-blur-sm"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="suspended-title"
    >
      <div className="flex min-h-full items-center justify-center p-4">
        <div
          ref={panel}
          tabIndex={-1}
          className="animate-modal-in w-full max-w-md rounded-3xl border border-[var(--line)] bg-[var(--bg-2)] p-6 text-[var(--ink)] shadow-[0_30px_80px_rgba(0,0,0,0.6)] outline-none sm:p-8"
        >
          <span aria-hidden className="flex h-12 w-12 items-center justify-center rounded-full bg-red-500/15 text-red-300">
            <LockIcon className="h-6 w-6" />
          </span>
          <h2 id="suspended-title" className="mt-4 text-2xl font-bold tracking-tight">
            {reason === "age_locked" ? "This account is locked" : "This account is suspended"}
          </h2>
          <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
            {reason === "age_locked"
              ? "An age check showed a birth date under 18, so the account is locked while we review it. If that's wrong, contact support and we'll look again. Support can also send you a copy of your data or delete it."
              : "It broke the content policy. To appeal, or to get a copy of your data or have it deleted, contact support and include your username."}
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
              Log out
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function LogoutNotice({ busy, onRetry, onClose }: { busy: boolean; onRetry: () => void; onClose: () => void }) {
  const panel = useModal(true, onClose);
  return (
    <div
      className="fixed inset-0 z-[60] overflow-y-auto bg-black/75 backdrop-blur-sm"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="logout-error-title"
      aria-describedby="logout-error-description"
    >
      <div className="flex min-h-full items-center justify-center p-4">
        <div ref={panel} tabIndex={-1} className="w-full max-w-md rounded-3xl border border-[var(--line)] bg-[var(--bg-2)] p-6 text-[var(--ink)] outline-none">
          <h2 id="logout-error-title" className="text-xl font-bold">Couldn&apos;t log out</h2>
          <p id="logout-error-description" className="mt-3 text-sm leading-6 text-[var(--muted)]">
            We couldn&apos;t confirm that your session ended. Check your connection and try again.
          </p>
          <div className="mt-6 flex gap-3">
            <button type="button" onClick={onClose} className={buttonClass("secondary", "md", "flex-1")}>
              Close
            </button>
            <button type="button" data-autofocus disabled={busy} onClick={onRetry} className={buttonClass("primary", "md", "flex-1")}>
              {busy ? "Logging out…" : "Try again"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Image on the left and the form on the right (LoginScreen draws both); this
// is the overlay and the close button. Mounted only while open, so every
// opening starts fresh.
function LoginModal({
  intent,
  onClose,
  onAccount,
}: {
  intent: AuthIntent;
  onClose: () => void;
  onAccount: (me: Me) => void;
}) {
  // While a new recovery code is on screen the modal can't be dismissed by
  // accident (Escape, a tap outside): it's shown once.
  const [locked, setLocked] = useState(false);
  const lockedRef = useRef(false);
  const lock = useCallback((value: boolean) => {
    lockedRef.current = value;
    setLocked(value);
  }, []);
  const dismiss = useCallback(() => {
    if (!lockedRef.current) onClose();
  }, [onClose]);
  const panel = useModal(true, dismiss);

  return (
    <div
      className="animate-fade-in fixed inset-0 z-50 overflow-y-auto overscroll-contain bg-black/75 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="login-title"
    >
      {/* A press on the dimmed area around the panel closes it. */}
      <div
        className="flex min-h-full items-center justify-center p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))] sm:p-6"
        onMouseDown={(event) => event.target === event.currentTarget && dismiss()}
      >
        <div
          ref={panel}
          tabIndex={-1}
          className="animate-modal-in relative w-full max-w-[880px] overflow-hidden rounded-3xl border border-[var(--line)] bg-[var(--bg-2)] shadow-[0_30px_80px_rgba(0,0,0,0.6)] outline-none"
        >
          {locked ? null : (
            <button
              type="button"
              aria-label="Close"
              className="absolute right-3 top-3 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur transition-[background-color,transform] hover:bg-black/70 active:scale-95 motion-reduce:active:scale-100"
              onClick={onClose}
            >
              <CloseIcon />
            </button>
          )}
          <LoginScreen embedded intent={intent} onAccount={onAccount} onLock={lock} onSignedIn={onClose} />
        </div>
      </div>
    </div>
  );
}

// One provider for every environment. The session is an httpOnly cookie set
// by /api/auth/*, so /api/me alone says who's signed in.
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [features, setFeatures] = useState<Features | null>(null);
  const [suspension, setSuspension] = useState<Suspension>(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [authIntent, setAuthIntent] = useState<AuthIntent>("login");
  const [logoutError, setLogoutError] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const logoutPending = useRef(false);
  // Bumped by every sign-in, sign-out and request: an answer is applied only
  // if nothing newer happened, so a slow /api/me from before signing out can't
  // sign the browser back in.
  const generation = useRef(0);

  const refreshMe = useCallback(async () => {
    const asked = ++generation.current;
    const response = await fetch("/api/me", { cache: "no-store" }).catch(() => null);
    const body = response ? ((await response.json().catch(() => null)) as (MeResponse & { code?: string }) | null) : null;
    if (asked !== generation.current) return;
    if (response?.status === 403) {
      setSuspension(body?.code === "age_locked" ? "age_locked" : "policy");
      setMe(null);
    } else if (response?.ok && body) {
      setSuspension(false);
      setMe(body.me);
      setFeatures(body.features);
    }
    // Offline or a server error: keep what's known, and stop waiting.
    setReady(true);
  }, []);

  useEffect(() => {
    // Ask once on mount; state is set when the answer arrives.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshMe();
  }, [refreshMe]);

  // Log in, sign up and password recovery answer with the account: use it
  // straight away (the cookie is already set).
  const acceptAccount = useCallback(
    (next: Me) => {
      generation.current += 1;
      setSuspension(false);
      setMe(next);
      setReady(true);
      if (!features) void refreshMe();
      router.refresh();
    },
    [features, refreshMe, router],
  );

  const signOut = useCallback(() => {
    if (logoutPending.current) return;
    logoutPending.current = true;
    setSigningOut(true);
    generation.current += 1;
    void fetch("/api/auth/logout", { method: "POST" })
      .then((response) => {
        if (!response.ok) throw new Error("Logout failed");
        // A dev handle cookie from local development would sign straight back in.
        writeDevUser(null);
        generation.current += 1;
        setMe(null);
        setSuspension(false);
        setLogoutError(false);
        router.refresh();
      })
      .catch(() => setLogoutError(true))
      .finally(() => {
        logoutPending.current = false;
        setSigningOut(false);
      });
  }, [router]);
  const closeLogoutError = useCallback(() => setLogoutError(false), []);

  const openLogin = useCallback(() => {
    setAuthIntent("login");
    setLoginOpen(true);
  }, []);
  const openSignup = useCallback(() => {
    setAuthIntent("signup");
    setLoginOpen(true);
  }, []);
  const closeLogin = useCallback(() => setLoginOpen(false), []);

  // Someone who gives an under-18 date while signing up is turned away by the
  // age gate, which covers every page except the legal ones. There the modal
  // stays and shows the refusal itself.
  useEffect(() => {
    function onRefused() {
      if (!isOpenPath(window.location.pathname)) setLoginOpen(false);
    }
    window.addEventListener(AGE_REFUSED_EVENT, onRefused);
    return () => window.removeEventListener(AGE_REFUSED_EVENT, onRefused);
  }, []);

  // Stable while the same account is in, so pages keyed on it don't refetch
  // when only the balance changes.
  const id = me?.id ?? null;
  const displayName = me?.displayName ?? "";
  const username = me?.username ?? null;
  const session = useMemo(
    () => (id ? sessionFromMe({ id, displayName, username }) : null),
    [id, displayName, username],
  );

  const value = useMemo<AuthValue>(
    () => ({
      ready,
      session,
      me,
      features,
      suspended: Boolean(suspension),
      refreshMe,
      getToken: noToken,
      signOut,
      openLogin,
      openSignup,
    }),
    [ready, session, me, features, suspension, refreshMe, signOut, openLogin, openSignup],
  );

  return (
    <SessionContext.Provider value={value}>
      {children}
      {/* Keyed by account: Privy re-syncs only when signed-in flips, so a
          straight switch from one account to another remounts it to sync
          afresh. Not mounted until /api/me answers, so loading doesn't
          count as a switch. */}
      {isPrivyConfigured() && ready ? <WalletSync key={me?.id ?? "signed-out"} /> : null}
      {loginOpen ? <LoginModal intent={authIntent} onClose={closeLogin} onAccount={acceptAccount} /> : null}
      {suspension && !logoutError ? <SuspendedNotice reason={suspension} onSignOut={signOut} /> : null}
      {logoutError ? <LogoutNotice busy={signingOut} onRetry={signOut} onClose={closeLogoutError} /> : null}
    </SessionContext.Provider>
  );
}
