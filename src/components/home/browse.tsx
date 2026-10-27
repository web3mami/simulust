"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeftIcon, ChevronRightIcon, SearchIcon } from "@/components/icons";
import { CharacterCard, Chip, cx } from "@/components/ui";
import type { Character } from "@/lib/characters";

// A row that scrolls sideways: swipe on phones, arrow buttons on wider screens.
// Keyboard users tab through the items, which scrolls them into view, so the
// arrows are mouse-only.
export function ScrollRow({
  children,
  label,
  watch,
  className,
}: {
  children: ReactNode;
  label?: string;
  // Anything that changes the row's content width (item count, filter).
  watch?: unknown;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const start = el.scrollLeft <= 4;
    const end = el.scrollLeft + el.clientWidth >= el.scrollWidth - 4;
    setEdges((now) => (now.start === start && now.end === end ? now : { start, end }));
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const frame = requestAnimationFrame(measure);
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    el.addEventListener("scroll", measure, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      el.removeEventListener("scroll", measure);
    };
  }, [measure, watch]);

  function scroll(direction: 1 | -1) {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: "smooth" });
  }

  const arrow = (direction: 1 | -1) => (
    <div
      className={cx(
        "pointer-events-none absolute inset-y-0 z-10 hidden items-center sm:flex",
        direction === -1
          ? "left-0 bg-gradient-to-r from-[var(--bg)] via-[var(--bg)]/80 to-transparent pr-8"
          : "right-0 bg-gradient-to-l from-[var(--bg)] via-[var(--bg)]/80 to-transparent pl-8",
      )}
    >
      <button
        type="button"
        tabIndex={-1}
        aria-hidden
        onClick={() => scroll(direction)}
        className="pointer-events-auto flex h-9 w-9 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--surface-2)] text-[var(--ink)] shadow-lg hover:bg-[var(--surface)]"
      >
        {direction === -1 ? <ChevronLeftIcon className="h-4 w-4" /> : <ChevronRightIcon className="h-4 w-4" />}
      </button>
    </div>
  );

  return (
    <div className={cx("relative", className)}>
      {edges.start ? null : arrow(-1)}
      <div
        ref={ref}
        role={label ? "group" : undefined}
        aria-label={label}
        className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto scroll-px-4 px-4 sm:mx-0 sm:scroll-px-0 sm:px-0"
      >
        {children}
      </div>
      {edges.end ? null : arrow(1)}
    </div>
  );
}

export function SearchField({
  value,
  onChange,
  placeholder = "Search by name, role or vibe",
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <label className={cx("relative block w-full", className)}>
      <span className="sr-only">Search characters</span>
      <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-10 w-full rounded-full border border-[var(--line)] bg-[var(--surface)] pl-10 pr-4 text-sm text-[var(--ink)] outline-none placeholder:text-[var(--muted)] focus:border-[var(--accent)]"
      />
    </label>
  );
}

export function TagChips({
  tags,
  value,
  onChange,
  className,
}: {
  tags: string[];
  value: string;
  onChange: (tag: string) => void;
  className?: string;
}) {
  return (
    <ScrollRow label="Filter by tag" watch={tags.length} className={cx("min-w-0", className)}>
      {["All", ...tags].map((tag) => (
        <Chip key={tag} active={value === tag} onClick={() => onChange(tag)}>
          {tag}
        </Chip>
      ))}
    </ScrollRow>
  );
}

export const GRID = "grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6";

export function CharacterGrid({
  people,
  badge,
  label,
}: {
  people: Character[];
  badge?: (person: Character) => ReactNode;
  label?: string;
}) {
  return (
    <ul className={GRID} aria-label={label}>
      {people.map((person) => (
        <li key={person.id}>
          <CharacterCard person={person} badge={badge?.(person)} />
        </li>
      ))}
    </ul>
  );
}

export function GridSkeleton({ count = 10, label = "Loading" }: { count?: number; label?: string }) {
  return (
    <div className={GRID} aria-busy="true" aria-label={label}>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="aspect-[3/4] animate-pulse rounded-2xl bg-[var(--surface)] ring-1 ring-white/5" />
      ))}
    </div>
  );
}
