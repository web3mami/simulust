"use client";

import type { ReactNode } from "react";
import { ChevronRightIcon } from "@/components/icons";
import { cx } from "@/components/ui";
import { STEP_LABELS, type Step } from "@/components/create/options";

export type SummaryRow = { step: Step; index: number; values: (string | null | false | undefined)[] };

// The desktop side panel: a preview, everything picked so far grouped by step
// (each group jumps back to its step), and what the portrait costs.
export function SummaryPanel({
  preview,
  title,
  subtitle,
  rows,
  current,
  canVisit,
  onGo,
  footer,
}: {
  preview: string;
  title: string;
  subtitle: string;
  rows: SummaryRow[];
  current: number;
  canVisit: (index: number) => boolean;
  onGo: (index: number) => void;
  footer?: ReactNode;
}) {
  return (
    <aside aria-label="Your character so far" className="hidden lg:block">
      <div className="sticky top-20 flex flex-col gap-3">
        <div className="overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface)]">
          <div className="relative aspect-[5/4] overflow-hidden bg-[var(--surface-2)]">
            <img src={preview} alt="" className="absolute inset-0 h-full w-full object-cover object-[50%_20%]" />
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent px-4 pb-3.5 pt-16">
              <p className="truncate text-lg font-bold text-white">{title}</p>
              <p className="truncate text-xs text-white/75">{subtitle}</p>
            </div>
            <span className="absolute left-3 top-3 rounded-full bg-black/55 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white backdrop-blur">
              Preview
            </span>
          </div>
          <ul className="divide-y divide-[var(--line)]">
            {rows.map((row) => {
              const text = row.values.filter(Boolean).join(" · ");
              const here = row.index === current;
              const open = !here && canVisit(row.index);
              return (
                <li key={row.step}>
                  <button
                    type="button"
                    disabled={!open}
                    onClick={() => onGo(row.index)}
                    aria-label={open ? `Edit ${STEP_LABELS[row.step]}` : undefined}
                    className={cx(
                      "flex w-full items-center gap-3 px-4 py-2.5 text-left outline-none transition-colors focus-visible:bg-white/5",
                      open && "hover:bg-white/5",
                      here && "bg-[var(--accent-soft)]",
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className={cx("block text-[11px] font-semibold uppercase tracking-wide", here ? "text-[var(--accent)]" : "text-[var(--muted)]")}>
                        {STEP_LABELS[row.step]}
                      </span>
                      <span className={cx("mt-0.5 block truncate text-sm", text ? "text-[var(--ink)]" : "text-[var(--muted)]/70")}>
                        {text || "Not picked yet"}
                      </span>
                    </span>
                    {open ? <ChevronRightIcon className="h-4 w-4 text-[var(--muted)]" /> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
        {footer}
      </div>
    </aside>
  );
}
