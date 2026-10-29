"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import { CheckIcon } from "@/components/create/tiles";
import styles from "@/components/create/motion.module.css";
import { useLane } from "@/components/app-shell";
import { SearchField } from "@/components/home/browse";
import { featuredIn, isOwnCharacter, matchesQuery } from "@/components/home/catalogue";
import { LaneChips } from "@/components/home/lane-chips";
import { PlusCircleIcon } from "@/components/icons";
import { ButtonLink, Skeleton, cx, isStaticArt } from "@/components/ui";
import { FOCUS } from "@/components/studio/parts";
import type { Character } from "@/lib/characters";

const GRID = "grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6";
const SIZES = "(min-width: 1536px) 16vw, (min-width: 1280px) 20vw, (min-width: 768px) 25vw, (min-width: 640px) 33vw, 50vw";

// A pickable portrait. Nude art only when the server sent it (explicit viewers);
// the regular portrait otherwise, and if the nude art won't load.
function PickCard({ person, selected, onPick, eager }: { person: Character; selected: boolean; onPick: () => void; eager?: boolean }) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const art = failed ? person.image : (person.explicitImage ?? person.image);
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onPick}
      className={cx(
        "group relative block aspect-[3/4] w-full overflow-hidden rounded-2xl text-left transition duration-200",
        selected
          ? "z-[1] ring-[3px] ring-[var(--accent)] shadow-[0_0_0_6px_var(--accent-soft),0_16px_40px_-16px_rgba(255,79,139,0.7)]"
          : "ring-1 ring-white/5 hover:-translate-y-0.5 hover:ring-[var(--accent)]/60 motion-reduce:hover:translate-y-0",
        FOCUS,
      )}
      style={{ background: person.color }}
    >
      {art ? (
        <Image
          key={art}
          src={art}
          alt=""
          fill
          sizes={SIZES}
          loading={eager ? "eager" : "lazy"}
          unoptimized={!isStaticArt(art)}
          onLoad={() => setLoaded(true)}
          onError={art === person.explicitImage ? () => setFailed(true) : undefined}
          className={cx(
            "object-cover object-top transition-[opacity,transform] duration-500 group-hover:scale-[1.04] motion-reduce:transition-none",
            loaded ? "opacity-100" : "opacity-0",
          )}
        />
      ) : null}
      {isOwnCharacter(person) ? (
        <span className="absolute left-2.5 top-2.5 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white backdrop-blur">
          Yours
        </span>
      ) : null}
      <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/45 to-transparent px-3 pb-3 pt-14">
        <span className="block truncate text-base font-bold leading-tight text-white">
          {person.name} <span className="font-medium text-white/80">{person.age}</span>
        </span>
        <span className="mt-1 line-clamp-1 block text-xs text-white/70">{[person.role, person.body].filter(Boolean).join(" · ")}</span>
      </span>
      {selected ? (
        <span
          className={cx(
            "absolute right-2.5 top-2.5 flex h-8 w-8 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--accent-ink)] shadow-[0_4px_14px_rgba(255,79,139,0.55)] ring-2 ring-black/20",
            styles.pop,
          )}
        >
          <CheckIcon className="h-[18px] w-[18px]" />
        </span>
      ) : null}
    </button>
  );
}

// Step 1: who stars in the scene. The viewer's own characters first, then the
// official ones of the lane, with search across both.
export function CharacterStep({
  characters,
  loading,
  selectedId,
  onPick,
}: {
  characters: Character[];
  loading: boolean;
  selectedId: string | null;
  onPick: (person: Character) => void;
}) {
  const { lane } = useLane();
  const [query, setQuery] = useState("");
  const own = useMemo(() => characters.filter((person) => isOwnCharacter(person) && matchesQuery(person, query)), [characters, query]);
  const official = useMemo(() => featuredIn(characters, lane).filter((person) => matchesQuery(person, query)), [characters, lane, query]);
  const empty = !loading && own.length === 0 && official.length === 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <SearchField value={query} onChange={setQuery} placeholder="Search by name, look or vibe" className="sm:max-w-sm" />
        <LaneChips className="sm:ml-auto" />
      </div>

      {own.length ? (
        <section aria-labelledby="studio-own" className="flex flex-col gap-3">
          <h2 id="studio-own" className="text-base font-bold text-[var(--ink)] sm:text-lg">
            <span className="text-[var(--accent)]">Your</span> characters
          </h2>
          <ul className={GRID}>
            {own.map((person, index) => (
              <li key={person.id}>
                <PickCard person={person} eager={index < 4} selected={selectedId === person.id} onPick={() => onPick(person)} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="studio-official" className="flex flex-col gap-3">
        {own.length ? (
          <h2 id="studio-official" className="text-base font-bold text-[var(--ink)] sm:text-lg">
            <span className="text-[var(--accent)]">Featured</span> characters
          </h2>
        ) : (
          <h2 id="studio-official" className="sr-only">
            Characters
          </h2>
        )}
        {loading && official.length === 0 ? (
          <div className={GRID} aria-label="Loading characters" role="status">
            {Array.from({ length: 10 }, (_, index) => (
              <Skeleton key={index} className="aspect-[3/4]" />
            ))}
          </div>
        ) : (
          <ul className={GRID}>
            {official.map((person, index) => (
              <li key={person.id}>
                <PickCard person={person} eager={!own.length && index < 4} selected={selectedId === person.id} onPick={() => onPick(person)} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {empty ? (
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-6 py-10 text-center">
          <p className="text-base font-semibold text-[var(--ink)]">No one matches &ldquo;{query}&rdquo;</p>
          <p className="max-w-sm text-sm text-[var(--muted)]">Try another name, or switch between Girls, Anime and Guys above.</p>
          <ButtonLink href="/create" variant="secondary">
            <PlusCircleIcon className="h-5 w-5" />
            Create your own
          </ButtonLink>
        </div>
      ) : null}
    </div>
  );
}
