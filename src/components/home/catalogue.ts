"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "@/components/auth-gate";
import { ApiError, useApi } from "@/lib/api";
import type { CharacterDTO } from "@/lib/api-types";
import { SEED_CHARACTERS, laneOf, type Character, type Lane } from "@/lib/characters";

// GET /api/characters returns the official characters and the user's own in one
// list; `own` marks the user's.

export function isOwnCharacter(person: Pick<Character, "own">) {
  return person.own === true;
}

const SEED_INDEX = new Map(SEED_CHARACTERS.map((person, index) => [person.id, index]));

function seededShuffle<T>(items: T[], seed: number): T[] {
  const copy = [...items];
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  const rand = () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

const LANE_SHUFFLE: Record<Lane, number> = { girls: 11, anime: 42, guys: 77 };

// The official characters of a lane in a fixed "featured" order. The API sends
// seeds in insert order, which can tie, so they're put back in seed order
// first; that way the list doesn't reshuffle when the API answers.
export function featuredIn<T extends Character>(people: T[], lane: Lane): T[] {
  const official = people
    .filter((person) => !isOwnCharacter(person) && laneOf(person) === lane)
    .sort((a, b) => (SEED_INDEX.get(a.id) ?? Infinity) - (SEED_INDEX.get(b.id) ?? Infinity));
  return seededShuffle(official, LANE_SHUFFLE[lane]);
}

export function matchesQuery(person: Character, query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [
    person.name,
    person.role,
    person.body,
    person.heat,
    person.ethnicity,
    person.occupation,
    person.personality,
    ...(person.tags ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(needle);
}

// Tags in the list, most common first.
export function tagsOf(people: Character[]) {
  const counts = new Map<string, number>();
  for (const person of people) {
    for (const tag of person.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([tag]) => tag);
}

type Loaded = { key: string | null; characters: CharacterDTO[] | null; error?: string };

// Everyone the current user can see. Until the API answers (or if it fails),
// the official seeds stand in so the page never renders empty.
export function useCatalogue() {
  const { ready, session } = useSession();
  const api = useApi();
  const key = session?.detail ?? null;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [removed, setRemoved] = useState<string[]>([]);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    void (async () => {
      try {
        const { characters } = await api<{ characters: CharacterDTO[] }>("/api/characters");
        if (!cancelled) setLoaded({ key, characters });
      } catch (error) {
        if (!cancelled) {
          setLoaded({
            key,
            characters: null,
            error: error instanceof ApiError ? error.message : "Couldn't load characters. Check your connection.",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, ready, key, attempt]);

  const current = loaded && loaded.key === key ? loaded : null;
  const characters = useMemo(
    () => (current?.characters ?? SEED_CHARACTERS).filter((person) => !removed.includes(person.id)),
    [current, removed],
  );
  const status: "loading" | "ready" | "error" = !ready || !current ? "loading" : current.characters ? "ready" : "error";

  const retry = useCallback(() => {
    setLoaded(null);
    setAttempt((count) => count + 1);
  }, []);
  const remove = useCallback((id: string) => setRemoved((ids) => [...ids, id]), []);

  return { characters, status, error: current?.error, retry, remove };
}

export function relativeTime(iso: string, now = Date.now()) {
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
  return then.toLocaleDateString(
    "en-US",
    sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" },
  );
}

// Page content width and gutters, the same on every screen in this area.
export const PAGE = "mx-auto w-full max-w-[1600px] px-4 sm:px-6 lg:px-8";
