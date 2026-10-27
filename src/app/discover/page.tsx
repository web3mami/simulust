"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShell, useLane } from "@/components/app-shell";
import { ChevronDownIcon, CloseIcon } from "@/components/icons";
import { Badge, Button, EmptyState, PageHeader, cx } from "@/components/ui";
import { CharacterGrid, FOCUS_RING, GridSkeleton, SearchField, TagChips } from "@/components/home/browse";
import { LaneChips } from "@/components/home/lane-chips";
import {
  LANE_LABEL,
  LANES,
  PAGE,
  PAGE_STACK,
  featuredIn,
  isOwnCharacter,
  matchesQuery,
  parseLane,
  relativeTime,
  tagsOf,
  themeById,
  useCatalogue,
} from "@/components/home/catalogue";
import { threadsByCharacter, useThreads } from "@/components/home/threads";
import { laneOf, type Character, type Lane } from "@/lib/characters";
import { FACETS, FilterPanel, SORTS, type Facet, type Sort } from "./filter-panel";

const TITLE = { accent: "Discover", title: "AI Characters" };
const SUBTITLE = "Everyone you can chat with, including the characters you made. Every character is a fictional adult.";
// Under the sticky top bar (h-16).
const STICKY =
  "sticky top-16 z-30 -mx-4 border-b border-[var(--line)] bg-[var(--bg)]/90 px-4 py-3 backdrop-blur-md sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8";

// Featured is the curated order with the user's own after it. Yours first puts
// their own first (latest made first). Age goes youngest to oldest; every
// character is an adult.
function sorted(people: Character[], lane: Lane, sort: Sort) {
  const official = featuredIn(people, lane);
  const own = people.filter((person) => isOwnCharacter(person) && laneOf(person) === lane);
  if (sort === "yours") return [...[...own].reverse(), ...official];
  if (sort === "age") return [...official, ...own].sort((a, b) => a.age - b.age || a.name.localeCompare(b.name));
  return [...official, ...own];
}

type Filters = {
  query: string;
  tag: string;
  theme: string | null;
  facets: Record<Facet, string | null>;
};

function matches(person: Character, filters: Filters, tags: string[]) {
  if (filters.tag !== "All" && tags.includes(filters.tag) && !(person.tags ?? []).includes(filters.tag)) return false;
  const theme = themeById(filters.theme);
  if (theme && !theme.match(person)) return false;
  for (const facet of FACETS) {
    const value = filters.facets[facet.id];
    if (value && person[facet.field] !== value) return false;
  }
  return matchesQuery(person, filters.query);
}

// Every filter lives in the URL (?lane=&tag=&theme=&q=&sort=&role=&body=&heat=&eth=),
// so Home's "See all" links land on a filtered list and a filtered list can be
// shared or reloaded. Defaults are left out.
function useUrlState() {
  const params = useSearchParams();
  const write = useCallback(
    (changes: Record<string, string | null>) => {
      // Read the live URL, not the render's copy, so two quick changes don't
      // undo each other.
      const next = new URLSearchParams(window.location.search);
      for (const [key, value] of Object.entries(changes)) {
        if (value === null || value === "") next.delete(key);
        else next.set(key, value);
      }
      const query = next.toString();
      // The native history API updates useSearchParams without a server
      // round trip, so chips respond instantly.
      window.history.replaceState(null, "", query ? `/discover?${query}` : "/discover");
    },
    [],
  );
  return { params, write };
}

function Discover() {
  const { params, write } = useUrlState();
  const { lane: shellLane, setLane } = useLane();
  const urlLane = parseLane(params.get("lane"));
  const lane = urlLane ?? shellLane;
  const { characters } = useCatalogue();
  const { threads } = useThreads();
  const chatting = useMemo(() => threadsByCharacter(threads), [threads]);
  const [filtersOpen, setFiltersOpen] = useState(false);

  // A ?lane= link sets the remembered lane; the top bar's tabs change the
  // URL's lane. Whichever moved since last time wins.
  const seen = useRef<{ url: Lane | null; shell: Lane }>({ url: null, shell: shellLane });
  useEffect(() => {
    const was = seen.current;
    seen.current = { url: urlLane, shell: shellLane };
    if (!urlLane) return;
    if (urlLane !== was.url) setLane(urlLane);
    else if (shellLane !== was.shell && shellLane !== urlLane) write({ lane: shellLane, tag: null });
  }, [urlLane, shellLane, setLane, write]);

  // Search: typed into local state at once, written to the URL after a pause.
  const urlQuery = params.get("q") ?? "";
  const [query, setQueryState] = useState(urlQuery);
  const [written, setWritten] = useState(urlQuery);
  const [seenUrlQuery, setSeenUrlQuery] = useState(urlQuery);
  if (urlQuery !== seenUrlQuery) {
    // The URL's q changed: ours arriving (ignore), or a link or Back (follow).
    setSeenUrlQuery(urlQuery);
    if (urlQuery !== written && urlQuery !== query) setQueryState(urlQuery);
  }
  useEffect(() => {
    if (query === urlQuery) return;
    const timer = window.setTimeout(() => {
      setWritten(query);
      write({ q: query.trim() ? query : null });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query, urlQuery, write]);

  const sortParam = params.get("sort");
  const sort: Sort = SORTS.some((option) => option.id === sortParam) ? (sortParam as Sort) : "featured";
  const inLane = useMemo(() => sorted(characters, lane, sort), [characters, lane, sort]);
  const tags = useMemo(() => tagsOf(inLane), [inLane]);
  const filters: Filters = {
    query,
    tag: params.get("tag") ?? "All",
    theme: themeById(params.get("theme"))?.id ?? null,
    facets: { role: params.get("role"), body: params.get("body"), heat: params.get("heat"), eth: params.get("eth") },
  };
  const activeTag = tags.includes(filters.tag) ? filters.tag : "All";
  const visible = inLane.filter((person) => matches(person, filters, tags));
  const theme = themeById(filters.theme);
  const facetCount = FACETS.filter((facet) => filters.facets[facet.id]).length;
  const filtered = query.trim() !== "" || activeTag !== "All" || Boolean(theme) || facetCount > 0;

  const clearAll = () => {
    setQueryState("");
    setWritten("");
    write({ q: null, tag: null, theme: null, role: null, body: null, heat: null, eth: null });
  };
  const pickLane = (next: Lane) => {
    setLane(next);
    write({ lane: next, tag: null });
  };

  // When nothing here matches, how many would in the other lanes.
  const elsewhere = filtered
    ? LANES.filter((other) => other !== lane)
        .map((other) => {
          const people = sorted(characters, other, "featured");
          const otherTags = tagsOf(people);
          return { lane: other, count: people.filter((person) => matches(person, filters, otherTags)).length };
        })
        .filter((entry) => entry.count > 0)
    : [];

  const pills: { key: string; label: string; clear: () => void }[] = [
    ...(theme ? [{ key: "theme", label: theme.label, clear: () => write({ theme: null }) }] : []),
    ...FACETS.flatMap((facet) => {
      const value = filters.facets[facet.id];
      return value ? [{ key: facet.id, label: value, clear: () => write({ [facet.id]: null }) }] : [];
    }),
  ];

  const countText = visible.length === 0 ? "No matches" : `${visible.length} ${visible.length === 1 ? "character" : "characters"}`;
  const meta = (
    <div className="flex min-h-8 flex-wrap items-center gap-2">
      {pills.map((pill) => (
        <button
          key={pill.key}
          type="button"
          onClick={pill.clear}
          aria-label={`Remove filter: ${pill.label}`}
          className={cx(
            "inline-flex h-8 items-center gap-1 rounded-full bg-[var(--accent-soft)] pl-3 pr-2 text-xs font-semibold text-[var(--accent)] transition-colors hover:bg-[var(--accent)]/25",
            FOCUS_RING,
          )}
        >
          {pill.label}
          <CloseIcon className="h-3.5 w-3.5" />
        </button>
      ))}
      {filtered ? (
        <button
          type="button"
          onClick={clearAll}
          className={cx("h-8 rounded-full px-2 text-xs font-semibold text-[var(--muted)] hover:text-[var(--ink)]", FOCUS_RING)}
        >
          Clear all
        </button>
      ) : null}
      <p className="ml-auto text-xs font-medium text-[var(--muted)]" aria-live="polite">
        {countText}
      </p>
    </div>
  );

  return (
    <div className={cx(PAGE, PAGE_STACK, "!gap-0")}>
      <PageHeader accent={TITLE.accent} title={TITLE.title} subtitle={<span className="hidden sm:inline">{SUBTITLE}</span>} />

      {/* The top bar has Girls / Anime / Guys from md up; phones pick here. */}
      <LaneChips fill className="mt-4 md:hidden" onPick={pickLane} />

      <div className={cx(STICKY, "mt-3 sm:mt-5")}>
        <div className="flex items-center gap-2">
          <SearchField value={query} onChange={setQueryState} placeholder="Search characters" className="min-w-0 flex-1 lg:max-w-xs" />
          <TagChips tags={tags} value={activeTag} onChange={(tag) => write({ tag: tag === "All" ? null : tag })} className="hidden min-w-0 flex-1 lg:block" />
          <label className="relative hidden shrink-0 sm:block">
            <span className="sr-only">Sort by</span>
            <select
              value={sort}
              onChange={(event) => write({ sort: event.target.value === "featured" ? null : event.target.value })}
              className="h-10 cursor-pointer appearance-none rounded-full border border-[var(--line)] bg-[var(--surface)] pl-4 pr-9 text-sm font-medium text-[var(--ink)] outline-none transition-colors hover:border-white/20 focus:border-[var(--accent)]"
            >
              {SORTS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
            <ChevronDownIcon className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" />
          </label>
          <div className="relative shrink-0">
            <button
              type="button"
              data-filter-toggle
              aria-haspopup="dialog"
              aria-expanded={filtersOpen}
              onClick={() => setFiltersOpen((open) => !open)}
              className={cx(
                "inline-flex h-10 items-center gap-2 rounded-full border px-4 text-sm font-semibold transition-colors",
                facetCount > 0
                  ? "border-[var(--accent)]/50 bg-[var(--accent-soft)] text-[var(--accent)]"
                  : "border-[var(--line)] bg-[var(--surface)] text-[var(--ink)] hover:border-white/20",
                FOCUS_RING,
              )}
            >
              <svg viewBox="0 0 24 24" aria-hidden className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
                <circle cx="16" cy="7" r="2" />
                <circle cx="10" cy="17" r="2" />
              </svg>
              <span className="hidden sm:inline">Filters</span>
              <span className="sr-only sm:hidden">Filters</span>
              {facetCount > 0 ? (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--accent)] px-1 text-[11px] font-bold text-[var(--accent-ink)]">
                  {facetCount}
                </span>
              ) : null}
            </button>
            {filtersOpen ? (
              <FilterPanel
                people={inLane.filter((person) => !isOwnCharacter(person))}
                values={filters.facets}
                sort={sort}
                count={visible.length}
                onChange={(facet, value) => write({ [facet]: value })}
                onSort={(next) => write({ sort: next === "featured" ? null : next })}
                onClear={() => write({ role: null, body: null, heat: null, eth: null, sort: null })}
                onClose={() => setFiltersOpen(false)}
              />
            ) : null}
          </div>
        </div>
        <TagChips tags={tags} value={activeTag} onChange={(tag) => write({ tag: tag === "All" ? null : tag })} className="mt-2.5 lg:hidden" />
        <div className="mt-2 hidden md:block">{meta}</div>
      </div>
      <div className="mt-3 md:hidden">{meta}</div>

      <div className="mt-4 md:mt-5">
        {visible.length > 0 ? (
          <CharacterGrid
            people={visible}
            label="Characters"
            eagerCount={6}
            // A card reached with Tab scrolls clear of the sticky filter bar.
            cardClassName="scroll-mt-48 lg:scroll-mt-40"
            badge={(person) =>
              isOwnCharacter(person) ? (
                <Badge>Yours</Badge>
              ) : chatting.has(person.id) ? (
                <Badge tone="muted">Chatting</Badge>
              ) : null
            }
            meta={(person) => {
              const thread = chatting.get(person.id);
              return thread ? `${person.role} · chatted ${relativeTime(thread.lastMessageAt)}` : undefined;
            }}
          />
        ) : (
          <EmptyState
            title={filtered ? "Nobody here matches" : "No characters here yet"}
            body={
              filtered
                ? elsewhere.length > 0
                  ? `Nobody in ${LANE_LABEL[lane]} fits those filters, but some do elsewhere.`
                  : "Try another word, or clear the filters."
                : "Pick another tab, or create your own."
            }
            action={
              filtered ? (
                <div className="flex flex-wrap justify-center gap-2">
                  {elsewhere.map((entry) => (
                    <Button key={entry.lane} onClick={() => pickLane(entry.lane)}>
                      Show {entry.count} in {LANE_LABEL[entry.lane]}
                    </Button>
                  ))}
                  <Button variant="secondary" onClick={clearAll}>
                    Clear filters
                  </Button>
                </div>
              ) : null
            }
          />
        )}
      </div>
    </div>
  );
}

// Shown while the URL is read on first load, in the same shape as the page.
function DiscoverFallback() {
  return (
    <div className={cx(PAGE, PAGE_STACK, "!gap-0")}>
      <PageHeader accent={TITLE.accent} title={TITLE.title} subtitle={<span className="hidden sm:inline">{SUBTITLE}</span>} />
      <div className="mt-[4.25rem] h-[6.5rem] md:mt-5 md:h-[6.25rem] lg:h-[6.75rem]" />
      <div className="mt-4 md:mt-5">
        <GridSkeleton count={10} label="Loading characters" />
      </div>
    </div>
  );
}

export default function DiscoverPage() {
  return (
    <AppShell>
      {/* useSearchParams needs a Suspense boundary so the rest prerenders. */}
      <Suspense fallback={<DiscoverFallback />}>
        <Discover />
      </Suspense>
    </AppShell>
  );
}
