"use client";

import Link from "next/link";
import type { ReactNode, RefObject } from "react";
import { CameraIcon, CoinIcon, SendIcon } from "@/components/icons";
import { buttonClass, cx } from "@/components/ui";

// The bottom of the conversation: what went wrong (if anything), the photo
// shortcut and your credits, then the message box. Enter sends, Shift+Enter
// starts a new line.
export function Composer({
  name,
  draft,
  onDraft,
  onSend,
  sending,
  ready,
  maxLength,
  textareaRef,
  problem,
  photo,
  credits,
}: {
  name: string;
  draft: string;
  onDraft: (value: string) => void;
  onSend: () => void;
  sending: boolean;
  // The conversation has loaded.
  ready: boolean;
  maxLength: number;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  problem?: ReactNode;
  // The "Send me a photo" shortcut, when photos are unlocked.
  photo?: { onClick: () => void; busy: boolean; disabled: boolean; cost: number } | null;
  credits?: { full: string; short: string; member: boolean } | null;
}) {
  const hint = draft.trim().length > 0;
  const nearLimit = draft.length > maxLength - 500;
  return (
    <div className="shrink-0 border-t border-[var(--line)] bg-[var(--bg-2)] px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2.5 sm:px-6">
      <div className="mx-auto w-full max-w-3xl">
        {problem ? <div className="mb-2.5">{problem}</div> : null}
        {photo || credits ? (
          <div className="mb-2 flex items-center gap-2">
            {photo ? (
              <button
                type="button"
                onClick={photo.onClick}
                disabled={photo.disabled}
                className="relative inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-[var(--accent)]/40 bg-[var(--accent-soft)] px-3 text-xs font-semibold text-[var(--accent)] transition-colors after:absolute after:-inset-1 hover:bg-[var(--accent)]/25 disabled:opacity-60"
                title={hint ? "Uses what you've typed as the idea for the photo" : undefined}
              >
                <CameraIcon className="h-4 w-4" />
                {photo.busy ? "Asking…" : `Send me a photo · ${photo.cost} credits`}
              </button>
            ) : null}
            {photo && hint && !photo.busy ? (
              <span className="hidden truncate text-[11px] text-[var(--muted)] sm:inline">Uses your text as the idea</span>
            ) : null}
            {credits ? (
              credits.member ? (
                <span className="ml-auto flex min-w-0 items-center gap-1.5 text-[11px] text-[var(--muted)]">
                  <CoinIcon className="h-4 w-4 shrink-0 text-[var(--premium)]" />
                  <span className="truncate sm:hidden">{credits.short}</span>
                  <span className="hidden truncate sm:inline">{credits.full}</span>
                </span>
              ) : (
                <Link
                  href="/premium"
                  title="Get credits"
                  className="ml-auto flex h-8 min-w-0 items-center gap-1.5 rounded-full px-2 text-[11px] text-[var(--muted)] hover:bg-white/5 hover:text-[var(--ink)]"
                >
                  <CoinIcon className="h-4 w-4 shrink-0 text-[var(--premium)]" />
                  <span className="truncate sm:hidden">{credits.short}</span>
                  <span className="hidden truncate sm:inline">{credits.full}</span>
                </Link>
              )
            ) : null}
          </div>
        ) : null}
        <form
          className="flex items-end gap-2 rounded-3xl border border-[var(--line)] bg-[var(--surface)] p-1.5 pl-4 transition-colors focus-within:border-[var(--accent)]/70"
          onSubmit={(event) => {
            event.preventDefault();
            onSend();
          }}
        >
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(event) => onDraft(event.target.value.slice(0, maxLength))}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                onSend();
              }
            }}
            rows={1}
            maxLength={maxLength}
            placeholder={`Text ${name}`}
            aria-label={`Message ${name}`}
            disabled={!ready}
            className="max-h-40 min-h-[44px] flex-1 resize-none bg-transparent py-2.5 text-[15px] leading-6 text-[var(--ink)] outline-none placeholder:text-[var(--muted)] disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={!draft.trim() || sending || !ready}
            aria-label="Send"
            className={buttonClass("primary", "md", "h-11 w-11 !px-0 sm:w-auto sm:!px-5")}
          >
            {sending ? (
              <span className="inline-flex gap-1" aria-hidden>
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:150ms]" />
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:300ms]" />
              </span>
            ) : (
              <SendIcon className="h-5 w-5" />
            )}
            <span className="hidden sm:inline">{sending ? "Sending" : "Send"}</span>
          </button>
        </form>
        <div
          className={cx(
            "mt-1.5 items-center justify-between gap-3 px-2 text-[11px] text-[var(--muted)]",
            nearLimit ? "flex" : "hidden sm:flex",
          )}
        >
          <span className="hidden sm:inline">Enter to send · Shift+Enter for a new line</span>
          {nearLimit ? (
            <span className="ml-auto">
              {draft.length.toLocaleString("en-US")} / {maxLength.toLocaleString("en-US")}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
