"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon, SearchIcon } from "@/components/icons";
import { Chip, cx } from "@/components/ui";
import type { Character } from "@/lib/characters";
import { PortraitCard, PortraitSkeleton, ROW_ITEM, ROW_SIZES } from "@/components/home/portrait-card";

// Round controls get an accent ring on keyboard focus instead of the browser's
// square outline.
export const FOCUS_RING =
  "outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]";

// A section heading for these screens: the first word in the accent colour, an
// optional "See all" link, and a size that keeps one line on a phone.
export function RowTitle({
  id,
  accent,
  children,
  href,
  linkLabel = "See all",
  linkHint,
}: {
  id?: string;
  accent?: string;
  children: ReactNode;
  href?: string;
  linkLabel?: string;
  // Read after the link text by screen readers ("See all" → "See all Romance").
  linkHint?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 id={id} className="min-w-0 text-lg font-bold leading-tight tracking-tight text-[var(--ink)] sm:text-2xl">
        {accent ? <span className="text-[var(--accent)]">{accent} </span> : null}
        {children}
      </h2>
      {href ? (
        <Link
          href={href}
          className={cx(
            "-mr-2 flex h-10 shrink-0 items-center gap-0.5 whitespace-nowrap rounded-full px-2 text-xs font-semibold text-[var(--muted)] transition-colors hover:bg-white/5 hover:text-[var(--ink)] sm:px-3 sm:text-sm",
            FOCUS_RING,
          )}
        >
          {linkLabel}
          {linkHint ? <span className="sr-only"> {linkHint}</span> : null}
          <ChevronRightIcon className="h-4 w-4" />
        </Link>
      ) : null}
    </div>
  );
}

// A row that scrolls sideways: swipe on phones (snapping to cards), arrow
// buttons on wider screens. Keyboard users tab through the items, which
// scrolls them into view, so the arrows are mouse-only.
export function ScrollRow({
  children,
  label,
  role,
  watch,
  className,
  onKeyDown,
}: {
  children: ReactNode;
  label?: string;
  role?: "group" | "radiogroup" | "list";
  // Anything that changes the row's content width (item count, filter).
  watch?: unknown;
  className?: string;
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
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
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: reduce ? "auto" : "smooth" });
  }

  const arrow = (direction: 1 | -1) => (
    <div
      className={cx(
        "pointer-events-none absolute inset-y-0 z-10 hidden items-center sm:flex",
        direction === -1
          ? "left-0 bg-gradient-to-r from-[var(--bg)] via-[var(--bg)]/80 to-transparent pr-10"
          : "right-0 bg-gradient-to-l from-[var(--bg)] via-[var(--bg)]/80 to-transparent pl-10",
      )}
    >
      <button
        type="button"
        tabIndex={-1}
        aria-hidden
        onClick={() => scroll(direction)}
        className="pointer-events-auto flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-[var(--surface-2)]/90 text-[var(--ink)] shadow-[0_8px_24px_rgba(0,0,0,0.5)] backdrop-blur transition hover:scale-105 hover:bg-[var(--surface-2)]"
      >
        {direction === -1 ? <ChevronLeftIcon className="h-5 w-5" /> : <ChevronRightIcon className="h-5 w-5" />}
      </button>
    </div>
  );

  return (
    <div className={cx("relative", className)}>
      {edges.start ? null : arrow(-1)}
      <div
        ref={ref}
        role={role ?? (label ? "group" : undefined)}
        aria-label={label}
        onKeyDown={onKeyDown}
        className="no-scrollbar -mx-4 flex snap-x snap-proximity gap-2 overflow-x-auto scroll-px-4 px-4 sm:mx-0 sm:scroll-px-0 sm:px-0 sm:gap-3"
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
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className={cx("relative w-full", className)}>
      <label className="block">
        <span className="sr-only">Search characters</span>
        <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" />
        {/* 16px text on phones, so iOS doesn't zoom the page on focus. */}
        <input
          ref={input}
          type="search"
          value={value}
          enterKeyHint="search"
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && value) {
              event.preventDefault();
              onChange("");
            }
          }}
          placeholder={placeholder}
          className="h-10 w-full rounded-full border border-[var(--line)] bg-[var(--surface)] pl-10 pr-10 text-base text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--muted)] hover:border-white/20 focus:border-[var(--accent)] sm:text-sm [&::-webkit-search-cancel-button]:appearance-none"
        />
      </label>
      {value ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            onChange("");
            input.current?.focus();
          }}
          className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-[var(--muted)] transition-colors hover:bg-white/10 hover:text-[var(--ink)] focus-visible:bg-white/10 focus-visible:outline-none"
        >
          <CloseIcon className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );
}

// One choice from a row of chips. It is a single tab stop: arrow keys move the
// choice along the row (as a radio group does), so keyboard users don't tab
// through twenty chips to reach the grid.
export function TagChips({
  tags,
  value,
  onChange,
  label = "Filter by tag",
  className,
}: {
  tags: string[];
  value: string;
  onChange: (tag: string) => void;
  label?: string;
  className?: string;
}) {
  const options = ["All", ...tags];
  const current = options.includes(value) ? value : "All";

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    const edge = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : null;
    if (!step && edge === null) return;
    event.preventDefault();
    const at = options.indexOf(current);
    const next = edge ?? (at + step + options.length) % options.length;
    onChange(options[next]);
    const row = event.currentTarget;
    requestAnimationFrame(() => row.querySelector<HTMLElement>(`[data-chip="${CSS.escape(options[next])}"]`)?.focus());
  }

  return (
    <ScrollRow label={label} role="radiogroup" watch={tags.length} onKeyDown={onKeyDown} className={cx("min-w-0", className)}>
      {options.map((tag) => {
        const on = current === tag;
        return (
          <Chip
            key={tag}
            data-chip={tag}
            role="radio"
            aria-checked={on}
            aria-pressed={undefined}
            tabIndex={on ? 0 : -1}
            active={on}
            onClick={() => onChange(tag)}
            className={cx("snap-start", FOCUS_RING)}
          >
            {tag}
          </Chip>
        );
      })}
    </ScrollRow>
  );
}

export const GRID = "grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6";

export function CharacterGrid({
  people,
  badge,
  meta,
  label,
  eagerCount = 0,
  cardClassName,
}: {
  people: Character[];
  badge?: (person: Character) => ReactNode;
  meta?: (person: Character) => ReactNode;
  label?: string;
  cardClassName?: string;
  // How many cards are on screen at first paint, so they load first (the rest
  // load lazily as they scroll in).
  eagerCount?: number;
}) {
  return (
    <ul className={GRID} aria-label={label}>
      {people.map((person, index) => (
        <li key={person.id}>
          <PortraitCard
            person={person}
            badge={badge?.(person)}
            meta={meta?.(person)}
            eager={index < eagerCount}
            className={cardClassName}
          />
        </li>
      ))}
    </ul>
  );
}

export function GridSkeleton({ count = 10, label = "Loading" }: { count?: number; label?: string }) {
  return (
    <div className={GRID} role="status" aria-busy="true" aria-label={label}>
      {Array.from({ length: count }, (_, index) => (
        <PortraitSkeleton key={index} />
      ))}
    </div>
  );
}

// A themed sideways row of portrait cards with its title and "See all".
export function CharacterRow({
  id,
  accent,
  title,
  people,
  href,
  linkLabel,
  linkHint,
  badge,
  lead,
}: {
  id: string;
  accent?: string;
  title: ReactNode;
  people: Character[];
  href?: string;
  linkLabel?: string;
  linkHint?: string;
  badge?: (person: Character) => ReactNode;
  // A card before the people (e.g. "Create new").
  lead?: ReactNode;
}) {
  const headingId = `${id}-title`;
  return (
    <Reveal as="section" aria-labelledby={headingId}>
      <RowTitle id={headingId} accent={accent} href={href} linkLabel={linkLabel} linkHint={linkHint}>
        {title}
      </RowTitle>
      <ScrollRow className="mt-3 sm:mt-4" watch={people.length}>
        {lead ? <div className={ROW_ITEM}>{lead}</div> : null}
        {people.map((person) => (
          <PortraitCard key={person.id} person={person} sizes={ROW_SIZES} badge={badge?.(person)} className={ROW_ITEM} />
        ))}
      </ScrollRow>
    </Reveal>
  );
}

// Fades a section up as it scrolls into view. Off for reduced motion, and the
// content is visible without JavaScript (the hidden state needs data-reveal,
// which only the client sets).
export function Reveal({
  as: Tag = "div",
  className,
  children,
  ...props
}: {
  as?: "div" | "section";
  className?: string;
  children: ReactNode;
  "aria-labelledby"?: string;
  "aria-label"?: string;
  id?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  const [state, setState] = useState<"idle" | "hidden" | "shown">("idle");

  useEffect(() => {
    const el = ref.current;
    if (!el || !("IntersectionObserver" in window)) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // Already on screen: no animation, nothing to wait for.
    const box = el.getBoundingClientRect();
    if (box.top < window.innerHeight) return;
    // Hidden only once we know it's below the fold, so nothing on screen blinks.
    setState("hidden");
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setState("shown");
          observer.disconnect();
        }
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <Tag
      ref={ref as never}
      data-reveal={state === "idle" ? undefined : state}
      className={cx(
        "transition-[opacity,transform] duration-700 ease-out data-[reveal=hidden]:translate-y-4 data-[reveal=hidden]:opacity-0",
        className,
      )}
      {...props}
    >
      {children}
    </Tag>
  );
}
