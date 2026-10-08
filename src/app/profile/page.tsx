"use client";

import { useEffect, useRef, useState } from "react";
import { AppHeader, AppShell } from "@/components/app-shell";
import { useSession } from "@/components/auth-gate";
import {
  loadProfile,
  saveProfile,
  type ProfileGender,
  type ProfileLane,
  type UserProfile,
} from "@/lib/profile";

const GENDERS: ProfileGender[] = ["Woman", "Man", "Non-binary"];
const LANES: ProfileLane[] = ["Girls", "Anime", "Guys"];

const PROVIDER_LABEL = {
  google: "Google",
  twitter: "X",
  email: "Email",
  wallet: "Wallet",
} as const;

const emptyForm = {
  name: "",
  photo: "",
  gender: "Woman" as ProfileGender,
  looking: ["Girls"] as ProfileLane[],
  bio: "",
};

export default function ProfilePage() {
  const { session, signOut, openLogin, openSignup } = useSession();
  const [saved, setSaved] = useState<UserProfile | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const photoInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!session) {
      setSaved(null);
      setEditing(false);
      return;
    }
    const profile = loadProfile(session.detail);
    setSaved(profile);
    setEditing(!profile);
    setForm({
      name: profile?.name || session.display,
      photo: profile?.photo || "",
      gender: profile?.gender || "Woman",
      looking: profile?.looking?.length ? profile.looking : ["Girls"],
      bio: profile?.bio || "",
    });
  }, [session]);

  function onPhoto(file: File | undefined) {
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      setForm((current) => ({ ...current, photo: String(reader.result || "") }));
    };
    reader.readAsDataURL(file);
  }

  function toggleLane(lane: ProfileLane) {
    setForm((current) => {
      const on = current.looking.includes(lane);
      const looking = on
        ? current.looking.filter((item) => item !== lane)
        : [...current.looking, lane];
      return { ...current, looking: looking.length ? looking : [lane] };
    });
  }

  function submit() {
    if (!session) return;
    const name = form.name.trim();
    if (!name) return;
    const profile: UserProfile = {
      owner: session.detail,
      name,
      photo: form.photo,
      gender: form.gender,
      looking: form.looking,
      bio: form.bio.trim(),
    };
    saveProfile(profile);
    setSaved(profile);
    setEditing(false);
  }

  return (
    <AppShell>
      <AppHeader />
      <section className="mx-auto w-full max-w-xl px-4 py-10">
        <h1 className="font-[family-name:var(--font-display)] text-4xl text-[var(--ink)]">
          Profile
        </h1>
        {!session ? (
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
        ) : editing ? (
          <form
            className="mt-8 space-y-6"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <p className="text-[var(--muted)]">
              This is you. Characters will remember the name you set here.
            </p>
            <button
              type="button"
              className="relative flex h-28 w-28 items-center justify-center overflow-hidden rounded-full border border-white/15 bg-white/5"
              onClick={() => photoInput.current?.click()}
            >
              {form.photo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={form.photo} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="text-3xl text-[var(--muted)]">
                  {(form.name || session.display).trim().charAt(0).toUpperCase() || "U"}
                </span>
              )}
              <span className="absolute inset-x-0 bottom-0 bg-black/55 py-1 text-[11px] text-[var(--ink)]">
                Photo
              </span>
            </button>
            <input
              ref={photoInput}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => onPhoto(event.target.files?.[0])}
            />
            <label className="block">
              <span className="text-xs uppercase tracking-wide text-[var(--muted)]">Name</span>
              <input
                value={form.name}
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
              <span className="text-xs uppercase tracking-wide text-[var(--muted)]">About you</span>
              <textarea
                value={form.bio}
                onChange={(event) => setForm((current) => ({ ...current, bio: event.target.value }))}
                rows={4}
                className="mt-2 w-full resize-none rounded-2xl border border-[var(--line)] bg-transparent px-4 py-3 text-[var(--ink)] outline-none focus:border-[var(--gold)]"
                placeholder="What should they know about you?"
              />
            </label>
            <div className="flex flex-wrap gap-3">
              <button
                type="submit"
                className="rounded-full bg-[var(--gold)] px-6 py-3 text-sm font-medium !text-[#12110F]"
              >
                Save profile
              </button>
              {saved ? (
                <button
                  type="button"
                  className="rounded-full border border-white/20 px-6 py-3 text-sm text-[var(--ink)]"
                  onClick={() => setEditing(false)}
                >
                  Cancel
                </button>
              ) : null}
            </div>
          </form>
        ) : saved ? (
          <div className="mt-8">
            <div className="flex items-center gap-4">
              <div className="h-24 w-24 overflow-hidden rounded-full border border-white/15 bg-white/5">
                {saved.photo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={saved.photo} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-3xl">
                    {saved.name.trim().charAt(0).toUpperCase()}
                  </div>
                )}
              </div>
              <div>
                <p className="font-[family-name:var(--font-display)] text-3xl text-[var(--ink)]">
                  {saved.name}
                </p>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  {saved.gender} · {saved.looking.join(" · ")}
                </p>
                <p className="mt-1 text-xs uppercase tracking-wide text-[var(--gold)]">
                  {PROVIDER_LABEL[session.provider]} · {session.detail}
                </p>
              </div>
            </div>
            {saved.bio ? (
              <p className="mt-6 text-base leading-7 text-[var(--muted)]">{saved.bio}</p>
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
