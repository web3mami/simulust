import Image from "next/image";
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import type { Character } from "@/lib/characters";

// Shared building blocks for every screen, so buttons, chips and cards look the
// same everywhere. Colours come from the tokens in globals.css.

// The same side gutters and top/bottom padding on every page, so titles don't
// jump sideways when you move between screens.
export const PAGE_GUTTER = "px-4 sm:px-6 lg:px-8";
export const PAGE_PAD_Y = "pt-6 pb-12 sm:pt-8";

export function cx(...names: (string | false | null | undefined)[]) {
  return names.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "ghost" | "premium" | "danger";
type Size = "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-[var(--accent)] !text-[var(--accent-ink)] hover:bg-[var(--accent-2)]",
  secondary: "border border-[var(--line)] bg-[var(--surface)] text-[var(--ink)] hover:bg-[var(--surface-2)]",
  ghost: "text-[var(--muted)] hover:bg-white/5 hover:text-[var(--ink)]",
  premium:
    "bg-gradient-to-r from-[var(--premium)] to-[var(--premium-2)] !text-[#1a1206] hover:brightness-110",
  danger: "border border-red-500/40 text-red-300 hover:bg-red-500/10",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 px-3 text-xs gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
  lg: "h-12 px-6 text-base gap-2",
};

// A quick shrink on press so taps on a phone feel answered; none for people
// who ask for less motion.
const PRESS =
  "transition-[background-color,color,border-color,transform,filter] duration-150 active:scale-[0.97] motion-reduce:active:scale-100";

export function buttonClass(variant: Variant = "primary", size: Size = "md", extra?: string) {
  return cx(
    "inline-flex shrink-0 items-center justify-center rounded-full font-semibold disabled:pointer-events-none disabled:opacity-50",
    PRESS,
    VARIANTS[variant],
    SIZES[size],
    extra,
  );
}

export function Button({
  variant,
  size,
  className,
  type = "button",
  ...props
}: ComponentProps<"button"> & { variant?: Variant; size?: Size }) {
  return <button type={type} className={buttonClass(variant, size, className)} {...props} />;
}

export function ButtonLink({
  variant,
  size,
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return <Link className={buttonClass(variant, size, className)} {...props} />;
}

export const inputClass =
  "w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-2.5 text-sm text-[var(--ink)] placeholder:text-[var(--muted)] outline-none focus:border-[var(--accent)]";

export function Chip({
  active,
  className,
  type = "button",
  ...props
}: ComponentProps<"button"> & { active?: boolean }) {
  return (
    <button
      type={type}
      aria-pressed={active}
      className={cx(
        "inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full px-4 text-sm font-medium",
        PRESS,
        active
          ? "bg-[var(--accent)] text-[var(--accent-ink)]"
          : "border border-[var(--line)] bg-[var(--surface)] text-[var(--ink)] hover:border-white/25",
        className,
      )}
      {...props}
    />
  );
}

// "Explore Featured Characters": the first word in the accent colour.
export function SectionTitle({
  accent,
  children,
  action,
  as: Tag = "h2",
}: {
  accent?: string;
  children: ReactNode;
  action?: ReactNode;
  as?: "h1" | "h2";
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <Tag className={cx("font-bold tracking-tight text-[var(--ink)]", Tag === "h1" ? "text-2xl sm:text-3xl" : "text-xl sm:text-2xl")}>
        {accent ? <span className="text-[var(--accent)]">{accent} </span> : null}
        {children}
      </Tag>
      {action}
    </div>
  );
}

// The title row at the top of an inner page.
export function PageHeader({
  title,
  accent,
  subtitle,
  action,
}: {
  title: string;
  accent?: string;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <SectionTitle as="h1" accent={accent}>
          {title}
        </SectionTitle>
        {subtitle ? <p className="mt-1.5 max-w-2xl text-sm leading-6 text-[var(--muted)]">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Panel({ className, ...props }: ComponentProps<"div">) {
  return <div className={cx("rounded-2xl border border-[var(--line)] bg-[var(--surface)]", className)} {...props} />;
}

export function Badge({ tone = "accent", className, ...props }: ComponentProps<"span"> & { tone?: "accent" | "premium" | "muted" }) {
  const tones = {
    accent: "bg-[var(--accent)] text-[var(--accent-ink)]",
    premium: "bg-gradient-to-r from-[var(--premium)] to-[var(--premium-2)] text-[#1a1206]",
    muted: "bg-black/55 text-white backdrop-blur",
  };
  return (
    <span
      className={cx("inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide", tones[tone], className)}
      {...props}
    />
  );
}

// A portrait card: the picture fills it, name and age sit on a fade at the
// bottom, and the persona line shows on hover.
// Our own art in /public can be resized by next/image; generated media can't.
export function isStaticArt(src: string) {
  return /^\/(?:characters|hero|creator)\//.test(src);
}

// Card widths in the 2-to-6 column grids, so phones never download desktop-size art.
export const CARD_SIZES = "(min-width: 1536px) 16vw, (min-width: 1280px) 20vw, (min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw";

export function CharacterCard({
  person,
  href = `/date/${person.id}`,
  badge,
  className,
  priority = false,
}: {
  person: Pick<Character, "id" | "name" | "age" | "image" | "color" | "role" | "line"> & { body?: string };
  href?: string;
  badge?: ReactNode;
  className?: string;
  // The first row on screen, so it isn't lazy-loaded.
  priority?: boolean;
}) {
  return (
    <Link
      href={href}
      className={cx(
        "group relative block aspect-[3/4] overflow-hidden rounded-2xl bg-[var(--surface)] ring-1 ring-white/5 transition hover:ring-[var(--accent)]/60",
        className,
      )}
      style={person.image ? undefined : { background: person.color }}
    >
      {person.image ? (
        <Image
          src={person.image}
          alt=""
          fill
          sizes={CARD_SIZES}
          // Next 16 deprecates `priority`; eager and high fetch priority do the same job.
          loading={priority ? "eager" : undefined}
          fetchPriority={priority ? "high" : undefined}
          unoptimized={!isStaticArt(person.image)}
          className="object-cover transition duration-500 group-hover:scale-[1.04]"
        />
      ) : null}
      {badge ? <div className="absolute left-2.5 top-2.5 z-10 flex gap-1">{badge}</div> : null}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/45 to-transparent px-3 pb-3 pt-14">
        <p className="text-base font-bold text-white">
          {person.name} <span className="font-medium text-white/80">{person.age}</span>
        </p>
        <p className="mt-0.5 line-clamp-1 text-xs text-white/70 group-hover:hidden">
          {[person.role, person.body].filter(Boolean).join(" · ")}
        </p>
        <p className="mt-0.5 hidden line-clamp-2 text-xs text-white/85 group-hover:block">{person.line}</p>
      </div>
    </Link>
  );
}

// A grey placeholder in the shape of what's loading.
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cx("animate-pulse rounded-2xl bg-[var(--surface)] motion-reduce:animate-none", className)} />;
}

// Shown where a list is empty: what's missing and the one thing to do next.
export function EmptyState({
  title,
  body,
  action,
  icon,
}: {
  title: string;
  body?: ReactNode;
  action?: ReactNode;
  // Optional: a line icon shown in a soft accent circle above the title.
  icon?: ReactNode;
}) {
  return (
    <Panel className="flex flex-col items-center px-6 py-12 text-center">
      {icon ? (
        <span
          aria-hidden
          className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent)]"
        >
          {icon}
        </span>
      ) : null}
      <p className="text-base font-semibold text-[var(--ink)]">{title}</p>
      {body ? <p className="mt-2 max-w-sm text-sm leading-6 text-[var(--muted)]">{body}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </Panel>
  );
}
