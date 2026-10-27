"use client";

import type { ReactNode } from "react";
import { Avatar } from "@/components/chat/avatar";
import { MediaView, Rich, TypingDots } from "@/components/chat/message-parts";
import { MicIcon, PlayIcon } from "@/components/icons";
import { cx } from "@/components/ui";
import type { CharacterDTO, MediaDTO, MessageDTO } from "@/lib/api-types";
import { COSTS } from "@/lib/pricing";

// Voice notes and videos made from a message, loaded with history or made during this visit.
export type Extra = { voice?: MediaDTO; video?: MediaDTO; busy?: "voice" | "video"; error?: string };

// One row in the conversation: the character's messages on the left on the
// surface colour, yours on the right in pink. Photos, voice notes and videos
// sit inside the bubble.
function Row({
  mine,
  person,
  showAvatar,
  children,
}: {
  mine: boolean;
  person: CharacterDTO;
  showAvatar: boolean;
  children: ReactNode;
}) {
  return (
    <div className={cx("flex gap-2.5", mine ? "justify-end" : "justify-start")}>
      {mine ? null : showAvatar ? <Avatar person={person} size="sm" className="mt-0.5" /> : <span className="w-8 shrink-0" />}
      <div className={cx("flex min-w-0 max-w-[85%] flex-col gap-1.5 sm:max-w-[75%]", mine ? "items-end" : "items-start")}>
        {children}
      </div>
    </div>
  );
}

function bubbleClass(mine: boolean, extra?: string) {
  return cx(
    "max-w-full overflow-hidden rounded-2xl text-[15px] leading-6",
    mine ? "rounded-br-md bg-[var(--accent)] text-[var(--accent-ink)]" : "rounded-bl-md bg-[var(--surface)] text-[var(--ink)]",
    extra,
  );
}

// A small labelled pill under a reply ("Voice · 4 credits"), with a 40px hit area.
function ExtraButton({
  icon,
  children,
  onClick,
  disabled,
}: {
  icon: ReactNode;
  children: ReactNode;
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
    </button>
  );
}

export function MessageBubble({
  message,
  person,
  extra,
  stalled,
  showAvatar,
  canVoice,
  canAnimate,
  onVoice,
  onVideo,
  onOpenPhoto,
}: {
  message: MessageDTO;
  person: CharacterDTO;
  extra?: Extra;
  stalled: ReadonlySet<string>;
  showAvatar: boolean;
  canVoice: boolean;
  canAnimate: boolean;
  onVoice: (message: MessageDTO) => void;
  onVideo: (message: MessageDTO, image: MediaDTO) => void;
  onOpenPhoto: (media: MediaDTO) => void;
}) {
  const name = person.name;
  const mine = message.role === "user";
  const pending = message.id.startsWith("pending-");
  const image = message.media?.kind === "image" && message.media.status === "ready" ? message.media : null;
  const media = [message.media, extra?.video, extra?.voice].filter((item): item is MediaDTO => Boolean(item));

  const showVoice = canVoice && message.content && (!extra?.voice || extra.voice.status === "failed");
  const showAnimate = canAnimate && image && (!extra?.video || extra.video.status === "failed");

  return (
    <Row mine={mine} person={person} showAvatar={showAvatar}>
      <div className={bubbleClass(mine, pending ? "opacity-70" : undefined)}>
        {message.content ? (
          <p className="whitespace-pre-wrap break-words px-4 py-2.5">
            <Rich text={message.content} />
          </p>
        ) : null}
        {media.length > 0 ? (
          <div className={cx("flex flex-col gap-1.5", message.content ? "px-1.5 pb-1.5" : "p-1.5")}>
            {media.map((item) => (
              <MediaView key={item.id} media={item} name={name} stalled={stalled.has(item.id)} onOpen={onOpenPhoto} />
            ))}
          </div>
        ) : null}
      </div>
      {!mine && (showVoice || showAnimate || extra?.error) ? (
        <div className="flex flex-wrap items-center gap-2 pt-0.5 text-[11px] text-[var(--muted)]">
          {showVoice ? (
            <ExtraButton icon={<MicIcon className="h-3.5 w-3.5" />} disabled={extra?.busy === "voice"} onClick={() => onVoice(message)}>
              {extra?.busy === "voice" ? "Recording…" : `Voice · ${COSTS.voiceNote} credits`}
            </ExtraButton>
          ) : null}
          {showAnimate ? (
            <ExtraButton icon={<PlayIcon className="h-3.5 w-3.5" />} disabled={extra?.busy === "video"} onClick={() => image && onVideo(message, image)}>
              {extra?.busy === "video" ? "Starting…" : `Animate · ${COSTS.video} credits`}
            </ExtraButton>
          ) : null}
          {extra?.error ? <span className="text-[var(--ink)]">{extra.error}</span> : null}
        </div>
      ) : null}
    </Row>
  );
}

// The reply as it streams in, or three dots before the first word.
export function StreamingBubble({ person, text, showAvatar }: { person: CharacterDTO; text: string; showAvatar: boolean }) {
  return (
    <Row mine={false} person={person} showAvatar={showAvatar}>
      <div className={bubbleClass(false)}>
        <p className="whitespace-pre-wrap break-words px-4 py-2.5">{text ? <Rich text={text} /> : <TypingDots name={person.name} />}</p>
      </div>
    </Row>
  );
}

// AI disclosures and other system lines, centred between messages.
export function NoticeLine({ children }: { children: ReactNode }) {
  return (
    <p className="mx-auto max-w-md rounded-2xl bg-[var(--surface)]/60 px-4 py-1.5 text-center text-[11px] leading-5 text-[var(--muted)]">
      {children}
    </p>
  );
}
