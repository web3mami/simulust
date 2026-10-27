"use client";

import { cx } from "@/components/ui";
import { CheckIcon } from "@/components/create/tiles";
import { STEP_LABELS, type Step } from "@/components/create/options";

// Where you are in the creator. Phones get "Step 3 of 7" and a segmented bar;
// wider screens get every step by name. Finished steps can be revisited.
export function Stepper({
  steps,
  current,
  done,
  canVisit,
  onGo,
}: {
  steps: Step[];
  current: number;
  done: (index: number) => boolean;
  canVisit: (index: number) => boolean;
  onGo: (index: number) => void;
}) {
  const step = steps[current];
  return (
    <nav aria-label="Creation steps">
      <div className="md:hidden">
        <div className="flex items-baseline justify-between gap-3 text-sm">
          <p className="font-semibold text-[var(--ink)]">
            <span className="text-[var(--accent)]">Step {current + 1}</span> of {steps.length}
          </p>
          <p className="truncate text-[var(--muted)]">
            {STEP_LABELS[step]}
            {steps[current + 1] ? <span className="text-[var(--muted)]/70"> · Next: {STEP_LABELS[steps[current + 1]]}</span> : null}
          </p>
        </div>
        <div className="mt-2.5 flex gap-1" aria-hidden>
          {steps.map((item, index) => (
            <span
              key={item}
              className={cx(
                "h-1.5 flex-1 rounded-full transition-colors",
                index <= current ? "bg-[var(--accent)]" : "bg-[var(--surface-2)]",
              )}
            />
          ))}
        </div>
      </div>

      <ol className="hidden items-center md:flex">
        {steps.map((item, index) => {
          const active = index === current;
          const finished = !active && done(index);
          const open = !active && canVisit(index);
          return (
            <li key={item} className={cx("flex items-center", index < steps.length - 1 && "flex-1")}>
              <button
                type="button"
                onClick={() => onGo(index)}
                disabled={!open}
                aria-current={active ? "step" : undefined}
                aria-label={`Step ${index + 1}: ${STEP_LABELS[item]}${finished ? ", done" : ""}`}
                className={cx(
                  "group flex h-10 shrink-0 items-center gap-2 rounded-full pr-2 text-sm font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
                  active ? "text-[var(--ink)]" : finished ? "text-[var(--ink)]/85" : "text-[var(--muted)]",
                  open ? "hover:text-[var(--ink)]" : "cursor-default",
                )}
              >
                <span
                  className={cx(
                    "flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition-colors",
                    active
                      ? "bg-[var(--accent)] text-[var(--accent-ink)] shadow-[0_0_0_4px_var(--accent-soft)]"
                      : finished
                        ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                        : "border border-[var(--line)] bg-[var(--surface)] text-[var(--muted)]",
                  )}
                >
                  {finished ? <CheckIcon className="h-4 w-4" /> : index + 1}
                </span>
                <span className={cx("whitespace-nowrap", active ? "inline" : "hidden xl:inline")}>{STEP_LABELS[item]}</span>
              </button>
              {index < steps.length - 1 ? (
                <span
                  aria-hidden
                  className={cx("mx-2 h-0.5 min-w-3 flex-1 rounded-full", index < current ? "bg-[var(--accent)]/60" : "bg-[var(--line)]")}
                />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
