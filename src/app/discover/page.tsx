"use client";

import { useMemo, useState } from "react";
import { AppShell, useLane } from "@/components/app-shell";
import { Badge, Button, EmptyState, PageHeader } from "@/components/ui";
import { CharacterGrid, SearchField, TagChips } from "@/components/home/browse";
import { LaneChips } from "@/components/home/lane-chips";
import { PAGE, featuredIn, isOwnCharacter, matchesQuery, tagsOf, useCatalogue } from "@/components/home/catalogue";
import { laneOf, type Character, type Lane } from "@/lib/characters";

type Sort = "popular" | "newest" | "age";

const SORTS: { id: Sort; label: string }[] = [
  { id: "popular", label: "Popular" },
  { id: "newest", label: "Newest" },
  { id: "age", label: "Age" },
];

// Popular is the featured order with the user's own characters after it.
// Newest puts their own first (latest made first), then the newest official
// ones. Age goes youngest to oldest; every character is an adult.
function sorted(people: Character[], lane: Lane, sort: Sort) {
  const official = featuredIn(people, lane);
  const own = people.filter((person) => isOwnCharacter(person) && laneOf(person) === lane);
  if (sort === "popular") return [...official, ...own];
  const officialNewest = people.filter((person) => !isOwnCharacter(person) && laneOf(person) === lane).reverse();
  if (sort === "newest") return [...[...own].reverse(), ...officialNewest];
  return [...official, ...own].sort((a, b) => a.age - b.age || a.name.localeCompare(b.name));
}

function Discover() {
  const { lane } = useLane();
  const { characters } = useCatalogue();
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState("All");
  const [sort, setSort] = useState<Sort>("popular");

  const inLane = useMemo(() => sorted(characters, lane, sort), [characters, lane, sort]);
  const tags = useMemo(() => tagsOf(inLane), [inLane]);
  const activeTag = tag === "All" || tags.includes(tag) ? tag : "All";
  const visible = inLane.filter(
    (person) => (activeTag === "All" || (person.tags ?? []).includes(activeTag)) && matchesQuery(person, query),
  );
  const filtered = query.trim() !== "" || activeTag !== "All";

  return (
    <div className={`${PAGE} flex flex-col gap-5 pb-10 pt-6 sm:pt-8`}>
      <PageHeader
        accent="Discover"
        title="AI Characters"
        subtitle="Everyone you can chat with, including the characters you made. Every character is a fictional adult."
      />

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <LaneChips onPick={() => setTag("All")} />
          <div className="flex flex-1 gap-2 lg:justify-end">
            <SearchField value={query} onChange={setQuery} placeholder="Search characters" className="min-w-0 flex-1 lg:max-w-sm" />
            <label className="relative shrink-0">
              <span className="sr-only">Sort by</span>
              <select
                value={sort}
                onChange={(event) => setSort(event.target.value as Sort)}
                className="h-10 appearance-none rounded-full border border-[var(--line)] bg-[var(--surface)] pl-4 pr-9 text-sm font-medium text-[var(--ink)] outline-none focus:border-[var(--accent)]"
              >
                {SORTS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
              <svg
                viewBox="0 0 24 24"
                aria-hidden
                className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </label>
          </div>
        </div>
        <TagChips tags={tags} value={activeTag} onChange={setTag} />
      </div>

      <p className="text-sm text-[var(--muted)]" aria-live="polite">
        {visible.length === 1 ? "1 character" : `${visible.length} characters`}
        {filtered ? " match" : ""}
      </p>

      {visible.length > 0 ? (
        <CharacterGrid
          people={visible}
          label="Characters"
          badge={(person) => (isOwnCharacter(person) ? <Badge>Yours</Badge> : null)}
        />
      ) : (
        <EmptyState
          title={filtered ? "Nobody matches that search" : "No characters here yet"}
          body={filtered ? "Try another word or tag, or switch between Girls, Anime and Guys." : "Pick another tab, or create your own."}
          action={
            filtered ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setQuery("");
                  setTag("All");
                }}
              >
                Clear filters
              </Button>
            ) : null
          }
        />
      )}
    </div>
  );
}

export default function DiscoverPage() {
  return (
    <AppShell>
      <Discover />
    </AppShell>
  );
}
