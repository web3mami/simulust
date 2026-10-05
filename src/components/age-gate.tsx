"use client";

import { useEffect, useState } from "react";

const GATE_KEY = "simulust-age-ok";

export function AgeGate({ children }: { children: React.ReactNode }) {
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    setAllowed(window.localStorage.getItem(GATE_KEY) === "1");
  }, []);

  if (allowed === null) {
    return <main className="min-h-screen bg-[var(--bg)]" />;
  }

  if (!allowed) {
    return (
      <main className="min-h-screen bg-[var(--bg)] text-[var(--ink)]">
        <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
          <p className="text-xs uppercase text-[var(--accent-2)]">Simulust</p>
          <h1 className="mt-4 text-4xl font-semibold leading-tight">
            Adults only.
          </h1>
          <p className="mt-4 text-[var(--muted)]">
            This is an 18+ AI dating and adult product. You must be 18 or older
            to enter. Characters are 18+ only.
          </p>
          <button
            className="mt-8 rounded-full bg-[var(--accent)] px-5 py-3 text-sm font-medium text-white"
            onClick={() => {
              window.localStorage.setItem(GATE_KEY, "1");
              setAllowed(true);
            }}
          >
            I am 18 or older
          </button>
          <a
            className="mt-4 text-sm text-[var(--muted)] underline"
            href="https://www.google.com"
          >
            I am not 18
          </a>
        </div>
      </main>
    );
  }

  return children;
}
