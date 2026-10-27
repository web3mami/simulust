"use client";

import Image from "next/image";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { ChevronRightIcon, CloseIcon } from "@/components/icons";
import { cx } from "@/components/ui";
import { STEP_LABELS, type Step } from "@/components/create/options";
import { CheckIcon } from "@/components/create/tiles";
import { useDialog } from "@/components/premium/use-dialog";
import styles from "@/components/create/motion.module.css";

export type SummaryRow = { step: Step; index: number; values: (string | null | false | undefined)[] };

type RowsProps = {
  rows: SummaryRow[];
  current: number;
  canVisit: (index: number) => boolean;
  onGo: (index: number) => void;
};

// Everything picked so far, grouped by step, as small chips. Each group jumps
// back to its step. Shared by the desktop panel and the phone sheet.
export function SummaryRows({ rows, current, canVisit, onGo }: RowsProps) {
  return (
    <ul className="divide-y divide-[var(--line)]">
      {rows.map((row) => {
        const values = row.values.filter((value): value is string => Boolean(value));
        const here = row.index === current;
        const open = !here && canVisit(row.index);
        return (
          <li key={row.step}>
            <button
              type="button"
              disabled={!open}
              onClick={() => onGo(row.index)}
              aria-label={open ? `Edit ${STEP_LABELS[row.step]}: ${values.join(", ") || "not picked yet"}` : undefined}
              className={cx(
                "flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left outline-none transition-colors focus-visible:bg-white/5",
                open && "hover:bg-white/5",
                here && "bg-[var(--accent-soft)]",
              )}
            >
              <span className="min-w-0 flex-1">
                <span
                  className={cx(
                    "block text-[11px] font-semibold uppercase tracking-wide",
                    here ? "text-[var(--accent)]" : "text-[var(--muted)]",
                  )}
                >
                  {STEP_LABELS[row.step]}
                </span>
                {values.length ? (
                  // Two lines at most; the rest is one tap away.
                  <span className="mt-1.5 flex max-h-[2.75rem] flex-wrap gap-1 overflow-hidden">
                    {values.map((value) => (
                      <span
                        key={value}
                        className="rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-xs font-medium text-[var(--ink)]"
                      >
                        {value}
                      </span>
                    ))}
                  </span>
                ) : (
                  <span className="mt-0.5 block text-sm text-[var(--muted)]/70">Not picked yet</span>
                )}
              </span>
              {open ? <ChevronRightIcon className="h-4 w-4 shrink-0 text-[var(--muted)]" /> : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// How far along: "3 of 6 steps" and a thin bar.
function Progress({ done, total, className }: { done: number; total: number; className?: string }) {
  return (
    <div className={className}>
      <div className="flex items-center justify-between text-[11px] font-semibold text-white/75">
        <span>
          {done} of {total} steps
        </span>
      </div>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/15" aria-hidden>
        <div
          className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-500 ease-out"
          style={{ width: `${(done / total) * 100}%` }}
        />
      </div>
    </div>
  );
}

// The preview picture: shimmers until it loads, then fades in. Keyed by the
// caller on the source so each new pick fades in fresh.
function Preview({ src, sizes, className }: { src: string; sizes: string; className?: string }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <Image
      src={src}
      alt=""
      fill
      sizes={sizes}
      onLoad={() => setLoaded(true)}
      className={cx("object-cover object-[50%_20%] transition-opacity duration-300", loaded ? "opacity-100" : "opacity-0", className)}
    />
  );
}

type PanelProps = RowsProps & {
  preview: string;
  title: string;
  subtitle: string;
  done: number;
  total: number;
  footer?: ReactNode;
};

// The desktop side panel: a preview, how far along, everything picked so far,
// and what the portrait costs.
export function SummaryPanel({ preview, title, subtitle, done, total, footer, ...rows }: PanelProps) {
  return (
    <aside aria-label="Your character so far" className="hidden lg:block">
      <div className="sticky top-20 flex flex-col gap-3">
        <div className="overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface)]">
          <div className={cx("relative aspect-[5/4] overflow-hidden", styles.shimmer)}>
            <Preview key={preview} src={preview} sizes="(min-width: 1280px) 336px, 272px" />
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent px-4 pb-3.5 pt-16">
              <p className="truncate text-lg font-bold text-white">{title}</p>
              <p className="truncate text-xs text-white/75">{subtitle}</p>
              <Progress done={done} total={total} className="mt-2.5" />
            </div>
            <span className="absolute left-3 top-3 rounded-full bg-black/55 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white backdrop-blur">
              Preview
            </span>
          </div>
          <SummaryRows {...rows} />
        </div>
        {footer}
      </div>
    </aside>
  );
}

// Phones: a slim row under the step bar with the preview, the name and an Edit
// button that opens every choice in a bottom sheet.
export function SummaryBar({ preview, title, subtitle, done, total, ...rows }: Omit<PanelProps, "footer">) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <div className="mt-4 lg:hidden">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="flex w-full items-center gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-2 pr-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      >
        <span className={cx("relative h-10 w-10 shrink-0 overflow-hidden rounded-full ring-1 ring-white/10", styles.shimmer)}>
          <Preview key={preview} src={preview} sizes="40px" />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm">
          <span className="font-semibold text-[var(--ink)]">{title}</span>
          <span className="text-[var(--muted)]"> · {subtitle}</span>
        </span>
        <span className="flex h-8 shrink-0 items-center rounded-full bg-[var(--surface-2)] px-3 text-xs font-semibold text-[var(--ink)]">
          Edit
        </span>
      </button>
      {open ? (
        <SummarySheet
          preview={preview}
          title={title}
          subtitle={subtitle}
          done={done}
          total={total}
          onClose={close}
          {...rows}
          onGo={(index) => {
            close();
            rows.onGo(index);
          }}
        />
      ) : null}
    </div>
  );
}

function SummarySheet({
  preview,
  title,
  subtitle,
  done,
  total,
  onClose,
  ...rows
}: Omit<PanelProps, "footer"> & { onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  useDialog(panel, onClose);
  return (
    <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Your character so far">
      <button
        type="button"
        tabIndex={-1}
        aria-label="Close"
        className={cx("absolute inset-0 cursor-default bg-black/70 backdrop-blur-sm", styles.fade)}
        onClick={onClose}
      />
      <div
        ref={panel}
        tabIndex={-1}
        className={cx(
          "absolute inset-x-0 bottom-0 max-h-[80dvh] overflow-y-auto overscroll-contain rounded-t-3xl bg-[var(--bg-2)] pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[0_-20px_60px_-20px_rgba(0,0,0,0.8)] outline-none ring-1 ring-white/10",
          styles.sheet,
        )}
      >
        <div className="flex items-center gap-3 px-4 pb-3 pt-4">
          <span className={cx("relative h-14 w-14 shrink-0 overflow-hidden rounded-2xl ring-1 ring-white/10", styles.shimmer)}>
            <Preview src={preview} sizes="56px" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-bold text-[var(--ink)]">{title}</p>
            <p className="truncate text-xs text-[var(--muted)]">{subtitle}</p>
            <div className="mt-2 flex items-center gap-2">
              <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/10" aria-hidden>
                <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${(done / total) * 100}%` }} />
              </div>
              <span className="flex shrink-0 items-center gap-1 text-[11px] font-semibold text-[var(--muted)]">
                {done === total ? <CheckIcon className="h-3 w-3 text-[var(--accent)]" /> : null}
                {done} of {total} steps
              </span>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="-mr-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[var(--muted)] hover:bg-white/5 hover:text-[var(--ink)]"
          >
            <CloseIcon />
          </button>
        </div>
        <div className="mx-3 overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface)]">
          <SummaryRows {...rows} />
        </div>
      </div>
    </div>
  );
}
