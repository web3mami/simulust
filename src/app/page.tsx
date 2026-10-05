"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AppHeader, AppShell } from "@/components/app-shell";
import {
  SEED_CHARACTERS,
  laneOf,
  type Character,
  type Lane,
} from "@/lib/characters";

const LANES: { id: Lane; label: string; title: string; blurb: string }[] = [
  {
    id: "girls",
    label: "Girls",
    title: "Explore AI girls",
    blurb: "Realistic women. You pick the body, the pace, and how filthy it gets.",
  },
  {
    id: "anime",
    label: "Anime",
    title: "Explore AI anime",
    blurb: "Drawn faces, adult characters. Same dating loop, different look.",
  },
  {
    id: "guys",
    label: "Guys",
    title: "Explore AI guys",
    blurb: "Realistic men. Boyfriend, stranger, or someone who runs the night.",
  },
];

const HERO_PAIR: Record<Lane, string> = {
  girls: "/hero/hero-girls-maid.jpg",
  anime: "/hero/hero-anime-wet.jpg",
  guys: "/hero/hero-guys-thirst.jpg",
};

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

function Portrait({ person }: { person: Character }) {
  return (
    <Link
      href={`/date/${person.id}`}
      className="group relative block aspect-[3/4] overflow-hidden rounded-2xl border border-white/10"
      style={{ background: person.color }}
    >
      {person.image ? (
        <img
          src={person.image}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : null}
      <div className="absolute inset-x-0 bottom-0 bg-black/55 p-3">
        <p className="text-base font-semibold text-white">
          {person.name}, {person.age}
        </p>
        <p className="mt-0.5 text-xs text-white/75">
          {person.role} · {person.body}
        </p>
      </div>
    </Link>
  );
}

export default function HomePage() {
  const [lane, setLane] = useState<Lane>("anime");
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState("All");

  const inLane = useMemo(
    () =>
      seededShuffle(
        SEED_CHARACTERS.filter((person) => laneOf(person) === lane),
        LANE_SHUFFLE[lane],
      ),
    [lane],
  );

  const active = LANES.find((item) => item.id === lane) ?? LANES[0];

  const tags = useMemo(() => {
    const unique = new Set<string>();
    for (const person of inLane) {
      for (const item of person.tags ?? []) unique.add(item);
    }
    return ["All", ...unique];
  }, [inLane]);

  const visible = inLane.filter((person) => {
    const matchesTag = tag === "All" || (person.tags ?? []).includes(tag);
    const haystack = `${person.name} ${person.role} ${person.body} ${person.heat}`.toLowerCase();
    const matchesQuery = haystack.includes(query.trim().toLowerCase());
    return matchesTag && matchesQuery;
  });

  function selectLane(next: Lane) {
    setLane(next);
    setTag("All");
    setQuery("");
  }

  return (
    <AppShell>
      <div className="flex h-[calc(100dvh-4rem)] flex-col lg:h-dvh">
        <AppHeader
          center={LANES.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => selectLane(item.id)}
              className={`border-b-2 pb-2 text-sm ${
                lane === item.id
                  ? "border-[var(--gold)] text-[var(--ink)]"
                  : "border-transparent text-[var(--muted)]"
              }`}
            >
              {item.label}
            </button>
          ))}
        />

        <section className="relative min-h-0 flex-1 overflow-hidden bg-[var(--bg)]">
          <img
            src={HERO_PAIR[lane]}
            alt=""
            aria-hidden
            className="absolute inset-0 h-full w-full object-cover object-right"
          />
          <img
            src={HERO_PAIR[lane]}
            alt=""
            className="absolute right-0 top-0 h-full w-auto max-w-none"
            style={{
              WebkitMaskImage:
                "linear-gradient(to right, transparent, #000 11rem)",
              maskImage: "linear-gradient(to right, transparent, #000 11rem)",
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-r from-[#12110F]/45 via-[#12110F]/12 via-[38%] to-transparent to-[72%]" />
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_60%_at_18%_28%,rgba(198,161,91,0.12),transparent_55%)]" />
          <div className="relative z-10 flex h-full flex-col justify-start px-6 pt-5 sm:px-10 sm:pt-6 lg:px-12 lg:pt-8">
            <div className="max-w-lg">
              <h1 className="font-[family-name:var(--font-display)] text-3xl font-medium leading-[1.15] tracking-tight text-[var(--ink)] sm:text-4xl">
                Meet an AI that <span className="text-[var(--gold)]">actually</span> remembers you.
              </h1>
              <p className="mt-4 text-sm leading-6 text-[var(--muted)] sm:text-base">
                Create your own character, give them a personality, and build a conversation that evolves over time.
              </p>
              <Link
                href="/create"
                className="mt-6 inline-block rounded-full bg-[var(--gold)] px-6 py-2.5 text-sm font-medium !text-[#12110F]"
              >
                Create one
              </Link>
            </div>
          </div>
        </section>
      </div>

      <div className="px-6 pb-10 sm:px-10 lg:px-12">
        <section id="explore">
          <h2 className="text-2xl font-semibold">{active.title}</h2>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search"
              className="w-full rounded-full border border-white/10 bg-white/5 px-4 py-2.5 text-sm sm:max-w-xs"
            />
            <div className="flex flex-wrap gap-2">
              {tags.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setTag(item)}
                  className={`shrink-0 rounded-full px-3 py-1.5 text-sm ${
                    tag === item
                      ? "bg-white text-black"
                      : "border border-white/10 text-white/80"
                  }`}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
            {visible.map((person) => (
              <Portrait key={person.id} person={person} />
            ))}
          </div>
          {visible.length === 0 ? (
            <p className="mt-8 text-sm text-[var(--muted)]">
              Nobody matches that search.
            </p>
          ) : null}
        </section>
      </div>
    </AppShell>
  );
}
