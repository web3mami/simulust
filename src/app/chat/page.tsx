"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppHeader, AppShell } from "@/components/app-shell";
import { findCharacter, loadPeople, type Character } from "@/lib/characters";
import { loadThreads } from "@/lib/threads";

type Row = Character & { preview: string };

export default function ChatPage() {
  const [threads, setThreads] = useState<Row[] | null>(null);

  useEffect(() => {
    const created = loadPeople();
    const createdIds = new Set(created.map((person) => person.id));
    const opened = loadThreads();
    const previewById = new Map(opened.map((thread) => [thread.id, thread.last]));

    const fromDiscover = opened
      .map((thread) => findCharacter(thread.id))
      .filter((person): person is Character => Boolean(person) && !createdIds.has(person.id));

    const rows: Row[] = [...created, ...fromDiscover].map((person) => ({
      ...person,
      preview: previewById.get(person.id) ?? person.line,
    }));

    const rank = new Map(opened.map((thread, index) => [thread.id, index]));
    rows.sort((a, b) => {
      const aRank = rank.get(a.id);
      const bRank = rank.get(b.id);
      if (aRank == null && bRank == null) return 0;
      if (aRank == null) return 1;
      if (bRank == null) return -1;
      return aRank - bRank;
    });

    setThreads(rows);
  }, []);

  return (
    <AppShell>
      <AppHeader />
      <section className="mx-auto w-full max-w-xl px-4 py-6">
        <h1 className="font-[family-name:var(--font-display)] text-3xl text-[var(--ink)]">Chat</h1>
        {threads == null ? null : threads.length === 0 ? (
          <p className="mt-6 text-sm leading-6 text-[var(--muted)]">
            No chats yet. Create someone, or text someone from Discover.
          </p>
        ) : (
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
                    <span className="mt-0.5 line-clamp-1 text-sm text-[var(--muted)]">{person.preview}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </AppShell>
  );
}
