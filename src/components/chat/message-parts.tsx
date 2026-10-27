"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import motion from "@/components/chat/chat-motion.module.css";
import { reportHref } from "@/components/chat/format";
import {
  CameraIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  CoinIcon,
  FlagIcon,
  MicIcon,
  PlayIcon,
} from "@/components/icons";
import { ButtonLink, buttonClass, cx } from "@/components/ui";
import type { CrisisResource, MediaDTO } from "@/lib/api-types";

export type Problem = { text: string; code?: string };

// *actions* in asterisks render as italics, the way roleplay chats write them,
// set back from the spoken words.
export function Rich({ text, mine = false }: { text: string; mine?: boolean }) {
  const parts = text.split(/(\*[^*\n]+\*)/g);
  return (
    <>
      {parts.map((part, index) =>
        part.length > 2 && part.startsWith("*") && part.endsWith("*") ? (
          <em key={index} className={mine ? "text-white/75" : "text-[var(--muted)]"}>
            {part.slice(1, -1)}
          </em>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </>
  );
}

export function TypingDots({ name }: { name: string }) {
  return (
    <span className="inline-flex h-6 items-center gap-1.5 px-0.5" role="status" aria-label={`${name} is typing`}>
      <span className={cx("h-2 w-2 rounded-full bg-[var(--ink)]/70", motion.dot)} />
      <span className={cx("h-2 w-2 rounded-full bg-[var(--ink)]/70", motion.dot)} />
      <span className={cx("h-2 w-2 rounded-full bg-[var(--ink)]/70", motion.dot)} />
    </span>
  );
}

// What went wrong with the last action, and the one thing that fixes it.
export function ProblemLine({ problem, onDismiss }: { problem: Problem; onDismiss: () => void }) {
  let action: ReactNode = null;
  if (problem.code === "insufficient_credits") {
    action = (
      <ButtonLink href="/premium" size="sm">
        Get credits
      </ButtonLink>
    );
  } else if (problem.code === "age_verification_required") {
    action = (
      <ButtonLink href="/verify" size="sm">
        Verify your age
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
        "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-[var(--accent)]/30 bg-[var(--accent-soft)] px-4 py-2.5 text-sm",
        motion.pop,
      )}
    >
      <p className="min-w-0 flex-1 basis-48 text-[var(--ink)]">{problem.text}</p>
      <div className="flex items-center gap-1">
        {action}
        <button
          type="button"
          onClick={onDismiss}
          className="h-10 rounded-full px-3 text-xs font-medium text-[var(--muted)] hover:bg-white/5 hover:text-[var(--ink)]"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

export function CrisisCard({ resources, onClose }: { resources: CrisisResource[]; onClose: () => void }) {
  return (
    <div
      role="region"
      aria-label="Crisis support"
      className="rounded-2xl border border-[var(--accent)]/50 bg-[var(--surface)] p-4 text-sm leading-6 text-[var(--ink)] sm:p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="font-semibold">
          If you&apos;re thinking about hurting yourself, you can talk to a real person right now. It&apos;s free and
          confidential.
        </p>
        <button
          type="button"
          onClick={onClose}
          className="-mr-2 -mt-1 h-10 shrink-0 rounded-full px-3 text-xs font-medium text-[var(--muted)] hover:bg-white/5 hover:text-[var(--ink)]"
        >
          Close
        </button>
      </div>
      <ul className="mt-3 space-y-2">
        {resources.map((resource) => (
          <li key={resource.label}>
            <span className="font-semibold text-[var(--accent)]">{resource.label}:</span>{" "}
            {resource.href ? (
              <a
                href={resource.href}
                className="underline underline-offset-2"
                target={resource.href.startsWith("http") ? "_blank" : undefined}
                rel="noreferrer"
              >
                {resource.detail}
              </a>
            ) : (
              resource.detail
            )}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-[var(--muted)]">If you&apos;re in immediate danger, call your local emergency number.</p>
    </div>
  );
}

// Solid glyphs for play and pause; the line icons read too thin on a photo.
function PlayGlyph({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M8 5.2v13.6a1 1 0 0 0 1.53.85l10.6-6.8a1 1 0 0 0 0-1.7L9.53 4.35A1 1 0 0 0 8 5.2z" />
    </svg>
  );
}

function PauseGlyph({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <rect x="6.5" y="5" width="4" height="14" rx="1.2" />
      <rect x="13.5" y="5" width="4" height="14" rx="1.2" />
    </svg>
  );
}

function duration(seconds: number | null) {
  if (seconds === null || !Number.isFinite(seconds)) return "";
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

// Photos and videos in a fixed 7:9 card (generated photos are 896x1152), so
// nothing in the conversation moves when they load.
const CARD = "relative aspect-[7/9] w-56 shrink-0 overflow-hidden rounded-2xl bg-[var(--surface-2)] ring-1 ring-white/10 sm:w-64";

function PhotoCard({ media, name, onOpen }: { media: MediaDTO; name: string; onOpen?: (media: MediaDTO) => void }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <button
      type="button"
      onClick={() => onOpen?.(media)}
      className={cx(
        CARD,
        "group block focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]",
        loaded ? null : motion.shimmer,
      )}
      aria-label={`Open photo from ${name}`}
    >
      {/* Generated media needs the viewer's login, so it can't go through next/image. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={(img) => {
          // Already decoded (from cache) before React attached onLoad.
          if (img?.complete && img.naturalWidth > 0) setLoaded(true);
        }}
        src={media.url ?? undefined}
        alt={`Photo from ${name}`}
        loading="lazy"
        decoding="async"
        draggable={false}
        onLoad={() => setLoaded(true)}
        onError={() => setLoaded(true)}
        className={cx(
          "absolute inset-0 h-full w-full object-cover transition-[opacity,filter,scale] duration-500 ease-out group-hover:scale-[1.03] motion-reduce:transition-none",
          loaded ? "scale-100 opacity-100 blur-0" : "scale-[1.04] opacity-0 blur-md",
        )}
      />
    </button>
  );
}

function VideoCard({ media, name, poster }: { media: MediaDTO; name: string; poster?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);
  const [length, setLength] = useState<number | null>(null);
  return (
    <div className={cx(CARD, "group bg-black")}>
      <video
        ref={videoRef}
        src={media.url ?? undefined}
        poster={poster}
        preload="metadata"
        playsInline
        controls={started}
        onLoadedMetadata={(event) => setLength(event.currentTarget.duration)}
        className="absolute inset-0 h-full w-full object-cover"
        aria-label={`Video from ${name}`}
      />
      {started ? null : (
        <button
          type="button"
          onClick={() => {
            setStarted(true);
            void videoRef.current?.play().catch(() => {
              // Autoplay refused: the controls are showing now, so they can press play.
            });
          }}
          className="absolute inset-0 flex items-center justify-center bg-black/10 transition-colors hover:bg-black/0"
          aria-label={`Play video from ${name}`}
        >
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-black/55 text-white ring-1 ring-white/25 backdrop-blur transition-transform group-hover:scale-105">
            <PlayGlyph className="h-6 w-6 translate-x-0.5" />
          </span>
          {length ? (
            <span className="absolute bottom-2.5 left-2.5 rounded-full bg-black/60 px-2 py-0.5 text-xs font-semibold tabular-nums text-white backdrop-blur">
              {duration(length)}
            </span>
          ) : null}
        </button>
      )}
    </div>
  );
}

// A voice note: play, a thin progress line and the time, over a hidden <audio>.
function VoicePill({ media, name }: { media: MediaDTO; name: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [length, setLength] = useState<number | null>(null);
  const [at, setAt] = useState(0);
  const progress = length && Number.isFinite(length) ? Math.min(1, at / length) : 0;
  return (
    <div className="flex h-11 w-64 max-w-full items-center gap-3 rounded-full bg-[var(--surface-2)] pl-1 pr-4 ring-1 ring-white/5">
      <button
        type="button"
        onClick={() => {
          const audio = audioRef.current;
          if (!audio) return;
          if (audio.paused) void audio.play().catch(() => setPlaying(false));
          else audio.pause();
        }}
        aria-label={playing ? "Pause voice note" : `Play voice note from ${name}`}
        className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-white transition-colors after:absolute after:-inset-1 hover:bg-[var(--accent-2)]"
      >
        {playing ? <PauseGlyph className="h-4 w-4" /> : <PlayGlyph className="h-4 w-4 translate-x-px" />}
      </button>
      <span className="relative h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-white/15" aria-hidden>
        <span className="absolute inset-y-0 left-0 rounded-full bg-[var(--ink)]" style={{ width: `${progress * 100}%` }} />
      </span>
      <span className="shrink-0 text-xs tabular-nums text-[var(--muted)]">{duration(at > 0 ? at : length)}</span>
      <audio
        ref={audioRef}
        src={media.url ?? undefined}
        preload="metadata"
        onLoadedMetadata={(event) => setLength(event.currentTarget.duration)}
        onTimeUpdate={(event) => setAt(event.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setAt(0);
        }}
        className="hidden"
      />
    </div>
  );
}

// A photo or video card that is still being made.
export function PendingCard({ label, detail, kind = "image", stalled }: { label: string; detail?: string; kind?: "image" | "video"; stalled?: boolean }) {
  const Icon = kind === "video" ? PlayIcon : CameraIcon;
  return (
    <div className={cx(CARD, "flex flex-col items-center justify-center gap-2 px-5 text-center")} role="status">
      {stalled ? null : <span className={cx("absolute inset-0", motion.sweep)} aria-hidden />}
      <span className="relative flex h-11 w-11 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent)]">
        <Icon className={cx("h-5 w-5", stalled ? null : "animate-pulse motion-reduce:animate-none")} />
      </span>
      <span className="relative text-sm font-medium leading-5 text-[var(--ink)]">{label}</span>
      {detail ? <span className="relative line-clamp-2 text-xs leading-5 text-[var(--muted)]">{detail}</span> : null}
    </div>
  );
}

// A photo, voice note or video in a message, including its pending and failed
// states. Photos open full size when tapped; a video shows the photo it came from.
export function MediaView({
  media,
  name,
  stalled,
  poster,
  onOpen,
}: {
  media: MediaDTO;
  name: string;
  stalled?: boolean;
  poster?: string;
  onOpen?: (media: MediaDTO) => void;
}) {
  if (media.status === "pending") {
    const label = stalled
      ? "Still working on it. Reload the page later to check."
      : media.kind === "video"
        ? "Making the video…"
        : media.kind === "audio"
          ? "Recording…"
          : "Taking the photo…";
    if (media.kind === "audio") {
      return (
        <div className="flex h-11 w-64 max-w-full items-center gap-3 rounded-full bg-[var(--surface-2)] px-4 text-xs text-[var(--muted)]" role="status">
          <MicIcon className={cx("h-4 w-4 text-[var(--accent)]", stalled ? null : "animate-pulse motion-reduce:animate-none")} />
          {label}
        </div>
      );
    }
    return <PendingCard label={label} kind={media.kind} stalled={stalled} />;
  }
  if (media.status !== "ready" || !media.url) {
    return (
      <p className="max-w-64 rounded-2xl border border-white/10 bg-[var(--surface)] px-3.5 py-2.5 text-xs leading-5 text-[var(--muted)]">
        {media.error ?? "This couldn't be created."} Any credits for it were returned.
      </p>
    );
  }
  if (media.kind === "image") return <PhotoCard media={media} name={name} onOpen={onOpen} />;
  if (media.kind === "video") return <VideoCard media={media} name={name} poster={poster} />;
  return <VoicePill media={media} name={name} />;
}

export type LightboxPhoto = { media: MediaDTO; canAnimate?: boolean };

// Photos full screen: page with the arrows, arrow keys or a swipe; report any of
// them, and animate one when that's on offer.
export function Lightbox({
  photos,
  index,
  onIndex,
  name,
  onClose,
  onAnimate,
  animateCost,
}: {
  photos: LightboxPhoto[];
  index: number;
  onIndex: (index: number) => void;
  name: string;
  onClose: () => void;
  onAnimate?: (index: number) => void;
  animateCost?: number;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const swipeRef = useRef<{ x: number; y: number } | null>(null);
  const count = photos.length;
  const current = photos[Math.min(index, count - 1)];

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      else if (event.key === "ArrowLeft" && index > 0) onIndex(index - 1);
      else if (event.key === "ArrowRight" && index < count - 1) onIndex(index + 1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, onIndex, index, count]);

  // Fetch the neighbours so paging is instant.
  useEffect(() => {
    for (const near of [photos[index - 1], photos[index + 1]]) {
      if (near?.media.url) new window.Image().src = near.media.url;
    }
  }, [photos, index]);

  if (!current?.media.url) return null;

  function onPointerDown(event: ReactPointerEvent) {
    swipeRef.current = { x: event.clientX, y: event.clientY };
  }
  function onPointerUp(event: ReactPointerEvent) {
    const start = swipeRef.current;
    swipeRef.current = null;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy)) return;
    if (dx < 0 && index < count - 1) onIndex(index + 1);
    if (dx > 0 && index > 0) onIndex(index - 1);
  }

  const arrow =
    "absolute top-1/2 z-10 hidden h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white ring-1 ring-white/15 backdrop-blur transition-colors hover:bg-black/70 sm:flex";

  return (
    <div className="fixed inset-0 z-[60] flex flex-col" role="dialog" aria-modal="true" aria-label={`Photos from ${name}`}>
      <button
        type="button"
        aria-label="Close photo"
        tabIndex={-1}
        className={cx("absolute inset-0 bg-black/90 backdrop-blur-sm", motion.fade)}
        onClick={onClose}
      />
      <div className="relative flex items-center gap-2 p-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:p-4">
        {count > 1 ? (
          <span className="rounded-full bg-black/50 px-3 py-1.5 text-xs font-semibold tabular-nums text-white ring-1 ring-white/15">
            {index + 1} / {count}
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          {onAnimate && current.canAnimate ? (
            <button type="button" onClick={() => onAnimate(index)} className={buttonClass("secondary", "md")}>
              <PlayIcon className="h-4 w-4" />
              Animate
              <span className="inline-flex items-center gap-0.5 text-xs text-[var(--premium)]">
                <CoinIcon className="h-3.5 w-3.5" />
                {animateCost}
              </span>
            </button>
          ) : null}
          <Link href={reportHref(current.media.id)} className={buttonClass("secondary", "md")}>
            <FlagIcon className="h-4 w-4" />
            Report
          </Link>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className={buttonClass("secondary", "md", "w-10 !px-0")}
            aria-label="Close photo"
          >
            <CloseIcon />
          </button>
        </div>
      </div>
      <div
        className="pointer-events-none relative flex min-h-0 flex-1 touch-pan-y items-center justify-center px-3 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-20"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (swipeRef.current = null)}
      >
        {index > 0 ? (
          <button type="button" onClick={() => onIndex(index - 1)} className={cx(arrow, "pointer-events-auto left-4")} aria-label="Previous photo">
            <ChevronLeftIcon className="h-6 w-6" />
          </button>
        ) : null}
        {/* eslint-disable-next-line @next/next/no-img-element -- generated media, see PhotoCard */}
        <img
          key={current.media.id}
          src={current.media.url}
          alt={`Photo from ${name}`}
          draggable={false}
          className={cx("pointer-events-auto max-h-full max-w-full select-none rounded-2xl object-contain shadow-2xl", motion.zoom)}
        />
        {index < count - 1 ? (
          <button type="button" onClick={() => onIndex(index + 1)} className={cx(arrow, "pointer-events-auto right-4")} aria-label="Next photo">
            <ChevronRightIcon className="h-6 w-6" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
