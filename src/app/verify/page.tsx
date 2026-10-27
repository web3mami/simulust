"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppHeader, AppShell } from "@/components/app-shell";
import { useSession } from "@/components/auth-gate";
import { useApi } from "@/lib/api";
import type { AgeStatus, Me } from "@/lib/api-types";

const STATUS: Record<AgeStatus, { label: string; detail: string }> = {
  none: {
    label: "Not verified",
    detail: "You can chat without verifying. Explicit messages, photos, voice notes and video stay locked until you do.",
  },
  pending: {
    label: "Checking",
    detail: "We're waiting for the result. It usually takes a minute or two, sometimes longer if a person needs to review it.",
  },
  approved: {
    label: "Verified",
    detail: "You're verified. Turn on explicit content in Settings whenever you want it.",
  },
  declined: {
    label: "Not approved",
    detail:
      "Your last check didn't go through. That's usually a blurry photo, glare, or an expired document. You can try again.",
  },
};

export default function VerifyPage() {
  const { ready, session, me, features, suspended, refreshMe, openLogin, openSignup } = useSession();
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [returned, setReturned] = useState(false);

  useEffect(() => {
    // Veriff sends people back here with ?from=veriff when they finish.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReturned(new URLSearchParams(window.location.search).get("from") === "veriff");
  }, []);

  // The decision arrives by webhook, so poll while it's pending.
  const pending = me?.ageStatus === "pending";
  useEffect(() => {
    if (!pending) return;
    let tries = 0;
    const timer = window.setInterval(() => {
      tries += 1;
      void refreshMe();
      if (tries >= 60) window.clearInterval(timer);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [pending, refreshMe]);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const { url } = await api<{ url: string }>("/api/age/start", { method: "POST" });
      window.location.assign(url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "We couldn't start verification. Try again.");
      setBusy(false);
    }
  }

  async function devOutcome(outcome: "approved" | "declined") {
    setBusy(true);
    setError(null);
    try {
      await api<{ me: Me }>("/api/age/dev", { method: "POST", json: { outcome } });
      await refreshMe();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const mode = features?.ageVerification ?? null;
  const status = me ? STATUS[me.ageStatus] : null;

  return (
    <AppShell>
      <AppHeader />
      <section className="mx-auto w-full max-w-xl px-4 py-10">
        <h1 className="font-[family-name:var(--font-display)] text-4xl text-[var(--ink)]">Verify your age</h1>
        <p className="mt-4 leading-7 text-[var(--muted)]">
          The law in many places now requires a real age check, not just a click, before a site can show explicit
          content. So before we unlock explicit chat, photos, voice notes and video, we ask for a one-time check.
        </p>

        <div className="mt-8 rounded-3xl border border-[var(--line)] bg-[var(--bg-2)] p-6">
          {suspended ? (
            <p className="text-sm text-[var(--muted)]">This account is suspended, so it can&apos;t start an age check.</p>
          ) : !ready || !features || (session && !me) ? (
            <p className="text-sm text-[var(--muted)]">Loading…</p>
          ) : !me ? (
            <div>
              <p className="text-[var(--ink)]">Sign in to verify your age.</p>
              <div className="mt-5 flex flex-wrap gap-3">
                <button
                  type="button"
                  className="rounded-full border border-white/20 px-5 py-2.5 text-sm text-[var(--ink)]"
                  onClick={openLogin}
                >
                  Login
                </button>
                <button
                  type="button"
                  className="rounded-full bg-[var(--gold)] px-5 py-2.5 text-sm font-medium !text-[#12110F]"
                  onClick={openSignup}
                >
                  Sign up
                </button>
              </div>
            </div>
          ) : (
            <div>
              <p className="text-xs uppercase tracking-wide text-[var(--muted)]">Your status</p>
              <p className="mt-2 flex items-center gap-2 text-xl text-[var(--ink)]">
                <span
                  aria-hidden
                  className={`h-2.5 w-2.5 rounded-full ${
                    me.ageStatus === "approved"
                      ? "bg-emerald-400"
                      : me.ageStatus === "declined"
                        ? "bg-red-400"
                        : me.ageStatus === "pending"
                          ? "animate-pulse bg-[var(--gold)]"
                          : "bg-white/30"
                  }`}
                />
                {status?.label}
              </p>
              <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                {returned && me.ageStatus === "pending"
                  ? "Thanks. Your check is submitted and we're waiting for the result. You can leave this page; we'll update your account when it's in."
                  : status?.detail}
              </p>

              {me.ageStatus === "approved" ? (
                <Link
                  href="/settings"
                  className="mt-5 inline-block rounded-full bg-[var(--gold)] px-6 py-3 text-sm font-medium !text-[#12110F]"
                >
                  Go to settings
                </Link>
              ) : mode === "veriff" ? (
                <button
                  type="button"
                  disabled={busy}
                  className="mt-5 rounded-full bg-[var(--gold)] px-6 py-3 text-sm font-medium !text-[#12110F] disabled:opacity-60"
                  onClick={start}
                >
                  {busy
                    ? "Opening Veriff…"
                    : me.ageStatus === "pending"
                      ? "Start a new check"
                      : me.ageStatus === "declined"
                        ? "Try again"
                        : "Start verification"}
                </button>
              ) : mode === "dev" ? (
                <div className="mt-5 rounded-2xl border border-dashed border-[var(--gold)]/50 p-4">
                  <p className="text-sm text-[var(--gold)]">Development mode: Veriff isn&apos;t configured.</p>
                  <div className="mt-3 flex flex-wrap gap-3">
                    <button
                      type="button"
                      disabled={busy}
                      className="rounded-full bg-[var(--gold)] px-5 py-2.5 text-sm font-medium !text-[#12110F] disabled:opacity-60"
                      onClick={() => devOutcome("approved")}
                    >
                      Approve (dev)
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      className="rounded-full border border-white/20 px-5 py-2.5 text-sm text-[var(--ink)] disabled:opacity-60"
                      onClick={() => devOutcome("declined")}
                    >
                      Decline (dev)
                    </button>
                  </div>
                </div>
              ) : (
                <p className="mt-5 text-sm text-[var(--muted)]">
                  Age verification isn&apos;t available right now. Check back soon.
                </p>
              )}
              {mode === "dev" && me.ageStatus === "approved" ? (
                <button
                  type="button"
                  disabled={busy}
                  className="mt-3 block text-xs text-[var(--muted)] underline underline-offset-2"
                  onClick={() => devOutcome("declined")}
                >
                  Reset to declined (dev)
                </button>
              ) : null}
              {error ? <p className="mt-4 text-sm text-red-300">{error}</p> : null}
            </div>
          )}
        </div>

        <h2 className="mt-10 font-[family-name:var(--font-display)] text-2xl text-[var(--ink)]">How it works</h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5 leading-7 text-[var(--muted)]">
          <li>We send you to Veriff, an identity verification company.</li>
          <li>You take a photo of a government ID and a short selfie video. It takes about two minutes.</li>
          <li>Veriff tells us whether you passed, and you come back here.</li>
        </ol>

        <h2 className="mt-10 font-[family-name:var(--font-display)] text-2xl text-[var(--ink)]">What we keep</h2>
        <p className="mt-3 leading-7 text-[var(--muted)]">
          Only the result: passed or not, and when. We never store your ID, your selfie, your name or your date of
          birth. Veriff handles those under its own privacy policy and retention rules. See our{" "}
          <Link href="/privacy" className="text-[var(--gold)] underline underline-offset-2">
            privacy policy
          </Link>{" "}
          for details.
        </p>
      </section>
    </AppShell>
  );
}
