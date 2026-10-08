"use client";

import { useEffect, useState } from "react";

const GATE_KEY = "simulust-age-ok";

export function AgeGate({ children }: { children: React.ReactNode }) {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [remember, setRemember] = useState(true);

  useEffect(() => {
    const saved =
      window.localStorage.getItem(GATE_KEY) === "1" ||
      window.sessionStorage.getItem(GATE_KEY) === "1";
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

  return (
    <>
      {allowed === false ? (
        <main className="relative min-h-dvh overflow-hidden bg-[var(--bg)] text-[var(--ink)]">
          <div className="pointer-events-none absolute inset-0" aria-hidden>
            <div className="age-gate-glow absolute -right-24 top-[-22%] h-[32rem] w-[48rem] rotate-[-16deg] bg-[radial-gradient(ellipse,rgba(198,161,91,0.12),transparent_70%)]" />
            <div className="age-gate-glow-lag absolute left-[-10%] bottom-[-18%] h-[26rem] w-[40rem] rotate-[10deg] bg-[radial-gradient(ellipse,rgba(92,52,16,0.42),transparent_72%)]" />
            <Geometry />
            <div className="age-gate-vignette absolute inset-0" />
          </div>

          <div className="relative mx-auto flex min-h-dvh max-w-xl flex-col justify-center px-6 py-16 [word-spacing:0.12em]">
            <p className="font-[family-name:var(--font-display)] text-xl text-[var(--ink)]">
              Simu<span className="text-[var(--gold)]">Lust</span>
            </p>
            <div className="mt-12 h-px w-10 bg-[var(--gold)]" />
            <h1 className="mt-8 font-[family-name:var(--font-display)] text-5xl font-light leading-[1.08] text-[var(--ink)] sm:text-6xl">
              Adults only.
            </h1>
            <div className="mt-6 max-w-md space-y-3 text-base leading-7 text-[var(--muted)]">
              <p className="text-[var(--ink)]">
                Welcome to Simu<span className="text-[var(--gold)]">Lust</span>.
              </p>
              <p>This platform contains AI-generated adult content and intimate conversations.</p>
              <p>All characters are 18+ fictional personas.</p>
            </div>
            <label className="mt-8 flex cursor-pointer items-center gap-3 text-sm text-[var(--muted)]">
              <input
                type="checkbox"
                checked={remember}
                onChange={(event) => setRemember(event.target.checked)}
                className="h-4 w-4 shrink-0 accent-[var(--gold)]"
              />
              Remember my choice on this device
            </label>
            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                className="rounded-full bg-[var(--gold)] px-7 py-3.5 text-sm font-medium !text-[#12110F]"
                onClick={enter}
              >
                Yes, I&apos;m 18
              </button>
              <a
                className="rounded-full border border-[var(--ink)]/35 px-7 py-3.5 text-sm font-medium text-[var(--ink)] hover:border-[var(--ink)] hover:bg-white/5"
                href="https://www.google.com"
              >
                No, exit
              </a>
            </div>
          </div>
        </main>
      ) : allowed === null ? (
        <main className="min-h-dvh bg-[var(--bg)]" />
      ) : null}
      <div className={allowed === true ? "contents" : "hidden"}>{children}</div>
    </>
  );
}

function Geometry() {
  const rays = Array.from({ length: 17 }, (_, index) => {
    const angle = ((-78 + index * 9.2) * Math.PI) / 180;
    return {
      x: Math.cos(angle) * 920,
      y: Math.sin(angle) * 920,
    };
  });

  return (
    <svg
      className="absolute inset-0 h-full w-full"
      viewBox="0 0 1200 800"
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <pattern id="age-khatam" width="96" height="96" patternUnits="userSpaceOnUse">
          <g fill="none" stroke="#C6A15B" strokeLinecap="round" strokeWidth="0.5">
            <rect x="28" y="28" width="40" height="40" />
            <path d="M48 8 L88 48 L48 88 L8 48 Z" />
            <path d="M48 20 L76 48 L48 76 L20 48 Z" />
            <path d="M34 34 L62 34 L62 62 L34 62 Z" />
            <circle cx="48" cy="48" r="4.5" />
          </g>
        </pattern>
        <pattern id="age-shippo" width="120" height="120" patternUnits="userSpaceOnUse">
          <g fill="none" stroke="#C6A15B" strokeWidth="0.4">
            <circle cx="0" cy="0" r="60" />
            <circle cx="120" cy="0" r="60" />
            <circle cx="0" cy="120" r="60" />
            <circle cx="120" cy="120" r="60" />
            <circle cx="60" cy="60" r="60" />
          </g>
        </pattern>
        <radialGradient id="age-geo-fade" cx="42%" cy="48%" r="78%">
          <stop offset="0%" stopColor="white" stopOpacity="0.55" />
          <stop offset="62%" stopColor="white" stopOpacity="0.32" />
          <stop offset="100%" stopColor="white" stopOpacity="0.14" />
        </radialGradient>
        <mask id="age-geo-mask">
          <rect width="1200" height="800" fill="url(#age-geo-fade)" />
        </mask>
      </defs>
      <g mask="url(#age-geo-mask)">
        <rect width="1200" height="800" fill="url(#age-shippo)" opacity="0.16" />
        <rect width="1200" height="800" fill="url(#age-khatam)" opacity="0.28" />
        <g
          transform="translate(1120 -30)"
          fill="none"
          stroke="#C6A15B"
          strokeLinecap="round"
          strokeWidth="0.55"
          opacity="0.3"
        >
          {rays.map((ray) => (
            <path key={`${ray.x}-${ray.y}`} d={`M0 0 L${ray.x} ${ray.y}`} />
          ))}
          <circle r="72" />
          <circle r="132" />
          <circle r="198" />
          <circle r="268" />
          <path d="M-40 220 A 280 280 0 0 1 -280 40" />
        </g>
      </g>
    </svg>
  );
}
