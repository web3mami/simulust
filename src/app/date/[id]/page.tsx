"use client";

import Image from "next/image";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { AppShell } from "@/components/app-shell";
import { useSession } from "@/components/auth-gate";
import { Avatar } from "@/components/chat/avatar";
import motion from "@/components/chat/chat-motion.module.css";
import { ChatHeader } from "@/components/chat/chat-header";
import { Composer, type PhotoAction } from "@/components/chat/composer";
import { ConversationList, recallCharacter, rememberCharacter } from "@/components/chat/conversation-list";
import { dayKey, dayLabel, EXPLORE_HREF, groupPositions, OPENERS, photoIdeaLabel, replyStarters, stampedAt } from "@/components/chat/format";
import {
  DaySeparator,
  MessageBubble,
  NoticeLine,
  PendingPhoto,
  StreamingBubble,
  type Extra,
} from "@/components/chat/message-bubble";
import { CrisisCard, Lightbox, ProblemLine, Rich, type LightboxPhoto, type Problem } from "@/components/chat/message-parts";
import { ProfilePanel, type Gallery, type PrivateAccess } from "@/components/chat/profile-panel";
import { ChatIcon, ChevronDownIcon, ChevronLeftIcon } from "@/components/icons";
import { Button, ButtonLink, cx, isStaticArt, Panel, Skeleton } from "@/components/ui";
import { ApiError, useApi, useAuthHeaders } from "@/lib/api";
import type {
  ApiErrorBody,
  CharacterDTO,
  ChatStreamEvent,
  CrisisResource,
  MediaDTO,
  Me,
  MessageDTO,
  ThreadDTO,
} from "@/lib/api-types";
import { COSTS } from "@/lib/pricing";

type ThreadPage = { thread: ThreadDTO; messages: MessageDTO[]; hasMore?: boolean };

function extrasFrom(list: MessageDTO[]): Record<string, Extra> {
  const out: Record<string, Extra> = {};
  for (const message of list) {
    if (message.voice || message.video) {
      out[message.id] = { voice: message.voice ?? undefined, video: message.video ?? undefined };
    }
  }
  return out;
}

const PAGE_SIZE = 50;
const POLL_MS = 3000;
// Give up polling a job after this long; the media stays in the user's history.
const POLL_GIVE_UP_MS = 15 * 60 * 1000;
const MAX_LENGTH = 4000;
// From this width the profile sits beside the conversation; below it, it slides over.
const DOCK_MIN = 1180;
// The message box grows to five lines (24px each, plus its padding).
const COMPOSER_MAX = 5 * 24 + 20;
// Column widths, shared with the loading state so nothing moves when the chat arrives.
const LIST_WIDTH = "lg:w-[280px] 2xl:w-[320px]";
const PROFILE_WIDTH = "w-[320px] min-[1600px]:w-[360px]";
// How long the profile slide-over takes to leave before it unmounts.
const SHEET_MS = 300;

// Every chat is its own page, so what should survive switching between chats
// lives here: the last page of each conversation (drawn at once, then
// refreshed), unsent drafts, and whether the docked profile was hidden.
const pageCache = new Map<string, { thread: ThreadDTO; messages: MessageDTO[]; hasMore: boolean }>();
const draftCache = new Map<string, string>();
let profileHiddenPref = false;

function problemOf(error: unknown, fallback = "Something went wrong. Try again."): Problem {
  if (error instanceof ApiError) return { text: error.message, code: error.code };
  return { text: fallback };
}

// Errors worth the line above the message box even when they came from a
// photo's voice or video button: the fix is the same for the whole chat.
const CHAT_WIDE = new Set(["insufficient_credits", "age_verification_required", "explicit_hold"]);

// Errors that mean what the account may see has changed (a hold was placed,
// or the age confirmation is gone), so the 18+ actions catch up with /api/me.
const ACCESS_CHANGED = new Set(["age_verification_required", "explicit_hold", "blocked_minor"]);

async function* readNdjson(body: ReadableStream<Uint8Array>): AsyncGenerator<ChatStreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      try {
        yield JSON.parse(line) as ChatStreamEvent;
      } catch {
        // A malformed line shouldn't take down the whole reply.
      }
    }
  }
  const rest = (buffer + decoder.decode()).trim();
  if (rest) {
    try {
      yield JSON.parse(rest) as ChatStreamEvent;
    } catch {
      // Ignore a truncated last line.
    }
  }
}

// A centred message in the conversation column, for missing characters and errors.
function CenterNote({ title, body, children }: { title: string; body: ReactNode; children?: ReactNode }) {
  return (
    <div className="m-auto flex max-w-md flex-col items-center px-6 py-16 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent)]">
        <ChatIcon className="h-7 w-7" />
      </span>
      <h1 className="mt-5 text-2xl font-bold tracking-tight text-[var(--ink)] sm:text-3xl">{title}</h1>
      <p className="mt-3 text-sm leading-6 text-[var(--muted)]">{body}</p>
      {children ? <div className="mt-6 flex flex-wrap justify-center gap-3">{children}</div> : null}
    </div>
  );
}

// Message-shaped placeholders: theirs with an avatar on the left, yours on the right.
function MessagesSkeleton() {
  return (
    <div className="mx-auto mt-auto flex w-full max-w-3xl flex-col gap-4 px-3 py-5 sm:px-6" aria-label="Loading messages">
      <div className="flex items-end gap-2">
        <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
        <Skeleton className="h-14 w-3/5 rounded-[20px] rounded-bl-md" />
      </div>
      <div className="flex justify-end">
        <Skeleton className="h-10 w-2/5 rounded-[20px] rounded-br-md" />
      </div>
      <div className="flex items-end gap-2">
        <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
        <Skeleton className="h-20 w-2/3 rounded-[20px] rounded-bl-md" />
      </div>
      <div className="flex justify-end">
        <Skeleton className="h-10 w-1/3 rounded-[20px] rounded-br-md" />
      </div>
    </div>
  );
}

// The whole conversation before the character is known, in the real layout.
function ConversationSkeleton() {
  return (
    <div className="flex min-w-0 flex-1 flex-col" aria-busy="true" aria-label="Loading chat">
      <div className="shrink-0 border-b border-[var(--line)] bg-[var(--bg-2)] pt-[env(safe-area-inset-top)] lg:pt-0">
        <div className="flex h-14 items-center gap-3 px-1.5 sm:px-4 lg:h-16">
          <Link href="/chat" aria-label="Back to chats" className="flex h-10 w-10 items-center justify-center rounded-full text-[var(--ink)] hover:bg-white/5 lg:hidden">
            <ChevronLeftIcon className="h-6 w-6" />
          </Link>
          <Skeleton className="h-10 w-10 rounded-full" />
          <span className="space-y-1.5">
            <Skeleton className="h-3.5 w-24 rounded" />
            <Skeleton className="h-3 w-16 rounded" />
          </span>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <MessagesSkeleton />
      </div>
      <div className="shrink-0 border-t border-[var(--line)] bg-[var(--bg-2)] px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 sm:px-6">
        <div className="mx-auto w-full max-w-3xl">
          <div className="flex h-10 items-center gap-2">
            <Skeleton className="h-10 w-40 rounded-full" />
            <Skeleton className="h-10 w-28 rounded-full" />
          </div>
          <Skeleton className="mt-2 h-14 w-full rounded-[26px]" />
        </div>
      </div>
    </div>
  );
}

function ProfileSkeleton() {
  return (
    <aside aria-hidden className={cx("hidden shrink-0 border-l border-[var(--line)] bg-[var(--bg-2)] p-4", PROFILE_WIDTH, !profileHiddenPref && "@min-[1180px]:block")}>
      <Skeleton className="aspect-[3/4] w-full rounded-3xl" />
      <Skeleton className="mt-4 h-3.5 w-full rounded" />
      <Skeleton className="mt-2 h-3.5 w-2/3 rounded" />
      <Skeleton className="mt-4 h-10 w-full rounded-full" />
    </aside>
  );
}

// A new chat opens on the character, not an empty room: their portrait, their
// line, and a few first messages to tap.
function EmptyHero({
  person,
  onOpener,
  disabled,
}: {
  person: CharacterDTO;
  onOpener: (text: string) => void;
  disabled: boolean;
}) {
  return (
    <div className={cx("mt-auto flex flex-col items-center pb-2 pt-6 text-center lg:my-auto", motion.fade)}>
      <div
        className="relative aspect-[4/5] w-full max-w-[15rem] overflow-hidden rounded-3xl sm:max-w-[18rem] shadow-[0_24px_60px_rgba(0,0,0,0.45)] ring-1 ring-white/10"
        style={{ background: person.color }}
      >
        {person.image ? (
          <Image
            src={person.image}
            alt={`Portrait of ${person.name}`}
            fill
            sizes="(min-width: 640px) 288px, 240px"
            loading="eager"
            fetchPriority="high"
            unoptimized={!isStaticArt(person.image)}
            className="object-cover"
          />
        ) : null}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/60 to-transparent px-5 pb-5 pt-24 text-left">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--accent-2)]">{person.role}</p>
          <p className="mt-1 text-2xl font-bold tracking-tight text-white">
            {person.name}, {person.age}
          </p>
          <p className="mt-1.5 line-clamp-3 text-sm leading-5 text-white/85">{person.line}</p>
        </div>
      </div>
      <p className="mt-5 text-sm font-semibold text-[var(--ink)]">Say something to {person.name}</p>
      <div className="mt-3 flex max-w-md flex-wrap justify-center gap-2">
        {OPENERS.map((text) => (
          <button
            key={text}
            type="button"
            onClick={() => onOpener(text)}
            disabled={disabled}
            className="min-h-10 max-w-full rounded-[20px] border border-[var(--line)] bg-[var(--surface)] px-4 py-2 text-left text-sm font-medium text-[var(--ink)] transition-colors hover:border-[var(--accent)]/50 hover:bg-[var(--surface-2)] disabled:opacity-60"
          >
            <Rich text={text} />
          </button>
        ))}
      </div>
      <p className="mt-4 max-w-sm text-xs leading-5 text-[var(--muted)]">
        {person.name} is an AI character. Everything here is fiction between adults.
      </p>
    </div>
  );
}

// The profile over the conversation on narrower screens: slides in from the
// right, slides back out before it unmounts, and follows a swipe to the right.
function ProfileSheet({ open, label, onClose, children }: { open: boolean; label: string; onClose: () => void; children: ReactNode }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; dx: number; horizontal: boolean | null } | null>(null);

  function onPointerDown(event: ReactPointerEvent) {
    if (event.pointerType !== "touch") return;
    dragRef.current = { x: event.clientX, y: event.clientY, dx: 0, horizontal: null };
  }
  function onPointerMove(event: ReactPointerEvent) {
    const drag = dragRef.current;
    const panel = panelRef.current;
    if (!drag || !panel) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (drag.horizontal === null && Math.hypot(dx, dy) > 8) drag.horizontal = Math.abs(dx) > Math.abs(dy);
    if (!drag.horizontal) return;
    drag.dx = Math.max(0, dx);
    // Moved directly rather than through state, so the panel isn't re-rendered on every frame.
    panel.style.transition = "none";
    panel.style.translate = `${drag.dx}px 0`;
  }
  function onPointerEnd() {
    const drag = dragRef.current;
    const panel = panelRef.current;
    dragRef.current = null;
    if (!drag || !panel) return;
    panel.style.transition = "";
    panel.style.translate = "";
    if (drag.horizontal && drag.dx > 80) onClose();
  }

  return (
    <div className={cx("fixed inset-0 z-50", !open && "pointer-events-none")} role="dialog" aria-modal="true" aria-label={label}>
      <button
        type="button"
        aria-label="Close profile"
        tabIndex={-1}
        className={cx(
          "absolute inset-0 bg-black/70 transition-opacity duration-300 motion-reduce:transition-none",
          open ? "opacity-100 starting:opacity-0" : "opacity-0",
        )}
        onClick={onClose}
      />
      <div
        ref={panelRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        className={cx(
          "absolute inset-y-0 right-0 w-[min(400px,90vw)] touch-pan-y border-l border-[var(--line)] bg-[var(--bg-2)] shadow-[0_0_60px_rgba(0,0,0,0.6)] transition-[translate] duration-300 ease-[cubic-bezier(.32,.72,0,1)] motion-reduce:transition-none",
          open ? "translate-x-0 starting:translate-x-full" : "translate-x-full",
        )}
      >
        {children}
      </div>
    </div>
  );
}

export default function DatePage() {
  const params = useParams<{ id: string }>();
  const characterId = params.id;
  const { ready, session, me, features, refreshMe, openLogin } = useSession();
  const api = useApi();
  const authHeaders = useAuthHeaders();
  const sessionKey = session?.detail ?? "anon";
  // The session object is rebuilt on every render upstream; its id string is stable.
  const sessionDetail = session?.detail ?? null;

  // Character: drawn at once from the chat list's copy when there is one, and
  // confirmed by its own fetch.
  const [characterState, setCharacterState] = useState<{
    key: string;
    character: CharacterDTO | null;
    problem?: Problem;
  } | null>(null);
  const characterKey = `${sessionKey}:${characterId}`;
  const [characterRetry, setCharacterRetry] = useState(0);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    void (async () => {
      try {
        const { character } = await api<{ character: CharacterDTO }>(`/api/characters/${encodeURIComponent(characterId)}`);
        if (cancelled) return;
        if (sessionDetail) rememberCharacter(sessionDetail, character);
        setCharacterState({ key: characterKey, character });
      } catch (error) {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 404) setCharacterState({ key: characterKey, character: null });
        else setCharacterState({ key: characterKey, character: null, problem: problemOf(error, "Couldn't load this character.") });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, api, characterId, characterKey, characterRetry, sessionDetail]);

  const fetched = characterState?.key === characterKey ? characterState : null;
  const cachedPerson = sessionDetail ? recallCharacter(sessionDetail, characterId) : null;
  const characterLoaded = Boolean(fetched || cachedPerson);
  const person = fetched ? fetched.character : cachedPerson;

  // Thread and history. Opening the thread only needs the id in the address, so
  // it runs alongside the character fetch rather than after it.
  const chatKey = ready && sessionDetail ? `${sessionDetail}:${characterId}` : null;
  const cached = chatKey ? pageCache.get(chatKey) : undefined;
  const [loadedKey, setLoadedKey] = useState<string | null>(() => (cached ? chatKey : null));
  const [historyProblem, setHistoryProblem] = useState<{ key: string; problem: Problem } | null>(null);
  const [historyRetry, setHistoryRetry] = useState(0);
  const [thread, setThread] = useState<ThreadDTO | null>(() => cached?.thread ?? null);
  const [messages, setMessages] = useState<MessageDTO[]>(() => cached?.messages ?? []);
  const [hasMore, setHasMore] = useState(() => cached?.hasMore ?? false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [extras, setExtras] = useState<Record<string, Extra>>(() => extrasFrom(cached?.messages ?? []));
  // Media we stopped polling because it took too long.
  const [stalled, setStalled] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    if (!chatKey) return;
    let cancelled = false;
    void (async () => {
      try {
        const opened = await api<{ thread: ThreadDTO }>("/api/threads", { method: "POST", json: { characterId } });
        const page = await api<ThreadPage>(`/api/threads/${opened.thread.id}`);
        if (cancelled) return;
        setThread(page.thread);
        // Anything sent while this was loading (from a cached copy) stays.
        setMessages((current) => {
          const have = new Set(page.messages.map((message) => message.id));
          const newest = page.messages.at(-1)?.createdAt ?? "";
          const local = current.filter(
            (message) => !have.has(message.id) && (message.id.startsWith("pending-") || message.createdAt > newest),
          );
          return [...page.messages, ...local];
        });
        setHasMore(page.hasMore ?? page.messages.length >= PAGE_SIZE);
        setExtras((current) => {
          const next = { ...current };
          for (const [id, extra] of Object.entries(extrasFrom(page.messages))) next[id] = { ...current[id], ...extra };
          return next;
        });
        setLoadedKey(chatKey);
      } catch (error) {
        if (!cancelled) setHistoryProblem({ key: chatKey, problem: problemOf(error, "Couldn't load your chat.") });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, chatKey, characterId, historyRetry]);

  const chatLoaded = chatKey !== null && loadedKey === chatKey;
  const chatProblem = historyProblem && historyProblem.key === chatKey && !chatLoaded ? historyProblem.problem : null;

  useEffect(() => {
    if (!chatLoaded || !chatKey || !thread) return;
    pageCache.set(chatKey, { thread, messages: messages.filter((message) => !message.id.startsWith("pending-")), hasMore });
  }, [chatLoaded, chatKey, thread, messages, hasMore]);

  // Composer and streaming
  const [draft, setDraft] = useState(() => draftCache.get(characterId) ?? "");
  const [sending, setSending] = useState(false);
  const [streamText, setStreamText] = useState<string | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [crisis, setCrisis] = useState<CrisisResource[] | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  // The photo being taken, shown in the conversation until it arrives.
  const [photoPending, setPhotoPending] = useState<{ idea: string | null; at: string } | null>(null);
  // Credits from the latest reply, shown until /api/me catches up.
  const [credits, setCredits] = useState<{ balance: number; free: number; me: Me | null } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    draftCache.set(characterId, draft);
  }, [characterId, draft]);

  const shownCredits = credits && credits.me === me ? credits : me ? { balance: me.balance, free: me.freeMessagesLeft } : null;

  // Layout: the chat list refreshes after each reply so its previews stay
  // current; the profile docks beside the chat on wide screens and slides over
  // it on narrow ones; photos open full screen.
  const [listVersion, setListVersion] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(false);
  const [profileHidden, setProfileHidden] = useState(profileHiddenPref);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetMounted, setSheetMounted] = useState(false);
  const sheetCloseRef = useRef<HTMLButtonElement>(null);
  // Where focus goes back to when the profile or the photo viewer closes.
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const sheetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [galleryRequest, setGalleryRequest] = useState(0);
  const [lightbox, setLightbox] = useState<{ photos: MediaDTO[]; index: number } | null>(null);
  const closeLightbox = useCallback(() => setLightbox(null), []);
  const pageLightbox = useCallback((index: number) => setLightbox((current) => (current ? { ...current, index } : current)), []);
  // A message whose time was tapped open (touch screens have no hover).
  const [timeFor, setTimeFor] = useState<string | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setWide(entry.contentRect.width >= DOCK_MIN));
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  // Phones: size the conversation to what the on-screen keyboard leaves, so the
  // message box stays above it (iOS doesn't shrink dvh for the keyboard).
  useEffect(() => {
    const root = rootRef.current;
    const viewport = window.visualViewport;
    if (!root || !viewport) return;
    const update = () => {
      if (Math.abs(viewport.scale - 1) > 0.01) {
        // Pinch-zoomed: leave the layout alone.
        root.style.removeProperty("--vvh");
        root.style.removeProperty("--vvt");
        return;
      }
      root.style.setProperty("--vvh", `${viewport.height}px`);
      root.style.setProperty("--vvt", `${viewport.offsetTop}px`);
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, []);

  const sheetShown = sheetMounted && !wide;
  // While the profile or a photo is over the conversation, the page behind it is inert.
  const overlayOpen = (sheetShown && sheetOpen) || lightbox !== null;

  function rememberFocus() {
    if (!returnFocusRef.current && document.activeElement instanceof HTMLElement) returnFocusRef.current = document.activeElement;
  }

  // Back to whatever opened it, once the page is no longer inert.
  useEffect(() => {
    if (overlayOpen) return;
    const target = returnFocusRef.current;
    returnFocusRef.current = null;
    target?.focus({ preventScroll: true });
  }, [overlayOpen]);

  const openSheet = useCallback(() => {
    if (sheetTimerRef.current) clearTimeout(sheetTimerRef.current);
    rememberFocus();
    setSheetMounted(true);
    setSheetOpen(true);
  }, []);

  const closeSheet = useCallback(() => {
    setSheetOpen(false);
    if (sheetTimerRef.current) clearTimeout(sheetTimerRef.current);
    sheetTimerRef.current = setTimeout(() => setSheetMounted(false), SHEET_MS);
  }, []);

  useEffect(() => () => {
    if (sheetTimerRef.current) clearTimeout(sheetTimerRef.current);
  }, []);

  useEffect(() => {
    if (!sheetShown || !sheetOpen) return;
    sheetCloseRef.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && closeSheet();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [sheetShown, sheetOpen, closeSheet]);

  function setDocked(hidden: boolean) {
    profileHiddenPref = hidden;
    setProfileHidden(hidden);
  }

  function toggleProfile() {
    setGalleryRequest(0);
    if ((rootRef.current?.clientWidth ?? 0) >= DOCK_MIN) setDocked(!profileHidden);
    else if (sheetOpen) closeSheet();
    else openSheet();
  }

  function showPhotos() {
    setGalleryRequest((count) => count + 1);
    if ((rootRef.current?.clientWidth ?? 0) >= DOCK_MIN) setDocked(false);
    else openSheet();
  }

  // Scrolling: stay pinned to the bottom unless the user scrolled up, and keep
  // the reading position when older messages are prepended. Scroll events
  // caused by our own pinning are ignored, so a photo that grows the list
  // after a pin can't unpin it.
  const listRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const autoTopRef = useRef<number | null>(null);
  const jumpingRef = useRef(false);
  const anchorRef = useRef<{ height: number; top: number } | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  // Replies that arrived while scrolled up.
  const [unseen, setUnseen] = useState(0);

  const pin = useCallback((list: HTMLDivElement) => {
    const before = list.scrollTop;
    list.scrollTop = list.scrollHeight;
    jumpingRef.current = false;
    if (list.scrollTop !== before) autoTopRef.current = list.scrollTop;
  }, []);

  function stickToBottom() {
    stickRef.current = true;
    setAtBottom(true);
    setUnseen(0);
  }

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    if (anchorRef.current) {
      list.scrollTop = list.scrollHeight - anchorRef.current.height + anchorRef.current.top;
      anchorRef.current = null;
      return;
    }
    if (stickRef.current) pin(list);
  }, [messages, streamText, crisis, extras, chatLoaded, photoPending, pin]);

  // The message box grows with its text, up to five lines.
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, COMPOSER_MAX)}px`;
  }, [draft]);

  // With a mouse, the message box is ready to type into.
  useEffect(() => {
    if (chatLoaded && window.matchMedia("(pointer: fine)").matches) inputRef.current?.focus({ preventScroll: true });
  }, [chatLoaded]);

  function onScroll() {
    const list = listRef.current;
    if (!list) return;
    const auto = autoTopRef.current;
    autoTopRef.current = null;
    if (auto !== null && Math.abs(list.scrollTop - auto) < 2) return;
    const gap = list.scrollHeight - list.scrollTop - list.clientHeight;
    if (jumpingRef.current) {
      if (gap < 2) jumpingRef.current = false;
      return;
    }
    const stick = gap < 120;
    stickRef.current = stick;
    setAtBottom(stick);
    if (stick) setUnseen(0);
  }

  function jumpToLatest() {
    const list = listRef.current;
    if (!list) return;
    stickToBottom();
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    jumpingRef.current = smooth;
    list.scrollTo({ top: list.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }

  // Photos and videos load after the messages render, and the keyboard resizes
  // the list on phones; stay pinned through both.
  const conversationShown = Boolean(ready && session && person);
  useEffect(() => {
    const list = listRef.current;
    const content = contentRef.current;
    if (!conversationShown || !list || !content || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (stickRef.current && !anchorRef.current) pin(list);
    });
    observer.observe(content);
    observer.observe(list);
    return () => observer.disconnect();
  }, [conversationShown, pin]);

  const setExtra = useCallback((messageId: string, patch: Partial<Extra>) => {
    setExtras((current) => ({ ...current, [messageId]: { ...current[messageId], ...patch } }));
  }, []);

  // Poll pending photos, voice notes and videos until they settle.
  const pendingIds = useMemo(() => {
    const ids = new Set<string>();
    for (const message of messages) if (message.media?.status === "pending") ids.add(message.media.id);
    for (const extra of Object.values(extras)) {
      if (extra.voice?.status === "pending") ids.add(extra.voice.id);
      if (extra.video?.status === "pending") ids.add(extra.video.id);
    }
    return [...ids].filter((id) => !stalled.has(id)).sort().join(",");
  }, [messages, extras, stalled]);
  const pollStarted = useRef(new Map<string, number>());

  const applyMedia = useCallback((media: MediaDTO) => {
    setMessages((current) =>
      current.map((message) => (message.media?.id === media.id ? { ...message, media } : message)),
    );
    setExtras((current) => {
      let changed = false;
      const next: Record<string, Extra> = {};
      for (const [key, extra] of Object.entries(current)) {
        const updated = { ...extra };
        if (extra.voice?.id === media.id) {
          updated.voice = media;
          changed = true;
        }
        if (extra.video?.id === media.id) {
          updated.video = media;
          changed = true;
        }
        next[key] = updated;
      }
      return changed ? next : current;
    });
  }, []);

  useEffect(() => {
    if (!pendingIds) return;
    let cancelled = false;
    const timer = setInterval(() => {
      for (const id of pendingIds.split(",")) {
        const started = pollStarted.current.get(id) ?? Date.now();
        pollStarted.current.set(id, started);
        if (Date.now() - started > POLL_GIVE_UP_MS) {
          setStalled((current) => new Set(current).add(id));
          continue;
        }
        void api<{ media: MediaDTO }>(`/api/media/${id}/status`)
          .then(({ media }) => {
            if (cancelled || media.status === "pending") return;
            applyMedia(media);
            if (media.status !== "ready") void refreshMe();
          })
          .catch(() => {
            // Try again on the next tick.
          });
      }
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [pendingIds, api, applyMedia, refreshMe]);

  // Photos from this character, for the profile's gallery. Loaded only when
  // the profile is on screen, and again when a new photo lands in the chat.
  const readyPhotos = messages.filter((message) => message.media?.kind === "image" && message.media.status === "ready").length;
  const galleryWanted = conversationShown && (wide ? !profileHidden : sheetMounted);
  const personId = person?.id;
  const [galleryState, setGalleryState] = useState<{ chat: string; photos: MediaDTO[] | null; error?: string } | null>(null);

  useEffect(() => {
    if (!galleryWanted || !chatKey || !personId) return;
    let cancelled = false;
    void api<{ media: MediaDTO[] }>(`/api/media?kind=image&limit=60&characterId=${encodeURIComponent(personId)}`)
      .then(({ media }) => {
        if (cancelled) return;
        const photos = media;
        setGalleryState({ chat: chatKey, photos });
      })
      .catch(() => {
        if (cancelled) return;
        setGalleryState((current) =>
          current && current.chat === chatKey && current.photos
            ? current
            : { chat: chatKey, photos: null, error: "Couldn't load photos right now." },
        );
      });
    return () => {
      cancelled = true;
    };
  }, [galleryWanted, chatKey, personId, readyPhotos, api]);

  const gallery: Gallery =
    galleryState && galleryState.chat === chatKey ? { photos: galleryState.photos, error: galleryState.error } : { photos: null };

  async function send(override?: string) {
    const text = (override ?? draft).trim();
    if (!text || sending || !thread) return;
    setProblem(null);
    setSending(true);
    if (override === undefined) setDraft("");
    stickToBottom();

    const tempId = `pending-${Date.now()}`;
    setMessages((current) => [
      ...current,
      { id: tempId, role: "user", content: text, createdAt: new Date().toISOString(), media: null },
    ]);
    setStreamText("");

    let savedId: string | null = null;
    let finished = false;
    const removeMine = () => {
      setMessages((current) => current.filter((message) => message.id !== tempId && message.id !== savedId));
      setDraft((current) => current || text);
    };

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const response = await fetch(`/api/threads/${thread.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ content: text }),
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
        removeMine();
        setProblem({ text: body?.error ?? "Couldn't send that. Try again.", code: body?.code });
        if (body?.code && ACCESS_CHANGED.has(body.code)) void refreshMe();
        return;
      }

      for await (const event of readNdjson(response.body)) {
        if (event.type === "user") {
          savedId = event.message.id;
          setMessages((current) => current.map((message) => (message.id === tempId ? event.message : message)));
        } else if (event.type === "notice") {
          // A notice before the message was saved means it was refused and not
          // stored. That refusal is the whole answer: nothing else will follow.
          if (!savedId) {
            finished = true;
            setStreamText(null);
            setMessages((current) => current.filter((message) => message.id !== tempId));
            // A refusal can change what the account may see (saying you're
            // under 18 pauses explicit content), so the 18+ actions catch up.
            void refreshMe();
          }
          setMessages((current) => [...current, event.message]);
        } else if (event.type === "crisis") {
          setCrisis(event.resources);
        } else if (event.type === "delta") {
          setStreamText((current) => (current ?? "") + event.text);
        } else if (event.type === "done") {
          finished = true;
          // The saved reply replaces the streamed text (it can differ if the reply was replaced for safety).
          setStreamText(null);
          setMessages((current) => [...current, event.message]);
          if (!stickRef.current) setUnseen((count) => count + 1);
          setCredits({ balance: event.balance, free: event.freeMessagesLeft, me });
          setListVersion((count) => count + 1);
          void refreshMe();
        } else if (event.type === "error") {
          finished = true;
          setStreamText(null);
          // Model failures are undone server-side, so put the text back to resend.
          if (!savedId || event.code === "model_error") removeMine();
          setProblem({ text: event.error, code: event.code });
          if (event.code && ACCESS_CHANGED.has(event.code)) void refreshMe();
        }
      }
      if (!finished) {
        setProblem({ text: "The reply was cut off. Reload the page to see if it arrived." });
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      if (!finished) {
        if (!savedId) removeMine();
        setProblem({
          text: savedId
            ? "The connection dropped. Reload the page to see if the reply arrived."
            : "Couldn't reach Simulust. Check your connection and try again.",
        });
      }
      console.error(error);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setStreamText(null);
      setSending(false);
    }
  }

  async function loadEarlier() {
    const oldest = messages.find((message) => !message.id.startsWith("pending-"));
    if (!oldest || !thread || loadingEarlier) return;
    setLoadingEarlier(true);
    const list = listRef.current;
    try {
      const page = await api<ThreadPage>(`/api/threads/${thread.id}?before=${encodeURIComponent(oldest.createdAt)}`);
      anchorRef.current = list ? { height: list.scrollHeight, top: list.scrollTop } : null;
      setMessages((current) => {
        const have = new Set(current.map((message) => message.id));
        return [...page.messages.filter((message) => !have.has(message.id)), ...current];
      });
      setExtras((current) => ({ ...extrasFrom(page.messages), ...current }));
      setHasMore(page.hasMore ?? page.messages.length >= PAGE_SIZE);
    } catch (error) {
      setProblem(problemOf(error, "Couldn't load earlier messages."));
    } finally {
      setLoadingEarlier(false);
    }
  }

  // `hint` is a short idea for the photo (from the ideas menu or what was typed).
  async function requestPhoto(hint: string | null, fromDraft = false) {
    if (!thread || photoBusy) return;
    const idea = fromDraft ? hint : photoIdeaLabel(hint);
    setPhotoBusy(true);
    setPhotoPending({ idea, at: new Date().toISOString() });
    setProblem(null);
    stickToBottom();
    try {
      const result = await api<{ message: MessageDTO; notice?: MessageDTO | null; balance: number }>(
        `/api/threads/${thread.id}/photo`,
        { method: "POST", json: hint ? { hint } : {} },
      );
      if (fromDraft) setDraft("");
      // The AI disclosure, when one was due, comes just before the photo.
      setMessages((current) => [...current, ...(result.notice ? [result.notice] : []), result.message]);
      if (!stickRef.current) setUnseen((count) => count + 1);
      if (typeof result.balance === "number") {
        setCredits({ balance: result.balance, free: shownCredits?.free ?? 0, me });
      }
      setListVersion((count) => count + 1);
      void refreshMe();
    } catch (error) {
      const problem = problemOf(error, "Couldn't get a photo right now. Try again.");
      setProblem(problem);
      if (problem.code && ACCESS_CHANGED.has(problem.code)) void refreshMe();
    } finally {
      setPhotoBusy(false);
      setPhotoPending(null);
    }
  }

  async function requestVoice(message: MessageDTO) {
    setExtra(message.id, { busy: "voice", error: undefined });
    try {
      const result = await api<{ media: MediaDTO; balance: number }>(`/api/messages/${message.id}/voice`, { method: "POST" });
      setExtra(message.id, { voice: result.media, busy: undefined });
      if (typeof result.balance === "number") setCredits({ balance: result.balance, free: shownCredits?.free ?? 0, me });
      void refreshMe();
    } catch (error) {
      const { text, code } = problemOf(error, "Couldn't make a voice note. Try again.");
      setExtra(message.id, { busy: undefined, error: text });
      if (code && CHAT_WIDE.has(code)) setProblem({ text, code });
      if (code && ACCESS_CHANGED.has(code)) void refreshMe();
    }
  }

  async function requestVideo(message: MessageDTO, image: MediaDTO) {
    setExtra(message.id, { busy: "video", error: undefined });
    try {
      const result = await api<{ media: MediaDTO; balance: number }>(`/api/media/${image.id}/animate`, {
        method: "POST",
        json: {},
      });
      setExtra(message.id, { video: result.media, busy: undefined });
      if (typeof result.balance === "number") setCredits({ balance: result.balance, free: shownCredits?.free ?? 0, me });
      void refreshMe();
    } catch (error) {
      const { text, code } = problemOf(error, "Couldn't animate this photo. Try again.");
      setExtra(message.id, { busy: undefined, error: text });
      if (code && CHAT_WIDE.has(code)) setProblem({ text, code });
      if (code && ACCESS_CHANGED.has(code)) void refreshMe();
    }
  }

  function addStarter(text: string) {
    setDraft((current) => (current.trim() ? `${current.trimEnd()} ${text}` : text));
    requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    });
  }

  // ---------------------------------------------------------------------------
  // Render

  // The chat list on the left (desktop) for anyone who may be signed in.
  const showList = !ready || Boolean(session);
  const list = showList ? (
    <aside aria-label="Your chats" className={cx("hidden shrink-0 border-r border-[var(--line)] bg-[var(--bg-2)] lg:block", LIST_WIDTH)}>
      <ConversationList activeId={person?.id ?? characterId} current={person} refreshKey={listVersion} />
    </aside>
  ) : null;

  let center: ReactNode;
  let profile: ReactNode = null;
  let overlays: ReactNode = null;
  // The conversation (and its loading state) takes the whole phone screen,
  // covering the site's top bar: its own header has the way back.
  const immersive = !ready || !characterLoaded || Boolean(person && session);

  if (!ready || !characterLoaded) {
    center = <ConversationSkeleton />;
    profile = <ProfileSkeleton />;
  } else if (!person) {
    const failed = fetched?.problem;
    center = (
      <section className="flex min-w-0 flex-1 overflow-y-auto">
        <CenterNote
          title={failed ? "We couldn't load this chat." : "That character is gone."}
          body={failed ? failed.text : "They may have been deleted. Find someone new on Discover."}
        >
          {failed ? (
            <Button
              size="lg"
              onClick={() => {
                setCharacterState(null);
                setCharacterRetry((count) => count + 1);
              }}
            >
              Try again
            </Button>
          ) : null}
          <ButtonLink href={EXPLORE_HREF} size="lg" variant={failed ? "secondary" : "primary"}>
            Explore characters
          </ButtonLink>
          {session ? (
            <ButtonLink href="/chat" size="lg" variant="secondary">
              Back to chats
            </ButtonLink>
          ) : null}
        </CenterNote>
      </section>
    );
  } else if (!session) {
    center = (
      <section className="flex min-w-0 flex-1 overflow-y-auto px-4 py-6">
        <div className="m-auto w-full max-w-sm">
          <div
            className="relative aspect-[3/4] overflow-hidden rounded-3xl ring-1 ring-white/10"
            style={{ background: person.color }}
          >
            {person.image ? (
              <Image
                src={person.image}
                alt={`Portrait of ${person.name}`}
                fill
                sizes="(min-width: 640px) 384px, 100vw"
                loading="eager"
                fetchPriority="high"
                unoptimized={!isStaticArt(person.image)}
                className="object-cover"
              />
            ) : null}
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/60 to-transparent px-5 pb-5 pt-24">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--accent-2)]">{person.role}</p>
              <h1 className="mt-1 text-3xl font-bold tracking-tight text-white">
                {person.name}, {person.age}
              </h1>
              <p className="mt-2 text-sm leading-6 text-white/85">{person.line}</p>
              <Button size="lg" className="mt-5 w-full" onClick={openLogin}>
                Log in to start talking
              </Button>
              <p className="mt-3 text-center text-xs text-white/70">18+ only. {person.name} remembers you between chats.</p>
            </div>
          </div>
        </div>
      </section>
    );
  } else {
    const name = person.name;
    const canVoice = Boolean(features?.voice && me?.ageVerified);
    const canAnimate = Boolean(features?.video && me?.ageVerified);
    // me.ageVerified is the server's answer to "may this account see explicit
    // content": a confirmed adult with no hold. There's no switch, so that's
    // everything (photos, the 18+ quick actions, private photos, voice, video).
    // The server still checks every request itself.
    const canPhoto = Boolean(me?.ageVerified);
    const held = Boolean(me?.explicitHold);
    const privateAccess: PrivateAccess = held ? "held" : canPhoto ? "explicit" : "verify";
    const profileOpen = wide ? !profileHidden : sheetOpen;

    const balance = shownCredits ? shownCredits.balance.toLocaleString("en-US") : null;
    let creditLine: string | null = null;
    let creditShort = "";
    let creditTiny = "";
    if (me?.isMember) {
      creditLine = balance ? `Unlimited messages · ${balance} credits` : "Unlimited messages";
      creditShort = balance ? `${balance} credits` : "Unlimited";
      creditTiny = balance ?? "Unlimited";
    } else if (shownCredits) {
      creditLine =
        shownCredits.free > 0
          ? `${shownCredits.free} free ${shownCredits.free === 1 ? "message" : "messages"} left today · ${balance} credits`
          : `${balance} credits · ${COSTS.message} per message`;
      creditShort = shownCredits.free > 0 ? `${shownCredits.free} free left today` : `${balance} credits`;
      creditTiny = shownCredits.free > 0 ? `${shownCredits.free} free` : (balance ?? "");
    }

    let banner: ReactNode = null;
    if (held) {
      banner = <>Explicit chat and photos are paused while we review this account.</>;
    } else if (me && !me.ageVerified) {
      // An older account from before sign-up asked for a date of birth.
      banner = (
        <>
          Explicit chat and photos open up once you confirm your age.{" "}
          <Link href="/verify" className="font-semibold text-[var(--accent)] underline-offset-2 hover:underline">
            Confirm your age
          </Link>
        </>
      );
    }

    // Everything in the conversation in order, with the photo being taken and
    // the reply being written at the end, so runs and days can be worked out.
    type Item =
      | { kind: "message"; message: MessageDTO; role: string; createdAt: string }
      | { kind: "photo"; role: "assistant"; createdAt: string }
      | { kind: "stream"; role: "assistant"; createdAt: string };
    const items: Item[] = messages.map((message) => ({ kind: "message", message, role: message.role, createdAt: message.createdAt }));
    if (photoPending) items.push({ kind: "photo", role: "assistant", createdAt: photoPending.at });
    if (streamText !== null) {
      // It follows your message, so it shares its time and day.
      items.push({ kind: "stream", role: "assistant", createdAt: items.at(-1)?.createdAt ?? "1970-01-01T00:00:00.000Z" });
    }
    const positions = groupPositions(items);
    const stamps = stampedAt(items);
    const empty = messages.length === 0 && streamText === null && !hasMore;

    const lastSaid = messages.findLast((message) => message.role !== "notice");
    const starters =
      messages.length === 0 || streamText !== null
        ? []
        : replyStarters(lastSaid ? { role: lastSaid.role, hasPhoto: lastSaid.media?.kind === "image" } : null);

    const photoAction: PhotoAction | null = canPhoto
      ? {
          kind: "ask",
          onPick: (hint, fromDraft) => void requestPhoto(hint, fromDraft),
          busy: photoBusy,
          disabled: photoBusy || !thread || !chatLoaded,
          cost: COSTS.photo,
        }
      : held
        ? { kind: "paused" }
        : me
          ? { kind: "confirm" }
          : null;

    const subtitle =
      streamText !== null ? (
        <span className="text-[var(--accent)]">typing…</span>
      ) : photoPending ? (
        <span className="text-[var(--accent)]">taking a photo…</span>
      ) : (
        person.role
      );

    const openChatPhoto = (media: MediaDTO) => {
      const photos = messages.flatMap((message) =>
        message.media?.kind === "image" && message.media.status === "ready" && message.media.url ? [message.media] : [],
      );
      rememberFocus();
      setLightbox({ photos, index: Math.max(0, photos.findIndex((item) => item.id === media.id)) });
    };
    const openGalleryPhoto = (index: number) => {
      if (!gallery.photos) return;
      rememberFocus();
      setLightbox({ photos: gallery.photos, index });
    };
    // The character's private art, full screen. Reported as the character.
    const openPrivatePhoto = () => {
      if (!canPhoto || !person.explicitImage) return;
      rememberFocus();
      setLightbox({ photos: [{ id: person.id, kind: "image", status: "ready", url: person.explicitImage }], index: 0 });
    };
    // Which message a photo came in, so the viewer can offer to animate it.
    const messageFor = (mediaId: string) => messages.find((message) => message.media?.id === mediaId);
    const lightboxPhotos: LightboxPhoto[] = (lightbox?.photos ?? []).map((media) => {
      const message = messageFor(media.id);
      const video = message ? extras[message.id]?.video : undefined;
      return { media, canAnimate: canAnimate && Boolean(message) && (!video || video.status === "failed") };
    });

    const panelProps = {
      person,
      canPhoto,
      photoBusy,
      photoReady: chatLoaded && Boolean(thread),
      privateAccess,
      onOpenPrivate: openPrivatePhoto,
      gallery,
      onOpenPhoto: openGalleryPhoto,
      galleryRequest,
    };

    center = (
      <section className="flex min-w-0 flex-1 flex-col" aria-label={`Chat with ${name}`}>
        <ChatHeader person={person} subtitle={subtitle} profileOpen={profileOpen} onToggleProfile={toggleProfile} onPhotos={showPhotos} />
        {banner ? (
          <p className="shrink-0 border-b border-[var(--line)] bg-[var(--accent-soft)] px-4 py-2 text-center text-xs leading-5 text-[var(--ink)]">
            {banner}
          </p>
        ) : null}

        <div className="relative isolate min-h-0 flex-1">
          {/* A faint wash of the character's portrait, so the chat feels like their space. */}
          {person.image ? (
            <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
              <Image
                src={person.image}
                alt=""
                fill
                sizes="64px"
                unoptimized={!isStaticArt(person.image)}
                className="scale-125 object-cover opacity-[0.09] blur-3xl"
              />
            </div>
          ) : null}
          <div
            ref={listRef}
            onScroll={onScroll}
            onWheel={() => {
              jumpingRef.current = false;
            }}
            onTouchStart={() => {
              jumpingRef.current = false;
            }}
            className="h-full overflow-y-auto overscroll-contain"
          >
            <div ref={contentRef} className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-3 pb-5 pt-3 sm:px-6">
              {chatProblem ? (
                <Panel className="m-auto flex max-w-sm flex-col items-center px-6 py-8 text-center">
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent)]">
                    <ChatIcon className="h-6 w-6" />
                  </span>
                  <p className="mt-4 text-base font-semibold text-[var(--ink)]">Couldn&apos;t load your chat with {name}</p>
                  <p className="mt-1.5 text-sm leading-6 text-[var(--muted)]">{chatProblem.text}</p>
                  <Button
                    className="mt-5"
                    onClick={() => {
                      setHistoryProblem(null);
                      setHistoryRetry((count) => count + 1);
                    }}
                  >
                    Try again
                  </Button>
                </Panel>
              ) : !chatLoaded ? (
                <MessagesSkeleton />
              ) : empty ? (
                <>
                  <EmptyHero person={person} disabled={sending || !thread} onOpener={(text) => void send(text)} />
                  {items.map((item, index) =>
                    item.kind === "photo" ? <PendingPhoto key="photo" person={person} idea={photoPending?.idea ?? null} position={positions[index]} /> : null,
                  )}
                </>
              ) : (
                <>
                  {hasMore ? (
                    <button
                      type="button"
                      onClick={loadEarlier}
                      disabled={loadingEarlier}
                      className="mx-auto mb-2 mt-auto h-10 shrink-0 rounded-full border border-[var(--line)] bg-[var(--surface)] px-4 text-xs font-medium text-[var(--muted)] transition-colors hover:text-[var(--ink)] disabled:opacity-60"
                    >
                      {loadingEarlier ? "Loading…" : "Load earlier messages"}
                    </button>
                  ) : (
                    // Short chats sit just above the message box, like any messenger.
                    <div className="mt-auto flex flex-col items-center pb-2 pt-6 text-center">
                      <Avatar person={person} size="xl" />
                      <p className="mt-3 text-lg font-bold tracking-tight text-[var(--ink)]">
                        {name}, {person.age}
                      </p>
                      <p className="mt-1 max-w-sm text-xs leading-5 text-[var(--muted)]">
                        {name} is an AI character. Everything here is fiction between adults.
                      </p>
                    </div>
                  )}

                  {items.map((item, index) => {
                    const newDay = index === 0 || dayKey(item.createdAt) !== dayKey(items[index - 1].createdAt);
                    const position = positions[index];
                    let row: ReactNode;
                    if (item.kind === "stream") {
                      row = <StreamingBubble person={person} text={streamText ?? ""} position={position} />;
                    } else if (item.kind === "photo") {
                      row = <PendingPhoto person={person} idea={photoPending?.idea ?? null} position={position} />;
                    } else if (item.message.role === "notice") {
                      row = <NoticeLine>{item.message.content}</NoticeLine>;
                    } else {
                      const message = item.message;
                      row = (
                        <MessageBubble
                          message={message}
                          person={person}
                          extra={extras[message.id]}
                          stalled={stalled}
                          position={position}
                          stamped={stamps[index]}
                          timeShown={timeFor === message.id}
                          onToggleTime={() => setTimeFor((current) => (current === message.id ? null : message.id))}
                          canVoice={canVoice}
                          canAnimate={canAnimate}
                          onVoice={requestVoice}
                          onVideo={requestVideo}
                          onOpenPhoto={openChatPhoto}
                          lock={held ? "paused" : "confirm"}
                        />
                      );
                    }
                    return (
                      <Fragment key={item.kind === "message" ? item.message.id : item.kind}>
                        {newDay ? <DaySeparator label={dayLabel(item.createdAt)} /> : null}
                        {row}
                      </Fragment>
                    );
                  })}

                  {crisis ? (
                    <div className="mt-4">
                      <CrisisCard resources={crisis} onClose={() => setCrisis(null)} />
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </div>

          {!atBottom && chatLoaded ? (
            <button
              type="button"
              onClick={jumpToLatest}
              className={cx(
                "absolute bottom-3 left-1/2 z-10 flex h-10 -translate-x-1/2 items-center gap-1.5 rounded-full px-4 text-sm font-semibold shadow-[0_8px_24px_rgba(0,0,0,0.5)] backdrop-blur",
                unseen > 0
                  ? "bg-[var(--accent)] text-[var(--accent-ink)]"
                  : "border border-[var(--line)] bg-[var(--surface-2)]/95 text-[var(--ink)]",
                motion.pop,
              )}
            >
              <ChevronDownIcon className="h-4 w-4" />
              {unseen > 0 ? `${unseen} new` : "Latest"}
            </button>
          ) : null}
        </div>

        <Composer
          name={name}
          gender={person.gender}
          draft={draft}
          onDraft={setDraft}
          onSend={() => void send()}
          sending={sending}
          ready={chatLoaded && Boolean(thread)}
          maxLength={MAX_LENGTH}
          textareaRef={inputRef}
          problem={problem ? <ProblemLine problem={problem} held={held} onDismiss={() => setProblem(null)} /> : null}
          photo={photoAction}
          starters={starters}
          onStarter={addStarter}
          credits={creditLine ? { full: creditLine, short: creditShort, tiny: creditTiny } : null}
        />
      </section>
    );

    profile = (
      <aside
        aria-label={`${name}'s profile`}
        className={cx("hidden shrink-0 border-l border-[var(--line)] bg-[var(--bg-2)]", PROFILE_WIDTH, !profileHidden && "@min-[1180px]:block")}
      >
        <ProfilePanel
          {...panelProps}
          onClose={() => setDocked(true)}
          closeLabel="Hide profile"
          onPhoto={(hint) => void requestPhoto(hint ?? null)}
        />
      </aside>
    );

    overlays = (
      <>
        {sheetShown ? (
          <ProfileSheet open={sheetOpen} label={`${name}'s profile`} onClose={closeSheet}>
            <ProfilePanel
              {...panelProps}
              onClose={closeSheet}
              closeLabel="Close profile"
              closeRef={sheetCloseRef}
              onPhoto={(hint) => {
                closeSheet();
                void requestPhoto(hint ?? null);
              }}
            />
          </ProfileSheet>
        ) : null}
        {lightbox && lightboxPhotos.length > 0 ? (
          <Lightbox
            photos={lightboxPhotos}
            index={lightbox.index}
            onIndex={pageLightbox}
            name={name}
            onClose={closeLightbox}
            animateCost={COSTS.video}
            onAnimate={(index) => {
              const media = lightboxPhotos[index]?.media;
              const message = media ? messageFor(media.id) : undefined;
              if (!media || !message) return;
              closeLightbox();
              void requestVideo(message, media);
            }}
          />
        ) : null}
      </>
    );
  }

  return (
    <AppShell>
      <div
        ref={rootRef}
        inert={overlayOpen || undefined}
        className={cx(
          "@container flex min-h-0 bg-[var(--bg)]",
          immersive
            ? "max-lg:fixed max-lg:inset-x-0 max-lg:top-[var(--vvt,0px)] max-lg:z-[45] max-lg:h-[var(--vvh,100dvh)] lg:h-full"
            : "h-full",
        )}
      >
        {list}
        {center}
        {profile}
      </div>
      {overlays}
    </AppShell>
  );
}
