"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useLane } from "@/components/app-shell";
import { ChevronRightIcon, PlusIcon } from "@/components/icons";
import { Badge, Button, EmptyState, buttonClass, cx } from "@/components/ui";
import { CharacterRow, GRID, Reveal, RowTitle, SearchField, TagChips } from "@/components/home/browse";
import {
  LANE_LABEL,
  LANE_NOUN,
  LANES,
  PAGE,
  discoverHref,
  featuredIn,
  isOwnCharacter,
  matchesQuery,
  tagsOf,
  themedRows,
  useCatalogue,
} from "@/components/home/catalogue";
import { ContinueChatting } from "@/components/home/continue-chatting";
import { HeroCarousel } from "@/components/home/hero-carousel";
import { CreatePromo, Faq, HomeFooter, HowItWorks } from "@/components/home/home-sections";
import { PortraitCard } from "@/components/home/portrait-card";
import { threadsByCharacter, useThreads } from "@/components/home/threads";
import { laneOf, type Character, type Lane } from "@/lib/characters";

// Characters in the hero. The grid below starts after them, so nobody shows twice.
const HERO_COUNT = 3;
// Two rows at every width (2 → 6 columns), so Home stays a sampler and
// Discover holds the full list. Past each cap a card is hidden by breakpoint.
const GRID_MAX = 12;
const HIDE_FROM: [number, string][] = [
  [10, "2xl:block"],
  [8, "xl:block"],
  [6, "md:block"],
];

function gridItemClass(index: number) {
  for (const [from, show] of HIDE_FROM) if (index >= from) return cx("hidden", show);
  return undefined;
}

// A "create" tile that sits at the front of the Made by you row.
function CreateTile() {
  return (
    <Link
      href="/create"
      className="group flex aspect-[3/4] flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-[var(--accent)]/40 bg-[var(--accent-soft)] p-4 text-center outline-none transition hover:border-[var(--accent)] hover:bg-[var(--accent)]/20 focus-visible:border-[var(--accent)]"
    >
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--accent-ink)] shadow-[0_8px_24px_rgba(255,79,139,0.4)] transition group-hover:scale-105">
        <PlusIcon className="h-6 w-6" />
      </span>
      <span className="text-sm font-bold text-[var(--ink)]">Create new</span>
    </Link>
  );
}

export function Home() {
  // The Girls / Anime / Guys tabs in the top bar choose the lane.
  const { lane } = useLane();
  const { characters } = useCatalogue();
  const { threads } = useThreads();
  const chatting = useMemo(() => threadsByCharacter(threads), [threads]);
  const [filters, setFilters] = useState<{ lane: Lane; query: string; tag: string }>({ lane, query: "", tag: "All" });
  // A new lane starts with a clean search.
  const { query, tag } = filters.lane === lane ? filters : { query: "", tag: "All" };
  const setQuery = (value: string) => setFilters({ lane, query: value, tag });
  const setTag = (value: string) => setFilters({ lane, query, tag: value });

  const featured = useMemo(() => featuredIn(characters, lane), [characters, lane]);
  const tags = useMemo(() => tagsOf(featured), [featured]);
  const rows = useMemo(() => themedRows(featured), [featured]);
  const own = useMemo(() => characters.filter(isOwnCharacter), [characters]);
  const filtering = query.trim() !== "" || tag !== "All";
  // Unfiltered, the grid skips the hero's people; a search covers everyone.
  const matches = (filtering ? featured : featured.slice(HERO_COUNT)).filter(
    (person) => (tag === "All" || (person.tags ?? []).includes(tag)) && matchesQuery(person, query),
  );
  // What Discover will show for the same filters: it lists the user's own
  // characters in this lane too.
  const ownMatches = own.filter(
    (person) =>
      laneOf(person) === lane && (tag === "All" || (person.tags ?? []).includes(tag)) && matchesQuery(person, query),
  );
  const total = (filtering ? matches.length : featured.length) + ownMatches.length;

  const badge = (person: Character) =>
    chatting.has(person.id) ? <Badge tone="muted">Chatting</Badge> : null;

  const row = (index: number) => {
    const item = rows[index];
    if (!item) return null;
    return (
      <CharacterRow
        key={item.theme.id}
        id={`row-${item.theme.id}`}
        accent={item.theme.accent}
        title={item.theme.title}
        people={item.people}
        href={discoverHref({ lane, theme: item.theme.id })}
        linkHint={item.theme.label}
        badge={badge}
      />
    );
  };

  return (
    <div className={cx(PAGE, "flex flex-col gap-10 pb-12 pt-4 sm:gap-14 sm:pt-6")}>
      <h1 className="sr-only">AI girlfriends, anime characters and AI boyfriends who remember you</h1>
      <HeroCarousel key={lane} lane={lane} people={featured.slice(0, HERO_COUNT)} />

      <ContinueChatting />

      <section id="explore" aria-labelledby="explore-title" className="scroll-mt-20">
        <RowTitle id="explore-title" accent="Explore" href={discoverHref({ lane })} linkHint={LANE_NOUN[lane]}>
          <span className="sm:hidden">characters</span>
          <span className="hidden sm:inline">Featured Characters</span>
        </RowTitle>
        <div className="mt-3 flex flex-col gap-3 sm:mt-4 md:flex-row md:items-center">
          <SearchField value={query} onChange={setQuery} placeholder={`Search ${LANE_NOUN[lane]}`} className="md:w-72 md:shrink-0" />
          <TagChips tags={tags} value={tag} onChange={setTag} className="md:flex-1" />
        </div>

        <div className="mt-4 sm:mt-5">
          {matches.length > 0 ? (
            <>
              <ul className={GRID} aria-label={`Featured ${LANE_NOUN[lane]}`}>
                {matches.slice(0, GRID_MAX).map((person, index) => (
                  <li key={person.id} className={gridItemClass(index)}>
                    <PortraitCard person={person} badge={badge(person)} />
                  </li>
                ))}
              </ul>
              <Link
                href={discoverHref({ lane, tag, q: query })}
                className={buttonClass("secondary", "lg", "mt-5 w-full hover:border-white/20 sm:mt-6")}
              >
                {filtering ? `See all ${total} ${total === 1 ? "match" : "matches"}` : `See all ${total} ${LANE_NOUN[lane]}`}
                <ChevronRightIcon className="h-4 w-4" />
              </Link>
            </>
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

      {row(0)}
      {row(1)}

      <CreatePromo lane={lane} />

      {own.length > 0 ? (
        <CharacterRow
          id="row-yours"
          accent="Made"
          title="by you"
          people={own}
          href="/my-ai"
          linkLabel="My AI"
          badge={() => <Badge tone="muted">Yours</Badge>}
          lead={<CreateTile />}
        />
      ) : null}

      {rows.slice(2).map((_, index) => row(index + 2))}

      {LANES.filter((other) => other !== lane).map((other) => (
        <CharacterRow
          key={other}
          id={`row-lane-${other}`}
          accent={LANE_LABEL[other]}
          title="you might like"
          people={featuredIn(characters, other).slice(0, 10)}
          href={discoverHref({ lane: other })}
          linkHint={LANE_NOUN[other]}
          badge={badge}
        />
      ))}

      <HowItWorks />
      <Faq />
      <Reveal>
        <HomeFooter />
      </Reveal>
    </div>
  );
}
