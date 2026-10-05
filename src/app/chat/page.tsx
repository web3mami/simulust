"use client";

import Link from "next/link";
import { useMemo } from "react";
import { AppHeader, AppShell } from "@/components/app-shell";
import { SEED_CHARACTERS, loadPeople } from "@/lib/characters";

export default function ChatPage() {
  const threads = useMemo(() => {
    const created = loadPeople();
    const taken = new Set(created.map((person) => person.id));
    return [...created, ...SEED_CHARACTERS.filter((person) => !taken.has(person.id))];
  }, []);

  return (
    <AppShell>
      <AppHeader />
      <section className="mx-auto w-full max-w-xl px-4 py-6">
        <h1 className="font-[family-name:var(--font-display)] text-3xl text-[var(--ink)]">Chat</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">Pick someone and keep the conversation going.</p>
        <ul className="mt-6 divide-y divide-[var(--line)] border-y border-[var(--line)]">
          {threads.map((person) => (
            <li key={person.id}>
              <Link href={`/date/${person.id}`} className="flex items-center gap-3 py-3">
                <span
                  className="relative h-12 w-12 shrink-0 overflow-hidden rounded-full border border-white/10"
                  style={{ background: person.color }}
                >
                  {person.image ? (
                    <img src={person.image} alt="" className="h-full w-full object-cover" />
                  ) : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-sm font-medium text-[var(--ink)]">{person.name}</span>
                    <span className="shrink-0 text-[11px] text-[var(--muted)]">{person.role}</span>
                  </span>
                  <span className="mt-0.5 line-clamp-1 text-sm text-[var(--muted)]">{person.line}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </AppShell>
  );
}
