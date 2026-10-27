"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { buttonClass } from "@/components/ui";

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
    setAllowed(true);
  }

  // Same tree either way, so moving between open and gated pages doesn't
  // remount the app below.
  const open = OPEN_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
  const gate = open ? true : allowed;

  return (
    <>
      {gate === false ? (
        <AgeGateScreen remember={remember} onRemember={setRemember} onEnter={enter} />
      ) : gate === null ? (
        <main className="min-h-dvh bg-[var(--bg)]" />
      ) : null}
      <div className={gate === true ? "contents" : "hidden"}>{children}</div>
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
      {/* A blurred, darkened wall of characters behind the card. */}
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="absolute -inset-6 grid scale-105 grid-cols-3 content-start gap-2 blur-[3px] sm:grid-cols-4 lg:grid-cols-6">
          {COLLAGE.map((id) => (
            // Thumbnails: the wall is blurred, so full-size portraits would only
            // cost bandwidth on a visitor's first screen.
            <Image
              key={id}
              src={`/characters/${id}.jpg`}
              alt=""
              width={240}
              height={320}
              sizes="(min-width: 1024px) 17vw, (min-width: 640px) 25vw, 34vw"
              fetchPriority="low"
              className="aspect-[3/4] w-full rounded-2xl object-cover"
            />
          ))}
        </div>
        <div className="absolute inset-0 bg-[var(--bg)]/50" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(13,13,16,0.55)_0%,rgba(13,13,16,0.2)_45%,rgba(13,13,16,0.9)_100%)]" />
      </div>

      <div className="relative flex min-h-dvh items-center justify-center px-4 py-10">
        <section
          aria-labelledby="age-gate-title"
          className="w-full max-w-md rounded-3xl border border-white/10 bg-[var(--bg-2)]/90 p-6 text-center shadow-[0_30px_80px_rgba(0,0,0,0.65)] backdrop-blur-xl sm:p-8"
        >
          <p className="text-2xl font-extrabold tracking-tight text-[var(--ink)]">
            simu<span className="text-[var(--accent)]">lust</span>
          </p>
          <div
            aria-hidden
            className="mx-auto mt-6 flex h-16 w-16 items-center justify-center rounded-full border-2 border-[var(--accent)] bg-[var(--accent-soft)] text-xl font-extrabold text-[var(--accent)]"
          >
            18+
          </div>
          <h1 id="age-gate-title" className="mt-5 text-3xl font-bold tracking-tight text-[var(--ink)]">
            Adults only.
          </h1>
          <div className="mt-4 space-y-2.5 text-sm leading-6 text-[var(--muted)]">
            <p className="font-semibold text-[var(--ink)]">
              Welcome to Simu<span className="text-[var(--accent)]">Lust</span>.
            </p>
            <p>This platform contains AI-generated adult content and intimate conversations.</p>
            <p>All characters are 18+ fictional personas.</p>
            <p>
              Explicit content also needs a one-time ID check. The law requires a real age check, not just this
              click, before we can show it.
            </p>
          </div>
          <div className="mt-7 flex flex-col gap-3">
            <button type="button" className={buttonClass("primary", "lg", "w-full")} onClick={onEnter}>
              I&apos;m 18 or older
            </button>
            <a className={buttonClass("secondary", "lg", "w-full !text-[var(--ink)]")} href="https://www.google.com">
              Leave
            </a>
          </div>
          <label className="mt-5 inline-flex min-h-10 cursor-pointer items-center gap-3 text-sm text-[var(--muted)]">
            <input
              type="checkbox"
              checked={remember}
              onChange={(event) => onRemember(event.target.checked)}
              className="h-4 w-4 shrink-0 accent-[var(--accent)]"
            />
            Remember my choice on this device
          </label>
          <nav aria-label="Legal" className="mt-4 flex justify-center gap-4 border-t border-[var(--line)] pt-4 text-xs">
            <Link href="/terms" className="!text-[var(--muted)] underline underline-offset-2 hover:!text-[var(--ink)]">
              Terms
            </Link>
            <Link href="/privacy" className="!text-[var(--muted)] underline underline-offset-2 hover:!text-[var(--ink)]">
              Privacy
            </Link>
            <Link href="/report" className="!text-[var(--muted)] underline underline-offset-2 hover:!text-[var(--ink)]">
              Report content
            </Link>
          </nav>
        </section>
      </div>
    </main>
  );
}
