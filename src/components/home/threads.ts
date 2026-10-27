"use client";

import { useEffect, useState } from "react";
import { useSession } from "@/components/auth-gate";
import { useApi } from "@/lib/api";
import type { ThreadDTO } from "@/lib/api-types";

// The signed-in user's chats, newest first, shared by every list on these
// screens (Continue chatting, "Chatting" badges, My AI's "Last chat"). Kept per
// session in memory, so coming back to a page shows them at once while a fresh
// copy loads, and two lists on one page share one request.
const cache = new Map<string, ThreadDTO[]>();
const inflight = new Map<string, Promise<ThreadDTO[]>>();

type Api = ReturnType<typeof useApi>;

function load(api: Api, key: string) {
  let request = inflight.get(key);
  if (!request) {
    request = api<{ threads: ThreadDTO[] }>("/api/threads")
      .then(({ threads }) => {
        cache.set(key, threads);
        return threads;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, request);
  }
  return request;
}

export type ThreadsState =
  // Still checking the login: nothing is known yet.
  | { status: "checking"; threads: null }
  // Signed in, first request still out.
  | { status: "loading"; threads: null }
  | { status: "signed-out"; threads: null }
  // Loaded (an empty list if it failed: these are shortcuts, never essential).
  | { status: "ready"; threads: ThreadDTO[] };

export function useThreads(): ThreadsState {
  const { ready, session } = useSession();
  const api = useApi();
  const key = session?.detail ?? null;
  const [loaded, setLoaded] = useState<{ key: string; threads: ThreadDTO[] } | null>(null);

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    load(api, key)
      .then((threads) => {
        if (!cancelled) setLoaded({ key, threads });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ key, threads: cache.get(key) ?? [] });
      });
    return () => {
      cancelled = true;
    };
  }, [api, key]);

  if (!ready) return { status: "checking", threads: null };
  if (!key) return { status: "signed-out", threads: null };
  const threads = loaded?.key === key ? loaded.threads : cache.get(key);
  return threads ? { status: "ready", threads } : { status: "loading", threads: null };
}

// Character id → their thread, for badges and "Last chat" lines.
export function threadsByCharacter(threads: ThreadDTO[] | null) {
  return new Map((threads ?? []).map((thread) => [thread.character.id, thread]));
}
