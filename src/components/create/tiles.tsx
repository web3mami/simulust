"use client";

import { useEffect, useMemo, useRef, type ReactNode, type RefObject } from "react";
import { cx } from "@/components/ui";

// The creator's choice tiles. Every tile is a toggle button (aria-pressed), the
// picked one gets a pink ring and a check.

function Glyph({ className = "h-5 w-5", children, width = "1.8" }: { className?: string; children: ReactNode; width?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cx("shrink-0", className)} fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}

export const CheckIcon = ({ className = "h-4 w-4" }: { className?: string }) => (
  <Glyph className={className} width="2.6">
    <path d="m5.5 12.5 4 4 9-9" />
  </Glyph>
);

export const ShuffleIcon = ({ className }: { className?: string }) => (
  <Glyph className={className}>
    <path d="M4 7h3.5c4.5 0 4.5 10 9 10H20M4 17h3.5c1.4 0 2.4-1 3.2-2.4M13.3 9.4C14.1 8 15.1 7 16.5 7H20M17.5 4.5 20 7l-2.5 2.5M17.5 14.5 20 17l-2.5 2.5" />
  </Glyph>
);

export const RefreshIcon = ({ className }: { className?: string }) => (
  <Glyph className={className}>
    <path d="M19 12a7 7 0 1 1-2.05-4.95M19 4.5V8h-3.5" />
  </Glyph>
);

function Check({ small, className }: { small?: boolean; className?: string }) {
  return (
    <span
      className={cx(
        "absolute flex items-center justify-center rounded-full bg-[var(--accent)] text-[var(--accent-ink)] shadow-[0_4px_14px_rgba(255,79,139,0.5)]",
        className ?? (small ? "right-1.5 top-1.5 h-5 w-5 sm:right-2.5 sm:top-2.5 sm:h-7 sm:w-7" : "right-2.5 top-2.5 h-7 w-7"),
      )}
    >
      <CheckIcon className={small ? "h-3 w-3 sm:h-4 sm:w-4" : "h-4 w-4"} />
    </span>
  );
}

const FOCUS =
  "outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]";

// Cycles an <img> through a few poses, there and back, so a style card moves.
function useFrames(photo: RefObject<HTMLImageElement | null>, frames: string[]) {
  useEffect(() => {
    const el = photo.current;
    if (!el || frames.length < 2) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let cancelled = false;
    let raf = 0;
    let shown = -1;
    const cache = frames.map((url) => {
      const img = new Image();
      img.src = url;
      return img;
    });
    const start = performance.now();
    const tick = (now: number) => {
      if (cancelled || !photo.current) return;
      const progress = ((now - start) % 8000) / 8000;
      const trip = progress < 0.5 ? progress * 2 : 2 - progress * 2;
      const index = Math.min(frames.length - 1, Math.round(trip * (frames.length - 1)));
      if (index !== shown) {
        photo.current.src = cache[index].src;
        shown = index;
      }
      raf = requestAnimationFrame(tick);
    };
    Promise.all(cache.map((img) => img.decode().catch(() => undefined))).then(() => {
      if (!cancelled) raf = requestAnimationFrame(tick);
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [photo, frames]);
}

// A portrait tile: the picture fills it and the label sits on a dark fade.
export function ImageTile({
  src,
  frames,
  label,
  detail,
  swatch,
  selected,
  onClick,
  size = "md",
}: {
  src: string;
  frames?: string[];
  label: string;
  detail?: string;
  swatch?: string;
  selected: boolean;
  onClick: () => void;
  size?: "sm" | "md" | "lg";
}) {
  const frameKey = frames?.join("|") ?? "";
  const poses = useMemo(() => (frameKey ? frameKey.split("|") : [src]), [frameKey, src]);
  const photo = useRef<HTMLImageElement>(null);
  useFrames(photo, poses);

  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cx(
        "group relative block aspect-[3/4] w-full overflow-hidden bg-[var(--surface)] text-left transition",
        size === "sm" ? "rounded-xl sm:rounded-2xl" : "rounded-2xl",
        selected
          ? "ring-2 ring-[var(--accent)] shadow-[0_0_0_4px_var(--accent-soft)]"
          : "ring-1 ring-white/5 hover:ring-white/25",
        FOCUS,
      )}
    >
      <img
        ref={photo}
        src={poses[0] ?? src}
        alt=""
        loading="lazy"
        className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-[1.04]"
      />
      <span
        className={cx(
          "absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/45 to-transparent",
          size === "sm" ? "px-1.5 pb-2 pt-8 sm:px-3 sm:pb-3 sm:pt-12" : size === "lg" ? "px-4 pb-4 pt-20" : "px-3 pb-3 pt-12",
        )}
      >
        <span
          className={cx(
            "flex items-center gap-1.5 font-bold text-white",
            size === "sm" ? "justify-center text-[11px] leading-tight sm:justify-start sm:text-base" : size === "lg" ? "text-xl sm:text-2xl" : "text-sm sm:text-base",
          )}
        >
          {swatch ? (
            <span
              className={cx("shrink-0 rounded-full ring-1 ring-white/40", size === "sm" ? "hidden h-2.5 w-2.5 sm:inline-block" : "h-3 w-3")}
              style={{ background: swatch }}
              aria-hidden
            />
          ) : null}
          <span className="truncate">{label}</span>
        </span>
        {detail ? <span className="mt-0.5 block text-xs text-white/70 sm:text-sm">{detail}</span> : null}
      </span>
      {selected ? <Check small={size === "sm"} /> : null}
    </button>
  );
}

// Eye colour: a round close-up of the iris and the name under it.
export function EyeTile({
  src,
  label,
  selected,
  onClick,
}: {
  src: string;
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cx("group flex min-h-[4.5rem] flex-col items-center gap-1.5 rounded-xl py-1", FOCUS)}
    >
      <span
        className={cx(
          "relative block h-11 w-11 overflow-hidden rounded-full transition sm:h-16 sm:w-16",
          selected ? "ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-[var(--bg)]" : "ring-1 ring-white/10 group-hover:ring-white/30",
        )}
      >
        <img src={src} alt="" loading="lazy" className="h-full w-full scale-[1.9] object-cover" />
      </span>
      <span className={cx("text-[11px] font-semibold sm:text-sm", selected ? "text-[var(--accent)]" : "text-[var(--ink)]")}>{label}</span>
    </button>
  );
}

// A text choice: a title, an optional line under it, and an optional icon.
export function OptionCard({
  title,
  detail,
  icon,
  selected,
  onClick,
  compact,
}: {
  title: string;
  detail?: ReactNode;
  icon?: ReactNode;
  selected: boolean;
  onClick: () => void;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cx(
        "relative flex w-full items-start gap-3 rounded-2xl border text-left transition",
        compact ? "min-h-12 items-center px-4 py-3" : "min-h-[5.5rem] p-4",
        selected
          ? "border-[var(--accent)] bg-[var(--accent-soft)]"
          : "border-[var(--line)] bg-[var(--surface)] hover:border-white/25 hover:bg-[var(--surface-2)]",
        FOCUS,
      )}
    >
      {icon ? (
        <span
          className={cx(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
            selected ? "bg-[var(--accent)] text-[var(--accent-ink)]" : "bg-[var(--surface-2)] text-[var(--muted)]",
          )}
        >
          {icon}
        </span>
      ) : null}
      <span className="min-w-0 flex-1 pr-7">
        <span className={cx("block font-bold text-[var(--ink)]", compact ? "text-sm" : "text-base")}>{title}</span>
        {detail ? <span className="mt-1 block text-xs leading-5 text-[var(--muted)] sm:text-sm">{detail}</span> : null}
      </span>
      {selected ? (
        <Check small className={compact ? "right-3 top-1/2 h-6 w-6 -translate-y-1/2" : "right-3 top-3 h-6 w-6"} />
      ) : null}
    </button>
  );
}

// One block of choices inside a step: a heading, what's picked, and the tiles.
export function ChoiceGroup({
  id,
  title,
  value,
  hint,
  children,
}: {
  id: string;
  title: string;
  value?: string | null;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section role="group" aria-labelledby={`${id}-title`} className="mt-8 first:mt-0">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 id={`${id}-title`} className="text-lg font-bold tracking-tight text-[var(--ink)] sm:text-xl">
          {title}
        </h2>
        {value ? (
          <span className="truncate text-sm font-semibold text-[var(--accent)]">{value}</span>
        ) : hint ? (
          <span className="shrink-0 text-xs text-[var(--muted)] sm:text-sm">{hint}</span>
        ) : null}
      </div>
      {children}
    </section>
  );
}

// Age: a big number, a slider, and minus / plus buttons for exact steps.
export function AgePicker({
  age,
  min,
  max,
  onChange,
}: {
  age: number;
  min: number;
  max: number;
  onChange: (age: number) => void;
}) {
  const percent = ((age - min) / (max - min)) * 100;
  const stepButton = "flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--surface-2)] text-xl font-bold text-[var(--ink)] transition hover:border-white/25 disabled:opacity-40";
  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 py-5 sm:px-6">
      <div className="flex items-center gap-4">
        <button type="button" className={cx(stepButton, FOCUS)} aria-label="Younger" disabled={age <= min} onClick={() => onChange(age - 1)}>
          −
        </button>
        <p className="flex-1 text-center" aria-live="polite">
          <span className="text-4xl font-bold tracking-tight text-[var(--ink)]">{age >= max ? `${max}+` : age}</span>
          <span className="ml-1.5 text-sm text-[var(--muted)]">years</span>
        </p>
        <button type="button" className={cx(stepButton, FOCUS)} aria-label="Older" disabled={age >= max} onClick={() => onChange(age + 1)}>
          +
        </button>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={age}
        aria-label="Age"
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-5 h-2 w-full cursor-pointer appearance-none rounded-full accent-[var(--accent)] [&::-moz-range-thumb]:h-6 [&::-moz-range-thumb]:w-6 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-4 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:bg-[var(--accent)] [&::-webkit-slider-thumb]:h-6 [&::-webkit-slider-thumb]:w-6 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-4 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:bg-[var(--accent)] [&::-webkit-slider-thumb]:shadow-[0_2px_10px_rgba(255,79,139,0.6)]"
        style={{
          background: `linear-gradient(to right, var(--accent) ${percent}%, var(--surface-2) ${percent}%)`,
        }}
      />
      <div className="mt-2 flex justify-between text-xs text-[var(--muted)]">
        <span>{min}</span>
        <span>{max}+</span>
      </div>
    </div>
  );
}
