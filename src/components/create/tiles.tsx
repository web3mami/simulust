"use client";

import Image, { getImageProps } from "next/image";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { cx } from "@/components/ui";
import styles from "@/components/create/motion.module.css";

// The creator's choice tiles. Every tile is a toggle button (aria-pressed); the
// picked one gets a thick pink ring, a glow and a check, and once a group has a
// pick the others step back.

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

// Rendered widths of each tile size, so phones never fetch desktop-size art.
// The prefetch below uses the same values, or it would warm the wrong files.
export const TILE_SIZES = {
  lg: "(min-width: 640px) 330px, 50vw",
  md: "(min-width: 1024px) 220px, (min-width: 640px) 25vw, 50vw",
  sm: "(min-width: 1024px) 220px, 25vw",
  eye: "64px",
} as const;

// Fetches the optimized files a set of tiles will ask for, so the next step's
// pictures are already cached when it opens.
export function warmImages(srcs: string[], sizes: string) {
  for (const src of srcs) {
    const { props } = getImageProps({ src, alt: "", fill: true, sizes });
    const img = new window.Image();
    img.sizes = props.sizes ?? sizes;
    if (props.srcSet) img.srcset = props.srcSet;
    img.src = props.src;
  }
}

function Check({ className, size = "md" }: { className?: string; size?: "xs" | "sm" | "md" }) {
  return (
    <span
      className={cx(
        "absolute z-10 flex items-center justify-center rounded-full bg-[var(--accent)] text-[var(--accent-ink)] shadow-[0_4px_14px_rgba(255,79,139,0.55)] ring-2 ring-black/20",
        styles.pop,
        size === "xs" ? "h-5 w-5 sm:h-6 sm:w-6" : size === "sm" ? "h-6 w-6 sm:h-8 sm:w-8" : "h-8 w-8",
        className,
      )}
    >
      <CheckIcon className={size === "md" ? "h-[18px] w-[18px]" : "h-3 w-3 sm:h-4 sm:w-4"} />
    </span>
  );
}

const FOCUS =
  "outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]";

// Unpicked tiles once their group has a pick: quieter, back to full on hover.
const DIMMED =
  "opacity-60 saturate-50 hover:opacity-100 hover:saturate-100 focus-visible:opacity-100 focus-visible:saturate-100";

const PICKED_GLOW = "shadow-[0_0_0_6px_var(--accent-soft),0_16px_40px_-16px_rgba(255,79,139,0.7)]";

function prefersStill() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// Crossfades a style card through a few poses, there and back, so it moves.
// It waits until the card's first picture has loaded, the card is on screen and
// the browser is idle; phones only animate the picked card. The frames are the
// same optimized files the tile would use, not the originals.
function useFrames(
  layers: [RefObject<HTMLImageElement | null>, RefObject<HTMLImageElement | null>],
  frameKey: string,
  sizes: string,
  ready: boolean,
  selected: boolean,
) {
  const [layerA, layerB] = layers;
  useEffect(() => {
    const first = layerA.current;
    const second = layerB.current;
    const frames = frameKey ? frameKey.split("|") : [];
    if (!ready || !first || !second || frames.length < 2 || prefersStill()) return;
    if (!selected && !window.matchMedia("(min-width: 640px)").matches) return;

    const sources = frames.map((src) => getImageProps({ src, alt: "", fill: true, sizes }).props);
    let cancelled = false;
    let raf = 0;
    let idle = 0;
    let started = false;
    let shown = 0;
    let front = second;
    let back = first;
    let start = 0;

    const show = (index: number) => {
      const incoming = back;
      const source = sources[index];
      incoming.style.transition = "none";
      incoming.style.opacity = "0";
      incoming.style.zIndex = "2";
      front.style.zIndex = "1";
      incoming.sizes = source.sizes ?? sizes;
      if (source.srcSet) incoming.srcset = source.srcSet;
      incoming.src = source.src;
      incoming
        .decode()
        .catch(() => undefined)
        .then(() => {
          if (cancelled) return;
          incoming.style.transition = "opacity 400ms ease, scale 300ms ease";
          incoming.style.opacity = "1";
        });
      back = front;
      front = incoming;
    };

    const tick = (now: number) => {
      if (cancelled) return;
      const progress = ((now - start) % 8000) / 8000;
      const trip = progress < 0.5 ? progress * 2 : 2 - progress * 2;
      const index = Math.min(frames.length - 1, Math.round(trip * (frames.length - 1)));
      if (index !== shown) {
        shown = index;
        show(index);
      }
      raf = requestAnimationFrame(tick);
    };

    const begin = () => {
      if (cancelled) return;
      started = true;
      // Decode every pose first so a swap never shows a half-drawn picture.
      const cache = sources.map((source) => {
        const img = new window.Image();
        img.sizes = source.sizes ?? sizes;
        if (source.srcSet) img.srcset = source.srcSet;
        img.src = source.src;
        return img;
      });
      void Promise.all(cache.map((img) => img.decode().catch(() => undefined))).then(() => {
        if (cancelled) return;
        start = performance.now();
        raf = requestAnimationFrame(tick);
      });
    };

    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) {
        cancelAnimationFrame(raf);
        return;
      }
      if (started) {
        raf = requestAnimationFrame(tick);
        return;
      }
      idle =
        typeof window.requestIdleCallback === "function"
          ? window.requestIdleCallback(begin, { timeout: 1500 })
          : window.setTimeout(begin, 300);
    });
    observer.observe(first.parentElement ?? first);

    return () => {
      cancelled = true;
      observer.disconnect();
      cancelAnimationFrame(raf);
      if (typeof window.cancelIdleCallback === "function") window.cancelIdleCallback(idle);
      else window.clearTimeout(idle);
      // Settle back on the card's own picture.
      for (const layer of [first, second]) {
        layer.style.transition = "opacity 300ms ease, scale 300ms ease";
        layer.style.opacity = "0";
      }
    };
  }, [layerA, layerB, frameKey, sizes, ready, selected]);
}

// A portrait tile: the picture fills it and the label sits on a dark fade.
export function ImageTile({
  src,
  frames,
  label,
  detail,
  swatch,
  selected,
  dimmed,
  onClick,
  size = "md",
  eager,
}: {
  src: string;
  frames?: string[];
  label: string;
  detail?: string;
  swatch?: string;
  selected: boolean;
  // Another tile in this group is picked.
  dimmed?: boolean;
  onClick: () => void;
  size?: "sm" | "md" | "lg";
  // Above the fold on first load: fetch it first rather than lazily.
  eager?: boolean;
}) {
  // Keyed on the source, so a tile whose picture changes shimmers again.
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const loaded = loadedSrc === src;
  const layerA = useRef<HTMLImageElement>(null);
  const layerB = useRef<HTMLImageElement>(null);
  const sizes = TILE_SIZES[size];
  useFrames([layerA, layerB], frames?.join("|") ?? "", sizes, loaded, selected);

  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cx(
        "group relative block w-full overflow-hidden text-left transition duration-200",
        size === "lg" ? "aspect-[2/3] sm:aspect-[3/4]" : "aspect-[3/4]",
        size === "sm" ? "rounded-xl sm:rounded-2xl" : "rounded-2xl",
        loaded ? "bg-[var(--surface)]" : styles.shimmer,
        selected
          ? cx("z-[1] scale-[1.02] ring-[3px] ring-[var(--accent)]", PICKED_GLOW)
          : cx("ring-1 ring-white/5 hover:ring-white/25", dimmed && DIMMED),
        FOCUS,
      )}
    >
      <Image
        src={src}
        alt=""
        fill
        sizes={sizes}
        loading={eager ? "eager" : undefined}
        fetchPriority={eager ? "high" : undefined}
        onLoad={() => setLoadedSrc(src)}
        className={cx(
          "object-cover transition duration-300 group-hover:scale-[1.04]",
          loaded ? "opacity-100" : "opacity-0",
        )}
      />
      {frames ? (
        <>
          {/* Two layers the poses crossfade between; filled in by useFrames. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img ref={layerA} alt="" aria-hidden className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-0 group-hover:scale-[1.04]" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img ref={layerB} alt="" aria-hidden className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-0 group-hover:scale-[1.04]" />
        </>
      ) : null}
      <span
        className={cx(
          "absolute inset-x-0 bottom-0 z-[3] bg-gradient-to-t from-black/90 via-black/45 to-transparent",
          size === "sm" ? "px-1.5 pb-2 pt-8 sm:px-3 sm:pb-3 sm:pt-12" : size === "lg" ? "px-4 pb-4 pt-20" : "px-3 pb-3 pt-12",
        )}
      >
        <span
          className={cx(
            "flex items-center gap-1.5 font-bold text-white",
            size === "sm"
              ? "justify-center text-xs font-semibold leading-tight sm:justify-start sm:text-base sm:font-bold"
              : size === "lg"
                ? "text-xl sm:text-2xl"
                : "text-sm sm:text-base",
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
        {detail ? (
          <span className={cx("mt-0.5 block text-white/75", size === "lg" ? "text-xs sm:text-sm" : "text-xs")}>{detail}</span>
        ) : null}
      </span>
      {selected ? (
        <>
          <Check size={size === "sm" ? "sm" : "md"} className={size === "sm" ? "right-1.5 top-1.5 sm:right-2.5 sm:top-2.5" : "right-2.5 top-2.5"} />
          <span aria-hidden className="absolute inset-x-0 bottom-0 z-[4] h-[3px] bg-[var(--accent)]" />
        </>
      ) : null}
    </button>
  );
}

// A plain colour choice: a big swatch and its name. Used where the art would
// mislead (painted hair art in the realistic flow).
export function SwatchTile({
  swatch,
  label,
  selected,
  dimmed,
  onClick,
}: {
  swatch: string;
  label: string;
  selected: boolean;
  dimmed?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cx(
        "relative flex min-h-24 w-full flex-col items-center justify-center gap-2 rounded-2xl border px-1 py-3 transition duration-200 sm:min-h-28",
        selected
          ? cx("z-[1] scale-[1.02] border-transparent bg-[var(--accent-soft)] ring-[3px] ring-[var(--accent)]", PICKED_GLOW)
          : cx("border-[var(--line)] bg-[var(--surface)] hover:border-white/25 hover:bg-[var(--surface-2)]", dimmed && DIMMED),
        FOCUS,
      )}
    >
      <span
        aria-hidden
        className="h-12 w-12 rounded-full shadow-[inset_0_-6px_12px_rgba(0,0,0,0.35)] ring-1 ring-white/15 sm:h-14 sm:w-14"
        style={{ background: `radial-gradient(circle at 32% 26%, rgba(255,255,255,0.4), transparent 46%), ${swatch}` }}
      />
      <span className={cx("text-xs font-semibold sm:text-sm", selected ? "text-[var(--ink)]" : "text-[var(--ink)]/90")}>{label}</span>
      {selected ? <Check size="sm" className="right-1.5 top-1.5 sm:right-2 sm:top-2" /> : null}
    </button>
  );
}

// Eye colour: a round close-up of the iris and the name under it.
export function EyeTile({
  src,
  label,
  selected,
  dimmed,
  onClick,
}: {
  src: string;
  label: string;
  selected: boolean;
  dimmed?: boolean;
  onClick: () => void;
}) {
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const loaded = loadedSrc === src;
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cx(
        "group flex min-h-[4.5rem] flex-col items-center gap-1.5 rounded-xl py-1 transition duration-200",
        !selected && dimmed && DIMMED,
        FOCUS,
      )}
    >
      <span className="relative">
        <span
          className={cx(
            "relative block h-11 w-11 overflow-hidden rounded-full transition duration-200 sm:h-16 sm:w-16",
            loaded ? "bg-[var(--surface-2)]" : styles.shimmer,
            selected
              ? "scale-105 ring-[3px] ring-[var(--accent)] ring-offset-2 ring-offset-[var(--surface)] shadow-[0_8px_24px_-8px_rgba(255,79,139,0.8)]"
              : "ring-1 ring-white/10 group-hover:ring-white/30",
          )}
        >
          <Image
            src={src}
            alt=""
            fill
            sizes={TILE_SIZES.eye}
            onLoad={() => setLoadedSrc(src)}
            className={cx("scale-[1.9] object-cover transition-opacity duration-300", loaded ? "opacity-100" : "opacity-0")}
          />
        </span>
        {selected ? <Check size="xs" className="-right-1.5 -top-1.5" /> : null}
      </span>
      <span className={cx("text-xs font-semibold sm:text-sm", selected ? "text-[var(--accent)]" : "text-[var(--ink)]")}>{label}</span>
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
        "relative flex w-full items-start gap-3 rounded-2xl border text-left transition duration-200",
        compact ? "min-h-12 items-center px-4 py-3" : "min-h-[5.5rem] p-4",
        selected
          ? "border-[var(--accent)] bg-[var(--accent-soft)] shadow-[0_12px_32px_-18px_rgba(255,79,139,0.8)]"
          : "border-[var(--line)] bg-[var(--surface)] hover:border-white/25 hover:bg-[var(--surface-2)]",
        FOCUS,
      )}
    >
      {icon ? (
        <span
          className={cx(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors",
            selected ? "bg-[var(--accent)] text-[var(--accent-ink)]" : "bg-[var(--surface-2)] text-[var(--muted)]",
          )}
        >
          {icon}
        </span>
      ) : null}
      <span className={cx("min-w-0 flex-1", compact ? "pr-8" : "pr-9")}>
        <span className={cx("block font-bold text-[var(--ink)]", compact ? "text-sm" : "text-base")}>{title}</span>
        {detail ? <span className="mt-1 block text-xs leading-5 text-[var(--muted)] sm:text-sm">{detail}</span> : null}
      </span>
      {selected ? (
        <Check
          size={compact ? "sm" : "md"}
          className={compact ? "right-3 top-1/2 -mt-3 sm:-mt-4" : "right-3 top-3"}
        />
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
    <section role="group" aria-labelledby={`${id}-title`} className="mt-9 first:mt-0">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 id={`${id}-title`} className="text-lg font-bold tracking-tight text-[var(--ink)] sm:text-xl">
          {title}
        </h2>
        {value ? (
          <span key={value} className={cx("truncate text-sm font-semibold text-[var(--accent)]", styles.fade)}>
            {value}
          </span>
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
  const stepButton = "flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--surface-2)] text-xl font-bold text-[var(--ink)] transition hover:border-white/25 active:scale-95 disabled:opacity-40";
  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 py-5 sm:px-6">
      <div className="flex items-center gap-4">
        <button type="button" className={cx(stepButton, FOCUS)} aria-label="Younger" disabled={age <= min} onClick={() => onChange(age - 1)}>
          −
        </button>
        <p className="flex-1 text-center" aria-live="polite">
          <span className="text-4xl font-bold tabular-nums tracking-tight text-[var(--ink)]">{age >= max ? `${max}+` : age}</span>
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
