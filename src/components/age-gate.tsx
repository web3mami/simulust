"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useState, useSyncExternalStore, type FormEvent } from "react";
import { useSession } from "@/components/auth-gate";
import { ChevronDownIcon, LockIcon, ShieldIcon } from "@/components/icons";
import { buttonClass, cx, inputClass } from "@/components/ui";
import { ApiError, useApi } from "@/lib/api";
import type { Me } from "@/lib/api-types";

// Both also read by the boot script in app/layout.tsx.
const GATE_KEY = "simulust-age-ok";
// Set when someone gives a date of birth under 18, so trying again on this
// device isn't one click away. Only the refusal is kept, never the date.
const REFUSED_KEY = "simulust-age-refused";

// Fired on window when this device is refused, so the mounted gate (and the
// sign-up modal) can react.
export const AGE_REFUSED_EVENT = "simulust-age-refused";

// Pages with no adult content that anyone must be able to read: the policies
// people agree to, and the takedown form (someone reporting misuse of their
// image may never have used the site).
const OPEN_PATHS = ["/report", "/terms", "/privacy", "/content-policy", "/safety", "/dmca", "/2257"];

export function isOpenPath(pathname: string) {
  return OPEN_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

// Portraits for the blurred wall behind the age check (files in /public/characters).
// These are the regular, clothed portraits; nothing explicit is ever public.
const COLLAGE = [
  "mira", "yuna", "selene", "aiko", "nova", "vivian",
  "lucia", "hana", "sable", "lilith", "amara", "yuki",
  "nadia", "raven", "scarlet", "vesper", "zara", "ember",
];

// Private windows and blocked storage throw on access; the gate still works,
// it just can't remember anything.
function readStorage(kind: "local" | "session", key: string) {
  try {
    return (kind === "local" ? window.localStorage : window.sessionStorage).getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(kind: "local" | "session", key: string, value: string | null) {
  try {
    const storage = kind === "local" ? window.localStorage : window.sessionStorage;
    if (value === null) storage.removeItem(key);
    else storage.setItem(key, value);
  } catch {
    // Nothing to remember it in.
  }
}

/* Date of birth */

export type BirthDateParts = { day: string; month: string; year: string };
export const EMPTY_BIRTH_DATE: BirthDateParts = { day: "", month: "", year: "" };

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// "YYYY-MM-DD" when the three parts make a real date, or why they don't.
export function readBirthDate(parts: BirthDateParts): { date: string } | { error: string } {
  if (!parts.day || !parts.month || !parts.year) return { error: "Choose the day, month and year you were born." };
  const [day, month, year] = [Number(parts.day), Number(parts.month), Number(parts.year)];
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return { error: `${MONTHS[month - 1]} ${year} has no day ${day}. Check the date.` };
  }
  if (date.getTime() > Date.now()) return { error: "That date is in the future. Check the year." };
  const pad = (value: number) => String(value).padStart(2, "0");
  return { date: `${year}-${pad(month)}-${pad(day)}` };
}

// 18 or older today, counting the 18th birthday itself.
export function isAdultOn(birthDate: string, now = new Date()) {
  const [year, month, day] = birthDate.split("-").map(Number);
  return new Date(year + 18, month - 1, day).getTime() <= now.getTime();
}

// Today's date where the person is ("YYYY-MM-DD"), sent with every date of
// birth: someone whose 18th birthday is today counts as 18 in their own time
// zone, and the server can check the day is a plausible one.
export function localToday(now = new Date()) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// A year, in seconds: how long the refusal cookie lasts.
const REFUSED_COOKIE_MAX_AGE = 365 * 24 * 60 * 60;

// Keeps the refusal everywhere this device can: storage for the gate, an
// attribute on <html> for the boot script's CSS, and a cookie (same name) the
// server reads, so sign-up and log-in refuse this device too, even on the open
// pages the gate doesn't cover.
function markRefused() {
  writeStorage("local", REFUSED_KEY, "1");
  writeStorage("local", GATE_KEY, null);
  writeStorage("session", GATE_KEY, null);
  const root = document.documentElement;
  root.removeAttribute("data-age-ok");
  root.setAttribute("data-age-refused", "");
  try {
    const secure = window.location?.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${REFUSED_KEY}=1; Path=/; Max-Age=${REFUSED_COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
  } catch {
    // Cookies blocked: storage and the attribute still hold it.
  }
}

// Whether this device was turned away: by storage, the boot script's mark, or
// the cookie (which outlives cleared storage). False on the server.
export function isDeviceRefused() {
  if (typeof window === "undefined") return false;
  if (readStorage("local", REFUSED_KEY) === "1") return true;
  try {
    if (document.documentElement.hasAttribute("data-age-refused")) return true;
    return document.cookie.split(";").some((part) => part.trim() === `${REFUSED_KEY}=1`);
  } catch {
    return false;
  }
}

function subscribeRefused(onChange: () => void) {
  window.addEventListener(AGE_REFUSED_EVENT, onChange);
  return () => window.removeEventListener(AGE_REFUSED_EVENT, onChange);
}

// The refusal, live. Its callers only show it once the session is known,
// which is never during the server render or hydration, so reading the device
// for both snapshots can't mismatch.
export function useDeviceRefused() {
  return useSyncExternalStore(subscribeRefused, isDeviceRefused, isDeviceRefused);
}

// Turns this device away after an under-18 date of birth, wherever it was
// given (the gate, sign-up, the in-app confirmation). Remembered on the device,
// marked on <html> for the boot script's sake, and sent to the server, which
// holds a signed-in account for review. The date itself goes nowhere.
export function refuseDevice() {
  markRefused();
  // Fire and forget: same origin, so the session cookie goes with it, and
  // signed-out visitors just get a no-op answer.
  void fetch("/api/age/refused", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ today: localToday() }),
    keepalive: true,
  }).catch(() => undefined);
  window.dispatchEvent(new Event(AGE_REFUSED_EVENT));
}

// 16px text on phones, so focusing a select doesn't zoom the page.
const selectClass = cx(inputClass, "h-12 appearance-none !pl-3 !pr-8 text-base aria-[invalid=true]:border-red-400 sm:text-sm");

// Day, month and year as three native selects: the phone's own picker, no
// typing, and month names so nobody has to guess the order. Nothing is
// pre-filled, and every year is listed, so the form never hints at an answer.
export function BirthDateFields({
  value,
  onChange,
  disabled,
  invalid,
  legend = "Date of birth",
}: {
  value: BirthDateParts;
  onChange: (value: BirthDateParts) => void;
  disabled?: boolean;
  invalid?: boolean;
  legend?: string;
}) {
  const id = useId();
  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: thisYear - 1900 + 1 }, (_, index) => thisYear - index);
  const parts: { key: keyof BirthDateParts; label: string; autoComplete: string; options: [string, string][] }[] = [
    {
      key: "day",
      label: "Day",
      autoComplete: "bday-day",
      options: Array.from({ length: 31 }, (_, index) => [String(index + 1), String(index + 1)]),
    },
    { key: "month", label: "Month", autoComplete: "bday-month", options: MONTHS.map((name, index) => [String(index + 1), name]) },
    { key: "year", label: "Year", autoComplete: "bday-year", options: years.map((year) => [String(year), String(year)]) },
  ];
  return (
    <fieldset className="min-w-0">
      <legend className="text-sm font-semibold text-[var(--ink)]">{legend}</legend>
      <div className="mt-2 grid grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_minmax(0,1.15fr)] gap-2">
        {parts.map((part) => (
          <div key={part.key} className="relative min-w-0">
            <label htmlFor={`${id}-${part.key}`} className="sr-only">
              {part.label}
            </label>
            <select
              id={`${id}-${part.key}`}
              value={value[part.key]}
              disabled={disabled}
              aria-invalid={invalid || undefined}
              autoComplete={part.autoComplete}
              onChange={(event) => onChange({ ...value, [part.key]: event.target.value })}
              className={cx(selectClass, !value[part.key] && "text-[var(--muted)]")}
            >
              <option value="">{part.label}</option>
              {part.options.map(([optionValue, label]) => (
                <option key={optionValue} value={optionValue} className="text-[var(--ink)]">
                  {label}
                </option>
              ))}
            </select>
            <ChevronDownIcon className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" />
          </div>
        ))}
      </div>
    </fieldset>
  );
}

/* The gate */

export function AgeGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [refused, setRefused] = useState(false);
  const [remember, setRemember] = useState(true);

  useEffect(() => {
    // Storage is only readable after mount.
    const wasRefused = isDeviceRefused();
    // Fills in whatever's missing: the cookie on a device refused before it
    // existed, or storage someone cleared while the cookie stayed.
    if (wasRefused) markRefused();
    const saved = !wasRefused && (readStorage("local", GATE_KEY) === "1" || readStorage("session", GATE_KEY) === "1");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRefused(wasRefused);
    setAllowed(saved);
    // A refusal from anywhere else (sign-up, the in-app confirmation).
    function onRefused() {
      setRefused(true);
      setAllowed(false);
    }
    window.addEventListener(AGE_REFUSED_EVENT, onRefused);
    return () => window.removeEventListener(AGE_REFUSED_EVENT, onRefused);
  }, []);

  function enter() {
    writeStorage(remember ? "local" : "session", GATE_KEY, "1");
    writeStorage(remember ? "session" : "local", GATE_KEY, null);
    document.documentElement.setAttribute("data-age-ok", "");
    setAllowed(true);
  }

  // Same tree either way, so moving between open and gated pages doesn't
  // remount the app below.
  const gate = isOpenPath(pathname) ? true : allowed;

  // Before storage is read (the server render and the first client render)
  // both the check and the app are sent, and the layout's boot script picks
  // which one shows (see .age-pending-* in globals.css): returning visitors
  // get the app on first paint, newcomers the check, nobody a blank screen.
  // The refusal is sent too, for a device that was turned away before
  // (data-age-refused), so it never sees the form flash first.
  const check = (
    <AgeGateScreen remember={remember} onRemember={setRemember} onAdult={enter} onMinor={refuseDevice} />
  );
  return (
    <>
      {gate === true ? null : gate === null ? (
        <div className="age-pending-gate">
          <div className="age-gate-form">{check}</div>
          <div className="age-gate-refused">
            <AgeRefusedScreen titleId="age-refused-title" />
          </div>
        </div>
      ) : refused ? (
        <AgeRefusedScreen />
      ) : (
        check
      )}
      <div className={gate === true ? "contents" : gate === null ? "age-pending-app" : "hidden"}>{children}</div>
    </>
  );
}

function GateFrame({
  wall,
  titleId = "age-gate-title",
  children,
}: {
  wall: boolean;
  titleId?: string;
  children: React.ReactNode;
}) {
  return (
    <main className="relative min-h-dvh overflow-hidden bg-[var(--bg)] text-[var(--ink)]">
      {wall ? (
        // A blurred wall of characters behind the card: enough to set the mood,
        // never sharp before someone says they're an adult.
        <div className="pointer-events-none absolute inset-0" aria-hidden>
          <div className="animate-gate-drift absolute -inset-6 grid scale-105 grid-cols-3 content-start gap-2 blur-[3px] sm:grid-cols-4 lg:grid-cols-6">
            {COLLAGE.map((id) => (
              // Small thumbnails: the wall is blurred, so bigger ones would only
              // cost bandwidth on a visitor's first screen.
              <Image
                key={id}
                src={`/characters/${id}.jpg`}
                alt=""
                width={240}
                height={320}
                sizes="(min-width: 1024px) 128px, 96px"
                fetchPriority="low"
                className="aspect-[3/4] w-full rounded-2xl bg-[var(--surface)] object-cover"
              />
            ))}
          </div>
          <div className="absolute inset-0 bg-[var(--bg)]/35" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(13,13,16,0.35)_0%,rgba(13,13,16,0.15)_45%,rgba(13,13,16,0.9)_100%)]" />
        </div>
      ) : null}

      <div className="relative flex min-h-dvh items-center justify-center px-4 py-8 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(2rem,env(safe-area-inset-top))]">
        <section
          aria-labelledby={titleId}
          className="animate-modal-in w-full max-w-md rounded-3xl border border-white/10 bg-[var(--bg-2)]/85 p-6 shadow-[0_30px_80px_rgba(0,0,0,0.65)] backdrop-blur-xl sm:p-8"
        >
          <div className="flex items-center justify-between">
            <p className="text-2xl font-extrabold tracking-tight text-[var(--ink)]">
              simu<span className="text-[var(--accent)]">lust</span>
            </p>
            <span
              aria-hidden
              className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-[var(--accent)] bg-[var(--accent-soft)] text-base font-extrabold text-[var(--accent)]"
            >
              18+
            </span>
          </div>
          {children}
        </section>
      </div>
    </main>
  );
}

const LEAVE_URL = "https://www.google.com";

// The age check itself: a date of birth, over a blurred wall of characters.
export function AgeGateScreen({
  remember,
  onRemember,
  onAdult,
  onMinor,
}: {
  remember: boolean;
  onRemember: (value: boolean) => void;
  onAdult: () => void;
  onMinor: () => void;
}) {
  const [birthDate, setBirthDate] = useState<BirthDateParts>(EMPTY_BIRTH_DATE);
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();

  function submit(event: FormEvent) {
    event.preventDefault();
    const read = readBirthDate(birthDate);
    if ("error" in read) {
      setError(read.error);
      return;
    }
    setError(null);
    if (isAdultOn(read.date)) onAdult();
    else onMinor();
  }

  return (
    <GateFrame wall>
      <h1 id="age-gate-title" className="mt-6 text-3xl font-bold tracking-tight text-[var(--ink)] sm:text-4xl">
        Adults only.
      </h1>
      <p className="mt-3 font-semibold text-[var(--ink)]">Welcome to Simulust.</p>
      <p className="mt-1.5 text-sm leading-6 text-[var(--muted)]">
        Intimate conversations and AI-generated adult art, with fictional characters who are all 18 or older. Tell us
        when you were born to come in.
      </p>
      <form className="mt-5" onSubmit={submit} noValidate aria-describedby={error ? errorId : undefined}>
        <BirthDateFields value={birthDate} onChange={setBirthDate} invalid={Boolean(error)} />
        {error ? (
          <p id={errorId} role="alert" className="mt-2 text-sm text-red-300">
            {error}
          </p>
        ) : null}
        <p className="mt-4 flex gap-2.5 rounded-xl bg-white/[0.04] p-3 text-xs leading-5 text-[var(--muted)]">
          <ShieldIcon className="mt-0.5 h-4 w-4 text-[var(--accent)]" />
          <span>
            Your date of birth is only checked here, never sent or kept. Nudity stays hidden until you create an
            account, where we ask for it once more.
          </span>
        </p>
        <div className="mt-5 flex flex-col gap-3">
          <button
            type="submit"
            className={buttonClass("primary", "lg", "w-full shadow-[0_10px_30px_rgba(255,79,139,0.35)]")}
          >
            Enter
          </button>
          <a className={buttonClass("secondary", "lg", "w-full !text-[var(--ink)]")} href={LEAVE_URL}>
            Leave
          </a>
        </div>
        <label className="mt-4 flex min-h-10 cursor-pointer items-center gap-3 text-sm text-[var(--muted)]">
          <input
            type="checkbox"
            checked={remember}
            onChange={(event) => onRemember(event.target.checked)}
            className="h-4 w-4 shrink-0 accent-[var(--accent)]"
          />
          Remember me on this device
        </label>
        <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
          By entering you confirm you&apos;re 18 or older, and old enough to see adult content where you live, and you
          agree to our{" "}
          <Link href="/terms" className="!text-[var(--ink)] underline underline-offset-2">
            Terms
          </Link>
          .
        </p>
      </form>
      <nav aria-label="Legal" className="mt-5 flex justify-center gap-1 border-t border-[var(--line)] pt-3 text-xs">
        <Link href="/terms" className="rounded-lg px-2 py-2 !text-[var(--muted)] underline underline-offset-2 hover:!text-[var(--ink)]">
          Terms
        </Link>
        <Link href="/privacy" className="rounded-lg px-2 py-2 !text-[var(--muted)] underline underline-offset-2 hover:!text-[var(--ink)]">
          Privacy
        </Link>
        <Link href="/report" className="rounded-lg px-2 py-2 !text-[var(--muted)] underline underline-offset-2 hover:!text-[var(--ink)]">
          Report content
        </Link>
      </nav>
    </GateFrame>
  );
}

const footLink =
  "rounded-lg px-2 py-2 !text-[var(--muted)] underline underline-offset-2 hover:!text-[var(--ink)]";

// For someone who gave a date of birth under 18: a kind no, and the way out.
// No wall of characters behind it, but the policies and the report form stay
// in reach (they're open pages), so it's never a dead end.
export function AgeRefusedScreen({ titleId = "age-gate-title" }: { titleId?: string }) {
  return (
    <GateFrame wall={false} titleId={titleId}>
      <h1 id={titleId} className="mt-6 text-3xl font-bold tracking-tight text-[var(--ink)] sm:text-4xl">
        Simulust is for adults.
      </h1>
      <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
        You need to be 18 or older to come in, so we can&apos;t let you in today. Thanks for being honest with us.
      </p>
      <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
        Picked the wrong year by mistake? Contact support through the{" "}
        <Link href="/report" className="!text-[var(--ink)] underline underline-offset-2">
          report page
        </Link>{" "}
        and we&apos;ll take a look.
      </p>
      <a className={buttonClass("primary", "lg", "mt-6 w-full")} href={LEAVE_URL}>
        Leave
      </a>
      <nav aria-label="Legal" className="mt-5 flex justify-center gap-1 border-t border-[var(--line)] pt-3 text-xs">
        <Link href="/terms" className={footLink}>
          Terms
        </Link>
        <Link href="/privacy" className={footLink}>
          Privacy
        </Link>
        <Link href="/report" className={footLink}>
          Report content
        </Link>
      </nav>
    </GateFrame>
  );
}

/* In-app confirmation */

// Everything a confirmed adult gets: the whole site is uncensored, there's no
// separate switch. For the age page.
export const EXPLICIT_UNLOCKS = [
  "Nude art of every character",
  "Explicit photos from your characters",
  "The Video Studio, for short explicit clips of your own",
  "Explicit chat that follows your lead",
];

// The signed-in age confirmation (AGE_VERIFICATION=gate), for accounts that
// didn't confirm at sign-up (older and dev accounts, or one an admin cleared
// from a hold): the date of birth again, sent to the server with today's date,
// which re-checks it and keeps only the time. An under-18 date holds the
// account and turns this device away.
export function AgeConfirmForm({
  onConfirmed,
  submitLabel = "Confirm my age",
  className,
}: {
  onConfirmed?: (me: Me) => void | Promise<void>;
  submitLabel?: string;
  className?: string;
}) {
  const api = useApi();
  const { refreshMe } = useSession();
  const [birthDate, setBirthDate] = useState<BirthDateParts>(EMPTY_BIRTH_DATE);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const consentId = useId();

  async function submit(event: FormEvent) {
    event.preventDefault();
    const read = readBirthDate(birthDate);
    if ("error" in read) {
      setError(read.error);
      return;
    }
    if (!consent) {
      setError("Tick the box to confirm.");
      return;
    }
    setBusy(true);
    setError(null);
    // Sent even when it's under 18: the server is what holds the account.
    const minor = !isAdultOn(read.date);
    try {
      const { me } = await api<{ me: Me }>("/api/age/attest", {
        method: "POST",
        json: { birthDate: read.date, consent: true, today: localToday() },
      });
      if (minor) {
        refuseDevice();
        await refreshMe();
        return;
      }
      await refreshMe();
      await onConfirmed?.(me);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That didn't work. Try again.");
      if (minor || (caught instanceof ApiError && caught.code === "under_18")) refuseDevice();
      // An under-18 date (or an open hold) changes the account: show it.
      if (caught instanceof ApiError && (caught.code === "under_18" || caught.code === "explicit_hold")) {
        await refreshMe();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={className} onSubmit={submit} noValidate>
      <BirthDateFields value={birthDate} onChange={setBirthDate} disabled={busy} />
      <label htmlFor={consentId} className="mt-4 flex cursor-pointer items-start gap-3 text-sm leading-6 text-[var(--muted)]">
        <input
          id={consentId}
          type="checkbox"
          checked={consent}
          disabled={busy}
          onChange={(event) => setConsent(event.target.checked)}
          className="mt-1 h-4 w-4 shrink-0 accent-[var(--accent)]"
        />
        <span>
          I&apos;m 18 or older and I want explicit adult content. I understand every character is a fictional adult
          and everything here is AI-generated.
        </span>
      </label>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="submit" disabled={busy} className={buttonClass("primary", "md")}>
          <LockIcon className="h-4 w-4" />
          {busy ? "Confirming…" : submitLabel}
        </button>
        <p className="text-xs text-[var(--muted)]">We check the date and forget it. Only the time you confirmed is saved.</p>
      </div>
      {error ? (
        <p role="alert" className="mt-3 rounded-xl border border-red-500/35 bg-red-500/10 px-4 py-3 text-sm leading-6 text-red-200">
          {error}
        </p>
      ) : null}
    </form>
  );
}
