"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { useSession } from "@/components/auth-gate";
import {
  ACCOUNT_PAGE,
  AccountNav,
  AgeStatusBadge,
  Notice,
  SectionCard,
  SignInPrompt,
  SkeletonCard,
} from "@/components/account/account-ui";
import { CheckIcon, EyeOffIcon, IdCardIcon } from "@/components/account/account-icons";
import { Button, PageHeader, Panel, SectionTitle, buttonClass, cx } from "@/components/ui";
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

  // How far along the three steps below this account is.
  const stepsDone = me?.ageStatus === "approved" ? 3 : me?.ageStatus === "pending" ? 2 : 0;

  let card: ReactNode;
  if (suspended) {
    card = (
      <Panel className="p-5 sm:p-6">
        <p className="text-sm leading-6 text-[var(--muted)]">This account is suspended, so it can&apos;t start an age check.</p>
      </Panel>
    );
  } else if (!ready || !features || (session && !me)) {
    card = <SkeletonCard lines={3} label="Loading…" />;
  } else if (!me) {
    card = (
      <SignInPrompt
        title="Sign in to verify your age."
        body="It's a one-time check, and it unlocks explicit chat, photos, voice notes and video."
        onLogin={openLogin}
        onSignup={openSignup}
      />
    );
  } else {
    card = (
      <Panel className="overflow-hidden">
        <div className="flex items-start gap-4 p-5 sm:p-6">
          <span
            aria-hidden
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]"
          >
            <IdCardIcon className="h-6 w-6" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <h2 className="text-lg font-bold tracking-tight text-[var(--ink)]">One-time ID check</h2>
              <p>
                <span className="sr-only">Your status: </span>
                <AgeStatusBadge status={me.ageStatus} label={status?.label} />
              </p>
            </div>
            <p className="mt-2 max-w-xl text-sm leading-6 text-[var(--muted)]">
              {returned && me.ageStatus === "pending"
                ? "Thanks. Your check is submitted and we're waiting for the result. You can leave this page; we'll update your account when it's in."
                : status?.detail}
            </p>
          </div>
        </div>

        <div className="border-t border-[var(--line)] bg-[var(--bg-2)]/60 p-5 sm:p-6">
          {me.ageStatus === "approved" ? (
            <Link href="/settings" className={buttonClass("primary", "lg")}>
              Go to settings
            </Link>
          ) : mode === "veriff" ? (
            <Button size="lg" disabled={busy} onClick={start}>
              {busy
                ? "Opening Veriff…"
                : me.ageStatus === "pending"
                  ? "Start a new check"
                  : me.ageStatus === "declined"
                    ? "Try again"
                    : "Start verification"}
            </Button>
          ) : mode === "dev" ? (
            <div className="rounded-2xl border border-dashed border-[var(--line)] bg-[var(--bg)]/40 p-4">
              <p className="text-sm font-semibold text-[var(--ink)]">Development mode: Veriff isn&apos;t configured.</p>
              <div className="mt-3 flex flex-wrap gap-3">
                <Button disabled={busy} onClick={() => devOutcome("approved")}>
                  Approve (dev)
                </Button>
                <Button variant="secondary" disabled={busy} onClick={() => devOutcome("declined")}>
                  Decline (dev)
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-[var(--muted)]">Age verification isn&apos;t available right now. Check back soon.</p>
          )}
          {mode === "dev" && me.ageStatus === "approved" ? (
            <button
              type="button"
              disabled={busy}
              className="mt-3 block min-h-10 text-xs text-[var(--muted)] underline underline-offset-2 hover:text-[var(--ink)]"
              onClick={() => devOutcome("declined")}
            >
              Reset to declined (dev)
            </button>
          ) : null}
          {error ? (
            <Notice role="alert" className="mt-4">
              {error}
            </Notice>
          ) : null}
        </div>
      </Panel>
    );
  }

  return (
    <AppShell>
      <div className={ACCOUNT_PAGE}>
        <PageHeader
          accent="Verify"
          title="your age"
          subtitle="The law in many places now requires a real age check, not just a click, before a site can show explicit content. So before we unlock explicit chat, photos, voice notes and video, we ask for a one-time check."
        />
        <AccountNav className="mt-5" />
        <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 space-y-8">
            {card}
            <section>
              <SectionTitle accent="How">it works</SectionTitle>
              <ol className="mt-4 grid gap-3 sm:grid-cols-3">
                {STEPS.map((step, index) => {
                  const done = index < stepsDone;
                  return (
                    <li
                      key={step}
                      className={cx(
                        "flex items-start gap-3 rounded-2xl border p-4 sm:block sm:p-5",
                        done ? "border-emerald-400/30 bg-emerald-400/[0.04]" : "border-[var(--line)] bg-[var(--surface)]",
                      )}
                    >
                      <span
                        aria-hidden
                        className={cx(
                          "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold",
                          done ? "bg-emerald-400/15 text-emerald-300" : "bg-[var(--accent-soft)] text-[var(--accent)]",
                        )}
                      >
                        {done ? <CheckIcon className="h-4 w-4" /> : index + 1}
                      </span>
                      <p className="mt-0 pt-1.5 text-sm leading-6 text-[var(--ink)] sm:mt-3 sm:pt-0">{step}</p>
                      {done ? <span className="sr-only">(done)</span> : null}
                    </li>
                  );
                })}
              </ol>
            </section>
          </div>
          <SectionCard title="What we keep" icon={<EyeOffIcon />}>
            <p className="text-sm leading-6 text-[var(--muted)]">
              Only the result: passed or not, and when. We never store your ID, your selfie, your name or your date of
              birth. Veriff handles those under its own privacy policy and retention rules. See our{" "}
              <Link href="/privacy" className="!text-[var(--accent)] underline underline-offset-2">
                privacy policy
              </Link>{" "}
              for details.
            </p>
          </SectionCard>
        </div>
      </div>
    </AppShell>
  );
}

const STEPS = [
  "We send you to Veriff, an identity verification company.",
  "You take a photo of a government ID and a short selfie video. It takes about two minutes.",
  "Veriff tells us whether you passed, and you come back here.",
];
