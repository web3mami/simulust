"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Avatar } from "@/components/chat/avatar";
import motion from "@/components/chat/chat-motion.module.css";
import { reportHref } from "@/components/chat/format";
import { BrainIcon, ChatIcon, ChevronLeftIcon, FlagIcon, GalleryIcon, MoreIcon, SettingsIcon, UserIcon } from "@/components/icons";
import { Badge, cx } from "@/components/ui";
import type { CharacterDTO } from "@/lib/api-types";

const iconButton =
  "flex h-10 shrink-0 items-center justify-center gap-2 rounded-full text-sm font-medium text-[var(--ink)] transition-colors hover:bg-white/5";

// Top of the conversation: back to the list on phones, who you're talking to
// (and whether they're typing), then Memories, Profile and More. On phones it
// is the only bar, so it clears the notch.
export function ChatHeader({
  person,
  subtitle,
  profileOpen,
  onToggleProfile,
  onPhotos,
}: {
  person: CharacterDTO;
  subtitle?: ReactNode;
  profileOpen: boolean;
  onToggleProfile: () => void;
  // Opens the profile at the photo gallery.
  onPhotos: () => void;
}) {
  return (
    <header className="shrink-0 border-b border-[var(--line)] bg-[var(--bg-2)] pt-[env(safe-area-inset-top)] lg:pt-0">
      <div className="flex h-14 items-center gap-1 px-1.5 sm:gap-2 sm:px-4 lg:h-16">
        <Link href="/chat" aria-label="Back to chats" className={cx(iconButton, "w-10 lg:hidden")}>
          <ChevronLeftIcon className="h-6 w-6" />
        </Link>
        <button
          type="button"
          onClick={onToggleProfile}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-xl py-1 pr-2 text-left"
          aria-label={`${person.name}'s profile`}
        >
          <Avatar person={person} size="md" />
          <span className="min-w-0">
            <span className="flex items-center gap-2">
              <span className="truncate text-base font-bold leading-6 text-[var(--ink)]">{person.name}</span>
              <Badge tone="accent" title="AI character">
                AI
              </Badge>
            </span>
            {subtitle ? <span className="block truncate text-xs leading-4 text-[var(--muted)]">{subtitle}</span> : null}
          </span>
        </button>

        <div className="flex items-center gap-0.5 sm:gap-1">
          <Link href={`/memories/${encodeURIComponent(person.id)}`} className={cx(iconButton, "w-10 xl:w-auto xl:px-3")} title="Memories">
            <BrainIcon />
            <span className="sr-only xl:not-sr-only">Memories</span>
          </Link>
          <button
            type="button"
            onClick={onToggleProfile}
            aria-expanded={profileOpen}
            className={cx(iconButton, "w-10 xl:w-auto xl:px-3", profileOpen && "text-[var(--accent)]")}
            title={profileOpen ? "Hide profile" : "Show profile"}
          >
            <UserIcon />
            <span className="sr-only xl:not-sr-only">Profile</span>
          </button>
          <MoreMenu person={person} onPhotos={onPhotos} />
        </div>
      </div>
    </header>
  );
}

function MoreMenu({ person, onPhotos }: { person: CharacterDTO; onPhotos: () => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const item =
    "flex h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm text-[var(--ink)] transition-colors hover:bg-white/5";
  const close = () => setOpen(false);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label="More"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={cx(iconButton, "w-10", open && "bg-white/5")}
        title="More"
      >
        <MoreIcon />
      </button>
      {open ? (
        <div
          role="menu"
          aria-label={`More for ${person.name}`}
          className={cx(
            "absolute right-0 top-12 z-30 w-60 origin-top-right rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-1.5 shadow-[0_16px_40px_rgba(0,0,0,0.55)]",
            motion.pop,
          )}
        >
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={() => {
              close();
              onPhotos();
            }}
          >
            <GalleryIcon className="h-5 w-5 text-[var(--muted)]" />
            Photos from {person.name}
          </button>
          <Link role="menuitem" href={`/memories/${encodeURIComponent(person.id)}`} className={item} onClick={close}>
            <BrainIcon className="h-5 w-5 text-[var(--muted)]" />
            What {person.name} remembers
          </Link>
          <Link role="menuitem" href="/chat" className={item} onClick={close}>
            <ChatIcon className="h-5 w-5 text-[var(--muted)]" />
            All chats
          </Link>
          <Link role="menuitem" href="/settings" className={item} onClick={close}>
            <SettingsIcon className="h-5 w-5 text-[var(--muted)]" />
            Chat settings
          </Link>
          <div className="my-1 h-px bg-[var(--line)]" />
          <Link role="menuitem" href={reportHref(`/date/${person.id}`)} className={cx(item, "text-red-300")} onClick={close}>
            <FlagIcon className="h-5 w-5" />
            Report {person.name}
          </Link>
        </div>
      ) : null}
    </div>
  );
}
