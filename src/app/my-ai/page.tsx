"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { AppShell, useLane } from "@/components/app-shell";
import { useSession } from "@/components/auth-gate";
import { BrainIcon, ChatIcon, MoreIcon, PlusIcon } from "@/components/icons";
import { Badge, Button, ButtonLink, EmptyState, PageHeader, cx, isStaticArt } from "@/components/ui";
import { FOCUS_RING, GRID, GridSkeleton } from "@/components/home/browse";
import { PAGE, PAGE_STACK, isOwnCharacter, relativeTime, useCatalogue } from "@/components/home/catalogue";
import { CreatePromo } from "@/components/home/home-sections";
import { LoginPrompt, RetryPanel } from "@/components/home/login-prompt";
import { PortraitCard } from "@/components/home/portrait-card";
import { threadsByCharacter, useThreads } from "@/components/home/threads";
import { ApiError, useApi } from "@/lib/api";
import type { Character } from "@/lib/characters";

function TrashIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`shrink-0 ${className}`} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4.5 7h15M9.5 7V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v2M6.5 7l1 12.5h9l1-12.5M10 11v5.5M14 11v5.5" />
    </svg>
  );
}

function CreateCard() {
  return (
    <Link
      href="/create"
      className="group flex aspect-[3/4] flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-[var(--accent)]/40 bg-[var(--accent-soft)] p-4 text-center outline-none transition hover:border-[var(--accent)] hover:bg-[var(--accent)]/20 focus-visible:border-[var(--accent)] focus-visible:bg-[var(--accent)]/20"
    >
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--accent-ink)] shadow-[0_8px_24px_rgba(255,79,139,0.4)] transition group-hover:scale-105">
        <PlusIcon className="h-7 w-7" />
      </span>
      <span className="text-base font-bold text-[var(--ink)]">Create new character</span>
      <span className="hidden text-xs leading-5 text-[var(--muted)] sm:block">Pick a look and a personality.</span>
    </Link>
  );
}

const MENU_ITEM =
  "flex h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-medium text-[var(--ink)] hover:bg-white/5 focus:bg-white/5 focus:outline-none";

// The "..." button on a card: chat, memories, delete.
function CardMenu({ person, onDelete }: { person: Character; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const wrapper = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    const onPointer = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function onMenuKey(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = [...(menu.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next = event.key === "ArrowDown" ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
    items[next]?.focus();
  }

  return (
    <div ref={wrapper} className="absolute right-2 top-2 z-20">
      <button
        ref={button}
        type="button"
        aria-label={`Options for ${person.name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
        className={cx("flex h-10 w-10 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur transition hover:bg-black/75", FOCUS_RING)}
      >
        <MoreIcon />
      </button>
      {open ? (
        <div
          ref={menu}
          id={menuId}
          role="menu"
          aria-label={person.name}
          onKeyDown={onMenuKey}
          className="absolute right-0 top-12 w-48 origin-top-right rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-1.5 shadow-[0_16px_40px_rgba(0,0,0,0.55)] transition-[opacity,transform] duration-150 ease-out starting:scale-95 starting:opacity-0 motion-reduce:transition-none"
        >
          <Link role="menuitem" href={`/date/${person.id}`} className={MENU_ITEM}>
            <ChatIcon className="h-4 w-4 text-[var(--muted)]" />
            Chat
          </Link>
          <Link role="menuitem" href={`/memories/${person.id}`} className={MENU_ITEM}>
            <BrainIcon className="h-4 w-4 text-[var(--muted)]" />
            Memories
          </Link>
          <button
            role="menuitem"
            type="button"
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
            className={cx(MENU_ITEM, "text-red-300")}
          >
            <TrashIcon className="h-4 w-4" />
            Delete
          </button>
        </div>
      ) : null}
    </div>
  );
}

function DeleteDialog({
  person,
  onCancel,
  onDeleted,
}: {
  person: Character;
  onCancel: () => void;
  onDeleted: () => void;
}) {
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    cancel.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/characters/${encodeURIComponent(person.id)}`, { method: "DELETE" });
      onDeleted();
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : "Couldn't delete. Check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:items-center" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={bodyId}>
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        className="absolute inset-0 bg-black/70 transition-opacity duration-200 starting:opacity-0"
        onClick={busy ? undefined : onCancel}
      />
      <div className="relative w-full max-w-sm rounded-2xl border border-[var(--line)] bg-[var(--bg-2)] p-6 shadow-[0_24px_60px_rgba(0,0,0,0.6)] transition-[opacity,transform] duration-200 ease-out starting:translate-y-4 starting:opacity-0 motion-reduce:transition-none sm:starting:translate-y-0 sm:starting:scale-95">
        <div className="flex items-center gap-3">
          <span className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl" style={{ background: person.color }}>
            {person.image ? (
              <Image src={person.image} alt="" fill sizes="56px" unoptimized={!isStaticArt(person.image)} className="object-cover object-top" />
            ) : null}
          </span>
          <h2 id={titleId} className="text-lg font-bold tracking-tight text-[var(--ink)]">
            Delete {person.name}?
          </h2>
        </div>
        <p id={bodyId} className="mt-4 text-sm leading-6 text-[var(--muted)]">
          {person.name} will be removed from My AI and you won&apos;t be able to chat with them again. This can&apos;t be undone.
        </p>
        {error ? (
          <p role="alert" className="mt-3 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {error}
          </p>
        ) : null}
        <div className="mt-6 flex justify-end gap-3">
          <Button ref={cancel} variant="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => void confirm()} disabled={busy} className="bg-red-500/15">
            {busy ? "Deleting…" : "Delete"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function MyAI() {
  const { ready, session } = useSession();
  const { lane } = useLane();
  const { characters, status, error, retry, remove } = useCatalogue();
  const { threads } = useThreads();
  const chats = useMemo(() => threadsByCharacter(threads), [threads]);
  const [deleting, setDeleting] = useState<Character | null>(null);
  const own = characters.filter(isOwnCharacter);
  const signedIn = ready && Boolean(session);

  let body;
  if (!ready || (session && status === "loading")) {
    body = <GridSkeleton count={6} label="Loading your characters" />;
  } else if (!session) {
    body = (
      <LoginPrompt
        title="Log in to see your characters"
        body="Characters you create live here, and only you can chat with them."
        image="/hero/hero-girls-lounge.jpg"
      />
    );
  } else if (status === "error") {
    body = <RetryPanel message={error ?? "Couldn't load your characters."} onRetry={retry} />;
  } else if (own.length === 0) {
    body = (
      <EmptyState
        title="You haven't made anyone yet"
        body="Pick a look, a personality and how they talk to you. They'll remember every chat."
        action={
          <ButtonLink href="/create" size="lg">
            <PlusIcon className="h-5 w-5" />
            Create new character
          </ButtonLink>
        }
      />
    );
  } else {
    body = (
      <ul className={GRID} aria-label="Your characters">
        {/* Phones have no room for the header button; the card leads instead. */}
        <li className="sm:hidden">
          <CreateCard />
        </li>
        {own.map((person, index) => {
          const thread = chats.get(person.id);
          return (
            <li key={person.id} className="relative">
              <PortraitCard
                person={person}
                eager={index < 6}
                badge={thread ? <Badge tone="muted">Chatting</Badge> : null}
                meta={thread ? `Last chat ${relativeTime(thread.lastMessageAt)}` : "No chats yet"}
              />
              <CardMenu person={person} onDelete={() => setDeleting(person)} />
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className={cx(PAGE, PAGE_STACK)}>
      <PageHeader
        accent="My"
        title="AI"
        subtitle="The characters you created. Only you can see them. Open one to chat, or use ⋯ for memories."
        action={
          signedIn && own.length > 0 ? (
            <ButtonLink href="/create" className="max-sm:hidden">
              <PlusIcon className="h-4 w-4" />
              Create character
            </ButtonLink>
          ) : null
        }
      />
      {body}
      {/* A short list leaves the page bare; the band fills it with the next step. */}
      {signedIn && status === "ready" && own.length > 0 && own.length < 4 ? <CreatePromo lane={lane} /> : null}
      {deleting ? (
        <DeleteDialog
          person={deleting}
          onCancel={() => setDeleting(null)}
          onDeleted={() => {
            remove(deleting.id);
            setDeleting(null);
          }}
        />
      ) : null}
    </div>
  );
}

export default function MyAIPage() {
  return (
    <AppShell>
      <MyAI />
    </AppShell>
  );
}
