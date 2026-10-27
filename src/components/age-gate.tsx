"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ShieldIcon } from "@/components/icons";
import { buttonClass } from "@/components/ui";

// Also read by the boot script in app/layout.tsx.
const GATE_KEY = "simulust-age-ok";

// Pages with no adult content that anyone must be able to read: the policies
// people agree to, and the takedown form (someone reporting misuse of their
// image may never have used the site).
const OPEN_PATHS = ["/report", "/terms", "/privacy", "/content-policy", "/safety", "/dmca", "/2257"];

// Portraits for the blurred wall behind the age check (files in /public/characters).
const COLLAGE = [
  "mira", "yuna", "selene", "aiko", "nova", "vivian",
  "lucia", "hana", "sable", "lilith", "amara", "yuki",
  "nadia", "raven", "scarlet", "vesper", "zara", "ember",
];

export function AgeGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [remember, setRemember] = useState(true);

  useEffect(() => {
    // Storage is only readable after mount.
    const saved =
      window.localStorage.getItem(GATE_KEY) === "1" ||
      window.sessionStorage.getItem(GATE_KEY) === "1";
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAllowed(saved);
  }, []);

  function enter() {
    if (remember) {
      window.localStorage.setItem(GATE_KEY, "1");
      window.sessionStorage.removeItem(GATE_KEY);
    } else {
      window.sessionStorage.setItem(GATE_KEY, "1");
      window.localStorage.removeItem(GATE_KEY);
    }
    document.documentElement.setAttribute("data-age-ok", "");
    setAllowed(true);
  }

  // Same tree either way, so moving between open and gated pages doesn't
  // remount the app below.
  const open = OPEN_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
  const gate = open ? true : allowed;

  // Before storage is read (the server render and the first client render)
  // both the check and the app are sent, and the layout's boot script picks
  // which one shows (see .age-pending-* in globals.css): returning visitors
  // get the app on first paint, newcomers the check, nobody a blank screen.
  return (
    <>
      {gate === true ? null : (
        <div className={gate === null ? "age-pending-gate" : undefined}>
          <AgeGateScreen remember={remember} onRemember={setRemember} onEnter={enter} />
        </div>
      )}
      <div className={gate === true ? "contents" : gate === null ? "age-pending-app" : "hidden"}>{children}</div>
    </>
  );
}

// The age check itself: a centred card over a blurred wall of characters.
export function AgeGateScreen({
  remember,
  onRemember,
  onEnter,
}: {
  remember: boolean;
  onRemember: (value: boolean) => void;
  onEnter: () => void;
}) {
  return (
    <main className="relative min-h-dvh overflow-hidden bg-[var(--bg)] text-[var(--ink)]">
      {/* A blurred wall of characters behind the card: enough to set the mood,
          never sharp before someone says they're an adult. */}
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

      <div className="relative flex min-h-dvh items-center justify-center px-4 py-8 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(2rem,env(safe-area-inset-top))]">
        <section
          aria-labelledby="age-gate-title"
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
          <h1 id="age-gate-title" className="mt-6 text-3xl font-bold tracking-tight text-[var(--ink)] sm:text-4xl">
            Adults only.
          </h1>
          <p className="mt-3 font-semibold text-[var(--ink)]">Welcome to Simulust.</p>
          <p className="mt-1.5 text-sm leading-6 text-[var(--muted)]">
            This platform contains AI-generated adult content and intimate conversations. All characters are 18+
            fictional personas.
          </p>
          <p className="mt-4 flex gap-2.5 rounded-xl bg-white/[0.04] p-3 text-xs leading-5 text-[var(--muted)]">
            <ShieldIcon className="mt-0.5 h-4 w-4 text-[var(--accent)]" />
            <span>
              Explicit content also needs a one-time ID check. The law requires a real age check, not just this click,
              before we can show it.
            </span>
          </p>
          <div className="mt-6 flex flex-col gap-3">
            <button
              type="button"
              className={buttonClass("primary", "lg", "w-full shadow-[0_10px_30px_rgba(255,79,139,0.35)]")}
              onClick={onEnter}
            >
              I&apos;m 18 or older
            </button>
            <a className={buttonClass("secondary", "lg", "w-full !text-[var(--ink)]")} href="https://www.google.com">
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
            Remember my choice on this device
          </label>
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
        </section>
      </div>
    </main>
  );
}
