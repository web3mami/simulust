"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { CheckIcon } from "@/components/create/tiles";
import styles from "@/components/create/motion.module.css";
import { CoinIcon, SparkIcon } from "@/components/icons";
import { ButtonLink, cx, isStaticArt } from "@/components/ui";
import type { Character } from "@/lib/characters";

// Small pieces the Video Studio's steps share.

export const FOCUS =
  "outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]";

const PICKED = "ring-[3px] ring-[var(--accent)] shadow-[0_0_0_6px_var(--accent-soft),0_16px_40px_-16px_rgba(255,79,139,0.7)]";

export type StudioStage = "character" | "scene" | "generate";

// Who may create here. Every confirmed adult gets everything ("open"); an
// account on an explicit hold is paused while we review it ("held"); an older
// or dev account that never confirmed its age is asked to ("unconfirmed").
export type StudioAccess = "open" | "held" | "unconfirmed";

const STAGES: { id: StudioStage; label: string }[] = [
  { id: "character", label: "Character" },
  { id: "scene", label: "Scene" },
  { id: "generate", label: "Bring it to life" },
];

// Where you are: three steps, the finished ones clickable.
export function StudioSteps({ stage, canVisit, onGo }: { stage: StudioStage; canVisit: (stage: StudioStage) => boolean; onGo: (stage: StudioStage) => void }) {
  const current = STAGES.findIndex((item) => item.id === stage);
  return (
    <nav aria-label="Studio steps">
      <ol className="flex items-center gap-2">
        {STAGES.map((item, index) => {
          const active = index === current;
          const done = index < current;
          const open = !active && canVisit(item.id);
          return (
            <li key={item.id} className={cx("flex min-w-0 items-center gap-2", index < STAGES.length - 1 && "flex-1")}>
              <button
                type="button"
                disabled={!open}
                onClick={() => onGo(item.id)}
                aria-current={active ? "step" : undefined}
                className={cx(
                  "flex h-10 min-w-0 items-center gap-2 rounded-full pr-1 text-sm font-semibold transition-colors",
                  active ? "text-[var(--ink)]" : done ? "text-[var(--ink)]/85 hover:text-[var(--ink)]" : "text-[var(--muted)]",
                  open ? "cursor-pointer" : "cursor-default",
                  FOCUS,
                )}
              >
                <span
                  className={cx(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-colors",
                    active
                      ? "bg-[var(--accent)] text-[var(--accent-ink)] shadow-[0_0_0_4px_var(--accent-soft)]"
                      : done
                        ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                        : "border border-[var(--line)] bg-[var(--surface)] text-[var(--muted)]",
                  )}
                >
                  {done ? <CheckIcon className="h-4 w-4" /> : index + 1}
                </span>
                <span className={cx("truncate", active ? "inline" : "hidden sm:inline")}>{item.label}</span>
              </button>
              {index < STAGES.length - 1 ? (
                <span aria-hidden className={cx("h-0.5 min-w-3 flex-1 rounded-full", index < current ? "bg-[var(--accent)]/60" : "bg-[var(--line)]")} />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

// The step's main action. On phones it floats above the app's bottom bar; on
// wide screens it sticks to the bottom of the page.
export function StudioBar({ children, note }: { children: ReactNode; note?: ReactNode }) {
  return (
    <div className="sticky bottom-[calc(5.75rem+env(safe-area-inset-bottom))] z-20 lg:bottom-4">
      <div className="rounded-2xl border border-[var(--line)] bg-[var(--bg-2)]/95 p-2 shadow-[0_10px_30px_rgba(0,0,0,0.55)] backdrop-blur lg:p-3">
        {note ? <p className="px-2 pb-2 pt-1 text-center text-xs leading-5 text-[var(--muted)] sm:hidden">{note}</p> : null}
        <div className="flex items-center gap-2">
          {note ? <div className="hidden min-w-0 flex-1 px-2 text-sm text-[var(--muted)] sm:block">{note}</div> : null}
          <div className={cx("flex min-w-0 flex-1 justify-end gap-2", note ? "sm:flex-none" : null)}>{children}</div>
        </div>
      </div>
    </div>
  );
}

// "8" with a coin, for buttons and summaries.
export function Cost({ credits, className }: { credits: number; className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-0.5 font-semibold tabular-nums", className)}>
      <CoinIcon className="h-4 w-4" />
      {credits}
      <span className="sr-only"> credits</span>
    </span>
  );
}

// The viewer's balance, linking to where more comes from.
export function BalancePill({ balance }: { balance: number }) {
  return (
    <Link
      href="/premium"
      className={cx(
        "inline-flex h-10 items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--surface)] px-4 text-sm font-semibold text-[var(--ink)] transition-colors hover:border-white/25",
        FOCUS,
      )}
    >
      <CoinIcon className="h-4 w-4 text-[var(--premium)]" />
      <span className="tabular-nums">{balance.toLocaleString("en-US")}</span>
      <span className="text-[var(--muted)]">credits</span>
    </Link>
  );
}

// A character's face for small places. Always the regular portrait.
export function Face({ person, className, sizes = "48px" }: { person: Pick<Character, "image" | "color"> | undefined; className?: string; sizes?: string }) {
  return (
    <span className={cx("relative block shrink-0 overflow-hidden rounded-full ring-1 ring-white/15", className)} style={{ background: person?.color ?? "#24242b" }}>
      {person?.image ? (
        <Image src={person.image} alt="" fill sizes={sizes} unoptimized={!isStaticArt(person.image)} className="object-cover object-top" />
      ) : null}
    </span>
  );
}

// A choice tile: art or a mood gradient behind a label. The art is always the
// character's regular portrait.
export function SceneTile({
  label,
  blurb,
  selected,
  onClick,
  image,
  tone,
  eager,
  compact,
}: {
  label: string;
  blurb: string;
  selected: boolean;
  onClick: () => void;
  // The character's regular portrait.
  image?: string;
  tone?: readonly [string, string];
  eager?: boolean;
  // A shorter tile on phones, for mood tiles with no art.
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cx(
        "group relative block w-full overflow-hidden rounded-2xl text-left transition duration-200",
        compact ? "aspect-[4/3] sm:aspect-[4/5]" : "aspect-[4/5]",
        selected ? cx("z-[1]", PICKED) : "ring-1 ring-white/5 hover:ring-white/25",
        FOCUS,
      )}
      style={tone ? { background: `linear-gradient(160deg, ${tone[1]} 0%, ${tone[0]} 75%)` } : { background: "var(--surface)" }}
    >
      {image ? (
        <Image
          src={image}
          alt=""
          fill
          sizes="(min-width: 1024px) 200px, (min-width: 640px) 30vw, 45vw"
          loading={eager ? "eager" : "lazy"}
          unoptimized={!isStaticArt(image)}
          className="object-cover object-top transition duration-300 group-hover:scale-[1.04]"
        />
      ) : tone ? (
        <span aria-hidden className="absolute inset-0 bg-[radial-gradient(90%_60%_at_80%_10%,rgba(255,255,255,0.35),transparent_60%)]" />
      ) : null}
      <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent px-3 pb-3 pt-10">
        {/* Two lines for the longer names ("Penthouse at night") on narrow tiles. */}
        <span className="line-clamp-2 text-sm font-bold leading-tight text-white sm:text-base sm:leading-tight">{label}</span>
        <span className="mt-1 line-clamp-2 text-xs leading-4 text-white/75">{blurb}</span>
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

// A motion choice: a title and a line.
export function MotionCard({ label, blurb, selected, onClick }: { label: string; blurb: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cx(
        "relative flex min-h-[4.5rem] w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition duration-200",
        selected
          ? "border-[var(--accent)] bg-[var(--accent-soft)] shadow-[0_12px_32px_-18px_rgba(255,79,139,0.8)]"
          : "border-[var(--line)] bg-[var(--surface)] hover:border-white/25 hover:bg-[var(--surface-2)]",
        FOCUS,
      )}
    >
      <span
        className={cx(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors",
          selected ? "bg-[var(--accent)] text-[var(--accent-ink)]" : "bg-[var(--surface-2)] text-[var(--muted)]",
        )}
      >
        <SparkIcon className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1 pr-6">
        <span className="block text-sm font-bold text-[var(--ink)]">{label}</span>
        <span className="mt-0.5 block text-xs leading-5 text-[var(--muted)]">{blurb}</span>
      </span>
      {selected ? (
        <span className={cx("absolute right-3 top-1/2 -mt-3 flex h-6 w-6 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--accent-ink)]", styles.pop)}>
          <CheckIcon className="h-3.5 w-3.5" />
        </span>
      ) : null}
    </button>
  );
}

export type Problem = { text: string; code?: string };

export const STUDIO_PAUSED = "The Studio is paused while we review this account.";

// The server's answer for an account that may not create here: one that never
// confirmed its age, or one on an explicit hold ("explicit_hold").
export function isAgeProblem(problem: Problem | null) {
  return problem?.code === "age_verification_required" || problem?.code === "explicit_hold";
}

// What went wrong with the last action, and the one thing that fixes it. A held
// account gets no "Confirm your age": confirming again doesn't lift a hold, a
// review does, so the server's explicit_hold (or an age error while /api/me
// already says held) is the paused message with nothing to click.
export function ProblemNotice({ problem, held, onDismiss }: { problem: Problem; held?: boolean; onDismiss?: () => void }) {
  const paused = problem.code === "explicit_hold" || (held === true && problem.code === "age_verification_required");
  let action: ReactNode = null;
  if (problem.code === "insufficient_credits") {
    action = (
      <ButtonLink href="/premium" size="sm" variant="premium">
        <CoinIcon className="h-4 w-4" />
        Get credits
      </ButtonLink>
    );
  } else if (problem.code === "age_verification_required" && !paused) {
    action = (
      <ButtonLink href="/verify" size="sm">
        Confirm your age
      </ButtonLink>
    );
  } else if (problem.code === "age_locked" || problem.code === "forbidden") {
    action = (
      <ButtonLink href="/safety" size="sm" variant="secondary">
        Get help
      </ButtonLink>
    );
  }
  return (
    <div
      role="alert"
      className={cx(
        "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-[var(--accent)]/30 bg-[var(--accent-soft)] px-4 py-3 text-sm text-[var(--ink)]",
        styles.fade,
      )}
    >
      {/* A full line of text on phones, with the buttons below it. */}
      <p className="min-w-0 flex-[1_1_15rem] leading-6">{paused ? STUDIO_PAUSED : problem.text}</p>
      {action}
      {onDismiss ? (
        <button type="button" onClick={onDismiss} className={cx("rounded-full px-2 py-1 text-xs font-semibold text-[var(--muted)] hover:text-[var(--ink)]", FOCUS)}>
          Dismiss
        </button>
      ) : null}
    </div>
  );
}

// The keyframe card while it's drawn: the portrait blurred and drifting, a band
// of light, a bar, and lines built from the viewer's own choices.
export function Developing({ preview, title, lines, color }: { preview?: string; title: string; lines: string[]; color?: string }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 1800);
    return () => window.clearInterval(timer);
  }, []);
  const line = lines[Math.min(tick, lines.length - 1)] ?? "";
  return (
    <div
      className="relative isolate flex aspect-[4/5] w-full flex-col items-center justify-center overflow-hidden rounded-3xl border border-[var(--line)] px-6 text-center"
      style={{ background: color ?? "var(--surface)" }}
      role="status"
    >
      {preview ? (
        <div className="absolute inset-0 -z-10 overflow-hidden" aria-hidden>
          <Image src={preview} alt="" fill sizes="64px" unoptimized={!isStaticArt(preview)} className={cx("object-cover opacity-50 blur-2xl", styles.drift)} />
        </div>
      ) : null}
      <div className={cx("absolute inset-0 -z-10", styles.sweep)} aria-hidden />
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(70%_50%_at_50%_50%,rgba(0,0,0,0.55),transparent)]" aria-hidden />
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-black/35 text-[var(--accent)] shadow-[0_0_40px_-4px_rgba(255,79,139,0.6)] ring-1 ring-white/10 backdrop-blur">
        <SparkIcon className="h-7 w-7" />
      </span>
      <p className="mt-5 text-lg font-bold text-white">{title}</p>
      <div className="mt-4 h-1 w-full max-w-[16rem] overflow-hidden rounded-full bg-white/10" aria-hidden>
        <div className={cx("h-full rounded-full bg-gradient-to-r from-[var(--accent)] to-[var(--accent-2)]", styles.bar)} />
      </div>
      <p aria-live="polite" className="mt-3 min-h-10 max-w-[18rem] text-sm leading-5 text-white/80">
        <span key={line} className={cx("block", styles.rise)}>
          {line}
        </span>
      </p>
    </div>
  );
}
