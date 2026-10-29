"use client";

import type { ReactNode } from "react";
import { Avatar } from "@/components/chat/avatar";
import motion from "@/components/chat/chat-motion.module.css";
import { clockTime, type GroupPosition } from "@/components/chat/format";
import { MediaView, PendingCard, Rich, TypingDots, type MediaLock } from "@/components/chat/message-parts";
import { CoinIcon, MicIcon, PlayIcon } from "@/components/icons";
import { cx } from "@/components/ui";
import type { CharacterDTO, MediaDTO, MessageDTO } from "@/lib/api-types";
import { COSTS } from "@/lib/pricing";

// Voice notes and videos made from a message, loaded with history or made during this visit.
export type Extra = { voice?: MediaDTO; video?: MediaDTO; busy?: "voice" | "video"; error?: string };

const ends = (position: GroupPosition) => position === "last" || position === "single";

// One message in the conversation: the character's on the left beside their
// avatar (on the last of a run, messenger style), yours on the right. Runs from
// the same sender sit close together; a new run starts further down.
function Row({
  mine,
  person,
  position,
  fresh,
  hoverTime,
  below,
  children,
}: {
  mine: boolean;
  person: CharacterDTO;
  position: GroupPosition;
  // Just arrived during this visit, so it rises in.
  fresh?: boolean;
  // The time beside the bubble on hover, for messages that don't show it below.
  hoverTime?: ReactNode;
  below?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      className={cx(
        "group/msg flex w-full flex-col",
        mine ? "items-end" : "items-start",
        position === "first" || position === "single" ? "mt-4" : "mt-0.5",
        fresh && motion.rise,
      )}
    >
      <div className={cx("flex w-full items-end gap-2", mine ? "justify-end" : "justify-start")}>
        {mine ? null : ends(position) ? <Avatar person={person} size="sm" /> : <span className="w-8 shrink-0" aria-hidden />}
        <div className={cx("relative flex min-w-0 max-w-[85%] flex-col gap-1 sm:max-w-[75%]", mine ? "items-end" : "items-start")}>
          {children}
          {hoverTime}
        </div>
      </div>
      {below ? <div className={cx("mt-1 flex flex-col gap-1.5", mine ? "items-end pr-1" : "items-start pl-10")}>{below}</div> : null}
    </div>
  );
}

// Rounded all round, with the corners that face the rest of the run tucked in.
function bubbleClass(mine: boolean, position: GroupPosition, extra?: string) {
  const tucked = mine
    ? { single: "rounded-br-md", first: "rounded-br-md", middle: "rounded-r-md", last: "rounded-tr-md" }
    : { single: "rounded-bl-md", first: "rounded-bl-md", middle: "rounded-l-md", last: "rounded-tl-md" };
  return cx(
    "max-w-full overflow-hidden rounded-[20px] text-[15px] leading-6",
    tucked[position],
    // A deeper pink than the accent so white text stays readable (about 5:1).
    mine
      ? "bg-[linear-gradient(135deg,#c92a64,#9f2257)] text-[#fff] shadow-[0_1px_0_rgba(255,255,255,0.08)_inset]"
      : "bg-[var(--surface-2)] text-[var(--ink)]",
    extra,
  );
}

function Time({ iso, className }: { iso: string; className?: string }) {
  return (
    <time dateTime={iso} className={cx("px-1 text-xs text-[var(--muted)]", className)}>
      {clockTime(iso)}
    </time>
  );
}

// A small pill under a reply ("Voice · 4"), with a 40px hit area.
function ExtraButton({
  icon,
  children,
  cost,
  onClick,
  disabled,
}: {
  icon: ReactNode;
  children: ReactNode;
  cost?: number;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="relative inline-flex h-8 items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--bg-2)] px-3 text-xs font-medium text-[var(--muted)] transition-colors after:absolute after:-inset-1 hover:border-white/20 hover:text-[var(--ink)] disabled:opacity-60"
    >
      {icon}
      {children}
      {cost ? (
        <span className="inline-flex items-center gap-0.5 text-[var(--premium)]" title={`${cost} credits`}>
          <CoinIcon className="h-3.5 w-3.5" />
          {cost}
        </span>
      ) : null}
    </button>
  );
}

export function MessageBubble({
  message,
  person,
  extra,
  stalled,
  position,
  stamped,
  timeShown,
  onToggleTime,
  canVoice,
  canAnimate,
  onVoice,
  onVideo,
  onOpenPhoto,
  lock,
}: {
  message: MessageDTO;
  person: CharacterDTO;
  extra?: Extra;
  stalled: ReadonlySet<string>;
  position: GroupPosition;
  // Ends a burst of messages, so its time always shows underneath.
  stamped: boolean;
  // Tapped open on a touch screen (desktop shows it on hover).
  timeShown: boolean;
  onToggleTime: () => void;
  canVoice: boolean;
  canAnimate: boolean;
  onVoice: (message: MessageDTO) => void;
  onVideo: (message: MessageDTO, image: MediaDTO) => void;
  onOpenPhoto: (media: MediaDTO) => void;
  // What a locked 18+ photo or video says: paused (on hold) or confirm your age.
  lock?: MediaLock;
}) {
  const name = person.name;
  const mine = message.role === "user";
  const pending = message.id.startsWith("pending-");
  const image = message.media?.kind === "image" && message.media.status === "ready" ? message.media : null;
  const media = [message.media, extra?.video, extra?.voice].filter((item): item is MediaDTO => Boolean(item));

  const showVoice = canVoice && message.content && (!extra?.voice || extra.voice.status === "failed");
  const showAnimate = canAnimate && image && (!extra?.video || extra.video.status === "failed");
  const lastOfRun = ends(position);

  const actions =
    !mine && (showVoice || showAnimate || extra?.error) ? (
      <div className="flex flex-wrap items-center gap-2 pt-0.5 text-xs text-[var(--muted)]">
        {showVoice ? (
          <ExtraButton
            icon={<MicIcon className="h-3.5 w-3.5" />}
            cost={extra?.busy === "voice" ? undefined : COSTS.voiceNote}
            disabled={extra?.busy === "voice"}
            onClick={() => onVoice(message)}
          >
            {extra?.busy === "voice" ? "Recording…" : "Voice"}
          </ExtraButton>
        ) : null}
        {showAnimate ? (
          <ExtraButton
            icon={<PlayIcon className="h-3.5 w-3.5" />}
            cost={extra?.busy === "video" ? undefined : COSTS.video}
            disabled={extra?.busy === "video"}
            onClick={() => image && onVideo(message, image)}
          >
            {extra?.busy === "video" ? "Starting…" : "Animate"}
          </ExtraButton>
        ) : null}
        {extra?.error ? <span className="text-[var(--ink)]">{extra.error}</span> : null}
      </div>
    ) : null;

  const time = pending ? (
    lastOfRun ? (
      <span className="px-1 text-xs text-[var(--muted)]">Sending…</span>
    ) : null
  ) : stamped || timeShown ? (
    <Time iso={message.createdAt} />
  ) : null;

  const below =
    actions || time ? (
      <>
        {actions}
        {time}
      </>
    ) : null;

  return (
    <Row
      mine={mine}
      person={person}
      position={position}
      fresh={pending}
      below={below}
      hoverTime={
        stamped || pending ? null : (
          <Time
            iso={message.createdAt}
            className={cx(
              "pointer-events-none absolute bottom-1.5 hidden whitespace-nowrap opacity-0 transition-opacity group-hover/msg:opacity-100 [@media(hover:hover)]:block",
              mine ? "right-full mr-1" : "left-full ml-1",
            )}
          />
        )
      }
    >
      {message.content ? (
        <div
          className={bubbleClass(mine, position, pending ? "opacity-70" : undefined)}
          onClick={() => {
            // Touch screens have no hover: a tap shows the time instead.
            if (stamped || window.getSelection()?.toString()) return;
            if (window.matchMedia("(hover: none)").matches) onToggleTime();
          }}
        >
          <p className="whitespace-pre-wrap break-words px-4 py-2.5">
            <Rich text={message.content} mine={mine} />
          </p>
        </div>
      ) : null}
      {media.map((item) => (
        <MediaView
          key={item.id}
          media={item}
          name={name}
          stalled={stalled.has(item.id)}
          poster={item.kind === "video" ? (image?.url ?? undefined) : undefined}
          onOpen={onOpenPhoto}
          lock={lock}
        />
      ))}
    </Row>
  );
}

// The reply as it streams in, or the typing dots before the first word.
export function StreamingBubble({ person, text, position }: { person: CharacterDTO; text: string; position: GroupPosition }) {
  return (
    <Row
      mine={false}
      person={person}
      position={position}
      fresh
      // Keeps the line the time will take, so the finished reply doesn't nudge the list.
      below={<span className="invisible px-1 text-xs" aria-hidden>0:00</span>}
    >
      <div className={bubbleClass(false, position)} aria-live="polite">
        <p className="whitespace-pre-wrap break-words px-4 py-2.5">{text ? <Rich text={text} /> : <TypingDots name={person.name} />}</p>
      </div>
    </Row>
  );
}

// The photo you just asked for, shown at once while it's being taken.
export function PendingPhoto({ person, idea, position }: { person: CharacterDTO; idea: string | null; position: GroupPosition }) {
  return (
    <Row mine={false} person={person} position={position} fresh>
      <PendingCard label={`${person.name} is taking a photo…`} detail={idea ?? undefined} />
    </Row>
  );
}

// AI disclosures and other system lines, centred between messages.
export function NoticeLine({ children }: { children: ReactNode }) {
  return (
    <p className="mx-auto mt-4 max-w-md rounded-2xl bg-[var(--surface)]/70 px-3 py-1.5 text-center text-xs leading-5 text-[var(--muted)] ring-1 ring-white/5">
      {children}
    </p>
  );
}

// "Today", "Yesterday", "Mar 4" between days.
export function DaySeparator({ label }: { label: string }) {
  return (
    <div role="separator" aria-label={label} className="mb-1 mt-6 flex items-center gap-3 text-xs font-medium text-[var(--muted)] first:mt-2">
      <span className="h-px flex-1 bg-[var(--line)]" aria-hidden />
      {label}
      <span className="h-px flex-1 bg-[var(--line)]" aria-hidden />
    </div>
  );
}
