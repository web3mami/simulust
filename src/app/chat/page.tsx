"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { AppHeader, AppShell } from "@/components/app-shell";
import { useSession } from "@/components/auth-gate";
import { ApiError, useApi } from "@/lib/api";
import type { ThreadDTO } from "@/lib/api-types";

function relativeTime(iso: string, now = Date.now()) {
  const then = new Date(iso);
  const seconds = Math.max(0, Math.round((now - then.getTime()) / 1000));
  if (seconds < 60) return "now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return then.toLocaleDateString("en-US", { weekday: "short" });
  const sameYear = then.getFullYear() === new Date(now).getFullYear();
  return then.toLocaleDateString("en-US", sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
}

export default function ChatPage() {
  const { ready, session, openLogin } = useSession();
  const api = useApi();
  const sessionKey = session?.detail ?? null;
  const [state, setState] = useState<{ key: string; threads: ThreadDTO[] | null; error?: string } | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!sessionKey) return;
    let cancelled = false;
    void (async () => {
      try {
        const { threads } = await api<{ threads: ThreadDTO[] }>("/api/threads");
        if (!cancelled) setState({ key: sessionKey, threads });
      } catch (error) {
        if (!cancelled) {
          setState({
            key: sessionKey,
            threads: null,
            error: error instanceof ApiError ? error.message : "Couldn't load your chats. Check your connection.",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, sessionKey, retry]);

  const loaded = state && state.key === sessionKey ? state : null;

  let body: ReactNode;
  if (!ready || (sessionKey && !loaded)) {
    body = (
      <ul className="mt-6 divide-y divide-[var(--line)] border-y border-[var(--line)]" aria-label="Loading chats">
        {[0, 1, 2].map((row) => (
          <li key={row} className="flex items-center gap-3 py-3">
            <span className="h-12 w-12 shrink-0 animate-pulse rounded-full bg-[var(--bg-2)]" />
            <span className="flex-1 space-y-2">
              <span className="block h-3 w-1/3 animate-pulse rounded bg-[var(--bg-2)]" />
              <span className="block h-3 w-2/3 animate-pulse rounded bg-[var(--bg-2)]" />
            </span>
          </li>
        ))}
      </ul>
    );
  } else if (!session) {
    body = (
      <div className="mt-6 rounded-2xl border border-[var(--line)] bg-[var(--bg-2)] p-6">
        <p className="text-sm leading-6 text-[var(--muted)]">Log in to see your chats. Everyone you talk to remembers you here.</p>
        <button
          type="button"
          onClick={openLogin}
          className="mt-4 rounded-full bg-[var(--gold)] px-5 py-2 text-sm font-medium !text-[#12110F]"
        >
          Log in
        </button>
      </div>
    );
  } else if (loaded?.error || !loaded?.threads) {
    body = (
      <div className="mt-6 rounded-2xl border border-[var(--line)] bg-[var(--bg-2)] p-6">
        <p className="text-sm text-[var(--ink)]">{loaded?.error ?? "Couldn't load your chats."}</p>
        <button
          type="button"
          onClick={() => {
            setState(null);
            setRetry((count) => count + 1);
          }}
          className="mt-4 rounded-full bg-[var(--gold)] px-5 py-2 text-sm font-medium !text-[#12110F]"
        >
          Try again
        </button>
      </div>
    );
  } else if (loaded.threads.length === 0) {
    body = (
      <div className="mt-6 rounded-2xl border border-[var(--line)] bg-[var(--bg-2)] p-6">
        <p className="text-sm leading-6 text-[var(--muted)]">No chats yet. Pick someone on Discover, or create your own.</p>
        <div className="mt-4 flex gap-3">
          <Link href="/#explore" className="rounded-full bg-[var(--gold)] px-5 py-2 text-sm font-medium !text-[#12110F]">
            Discover
          </Link>
          <Link href="/create" className="rounded-full border border-[var(--line)] px-5 py-2 text-sm">
            Create
          </Link>
        </div>
      </div>
    );
  } else {
    body = (
      <ul className="mt-6 divide-y divide-[var(--line)] border-y border-[var(--line)]">
        {loaded.threads.map((thread) => {
          const person = thread.character;
          return (
            <li key={thread.id}>
              <Link href={`/date/${person.id}`} className="flex items-center gap-3 py-3">
                <span
                  className="relative h-12 w-12 shrink-0 overflow-hidden rounded-full border border-white/10"
                  style={{ background: person.color }}
                >
                  {person.image ? <img src={person.image} alt="" className="h-full w-full object-cover" /> : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-sm font-medium text-[var(--ink)]">{person.name}</span>
                    <time dateTime={thread.lastMessageAt} className="shrink-0 text-[11px] text-[var(--muted)]">
                      {relativeTime(thread.lastMessageAt)}
                    </time>
                  </span>
                  <span className="mt-0.5 line-clamp-1 text-sm text-[var(--muted)]">{thread.lastPreview}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <AppShell>
      <AppHeader />
      <section className="mx-auto w-full max-w-xl px-4 py-6">
        <h1 className="font-[family-name:var(--font-display)] text-3xl text-[var(--ink)]">Chat</h1>
        {body}
      </section>
    </AppShell>
  );
}
