"use client";

import type { ReactNode } from "react";
import { ChevronLeftIcon } from "@/components/icons";
import { Button, cx } from "@/components/ui";

// Back and the step's one primary action. On phones it floats just above the
// app's bottom bar; on wide screens it sticks to the bottom of the step.
export function ActionBar({
  onBack,
  backDisabled,
  hint,
  message,
  children,
}: {
  onBack?: () => void;
  backDisabled?: boolean;
  // Why the primary action is not available yet.
  hint?: string | null;
  // An error or notice about the last action.
  message?: string | null;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-x-3 bottom-3 z-30 sm:inset-x-6 lg:sticky lg:inset-x-auto lg:bottom-4 lg:mt-10">
      <div className="rounded-2xl border border-[var(--line)] bg-[var(--bg-2)]/95 p-2 shadow-[0_10px_30px_rgba(0,0,0,0.55)] backdrop-blur lg:p-3">
        {message ? (
          <p role="alert" className="px-2 pb-2 pt-1 text-center text-sm text-red-300 sm:text-left">
            {message}
          </p>
        ) : hint ? (
          <p className="px-2 pb-2 pt-1 text-center text-xs text-[var(--muted)] sm:hidden">{hint}</p>
        ) : null}
        <div className="flex items-center gap-2">
          {onBack ? (
            <Button variant="secondary" size="lg" onClick={onBack} disabled={backDisabled} className="px-4 sm:px-5">
              <ChevronLeftIcon className="h-5 w-5" />
              Back
            </Button>
          ) : null}
          <p className={cx("hidden min-w-0 flex-1 px-2 text-sm text-[var(--muted)] sm:block", !hint && "invisible")}>{hint}</p>
          <div className="flex min-w-0 flex-1 justify-end sm:flex-none">{children}</div>
        </div>
      </div>
    </div>
  );
}
