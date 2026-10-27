"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AppShell, useLane } from "@/components/app-shell";
import { ChevronRightIcon } from "@/components/icons";
import { Button, EmptyState, SectionTitle } from "@/components/ui";
import { CharacterGrid, SearchField, TagChips } from "@/components/home/browse";
import { PAGE, featuredIn, matchesQuery, tagsOf, useCatalogue } from "@/components/home/catalogue";
import { ContinueChatting } from "@/components/home/continue-chatting";
import { HeroCarousel } from "@/components/home/hero-carousel";
import type { Lane } from "@/lib/characters";

const LANE_NOUN: Record<Lane, string> = { girls: "AI girls", anime: "anime characters", guys: "AI guys" };

function Home() {
  // The Girls / Anime / Guys tabs in the top bar choose the lane.
  const { lane } = useLane();
  const { characters } = useCatalogue();
  const [filters, setFilters] = useState<{ lane: Lane; query: string; tag: string }>({ lane, query: "", tag: "All" });
  // A new lane starts with a clean search.
  const { query, tag } = filters.lane === lane ? filters : { query: "", tag: "All" };
  const setQuery = (value: string) => setFilters({ lane, query: value, tag });
  const setTag = (value: string) => setFilters({ lane, query, tag: value });

  const featured = useMemo(() => featuredIn(characters, lane), [characters, lane]);
  const tags = useMemo(() => tagsOf(featured), [featured]);
  const visible = featured.filter(
    (person) => (tag === "All" || (person.tags ?? []).includes(tag)) && matchesQuery(person, query),
  );

  return (
    <div className={`${PAGE} flex flex-col gap-8 pb-10 pt-4 sm:gap-10 sm:pt-6`}>
      <HeroCarousel key={lane} lane={lane} people={featured.slice(0, 4)} />

      <ContinueChatting />

      <section id="explore" aria-label="Explore featured characters" className="scroll-mt-20">
        <SectionTitle
          accent="Explore"
          action={
            <Link
              href="/discover"
              className="flex h-10 shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-3 text-sm font-semibold text-[var(--muted)] hover:bg-white/5 hover:text-[var(--ink)]"
            >
              See all
              <ChevronRightIcon className="h-4 w-4" />
            </Link>
          }
        >
          Featured Characters
        </SectionTitle>
        <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center">
          <SearchField value={query} onChange={setQuery} placeholder={`Search ${LANE_NOUN[lane]}`} className="md:w-72 md:shrink-0" />
          <TagChips tags={tags} value={tag} onChange={setTag} className="md:flex-1" />
        </div>

        <div className="mt-5">
          {visible.length > 0 ? (
            <CharacterGrid people={visible} label={`Featured ${LANE_NOUN[lane]}`} />
          ) : (
            <EmptyState
              title="Nobody matches that search"
              body="Try another word or tag, or browse everyone on Discover."
              action={
                <Button variant="secondary" onClick={() => setFilters({ lane, query: "", tag: "All" })}>
                  Clear filters
                </Button>
              }
            />
          )}
        </div>
      </section>
    </div>
  );
}

export default function HomePage() {
  return (
    <AppShell>
      <Home />
    </AppShell>
  );
}
