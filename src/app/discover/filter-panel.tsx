"use client";

import { useEffect, useId, useRef, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CloseIcon } from "@/components/icons";
import { Button, Chip, cx } from "@/components/ui";
import { FOCUS_RING } from "@/components/home/browse";
import type { Character } from "@/lib/characters";

export type Facet = "role" | "body" | "heat" | "eth";

// Attribute filters over fields every character has. The URL key is the id.
export const FACETS: { id: Facet; label: string; field: "role" | "body" | "heat" | "ethnicity" }[] = [
  { id: "role", label: "Relationship", field: "role" },
  { id: "body", label: "Body", field: "body" },
  { id: "heat", label: "Vibe", field: "heat" },
  { id: "eth", label: "Ethnicity", field: "ethnicity" },
];

export type Sort = "featured" | "yours" | "age";

// No popularity or recency claims: we have neither, so the sorts say what
// they really do.
export const SORTS: { id: Sort; label: string }[] = [
  { id: "featured", label: "Featured" },
  { id: "yours", label: "Yours first" },
  { id: "age", label: "Youngest first" },
];

// The values a facet takes in this list, most common first.
export function facetOptions(people: Character[], field: (typeof FACETS)[number]["field"]) {
  const counts = new Map<string, number>();
  for (const person of people) {
    const value = person[field];
    if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([value]) => value);
}

const WIDE = "(min-width: 768px)";

function subscribeWide(onChange: () => void) {
  const query = window.matchMedia(WIDE);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

// The phone sheet goes to <body>: the sticky bar it opens from has a backdrop
// blur, which would otherwise make "fixed" mean "fixed to the bar".
function Placement({ wide, children }: { wide: boolean; children: ReactNode }) {
  if (wide) return <div className="absolute right-0 top-full z-50 mt-2">{children}</div>;
  return createPortal(<div className="fixed inset-0 z-50">{children}</div>, document.body);
}

// "Filters": a bottom sheet on phones, a popover under the button on wider
// screens. Choices apply as they're made; the footer says how many match.
export function FilterPanel({
  people,
  values,
  sort,
  count,
  onChange,
  onSort,
  onClear,
  onClose,
}: {
  people: Character[];
  values: Record<Facet, string | null>;
  sort: Sort;
  count: number;
  onChange: (facet: Facet, value: string | null) => void;
  onSort: (sort: Sort) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const wide = useSyncExternalStore(
    subscribeWide,
    () => window.matchMedia(WIDE).matches,
    () => true,
  );

  // The sheet covers the page on phones, so the page shouldn't scroll under it.
  useEffect(() => {
    if (wide) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
    };
  }, [wide]);

  useEffect(() => {
    panel.current?.querySelector<HTMLElement>("button")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      // The Filters button toggles on its own; anything else outside closes.
      if (!panel.current?.contains(target) && !target.closest("[data-filter-toggle]")) onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [onClose]);

  const active = FACETS.some((facet) => values[facet.id]) || sort !== "featured";

  return (
    <Placement wide={wide}>
      {wide ? null : <div aria-hidden className="absolute inset-0 bg-black/60 transition-opacity duration-200 starting:opacity-0" />}
      <div
        ref={panel}
        role="dialog"
        aria-modal={!wide}
        aria-labelledby={titleId}
        className={cx(
          "flex flex-col border border-[var(--line)] bg-[var(--bg-2)] transition-[transform,opacity] ease-out motion-reduce:transition-none",
          wide
            ? "max-h-[min(36rem,calc(100dvh-10rem))] w-[26rem] rounded-2xl shadow-[0_24px_60px_rgba(0,0,0,0.6)] duration-150 starting:-translate-y-1 starting:opacity-0"
            : "absolute inset-x-0 bottom-0 max-h-[85dvh] rounded-t-3xl shadow-[0_-20px_60px_rgba(0,0,0,0.6)] duration-300 starting:translate-y-full",
        )}
      >
        <div className="flex items-center justify-between gap-3 px-5 pb-2 pt-4">
          {wide ? null : <span aria-hidden className="absolute left-1/2 top-2 h-1 w-10 -translate-x-1/2 rounded-full bg-white/15" />}
          <h2 id={titleId} className="text-base font-bold text-[var(--ink)]">
            Filters
          </h2>
          <button
            type="button"
            aria-label="Close filters"
            onClick={onClose}
            className={cx("-mr-2 flex h-10 w-10 items-center justify-center rounded-full text-[var(--muted)] hover:bg-white/5 hover:text-[var(--ink)]", FOCUS_RING)}
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="flex flex-1 flex-col gap-5 overflow-y-auto overscroll-contain px-5 pb-4">
          <fieldset className="sm:hidden">
            <legend className="text-xs font-bold uppercase tracking-wider text-[var(--muted)]">Sort</legend>
            <div className="mt-2.5 flex flex-wrap gap-2">
              {SORTS.map((option) => (
                <Chip key={option.id} active={sort === option.id} onClick={() => onSort(option.id)} className={FOCUS_RING}>
                  {option.label}
                </Chip>
              ))}
            </div>
          </fieldset>
          {FACETS.map((facet) => {
            const options = facetOptions(people, facet.field);
            if (options.length < 2) return null;
            const value = values[facet.id];
            return (
              <fieldset key={facet.id}>
                <legend className="text-xs font-bold uppercase tracking-wider text-[var(--muted)]">{facet.label}</legend>
                <div className="mt-2.5 flex flex-wrap gap-2">
                  <Chip active={!value} onClick={() => onChange(facet.id, null)} className={FOCUS_RING}>
                    Any
                  </Chip>
                  {options.map((option) => (
                    <Chip
                      key={option}
                      active={value === option}
                      onClick={() => onChange(facet.id, value === option ? null : option)}
                      className={FOCUS_RING}
                    >
                      {option}
                    </Chip>
                  ))}
                </div>
              </fieldset>
            );
          })}
        </div>

        <div className="flex items-center gap-3 border-t border-[var(--line)] px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <Button variant="ghost" onClick={onClear} disabled={!active}>
            Clear
          </Button>
          <Button onClick={onClose} className="flex-1" aria-live="polite">
            {count === 0 ? "No matches" : `Show ${count} ${count === 1 ? "character" : "characters"}`}
          </Button>
        </div>
      </div>
    </Placement>
  );
}
