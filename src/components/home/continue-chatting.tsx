"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSession } from "@/components/auth-gate";
import { ChevronRightIcon } from "@/components/icons";
import { SectionTitle } from "@/components/ui";
import { useApi } from "@/lib/api";
import type { ThreadDTO } from "@/lib/api-types";
import { ScrollRow } from "@/components/home/browse";
import { relativeTime } from "@/components/home/catalogue";

const SHOWN = 12;

// Recent chats for a signed-in user, newest first. Shows nothing until there
// is something to continue, so signed-out visitors never see an empty row.
export function ContinueChatting() {
  const { session } = useSession();
  const api = useApi();
  const sessionKey = session?.detail ?? null;
  const [loaded, setLoaded] = useState<{ key: string; threads: ThreadDTO[] } | null>(null);

  useEffect(() => {
    if (!sessionKey) return;
    let cancelled = false;
    void (async () => {
      try {
        const { threads } = await api<{ threads: ThreadDTO[] }>("/api/threads");
        if (!cancelled) setLoaded({ key: sessionKey, threads });
      } catch {
        // A shortcut row: if it can't load, the page works without it.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, sessionKey]);

  const threads = loaded && loaded.key === sessionKey ? loaded.threads.slice(0, SHOWN) : [];
  if (threads.length === 0) return null;

  return (
    <section aria-label="Continue chatting">
      <SectionTitle
        accent="Continue"
        action={
          <Link
            href="/chat"
            className="flex h-10 shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-3 text-sm font-semibold text-[var(--muted)] hover:bg-white/5 hover:text-[var(--ink)]"
          >
            All chats
            <ChevronRightIcon className="h-4 w-4" />
          </Link>
        }
      >
        chatting
      </SectionTitle>
      <ScrollRow className="mt-3" watch={threads.length}>
        {threads.map((thread) => {
          const person = thread.character;
          return (
            <Link
              key={thread.id}
              href={`/date/${person.id}`}
              className="group flex w-[16.5rem] shrink-0 items-center gap-3 rounded-2xl bg-[var(--surface)] p-2.5 ring-1 ring-white/5 transition hover:bg-[var(--surface-2)] hover:ring-[var(--accent)]/50 sm:w-72"
            >
              <span
                className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl"
                style={{ background: person.color }}
              >
                {person.image ? (
                  <img src={person.image} alt="" loading="lazy" className="h-full w-full object-cover object-top" />
                ) : null}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-bold text-[var(--ink)]">{person.name}</span>
                  <time dateTime={thread.lastMessageAt} className="shrink-0 text-[11px] text-[var(--muted)]">
                    {relativeTime(thread.lastMessageAt)}
                  </time>
                </span>
                <span className="mt-0.5 line-clamp-2 text-xs leading-[1.125rem] text-[var(--muted)]">{thread.lastPreview}</span>
              </span>
            </Link>
          );
        })}
      </ScrollRow>
    </section>
  );
}
