"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { useSession } from "@/components/auth-gate";
import { CameraIcon, ChatIcon, ChevronLeftIcon, ChevronRightIcon, CloseIcon, GalleryIcon, PlayIcon } from "@/components/icons";
import { Button, ButtonLink, Chip, EmptyState, PageHeader, cx } from "@/components/ui";
import { GridSkeleton } from "@/components/home/browse";
import { PAGE, useCatalogue } from "@/components/home/catalogue";
import { LoginPrompt, RetryPanel } from "@/components/home/login-prompt";
import { ApiError, useApi } from "@/lib/api";
import type { Character } from "@/lib/characters";
import type { CollectionMediaDTO, CollectionResponse } from "@/app/api/media/route";

type Kind = "all" | "image" | "video";

const FILTERS: { id: Kind; label: string; icon: ReactNode }[] = [
  { id: "all", label: "All", icon: <GalleryIcon className="h-4 w-4" /> },
  { id: "image", label: "Photos", icon: <CameraIcon className="h-4 w-4" /> },
  { id: "video", label: "Videos", icon: <PlayIcon className="h-4 w-4" /> },
];

const EMPTY: Record<Kind, { title: string; body: string }> = {
  all: {
    title: "Your collection is empty",
    body: "Every photo and video you get in a chat is saved here. Ask someone for a photo to start.",
  },
  image: { title: "No photos yet", body: "Ask for a photo in any chat and it'll be saved here." },
  video: { title: "No videos yet", body: "Animate a photo in a chat and the video will be saved here." },
};

const PAGE_SIZE = 36;
const GALLERY = "grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6";

function formatDate(iso: string) {
  const date = new Date(iso);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString("en-US", sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
}

function describe(item: CollectionMediaDTO, person: Character | undefined) {
  return `${item.kind === "video" ? "Video" : "Photo"} from ${person?.name ?? "a removed character"}, ${formatDate(item.createdAt)}`;
}

function Avatar({ person, className }: { person: Character | undefined; className?: string }) {
  return (
    <span className={cx("shrink-0 overflow-hidden rounded-full ring-1 ring-white/20", className)} style={{ background: person?.color ?? "#24242b" }}>
      {person?.image ? <img src={person.image} alt="" className="h-full w-full object-cover object-top" /> : null}
    </span>
  );
}

function Tile({ item, person, onOpen }: { item: CollectionMediaDTO; person: Character | undefined; onOpen: (target: HTMLButtonElement) => void }) {
  return (
    <button
      type="button"
      aria-label={describe(item, person)}
      onClick={(event) => onOpen(event.currentTarget)}
      className="group relative block aspect-[3/4] w-full overflow-hidden rounded-2xl bg-[var(--surface)] ring-1 ring-white/5 transition hover:ring-[var(--accent)]/60"
    >
      {item.url ? (
        item.kind === "video" ? (
          <video src={`${item.url}#t=0.1`} muted playsInline preload="metadata" className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <img src={item.url} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-[1.04]" />
        )
      ) : null}
      {item.kind === "video" ? (
        <span className="absolute right-2.5 top-2.5 flex h-8 w-8 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur">
          <PlayIcon className="h-4 w-4" />
        </span>
      ) : null}
      <span className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-black/85 via-black/40 to-transparent px-2.5 pb-2.5 pt-10 text-left">
        <Avatar person={person} className="h-7 w-7" />
        <span className="min-w-0">
          <span className="block truncate text-sm font-bold text-white">{person?.name ?? "Removed"}</span>
          <span className="block text-[11px] text-white/70">{formatDate(item.createdAt)}</span>
        </span>
      </span>
    </button>
  );
}

function Lightbox({
  items,
  index,
  people,
  onIndex,
  onClose,
}: {
  items: CollectionMediaDTO[];
  index: number;
  people: Map<string, Character>;
  onIndex: (index: number) => void;
  onClose: () => void;
}) {
  const item = items[index];
  const person = item?.characterId ? people.get(item.characterId) : undefined;
  const close = useRef<HTMLButtonElement>(null);
  const touchX = useRef<number | null>(null);
  const count = items.length;

  useEffect(() => {
    close.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft" && index > 0) onIndex(index - 1);
      if (event.key === "ArrowRight" && index < count - 1) onIndex(index + 1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [index, count, onIndex, onClose]);

  if (!item) return null;
  const label = describe(item, person);
  const navButton = "absolute top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur transition hover:bg-white/20";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={label}
      className="fixed inset-0 z-50 flex flex-col bg-black"
      onTouchStart={(event) => {
        touchX.current = event.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(event) => {
        // Swipe between items on touch screens.
        const start = touchX.current;
        const end = event.changedTouches[0]?.clientX;
        touchX.current = null;
        if (start === null || end === undefined || Math.abs(end - start) < 50) return;
        if (end < start && index < count - 1) onIndex(index + 1);
        if (end > start && index > 0) onIndex(index - 1);
      }}
    >
      <div className="flex items-center gap-3 px-4 py-3 sm:px-6">
        <Avatar person={person} className="h-10 w-10" />
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-white">{person?.name ?? "Removed character"}</p>
          <p className="text-xs text-white/60">
            {item.kind === "video" ? "Video" : "Photo"} · {formatDate(item.createdAt)} · {index + 1} of {count}
          </p>
        </div>
        <button
          ref={close}
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="ml-auto flex h-11 w-11 items-center justify-center rounded-full text-white hover:bg-white/10"
        >
          <CloseIcon />
        </button>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center px-4 sm:px-20">
        {item.url ? (
          item.kind === "video" ? (
            <video key={item.id} src={item.url} controls autoPlay playsInline loop className="max-h-full max-w-full rounded-xl" />
          ) : (
            <img key={item.id} src={item.url} alt={label} className="max-h-full max-w-full rounded-xl object-contain" />
          )
        ) : null}
        {index > 0 ? (
          <button type="button" aria-label="Previous" onClick={() => onIndex(index - 1)} className={cx(navButton, "left-2 sm:left-6")}>
            <ChevronLeftIcon />
          </button>
        ) : null}
        {index < count - 1 ? (
          <button type="button" aria-label="Next" onClick={() => onIndex(index + 1)} className={cx(navButton, "right-2 sm:right-6")}>
            <ChevronRightIcon />
          </button>
        ) : null}
      </div>

      <div className="flex justify-center px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4">
        {person && item.characterId ? (
          <ButtonLink href={`/date/${encodeURIComponent(item.characterId)}`} size="lg" className="shadow-[0_8px_24px_rgba(255,79,139,0.35)]">
            <ChatIcon className="h-5 w-5" />
            Open chat with {person.name}
          </ButtonLink>
        ) : (
          <p className="text-sm text-white/60">This character is no longer available, so the chat is closed.</p>
        )}
      </div>
    </div>
  );
}

type Loaded = { key: string; items: CollectionMediaDTO[]; hasMore: boolean; error?: string };

function messageOf(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback;
}

function query(kind: Kind, before?: string) {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
  if (kind !== "all") params.set("kind", kind);
  if (before) params.set("before", before);
  return `/api/media?${params}`;
}

function Collection() {
  const { ready, session } = useSession();
  const api = useApi();
  const { characters } = useCatalogue();
  const people = useMemo(() => new Map(characters.map((person) => [person.id, person])), [characters]);
  const sessionKey = session?.detail ?? null;

  const [kind, setKind] = useState<Kind>("all");
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [more, setMore] = useState<{ busy: boolean; error?: string }>({ busy: false });
  const [open, setOpen] = useState<number | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const key = sessionKey ? `${sessionKey}|${kind}|${attempt}` : null;

  useEffect(() => {
    if (!sessionKey || !key) return;
    let cancelled = false;
    void (async () => {
      try {
        const page = await api<CollectionResponse>(query(kind));
        if (!cancelled) setLoaded({ key, items: page.media, hasMore: page.hasMore });
      } catch (error) {
        if (!cancelled) setLoaded({ key, items: [], hasMore: false, error: messageOf(error, "Couldn't load your collection. Check your connection.") });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, sessionKey, kind, key]);

  const current = loaded && loaded.key === key ? loaded : null;
  const items = current?.items ?? [];

  const loadMore = useCallback(async () => {
    if (!current || !current.hasMore || more.busy) return;
    const last = current.items.at(-1);
    if (!last) return;
    setMore({ busy: true });
    try {
      const page = await api<CollectionResponse>(query(kind, last.createdAt));
      setLoaded((now) => {
        if (!now || now.key !== current.key) return now;
        // The boundary millisecond comes back again; keep the first copy.
        const seen = new Set(now.items.map((item) => item.id));
        return { ...now, items: [...now.items, ...page.media.filter((item) => !seen.has(item.id))], hasMore: page.hasMore };
      });
      setMore({ busy: false });
    } catch (error) {
      setMore({ busy: false, error: messageOf(error, "Couldn't load more. Try again.") });
    }
  }, [api, current, kind, more.busy]);

  // Load the next page as the end of the grid comes into view.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !current?.hasMore || more.error) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadMore();
    }, { rootMargin: "600px 0px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, [current?.hasMore, more.error, loadMore]);

  const closeLightbox = useCallback(() => {
    setOpen(null);
    opener.current?.focus();
  }, []);

  let body: ReactNode;
  if (!ready || (session && !current)) {
    body = <GridSkeleton count={10} label="Loading your collection" />;
  } else if (!session) {
    body = (
      <LoginPrompt
        title="Log in to see your collection"
        body="Every photo and video you get in your chats is saved here, and only you can see it."
        image="/hero/hero-girls-pool.jpg"
      />
    );
  } else if (current?.error) {
    body = (
      <RetryPanel
        message={current.error}
        onRetry={() => {
          setLoaded(null);
          setAttempt((count) => count + 1);
        }}
      />
    );
  } else if (items.length === 0) {
    body = (
      <EmptyState
        title={EMPTY[kind].title}
        body={EMPTY[kind].body}
        action={
          <ButtonLink href={kind === "all" ? "/discover" : "/chat"} size="lg">
            <ChatIcon className="h-5 w-5" />
            {kind === "all" ? "Find someone to chat with" : "Go to your chats"}
          </ButtonLink>
        }
      />
    );
  } else {
    body = (
      <>
        <ul className={GALLERY} aria-label="Photos and videos">
          {items.map((item, index) => (
            <li key={item.id}>
              <Tile
                item={item}
                person={item.characterId ? people.get(item.characterId) : undefined}
                onOpen={(target) => {
                  opener.current = target;
                  setOpen(index);
                }}
              />
            </li>
          ))}
        </ul>
        <div ref={sentinel} />
        {current?.hasMore || more.error ? (
          <div className="flex flex-col items-center gap-2">
            {more.error ? <p className="text-sm text-red-300" role="alert">{more.error}</p> : null}
            <Button variant="secondary" size="lg" onClick={() => void loadMore()} disabled={more.busy}>
              {more.busy ? "Loading…" : "Load more"}
            </Button>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <div className={`${PAGE} flex flex-col gap-5 pb-10 pt-6 sm:pt-8`}>
      <PageHeader
        accent="My"
        title="Collection"
        subtitle="Every photo and video you've received in your chats. Only you can see them."
      />
      {session ? (
        <div className="flex gap-2" role="group" aria-label="Show">
          {FILTERS.map((filter) => (
            <Chip
              key={filter.id}
              active={kind === filter.id}
              onClick={() => {
                setKind(filter.id);
                setMore({ busy: false });
                setOpen(null);
              }}
            >
              {filter.icon}
              {filter.label}
            </Chip>
          ))}
        </div>
      ) : null}
      {body}
      {open !== null && items[open] ? (
        <Lightbox items={items} index={open} people={people} onIndex={setOpen} onClose={closeLightbox} />
      ) : null}
    </div>
  );
}

export default function CollectionPage() {
  return (
    <AppShell>
      <Collection />
    </AppShell>
  );
}
