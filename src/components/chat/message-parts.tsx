"use client";

import Link from "next/link";
import { useEffect, useRef, type ReactNode } from "react";
import { reportHref } from "@/components/chat/format";
import { CameraIcon, CloseIcon, FlagIcon, MicIcon, PlayIcon } from "@/components/icons";
import { ButtonLink, buttonClass, cx } from "@/components/ui";
import type { CrisisResource, MediaDTO } from "@/lib/api-types";

export type Problem = { text: string; code?: string };

// *actions* in asterisks render as italics, the way roleplay chats write them.
export function Rich({ text }: { text: string }) {
  const parts = text.split(/(\*[^*\n]+\*)/g);
  return (
    <>
      {parts.map((part, index) =>
        part.length > 2 && part.startsWith("*") && part.endsWith("*") ? (
          <em key={index} className="opacity-80">
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
    <span className="inline-flex h-6 items-center gap-1" aria-label={`${name} is typing`}>
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--muted)]" />
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--muted)] [animation-delay:150ms]" />
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--muted)] [animation-delay:300ms]" />
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
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-[var(--accent)]/30 bg-[var(--accent-soft)] px-4 py-2.5 text-sm"
    >
      <p className="min-w-0 flex-1 basis-48 text-[var(--ink)]">{problem.text}</p>
      <div className="flex items-center gap-1">
        {action}
        <button
          type="button"
          onClick={onDismiss}
          className="h-8 rounded-full px-3 text-xs font-medium text-[var(--muted)] hover:bg-white/5 hover:text-[var(--ink)]"
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
          className="-mr-2 -mt-1 h-8 shrink-0 rounded-full px-3 text-xs font-medium text-[var(--muted)] hover:bg-white/5 hover:text-[var(--ink)]"
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

// A photo, voice note or video inside a message bubble, including its pending
// and failed states. Photos open full size when tapped.
export function MediaView({
  media,
  name,
  stalled,
  onOpen,
}: {
  media: MediaDTO;
  name: string;
  stalled?: boolean;
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
    const Icon = media.kind === "video" ? PlayIcon : media.kind === "audio" ? MicIcon : CameraIcon;
    return (
      <div
        className={cx(
          "flex max-w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 bg-black/20 px-4 text-center text-xs text-[var(--muted)]",
          media.kind === "audio" ? "h-12 w-64 flex-row" : "aspect-[3/4] w-56",
        )}
      >
        <Icon className={cx("h-5 w-5", stalled ? "" : "animate-pulse")} />
        <span className={stalled ? "" : "animate-pulse"}>{label}</span>
      </div>
    );
  }
  if (media.status !== "ready" || !media.url) {
    return (
      <p className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-[var(--muted)]">
        {media.error ?? "This couldn't be created."} Any credits for it were returned.
      </p>
    );
  }
  if (media.kind === "image") {
    return (
      <button
        type="button"
        onClick={() => onOpen?.(media)}
        className="group block overflow-hidden rounded-xl focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
        aria-label={`Open photo from ${name}`}
      >
        <img
          src={media.url}
          alt={`Photo from ${name}`}
          className="max-h-96 w-auto max-w-full transition duration-300 group-hover:scale-[1.02]"
        />
      </button>
    );
  }
  if (media.kind === "video") {
    return <video controls playsInline src={media.url} className="max-h-96 w-auto max-w-full rounded-xl bg-black" />;
  }
  return <audio controls src={media.url} className="w-64 max-w-full" />;
}

// A photo full screen, with a way to report it.
export function Lightbox({ media, name, onClose }: { media: MediaDTO; name: string; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!media.url) return null;
  return (
    <div className="fixed inset-0 z-[60] flex flex-col" role="dialog" aria-modal="true" aria-label={`Photo from ${name}`}>
      <button
        type="button"
        aria-label="Close photo"
        tabIndex={-1}
        className="absolute inset-0 bg-black/90 backdrop-blur-sm transition-opacity starting:opacity-0"
        onClick={onClose}
      />
      <div className="relative flex items-center justify-end gap-2 p-3 sm:p-4">
        <Link href={reportHref(media.id)} className={buttonClass("secondary", "md")}>
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
      <div className="pointer-events-none relative flex min-h-0 flex-1 items-center justify-center px-3 pb-6 sm:px-8">
        <img
          src={media.url}
          alt={`Photo from ${name}`}
          className="pointer-events-auto max-h-full max-w-full rounded-2xl object-contain shadow-2xl"
        />
      </div>
    </div>
  );
}
