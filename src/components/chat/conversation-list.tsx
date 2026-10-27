"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useSession } from "@/components/auth-gate";
import { Avatar } from "@/components/chat/avatar";
import { relativeTime } from "@/components/chat/format";
import { CameraIcon, CloseIcon, SearchIcon } from "@/components/icons";
import { Button, cx, Skeleton } from "@/components/ui";
import { ApiError, useApi } from "@/lib/api";
import type { CharacterDTO, ThreadDTO } from "@/lib/api-types";

type Row = { person: CharacterDTO; preview: string; at: string | null };

// Every chat page mounts its own list, so the last answer is kept here: a
// remount (switching chats) draws the rows at once and refreshes them quietly.
let threadCache: { key: string; threads: ThreadDTO[] } | null = null;

// Characters seen in the list, so a conversation can draw its header and
// profile on the first frame instead of waiting for its own fetch.
const characterCache = new Map<string, CharacterDTO>();

export function rememberCharacter(sessionKey: string, character: CharacterDTO) {
  characterCache.set(`${sessionKey}:${character.id}`, character);
}

export function recallCharacter(sessionKey: string, id: string) {
  return characterCache.get(`${sessionKey}:${id}`) ?? null;
}

// The list of conversations: search, then one row per character with the last
// message and when it was sent. Loads GET /api/threads, and again whenever
// refreshKey changes (after a reply arrives, so previews stay current).
export function ConversationList({
  activeId,
  current,
  refreshKey = 0,
  onLoaded,
  as: Heading = "h2",
}: {
  activeId?: string;
  // The open character, listed first even before the first message is sent.
  current?: CharacterDTO | null;
  refreshKey?: number;
  // Called with the threads once they load, or null if loading failed.
  onLoaded?: (threads: ThreadDTO[] | null) => void;
  as?: "h1" | "h2";
}) {
  const { ready, session, openLogin } = useSession();
  const api = useApi();
  const sessionKey = session?.detail ?? null;
  const [state, setState] = useState<{ key: string; threads: ThreadDTO[] | null; error?: string } | null>(() =>
    threadCache && threadCache.key === sessionKey ? threadCache : null,
  );
  const [retry, setRetry] = useState(0);
  const [query, setQuery] = useState("");

  const onLoadedRef = useRef(onLoaded);
  useEffect(() => {
    onLoadedRef.current = onLoaded;
  });

  // Rows from the cache count as loaded, so the page can act on them now.
  useEffect(() => {
    if (threadCache && threadCache.key === sessionKey) onLoadedRef.current?.(threadCache.threads);
  }, [sessionKey]);

  useEffect(() => {
    if (!sessionKey) return;
    let cancelled = false;
    void (async () => {
      try {
        const { threads } = await api<{ threads: ThreadDTO[] }>("/api/threads");
        if (cancelled) return;
        threadCache = { key: sessionKey, threads };
        for (const thread of threads) rememberCharacter(sessionKey, thread.character);
        setState({ key: sessionKey, threads });
        onLoadedRef.current?.(threads);
      } catch (error) {
        // A failed refresh keeps the rows we already have.
        if (cancelled || threadCache?.key === sessionKey) return;
        setState({
          key: sessionKey,
          threads: null,
          error: error instanceof ApiError ? error.message : "Couldn't load your chats. Check your connection.",
        });
        onLoadedRef.current?.(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, sessionKey, retry, refreshKey]);

  const loaded = state && state.key === sessionKey ? state : null;

  const rows: Row[] = (loaded?.threads ?? []).map((thread) => ({
    person: thread.character,
    preview: thread.lastPreview,
    at: thread.lastMessageAt,
  }));
  if (loaded?.threads && current && !rows.some((row) => row.person.id === current.id)) {
    rows.unshift({ person: current, preview: "New chat", at: null });
  }
  const searchable = Boolean(session && loaded?.threads && rows.length > 0);

  let body: ReactNode;
  if (!ready || (sessionKey && !loaded)) {
    body = (
      <ul className="flex flex-col gap-0.5 px-2" aria-label="Loading chats">
        {[0, 1, 2, 3].map((row) => (
          <li key={row} className="flex items-center gap-3 px-3 py-2.5">
            <Skeleton className="h-12 w-12 shrink-0 rounded-full" />
            <span className="flex-1 space-y-2">
              <Skeleton className="h-3 w-1/3 rounded" />
              <Skeleton className="h-3 w-2/3 rounded" />
            </span>
          </li>
        ))}
      </ul>
    );
  } else if (!session) {
    body = (
      <Notice>
        <p>Log in to see your chats. Everyone you talk to remembers you here.</p>
        <Button className="mt-4" onClick={openLogin}>
          Log in
        </Button>
      </Notice>
    );
  } else if (loaded?.error || !loaded?.threads) {
    body = (
      <Notice>
        <p className="text-[var(--ink)]">{loaded?.error ?? "Couldn't load your chats."}</p>
        <Button
          className="mt-4"
          onClick={() => {
            setState(null);
            setRetry((count) => count + 1);
          }}
        >
          Try again
        </Button>
      </Notice>
    );
  } else if (rows.length === 0) {
    body = (
      <Notice>
        <p className="font-semibold text-[var(--ink)]">No chats yet</p>
        <p className="mt-1">Your conversations will show up here.</p>
      </Notice>
    );
  } else {
    const needle = query.trim().toLowerCase();
    const shown = needle
      ? rows.filter((row) => row.person.name.toLowerCase().includes(needle) || row.preview.toLowerCase().includes(needle))
      : rows;
    body =
      shown.length === 0 ? (
        <Notice>No chats match &ldquo;{query.trim()}&rdquo;.</Notice>
      ) : (
        <ul className="flex flex-col gap-0.5 px-2 pb-4">
          {shown.map((row) => {
            const active = row.person.id === activeId;
            const photo = row.preview.startsWith("Photo:");
            return (
              <li key={row.person.id}>
                <Link
                  href={`/date/${encodeURIComponent(row.person.id)}`}
                  aria-current={active ? "page" : undefined}
                  className={cx(
                    "relative flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors",
                    active ? "bg-[var(--surface-2)]" : "hover:bg-white/5 active:bg-white/5",
                  )}
                >
                  {active ? <span className="absolute inset-y-3 left-0 w-1 rounded-full bg-[var(--accent)]" aria-hidden /> : null}
                  <Avatar person={row.person} size="lg" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-sm font-semibold text-[var(--ink)]">{row.person.name}</span>
                      {row.at ? (
                        <time dateTime={row.at} className="shrink-0 text-[11px] text-[var(--muted)]">
                          {relativeTime(row.at)}
                        </time>
                      ) : null}
                    </span>
                    <span
                      className={cx(
                        "mt-0.5 flex items-center gap-1 text-[13px]",
                        row.at ? "text-[var(--muted)]" : "font-medium text-[var(--accent)]",
                      )}
                    >
                      {photo ? <CameraIcon className="h-3.5 w-3.5 shrink-0" /> : null}
                      <span className="line-clamp-1">{photo ? row.preview.slice("Photo:".length).trim() || "Photo" : row.preview}</span>
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      );
  }

  return (
    <div className="flex flex-col lg:h-full lg:min-h-0">
      <div className="px-4 pb-3 pt-5 lg:pt-4">
        <Heading className="text-2xl font-bold tracking-tight text-[var(--ink)] lg:text-xl">
          <span className="text-[var(--accent)]">My</span> Chats
        </Heading>
        {searchable ? (
          <label className="relative mt-3 block">
            <span className="sr-only">Search chats</span>
            <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search"
              className="h-10 w-full rounded-full border border-[var(--line)] bg-[var(--surface)] pl-10 pr-10 text-sm text-[var(--ink)] outline-none placeholder:text-[var(--muted)] focus:border-[var(--accent)] [&::-webkit-search-cancel-button]:hidden"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="absolute right-0 top-0 flex h-10 w-10 items-center justify-center rounded-full text-[var(--muted)] hover:text-[var(--ink)]"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            ) : null}
          </label>
        ) : null}
      </div>
      <div className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto">{body}</div>
    </div>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="mx-4 mb-4 rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-5 py-6 text-center text-sm leading-6 text-[var(--muted)]">
      {children}
    </div>
  );
}
