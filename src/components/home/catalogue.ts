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

// Tags in the list, most common first. Only official characters count: a
// user's own character carries its hair and eye colours as tags, which would
// read as odd public filters ("Black", "Brown"). A tag on just one person
// isn't much of a filter either.
export function tagsOf(people: Character[], minCount = 2) {
  const counts = new Map<string, number>();
  for (const person of people) {
    if (isOwnCharacter(person)) continue;
    for (const tag of person.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= minCount)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tag]) => tag);
}

type Loaded = { key: string | null; characters: CharacterDTO[] | null; error?: string };

// The last good answer, so moving between Home, Discover and My AI renders the
// real list at once (and refreshes it behind the scenes) instead of flashing
// the seeds and swapping.
let lastLoaded: Loaded | null = null;

// Everyone the current user can see. Until the API answers (or if it fails),
// the official seeds stand in so the page never renders empty.
export function useCatalogue() {
  const { ready, session } = useSession();
  const api = useApi();
  const key = session?.detail ?? null;
  const [loaded, setLoaded] = useState<Loaded | null>(() => lastLoaded);
  const [attempt, setAttempt] = useState(0);
  const [removed, setRemoved] = useState<string[]>([]);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    void (async () => {
      try {
        const { characters } = await api<{ characters: CharacterDTO[] }>("/api/characters");
        lastLoaded = { key, characters };
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
  const remove = useCallback((id: string) => {
    if (lastLoaded?.characters) {
      lastLoaded = { ...lastLoaded, characters: lastLoaded.characters.filter((person) => person.id !== id) };
    }
    setRemoved((ids) => [...ids, id]);
  }, []);

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

// The vertical rhythm of an inner page (Discover, My AI, Collection), so the
// header doesn't jump when moving between them.
export const PAGE_STACK = "flex flex-col gap-6 pb-12 pt-5 sm:gap-8 sm:pt-8";

export const LANE_NOUN: Record<Lane, string> = { girls: "AI girls", anime: "anime characters", guys: "AI guys" };
export const LANE_LABEL: Record<Lane, string> = { girls: "Girls", anime: "Anime", guys: "Guys" };
export const LANES: Lane[] = ["girls", "anime", "guys"];

export function parseLane(value: string | null | undefined): Lane | null {
  return value === "girls" || value === "anime" || value === "guys" ? value : null;
}

// ---------------------------------------------------------------------------
// Themes: the rows on Home and the "See all" filters on Discover. Each is a
// rule over fields every character really has, so a row only ever shows people
// who fit it.

export type Theme = {
  id: string;
  // Short name for a filter pill; the row title is accent + title.
  label: string;
  accent: string;
  title: string;
  match: (person: Character) => boolean;
};

const hasTag = (person: Character, ...tags: string[]) => (person.tags ?? []).some((tag) => tags.includes(tag));

export const THEMES: Theme[] = [
  {
    id: "romance",
    label: "Romance",
    accent: "Romance",
    title: "and devotion",
    match: (p) => ["Girlfriend", "Boyfriend", "Wife", "Husband", "Exclusive"].includes(p.role),
  },
  {
    id: "fantasy",
    label: "Fantasy",
    accent: "Fantasy",
    title: "and otherworldly",
    match: (p) => hasTag(p, "Devil", "Fantasy", "Robot", "Goth"),
  },
  {
    id: "dominant",
    label: "Dominant",
    accent: "Dominant",
    title: "and in charge",
    match: (p) => p.role === "Dominant" || hasTag(p, "Dominant"),
  },
  { id: "curvy", label: "Curvy & thick", accent: "Curvy", title: "and thick", match: (p) => p.body === "Curvy" || p.body === "Thick" },
  { id: "busty", label: "Busty", accent: "Busty", title: "and bold", match: (p) => hasTag(p, "Busty") },
  { id: "strangers", label: "Strangers", accent: "Strangers", title: "you just met", match: (p) => p.role === "Stranger" },
  {
    id: "built",
    label: "Athletic",
    accent: "Athletic",
    title: "and built",
    match: (p) => p.body === "Athletic" || p.body === "Muscular",
  },
  {
    id: "casual",
    label: "No strings",
    accent: "No strings",
    title: "attached",
    match: (p) => p.role === "Friends with benefits" || p.role === "Situationship",
  },
];

export function themeById(id: string | null | undefined) {
  return THEMES.find((theme) => theme.id === id) ?? null;
}

// A row needs enough people to be worth scrolling.
export const MIN_ROW = 4;

// Home shows a few themed rows, not all of them: a lane has about 25 people, so
// every extra row mostly repeats faces. The rest are a filter away on Discover.
export const HOME_ROWS = 4;

// The themes a lane has enough people for, each with its people in featured
// order. Picked one at a time by how many faces they add that earlier rows
// haven't shown, so the rows feel different from each other.
export function themedRows<T extends Character>(featured: T[], limit = HOME_ROWS) {
  const candidates = THEMES.map((theme) => ({ theme, people: featured.filter(theme.match) })).filter(
    (row) => row.people.length >= MIN_ROW,
  );
  const shown = new Set<string>();
  const picked: typeof candidates = [];
  while (picked.length < limit && candidates.length) {
    let best = 0;
    let bestNew = -1;
    candidates.forEach((row, index) => {
      const fresh = row.people.filter((person) => !shown.has(person.id)).length;
      if (fresh > bestNew) [best, bestNew] = [index, fresh];
    });
    if (bestNew < 2) break;
    const [row] = candidates.splice(best, 1);
    row.people.forEach((person) => shown.add(person.id));
    picked.push(row);
  }
  // Back in THEMES order, so the page reads the same way on every visit.
  return picked.sort((a, b) => THEMES.indexOf(a.theme) - THEMES.indexOf(b.theme));
}

// A link into Discover with only the filters that are set.
export function discoverHref(filters: { lane?: Lane; theme?: string; tag?: string; q?: string }) {
  const params = new URLSearchParams();
  if (filters.lane) params.set("lane", filters.lane);
  if (filters.theme) params.set("theme", filters.theme);
  if (filters.tag && filters.tag !== "All") params.set("tag", filters.tag);
  if (filters.q?.trim()) params.set("q", filters.q.trim());
  const query = params.toString();
  return query ? `/discover?${query}` : "/discover";
}
