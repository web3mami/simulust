"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { useSession } from "@/components/auth-gate";
import { CameraIcon, ChatIcon, ChevronLeftIcon, ChevronRightIcon, CloseIcon, FilmIcon, GalleryIcon, PlayIcon } from "@/components/icons";
import { Button, ButtonLink, Chip, EmptyState, PageHeader, cx, isStaticArt } from "@/components/ui";
import { FOCUS_RING, GridSkeleton, ScrollRow } from "@/components/home/browse";
import { PAGE, PAGE_STACK, useCatalogue } from "@/components/home/catalogue";
import { LoginPrompt, RetryPanel } from "@/components/home/login-prompt";
import { ApiError, useApi } from "@/lib/api";
import type { Character } from "@/lib/characters";
import type { CollectionMediaDTO, CollectionResponse } from "@/app/api/media/route";

// "studio" is everything made in the Video Studio: keyframes and their clips.
type Kind = "all" | "image" | "video" | "studio";

const FILTERS: { id: Kind; label: string; icon: ReactNode }[] = [
  { id: "all", label: "All", icon: <GalleryIcon className="h-4 w-4" /> },
  { id: "image", label: "Photos", icon: <CameraIcon className="h-4 w-4" /> },
  { id: "video", label: "Videos", icon: <PlayIcon className="h-4 w-4" /> },
  { id: "studio", label: "Studio", icon: <FilmIcon className="h-4 w-4" /> },
];

const EMPTY: Record<Kind, { title: string; body: string }> = {
  all: {
    title: "Your collection is empty",
    body: "Every photo and video from your chats and the Video Studio is saved here. Ask someone for a photo to start.",
  },
  image: { title: "No photos yet", body: "Ask for a photo in any chat and it'll be saved here." },
  video: { title: "No videos yet", body: "Animate a photo in a chat or the Video Studio and the video will be saved here." },
  studio: {
    title: "No studio scenes yet",
    body: "Set a scene in the Video Studio and bring it to life. Every frame and clip you make lands here.",
  },
};

function DownloadIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`shrink-0 ${className}`} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14" />
    </svg>
  );
}

const PAGE_SIZE = 36;
const GALLERY = "grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6";

function formatDate(iso: string) {
  const date = new Date(iso);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString("en-US", sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
}

function describe(item: CollectionMediaDTO, person: Character | undefined) {
  const what = item.kind === "video" ? "Video" : "Photo";
  const who = person?.name ?? "a removed character";
  return item.origin === "studio"
    ? `Studio ${what.toLowerCase()} of ${who}, ${formatDate(item.createdAt)}`
    : `${what} from ${who}, ${formatDate(item.createdAt)}`;
}

// Portraits are our own art, so they come resized (a 40px circle never
// downloads the full picture).
function Avatar({ person, className }: { person: Character | undefined; className?: string }) {
  return (
    <span
      className={cx("relative shrink-0 overflow-hidden rounded-full ring-1 ring-white/20", className)}
      style={{ background: person?.color ?? "#24242b" }}
    >
      {person?.image ? (
        <Image src={person.image} alt="" fill sizes="40px" unoptimized={!isStaticArt(person.image)} className="object-cover object-top" />
      ) : null}
    </span>
  );
}

function Tile({
  item,
  person,
  eager,
  onOpen,
}: {
  item: CollectionMediaDTO;
  person: Character | undefined;
  // In the first rows, on screen at first paint.
  eager?: boolean;
  onOpen: (target: HTMLButtonElement) => void;
}) {
  return (
    <button
      type="button"
      aria-label={describe(item, person)}
      onClick={(event) => onOpen(event.currentTarget)}
      className={cx(
        "group relative block aspect-[3/4] w-full overflow-hidden rounded-2xl bg-[var(--surface)] ring-1 ring-white/5 transition-[transform,box-shadow] duration-300 hover:-translate-y-1 hover:shadow-[0_18px_40px_-12px_rgba(0,0,0,0.8)] hover:ring-[var(--accent)]/60 motion-reduce:transition-none motion-reduce:hover:translate-y-0",
        "outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
      )}
      style={{ background: person?.color }}
    >
      {item.url ? (
        item.kind === "video" ? (
          <video src={`${item.url}#t=0.1`} muted playsInline preload="metadata" className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          // Generated media needs the viewer's login, which the image optimizer
          // doesn't have, so it is shown as stored.
          <Image
            src={item.url}
            alt=""
            fill
            unoptimized
            loading={eager ? "eager" : "lazy"}
            sizes="(min-width: 1280px) 20vw, (min-width: 640px) 33vw, 50vw"
            className="object-cover transition duration-500 group-hover:scale-[1.04] motion-reduce:transition-none"
          />
        )
      ) : null}
      {item.kind === "video" ? (
        <span className="absolute right-2.5 top-2.5 flex h-8 w-8 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur">
          <PlayIcon className="h-4 w-4" />
        </span>
      ) : null}
      {item.origin === "studio" ? (
        <span className="absolute left-2.5 top-2.5 inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-white backdrop-blur">
          <FilmIcon className="h-3 w-3" />
          Studio
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
      className="fixed inset-0 z-50 flex flex-col bg-black/95 backdrop-blur-sm transition-opacity duration-200 starting:opacity-0 motion-reduce:transition-none"
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
            {item.origin === "studio" ? "Studio " : ""}
            {item.origin === "studio" ? (item.kind === "video" ? "video" : "frame") : item.kind === "video" ? "Video" : "Photo"} ·{" "}
            {formatDate(item.createdAt)} · {index + 1} of {count}
          </p>
        </div>
        {item.url ? (
          <a
            href={item.url}
            download
            aria-label={`Download this ${item.kind === "video" ? "video" : "photo"}`}
            className="ml-auto flex h-11 w-11 items-center justify-center rounded-full text-white hover:bg-white/10 focus-visible:bg-white/10 focus-visible:outline-none"
          >
            <DownloadIcon />
          </a>
        ) : null}
        <button
          ref={close}
          type="button"
          aria-label="Close"
          onClick={onClose}
          className={cx(
            "flex h-11 w-11 items-center justify-center rounded-full text-white hover:bg-white/10 focus-visible:bg-white/10 focus-visible:outline-none",
            !item.url && "ml-auto",
          )}
        >
          <CloseIcon />
        </button>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center px-4 sm:px-20">
        {item.url ? (
          item.kind === "video" ? (
            <video
              key={item.id}
              src={item.url}
              controls
              autoPlay
              playsInline
              loop
              className="max-h-full max-w-full rounded-xl transition-[opacity,transform] duration-300 ease-out starting:scale-[0.97] starting:opacity-0 motion-reduce:transition-none"
            />
          ) : (
            // Natural size up to the screen; generated media isn't optimised.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={item.id}
              src={item.url}
              alt={label}
              className="max-h-full max-w-full rounded-xl object-contain transition-[opacity,transform] duration-300 ease-out starting:scale-[0.97] starting:opacity-0 motion-reduce:transition-none"
            />
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

      <div className="flex flex-wrap justify-center gap-3 px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4">
        {person && item.characterId ? (
          <>
            {item.origin === "studio" ? (
              <ButtonLink href={`/studio?character=${encodeURIComponent(item.characterId)}`} size="lg" variant="secondary">
                <FilmIcon className="h-5 w-5" />
                New scene
              </ButtonLink>
            ) : null}
            <ButtonLink href={`/date/${encodeURIComponent(item.characterId)}`} size="lg" className="shadow-[0_8px_24px_rgba(255,79,139,0.35)]">
              <ChatIcon className="h-5 w-5" />
              Open chat with {person.name}
            </ButtonLink>
          </>
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
  if (kind === "studio") params.set("origin", "studio");
  else if (kind !== "all") params.set("kind", kind);
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
  // Narrow to one character's photos and videos (null: everyone).
  const [who, setWho] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  // Photo and video counts, known once the whole collection has loaded under
  // "All" (the API pages, so a partial list can't count). Kept per session.
  const [counts, setCounts] = useState<{ key: string; image: number; video: number; studio: number } | null>(null);
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
        if (cancelled) return;
        setLoaded({ key, items: page.media, hasMore: page.hasMore });
        if (kind === "all" && !page.hasMore) {
          const image = page.media.filter((item) => item.kind === "image").length;
          const studio = page.media.filter((item) => item.origin === "studio").length;
          setCounts({ key: sessionKey, image, video: page.media.length - image, studio });
        }
      } catch (error) {
        if (!cancelled) setLoaded({ key, items: [], hasMore: false, error: messageOf(error, "Couldn't load your collection. Check your connection.") });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, sessionKey, kind, key]);

  const current = loaded && loaded.key === key ? loaded : null;
  const loadedItems = useMemo(() => current?.items ?? [], [current]);
  // The characters in what's loaded, most recent first, for the filter row.
  const everyone = useMemo(() => {
    const seen = new Map<string, number>();
    for (const item of loadedItems) {
      if (item.characterId) seen.set(item.characterId, (seen.get(item.characterId) ?? 0) + 1);
    }
    return [...seen.entries()].map(([id, count]) => ({ id, count, person: people.get(id) }));
  }, [loadedItems, people]);
  const shownWho = who && everyone.some((entry) => entry.id === who) ? who : null;
  const items = shownWho ? loadedItems.filter((item) => item.characterId === shownWho) : loadedItems;
  const known = counts && counts.key === sessionKey ? counts : null;
  const countOf = (id: Kind) => (known ? (id === "all" ? known.image + known.video : known[id]) : null);

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
        body="Every photo and video from your chats and the Video Studio is saved here, and only you can see it."
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
          kind === "studio" ? (
            <ButtonLink href="/studio" size="lg">
              <FilmIcon className="h-5 w-5" />
              Open the Video Studio
            </ButtonLink>
          ) : (
            <ButtonLink href={kind === "all" ? "/discover" : "/chat"} size="lg">
              <ChatIcon className="h-5 w-5" />
              {kind === "all" ? "Find someone to chat with" : "Go to your chats"}
            </ButtonLink>
          )
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
                eager={index < 6}
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
    <div className={cx(PAGE, PAGE_STACK)}>
      <PageHeader
        accent="My"
        title="Collection"
        subtitle="Every photo and video from your chats and the Video Studio. Only you can see them."
      />
      {session ? (
        <div className="-mb-2 flex flex-col gap-3 sm:-mb-3">
          <ScrollRow label="Show" watch={FILTERS.length}>
            {FILTERS.map((filter) => {
              const count = countOf(filter.id);
              return (
                <Chip
                  key={filter.id}
                  active={kind === filter.id}
                  className={cx("snap-start", FOCUS_RING)}
                  onClick={() => {
                    setKind(filter.id);
                    setMore({ busy: false });
                    setOpen(null);
                  }}
                >
                  {filter.icon}
                  {filter.label}
                  {count !== null ? (
                    <span className={cx("text-xs font-semibold", kind === filter.id ? "text-white/80" : "text-[var(--muted)]")}>{count}</span>
                  ) : null}
                </Chip>
              );
            })}
          </ScrollRow>
          {everyone.length > 1 ? (
            <ScrollRow label="Show one character" watch={everyone.length}>
              <Chip active={!shownWho} onClick={() => setWho(null)} className={cx("snap-start", FOCUS_RING)}>
                Everyone
              </Chip>
              {everyone.map((entry) => (
                <Chip
                  key={entry.id}
                  active={shownWho === entry.id}
                  onClick={() => {
                    setWho(shownWho === entry.id ? null : entry.id);
                    setOpen(null);
                  }}
                  className={cx("snap-start pl-1.5", FOCUS_RING)}
                >
                  <Avatar person={entry.person} className="h-7 w-7" />
                  {entry.person?.name ?? "Removed"}
                  {current && !current.hasMore ? (
                    <span className={cx("text-xs font-semibold", shownWho === entry.id ? "text-white/80" : "text-[var(--muted)]")}>
                      {entry.count}
                    </span>
                  ) : null}
                </Chip>
              ))}
            </ScrollRow>
          ) : null}
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
