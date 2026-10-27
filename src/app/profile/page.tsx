"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AVATAR_FILL } from "@/components/account-menu";
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
  fieldHint,
  fieldLabel,
} from "@/components/account/account-ui";
import { PencilIcon } from "@/components/account/account-icons";
import { ChevronRightIcon, CoinIcon, SignOutIcon, UserIcon } from "@/components/icons";
import { PremiumIcon } from "@/components/premium-icon";
import { Button, Chip, PageHeader, Panel, buttonClass, cx, inputClass } from "@/components/ui";
import { ApiError, useApi } from "@/lib/api";
import type { Me } from "@/lib/api-types";
import type { Session } from "@/lib/session";

type ProfileGender = "Woman" | "Man" | "Non-binary";
type ProfileLane = "Girls" | "Anime" | "Guys";

// What GET/PUT /api/me/profile return.
type Profile = {
  name: string;
  gender: ProfileGender;
  looking: ProfileLane[];
  bio: string;
  updatedAt: string;
};

const GENDERS: ProfileGender[] = ["Woman", "Man", "Non-binary"];
const LANES: ProfileLane[] = ["Girls", "Anime", "Guys"];
const NAME_MAX = 40;
const BIO_MAX = 500;

const PROVIDER_LABEL = {
  google: "Google",
  twitter: "X",
  email: "Email",
  wallet: "Wallet",
} as const;

type Form = Omit<Profile, "updatedAt">;

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; profile: Profile | null };

function initialOf(name: string) {
  return name.trim().charAt(0).toUpperCase() || "U";
}

function formFrom(profile: Profile | null, fallbackName: string): Form {
  return {
    name: profile?.name || fallbackName.slice(0, NAME_MAX),
    gender: profile?.gender || "Woman",
    looking: profile?.looking?.length ? profile.looking : ["Girls"],
    bio: profile?.bio || "",
  };
}

function messageOf(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback;
}

export default function ProfilePage() {
  const { ready, session, me, refreshMe, signOut, openLogin, openSignup } = useSession();
  const api = useApi();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Form>(() => formFrom(null, ""));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Once the person types a name, nothing replaces it.
  const nameTouched = useRef(false);

  const identity = session?.detail ?? null;
  const fallbackName = me && me.displayName !== "You" ? me.displayName : (session?.display ?? "");

  useEffect(() => {
    if (!identity) return;
    let cancelled = false;
    // Reset before each load so a previous account's profile never shows.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoad({ state: "loading" });
    api<{ profile: Profile | null }>("/api/me/profile")
      .then(({ profile }) => {
        if (cancelled) return;
        setLoad({ state: "ready", profile });
        setEditing(!profile);
        setSaveError(null);
        setForm(formFrom(profile, fallbackName));
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoad({ state: "error", message: messageOf(error, "We couldn't load your profile. Check your connection and try again.") });
      });
    return () => {
      cancelled = true;
    };
    // fallbackName only seeds a new form; reloading when it changes would wipe edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity, api, attempt]);

  // A new profile starts from the account's display name, which can arrive after
  // the profile request (the login handle stands in until then).
  useEffect(() => {
    if (load.state !== "ready" || load.profile || nameTouched.current) return;
    setForm((current) => ({ ...current, name: fallbackName.slice(0, NAME_MAX) }));
  }, [fallbackName, load]);

  const saved = load.state === "ready" ? load.profile : null;

  const toggleLane = useCallback((lane: ProfileLane) => {
    setForm((current) => {
      const on = current.looking.includes(lane);
      const looking = on ? current.looking.filter((item) => item !== lane) : [...current.looking, lane];
      return { ...current, looking: looking.length ? looking : [lane] };
    });
  }, []);

  async function submit() {
    const name = form.name.trim();
    if (!name || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const { profile } = await api<{ profile: Profile }>("/api/me/profile", {
        method: "PUT",
        json: { name, gender: form.gender, looking: form.looking, bio: form.bio.trim() },
      });
      setLoad({ state: "ready", profile });
      setForm(formFrom(profile, name));
      setEditing(false);
      void refreshMe();
    } catch (error) {
      setSaveError(messageOf(error, "Your profile didn't save. Check your connection and try again."));
    } finally {
      setSaving(false);
    }
  }

  function cancelEdit() {
    setForm(formFrom(saved, fallbackName));
    setSaveError(null);
    setEditing(false);
  }

  let content: ReactNode;
  if (!ready) {
    content = <ProfileSkeleton />;
  } else if (!session) {
    content = (
      <SignInPrompt
        title="Sign in to set up your profile."
        body="Characters remember the name you set here."
        onLogin={openLogin}
        onSignup={openSignup}
      />
    );
  } else if (load.state === "loading") {
    content = <ProfileSkeleton />;
  } else if (load.state === "error") {
    content = (
      <Panel className="flex flex-col items-start gap-4 p-6" role="alert">
        <p className="text-sm leading-6 text-[var(--muted)]">{load.message}</p>
        <Button size="lg" onClick={() => setAttempt((value) => value + 1)}>
          Try again
        </Button>
      </Panel>
    );
  } else {
    content = (
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        {editing ? (
          <form
            className="space-y-6 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 sm:p-6"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <div>
              <h2 className="text-lg font-bold tracking-tight text-[var(--ink)]">
                {saved ? "Edit profile" : "Set up your profile"}
              </h2>
              <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
                This is you. Characters will remember the name you set here.
              </p>
            </div>
            <div className="flex items-center gap-4 sm:gap-5">
              <Avatar initial={initialOf(form.name || session.display)} size="md" />
              <label className="block min-w-0 flex-1">
                <span className={fieldLabel}>Name</span>
                <input
                  value={form.name}
                  maxLength={NAME_MAX}
                  onChange={(event) => {
                    nameTouched.current = true;
                    setForm((current) => ({ ...current, name: event.target.value }));
                  }}
                  className={cx(inputClass, "mt-2 h-11")}
                  autoComplete="nickname"
                  enterKeyHint="next"
                  required
                />
                <span className={fieldHint}>We don&apos;t take photo uploads, so your initial stands in for a picture.</span>
              </label>
            </div>
            <fieldset>
              <legend className={fieldLabel}>I am</legend>
              <div className="no-scrollbar -mx-1 mt-2 flex gap-2 overflow-x-auto px-1">
                {GENDERS.map((gender) => (
                  <Chip
                    key={gender}
                    active={form.gender === gender}
                    onClick={() => setForm((current) => ({ ...current, gender }))}
                  >
                    {gender}
                  </Chip>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className={fieldLabel}>Into</legend>
              <div className="no-scrollbar -mx-1 mt-2 flex gap-2 overflow-x-auto px-1">
                {LANES.map((lane) => (
                  <Chip
                    key={lane}
                    active={form.looking.includes(lane)}
                    onClick={() => toggleLane(lane)}
                  >
                    {lane}
                  </Chip>
                ))}
              </div>
              <span className={fieldHint}>Pick one or more.</span>
            </fieldset>
            <label className="block">
              <span className={cx(fieldLabel, "flex items-baseline justify-between")}>
                About you
                <span className="text-xs font-normal text-[var(--muted)]">
                  {form.bio.length}/{BIO_MAX}
                </span>
              </span>
              <textarea
                value={form.bio}
                maxLength={BIO_MAX}
                onChange={(event) => setForm((current) => ({ ...current, bio: event.target.value }))}
                rows={4}
                className={cx(inputClass, "mt-2 resize-none py-3 leading-6")}
                placeholder="What should they know about you?"
              />
            </label>
            {saveError ? (
              <Notice role="alert">{saveError}</Notice>
            ) : null}
            <div className="flex flex-col-reverse gap-3 border-t border-[var(--line)] pt-5 sm:flex-row sm:justify-end">
              {saved ? (
                <Button variant="ghost" size="lg" disabled={saving} onClick={cancelEdit}>
                  Cancel
                </Button>
              ) : null}
              <button type="submit" disabled={saving || !form.name.trim()} className={buttonClass("primary", "lg", "w-full sm:w-auto")}>
                {saving ? "Saving…" : "Save profile"}
              </button>
            </div>
          </form>
        ) : saved ? (
          <Panel className="overflow-hidden">
            <div
              aria-hidden
              className="h-28 bg-[radial-gradient(120%_140%_at_0%_0%,rgba(255,79,139,0.55),transparent_60%),radial-gradient(90%_120%_at_100%_0%,rgba(255,122,166,0.25),transparent_65%)] sm:h-32"
            />
            <div className="px-5 pb-6 sm:px-6">
              <div className="-mt-12 flex flex-wrap items-end justify-between gap-4">
                <Avatar initial={initialOf(saved.name)} size="lg" />
                <Button onClick={() => setEditing(true)}>
                  <PencilIcon className="h-4 w-4" />
                  Edit profile
                </Button>
              </div>
              <p className="mt-4 break-words text-2xl font-bold tracking-tight text-[var(--ink)] sm:text-3xl">
                {saved.name}
              </p>
              <dl className="mt-5 grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl bg-[var(--surface-2)] px-4 py-3">
                  <dt className="text-xs text-[var(--muted)]">I am</dt>
                  <dd className="mt-0.5 font-semibold text-[var(--ink)]">{saved.gender}</dd>
                </div>
                <div className="rounded-xl bg-[var(--surface-2)] px-4 py-3">
                  <dt className="text-xs text-[var(--muted)]">Into</dt>
                  <dd className="mt-0.5 font-semibold text-[var(--ink)]">{saved.looking.join(", ")}</dd>
                </div>
              </dl>
              <h3 className="mt-6 text-sm font-semibold text-[var(--ink)]">About you</h3>
              {saved.bio ? (
                <p className="mt-2 whitespace-pre-line break-words text-[15px] leading-7 text-[var(--muted)]">{saved.bio}</p>
              ) : (
                <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                  Nothing here yet. Edit your profile to tell characters a little about you.
                </p>
              )}
            </div>
          </Panel>
        ) : null}
        <AccountCard session={session} me={me} onSignOut={signOut} />
      </div>
    );
  }

  return (
    <AppShell>
      <div className={ACCOUNT_PAGE}>
        <PageHeader accent="My" title="Profile" subtitle="How characters see you, and the account behind it." />
        <AccountNav className="mt-5" />
        <div className="mt-6">{content}</div>
      </div>
    </AppShell>
  );
}

// The same filled avatar as the top bar, so it reads as the same person.
function Avatar({ initial, size }: { initial: string; size: "md" | "lg" }) {
  return (
    <div
      aria-hidden
      className={cx(
        "flex shrink-0 items-center justify-center rounded-full",
        AVATAR_FILL,
        size === "lg" ? "h-24 w-24 text-4xl outline outline-4 outline-[var(--surface)]" : "h-16 w-16 text-2xl sm:h-20 sm:w-20 sm:text-3xl",
      )}
    >
      {initial}
    </div>
  );
}

// Sign-in method, credits, plan and age check, with links to change each.
function AccountCard({ session, me, onSignOut }: { session: Session; me: Me | null; onSignOut: () => void }) {
  return (
    <SectionCard title="Account" icon={<UserIcon />}>
      <dl className="divide-y divide-[var(--line)] border-y border-[var(--line)]">
        <AccountRow label="Signed in with">
          <span className="font-semibold text-[var(--ink)]">{PROVIDER_LABEL[session.provider]}</span>
          <span className="block break-all text-xs text-[var(--muted)]">{session.detail}</span>
        </AccountRow>
        {me ? (
          <>
            <AccountRow label="Credits" href="/premium" linkLabel="Buy credits" premium>
              <span className="inline-flex items-center gap-1.5 font-semibold text-[var(--ink)]">
                <CoinIcon className="h-4 w-4 text-[var(--premium)]" />
                {me.balance.toLocaleString()}
              </span>
            </AccountRow>
            <AccountRow label="Plan" href="/premium" linkLabel={me.isMember ? "Manage" : "Go Premium"} premium>
              {me.isMember ? (
                <>
                  <span className="inline-flex items-center gap-1.5 font-semibold text-[var(--premium)]">
                    <PremiumIcon className="h-4 w-4" />
                    Premium
                  </span>
                  {me.memberUntil ? (
                    <span className="block text-xs text-[var(--muted)]">
                      Until {new Date(me.memberUntil).toLocaleDateString(undefined, { dateStyle: "medium" })}
                    </span>
                  ) : null}
                </>
              ) : (
                <span className="font-semibold text-[var(--ink)]">Free</span>
              )}
            </AccountRow>
            <AccountRow label="Age check" href="/verify" linkLabel={me.ageVerified ? "Details" : "Verify"}>
              <AgeStatusBadge status={me.ageStatus} />
            </AccountRow>
          </>
        ) : null}
      </dl>
      <div className="mt-5 flex flex-wrap gap-3">
        <Link href="/settings" className={buttonClass("secondary", "md", "flex-1")}>
          Settings
        </Link>
        <Button variant="ghost" className="flex-1" onClick={onSignOut}>
          <SignOutIcon className="h-4 w-4" />
          Log out
        </Button>
      </div>
    </SectionCard>
  );
}

function AccountRow({
  label,
  href,
  linkLabel,
  premium,
  children,
}: {
  label: string;
  href?: string;
  linkLabel?: string;
  // Credits and Premium links take the amber Premium colour.
  premium?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 py-3">
      <div className="min-w-0 flex-1">
        <dt className="text-xs text-[var(--muted)]">{label}</dt>
        <dd className="mt-1 text-sm">{children}</dd>
      </div>
      {href && linkLabel ? (
        <Link
          href={href}
          className={cx(
            "inline-flex h-10 shrink-0 items-center gap-0.5 rounded-full pl-3 pr-2 text-sm font-semibold",
            premium ? "!text-[var(--premium)] hover:bg-[var(--premium)]/10" : "!text-[var(--accent)] hover:bg-[var(--accent-soft)]",
          )}
        >
          {linkLabel}
          <ChevronRightIcon className="h-4 w-4" />
        </Link>
      ) : null}
    </div>
  );
}

function ProfileSkeleton() {
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]" aria-busy="true" aria-label="Loading your profile">
      <Panel className="overflow-hidden">
        <div className="h-28 animate-pulse bg-white/[0.04] motion-reduce:animate-none sm:h-32" />
        <div className="px-5 pb-6 sm:px-6">
          <div className="-mt-12 h-24 w-24 animate-pulse rounded-full bg-[var(--surface-2)] outline outline-4 outline-[var(--surface)] motion-reduce:animate-none" />
          <div className="mt-4 h-7 w-48 animate-pulse rounded-full bg-white/[0.06] motion-reduce:animate-none" />
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <div className="h-16 animate-pulse rounded-xl bg-white/[0.04] motion-reduce:animate-none" />
            <div className="h-16 animate-pulse rounded-xl bg-white/[0.04] motion-reduce:animate-none" />
          </div>
        </div>
      </Panel>
      <SkeletonCard lines={4} />
    </div>
  );
}
