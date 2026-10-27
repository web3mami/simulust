"use client";

import { useCallback, useEffect, useState } from "react";
import { AppHeader, AppShell } from "@/components/app-shell";
import { useSession } from "@/components/auth-gate";
import { ApiError, useApi } from "@/lib/api";

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

  return (
    <AppShell>
      <AppHeader />
      <section className="mx-auto w-full max-w-xl px-4 py-10">
        <h1 className="font-[family-name:var(--font-display)] text-4xl text-[var(--ink)]">
          Profile
        </h1>
        {!ready ? (
          <ProfileSkeleton />
        ) : !session ? (
          <div className="mt-8">
            <p className="text-[var(--muted)]">Sign in to set up your profile.</p>
            <div className="mt-6 flex flex-wrap gap-3">
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
        ) : load.state === "loading" ? (
          <ProfileSkeleton />
        ) : load.state === "error" ? (
          <div className="mt-8" role="alert">
            <p className="text-[var(--muted)]">{load.message}</p>
            <button
              type="button"
              className="mt-6 rounded-full border border-white/20 px-6 py-3 text-sm text-[var(--ink)]"
              onClick={() => setAttempt((value) => value + 1)}
            >
              Try again
            </button>
          </div>
        ) : editing ? (
          <form
            className="mt-8 space-y-6"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <p className="text-[var(--muted)]">
              This is you. Characters will remember the name you set here.
            </p>
            <div className="flex items-center gap-4">
              <div
                aria-hidden
                className="flex h-28 w-28 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/5 text-3xl text-[var(--muted)]"
              >
                {initialOf(form.name || session.display)}
              </div>
              <p className="text-sm leading-6 text-[var(--muted)]">
                We don&apos;t take photo uploads, so your initial stands in for a picture.
              </p>
            </div>
            <label className="block">
              <span className="text-xs uppercase tracking-wide text-[var(--muted)]">Name</span>
              <input
                value={form.name}
                maxLength={NAME_MAX}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                className="mt-2 w-full rounded-2xl border border-[var(--line)] bg-transparent px-4 py-3 text-[var(--ink)] outline-none focus:border-[var(--gold)]"
                required
              />
            </label>
            <fieldset>
              <legend className="text-xs uppercase tracking-wide text-[var(--muted)]">I am</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {GENDERS.map((gender) => (
                  <button
                    key={gender}
                    type="button"
                    aria-pressed={form.gender === gender}
                    className={`rounded-full px-4 py-2 text-sm ${
                      form.gender === gender
                        ? "bg-[var(--gold)] !text-[#12110F]"
                        : "border border-white/20 text-[var(--ink)]"
                    }`}
                    onClick={() => setForm((current) => ({ ...current, gender }))}
                  >
                    {gender}
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="text-xs uppercase tracking-wide text-[var(--muted)]">Into</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {LANES.map((lane) => (
                  <button
                    key={lane}
                    type="button"
                    aria-pressed={form.looking.includes(lane)}
                    className={`rounded-full px-4 py-2 text-sm ${
                      form.looking.includes(lane)
                        ? "bg-[var(--gold)] !text-[#12110F]"
                        : "border border-white/20 text-[var(--ink)]"
                    }`}
                    onClick={() => toggleLane(lane)}
                  >
                    {lane}
                  </button>
                ))}
              </div>
            </fieldset>
            <label className="block">
              <span className="flex items-baseline justify-between text-xs uppercase tracking-wide text-[var(--muted)]">
                About you
                <span className="normal-case tracking-normal">
                  {form.bio.length}/{BIO_MAX}
                </span>
              </span>
              <textarea
                value={form.bio}
                maxLength={BIO_MAX}
                onChange={(event) => setForm((current) => ({ ...current, bio: event.target.value }))}
                rows={4}
                className="mt-2 w-full resize-none rounded-2xl border border-[var(--line)] bg-transparent px-4 py-3 text-[var(--ink)] outline-none focus:border-[var(--gold)]"
                placeholder="What should they know about you?"
              />
            </label>
            {saveError ? (
              <p role="alert" className="text-sm text-red-400">
                {saveError}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-3">
              <button
                type="submit"
                disabled={saving || !form.name.trim()}
                className="rounded-full bg-[var(--gold)] px-6 py-3 text-sm font-medium !text-[#12110F] disabled:opacity-60"
              >
                {saving ? "Saving…" : "Save profile"}
              </button>
              {saved ? (
                <button
                  type="button"
                  disabled={saving}
                  className="rounded-full border border-white/20 px-6 py-3 text-sm text-[var(--ink)] disabled:opacity-60"
                  onClick={cancelEdit}
                >
                  Cancel
                </button>
              ) : null}
            </div>
          </form>
        ) : saved ? (
          <div className="mt-8">
            <div className="flex items-center gap-4">
              <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/5 text-3xl">
                {initialOf(saved.name)}
              </div>
              <div className="min-w-0">
                <p className="break-words font-[family-name:var(--font-display)] text-3xl text-[var(--ink)]">
                  {saved.name}
                </p>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  {[saved.gender, ...saved.looking].join(" · ")}
                </p>
                <p className="mt-1 truncate text-xs uppercase tracking-wide text-[var(--gold)]">
                  {PROVIDER_LABEL[session.provider]} · {session.detail}
                </p>
              </div>
            </div>
            {saved.bio ? (
              <p className="mt-6 whitespace-pre-line break-words text-base leading-7 text-[var(--muted)]">
                {saved.bio}
              </p>
            ) : null}
            <div className="mt-8 flex flex-wrap gap-3">
              <button
                type="button"
                className="rounded-full bg-[var(--gold)] px-6 py-3 text-sm font-medium !text-[#12110F]"
                onClick={() => setEditing(true)}
              >
                Edit profile
              </button>
              <button
                type="button"
                className="rounded-full border border-white/20 px-6 py-3 text-sm text-[var(--ink)]"
                onClick={signOut}
              >
                Logout
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </AppShell>
  );
}

function ProfileSkeleton() {
  return (
    <div className="mt-8 flex items-center gap-4" aria-busy="true" aria-label="Loading your profile">
      <div className="h-24 w-24 shrink-0 animate-pulse rounded-full bg-white/5" />
      <div className="flex-1 space-y-3">
        <div className="h-6 w-40 animate-pulse rounded-full bg-white/5" />
        <div className="h-4 w-56 animate-pulse rounded-full bg-white/5" />
      </div>
    </div>
  );
}
