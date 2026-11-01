"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode, type RefObject } from "react";
import motion from "@/components/chat/chat-motion.module.css";
import { explicitPhotoIdeas, PHOTO_IDEAS } from "@/components/chat/format";
import { CameraIcon, CoinIcon, LockIcon, SendIcon, SparkIcon } from "@/components/icons";
import { Chip, cx } from "@/components/ui";

export type PhotoAction =
  // A confirmed adult: the photo menu and the 18+ quick actions, uncensored by
  // default. The server checks every request either way.
  | {
      kind: "ask";
      // `fromDraft`: the hint is what they typed, so the draft is used up.
      onPick: (hint: string | null, fromDraft?: boolean) => void;
      busy: boolean;
      disabled: boolean;
      cost: number;
    }
  // An older account that hasn't confirmed its age yet: one link to do it.
  | { kind: "confirm" }
  // An account on hold (it said it was under 18): photos are paused while we
  // review it, with nothing to click.
  | { kind: "paused" };

// The bottom of the conversation: what went wrong (if anything), a row of quick
// actions (a photo, reply starters) with your credits, then the message box.
// Enter sends, Shift+Enter starts a new line.
export function Composer({
  name,
  gender,
  draft,
  onDraft,
  onSend,
  sending,
  ready,
  maxLength,
  textareaRef,
  problem,
  photo,
  starters,
  onStarter,
  credits,
}: {
  name: string;
  // The character's, so the 18+ quick actions are worded for who they are
  // (a man is shirtless, not topless).
  gender?: string | null;
  draft: string;
  onDraft: (value: string) => void;
  onSend: () => void;
  sending: boolean;
  // The conversation has loaded, so a message can be sent.
  ready: boolean;
  maxLength: number;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  problem?: ReactNode;
  photo?: PhotoAction | null;
  // Fixed reply starters; tapping one fills the draft.
  starters: string[];
  onStarter: (text: string) => void;
  // Your credits, from the tightest wording to the fullest, by the room there is.
  credits?: { full: string; short: string; tiny: string } | null;
}) {
  const nearLimit = draft.length > maxLength - 500;
  const [ideasOpen, setIdeasOpen] = useState(false);

  useEffect(() => {
    if (!ideasOpen) return;
    // Anywhere but the menu and its chip closes it (the message box too).
    const onDown = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest("[data-photo-ideas]")) setIdeasOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setIdeasOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [ideasOpen]);

  const typed = draft.trim();
  const pick = (hint: string | null, fromDraft = false) => {
    setIdeasOpen(false);
    if (photo?.kind === "ask") photo.onPick(hint, fromDraft);
  };
  const ideaItem =
    "flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm text-[var(--ink)] transition-colors hover:bg-white/5";

  return (
    <div className="shrink-0 border-t border-[var(--line)] bg-[var(--bg-2)] px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 sm:px-6">
      <div className="@container relative mx-auto w-full max-w-3xl">
        {problem ? <div className="mb-2">{problem}</div> : null}

        {ideasOpen && photo?.kind === "ask" ? (
          <div
            data-photo-ideas
            role="menu"
            aria-label={`Photo ideas for ${name}`}
            className={cx(
              "absolute bottom-full left-0 z-30 mb-2 w-[min(20rem,100%)] origin-bottom-left rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-1.5 shadow-[0_16px_40px_rgba(0,0,0,0.55)]",
              motion.pop,
            )}
          >
            <p className="flex items-center justify-between gap-3 px-3 pb-1.5 pt-2 text-xs text-[var(--muted)]">
              <span>Ask {name} for a photo</span>
              <span className="inline-flex items-center gap-1 font-semibold text-[var(--premium)]">
                <CoinIcon className="h-3.5 w-3.5" />
                {photo.cost} credits
              </span>
            </p>
            {typed ? (
              <button type="button" role="menuitem" className={ideaItem} onClick={() => pick(typed.slice(0, 300), true)}>
                <CameraIcon className="h-5 w-5 shrink-0 text-[var(--accent)]" />
                <span className="min-w-0">
                  <span className="block font-medium">Use what I typed</span>
                  <span className="block truncate text-xs text-[var(--muted)]">{typed}</span>
                </span>
              </button>
            ) : null}
            <button type="button" role="menuitem" className={ideaItem} onClick={() => pick(null)}>
              <SparkIcon className="h-5 w-5 shrink-0 text-[var(--accent)]" />
              <span className="font-medium">Surprise me</span>
            </button>
            {PHOTO_IDEAS.map((idea) => (
              <button key={idea.label} type="button" role="menuitem" className={ideaItem} onClick={() => pick(idea.hint)}>
                <CameraIcon className="h-5 w-5 shrink-0 text-[var(--muted)]" />
                {idea.label}
              </button>
            ))}
          </div>
        ) : null}

        <div className="flex h-10 items-center gap-2">
          <div className="no-scrollbar -mx-1 flex min-w-0 flex-1 items-center gap-2 overflow-x-auto px-1 [mask-image:linear-gradient(to_right,#000_calc(100%-24px),transparent)]">
            {photo?.kind === "ask" ? (
              <button
                type="button"
                data-photo-ideas
                onClick={() => setIdeasOpen((value) => !value)}
                disabled={photo.disabled}
                aria-haspopup="menu"
                aria-expanded={ideasOpen}
                className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border border-[var(--accent)]/40 bg-[var(--accent-soft)] pl-3 pr-3.5 text-sm font-semibold text-[var(--accent)] transition-colors hover:bg-[var(--accent)]/25 disabled:opacity-60"
              >
                <CameraIcon className="h-4 w-4" />
                {photo.busy ? "Taking a photo…" : "Send me a photo"}
                {photo.busy ? null : (
                  <span className="ml-0.5 inline-flex items-center gap-0.5 text-xs text-[var(--premium)]" title={`${photo.cost} credits`}>
                    <CoinIcon className="h-3.5 w-3.5" />
                    {photo.cost}
                  </span>
                )}
              </button>
            ) : null}
            {photo?.kind === "confirm" ? (
              <Link
                href="/verify"
                className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--surface)] px-3.5 text-sm font-semibold text-[var(--muted)] transition-colors hover:text-[var(--ink)]"
                title="Photos open up once you confirm your age"
              >
                <LockIcon className="h-4 w-4" />
                Confirm your age
              </Link>
            ) : photo?.kind === "paused" ? (
              <span
                className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border border-[var(--line)] px-3.5 text-sm font-medium text-[var(--muted)]"
                title="Photos are paused while we review this account"
              >
                <LockIcon className="h-4 w-4" />
                Photos paused
              </span>
            ) : null}
            {starters.map((text) => (
              <Chip key={text} onClick={() => onStarter(text)}>
                {text}
              </Chip>
            ))}
            {photo?.kind === "ask"
              ? explicitPhotoIdeas(gender).map((idea) => (
                  <button
                    key={idea.label}
                    type="button"
                    onClick={() => pick(idea.hint)}
                    disabled={photo.disabled}
                    title={`${idea.label} · ${photo.cost} credits`}
                    aria-label={`${idea.label}, ${photo.cost} credits`}
                    className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border border-[var(--accent)]/30 bg-[var(--surface)] pl-3.5 pr-3 text-sm font-medium text-[var(--ink)] transition-colors hover:border-[var(--accent)]/60 hover:bg-[var(--accent-soft)] disabled:opacity-60"
                  >
                    {idea.label}
                    <span className="inline-flex items-center gap-0.5 text-xs text-[var(--premium)]" aria-hidden>
                      <CoinIcon className="h-3.5 w-3.5" />
                      {photo.cost}
                    </span>
                  </button>
                ))
              : null}
          </div>
          {credits ? (
            <Link
              href="/premium"
              title={credits.full}
              aria-label={`${credits.full}. Get credits`}
              className="flex h-10 shrink-0 items-center gap-1.5 rounded-full px-2 text-xs font-medium tabular-nums text-[var(--muted)] transition-colors hover:bg-white/5 hover:text-[var(--ink)]"
            >
              <CoinIcon className="h-4 w-4 shrink-0 text-[var(--premium)]" />
              <span className="@min-[420px]:hidden">{credits.tiny}</span>
              <span className="hidden @min-[420px]:inline @min-[720px]:hidden">{credits.short}</span>
              <span className="hidden @min-[720px]:inline">{credits.full}</span>
            </Link>
          ) : null}
        </div>

        <form
          className="mt-2 flex items-end gap-2 rounded-[26px] border border-[var(--line)] bg-[var(--surface)] p-1.5 pl-4 transition-colors focus-within:border-[var(--accent)]/70"
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
            placeholder={`Message ${name}`}
            aria-label={`Message ${name}`}
            enterKeyHint="send"
            autoComplete="off"
            className="max-h-[140px] min-h-[44px] flex-1 resize-none bg-transparent py-2.5 text-[15px] leading-6 text-[var(--ink)] outline-none placeholder:text-[var(--muted)]"
          />
          <button
            type="submit"
            disabled={!draft.trim() || sending || !ready}
            aria-label={sending ? "Sending" : "Send"}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--accent-ink)] shadow-[0_6px_18px_rgba(255,79,139,0.35)] transition-[background-color,opacity,box-shadow] hover:bg-[var(--accent-2)] disabled:pointer-events-none disabled:opacity-40 disabled:shadow-none"
          >
            {sending ? (
              <span className="inline-flex gap-1" aria-hidden>
                <span className={cx("h-1.5 w-1.5 rounded-full bg-current", motion.dot)} />
                <span className={cx("h-1.5 w-1.5 rounded-full bg-current", motion.dot)} />
                <span className={cx("h-1.5 w-1.5 rounded-full bg-current", motion.dot)} />
              </span>
            ) : (
              <SendIcon className="h-5 w-5" />
            )}
          </button>
        </form>
        {nearLimit ? (
          <p className="mt-1.5 px-2 text-right text-xs text-[var(--muted)]">
            {draft.length.toLocaleString("en-US")} / {maxLength.toLocaleString("en-US")}
          </p>
        ) : null}
      </div>
    </div>
  );
}
