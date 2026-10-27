"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { useSession } from "@/components/auth-gate";
import { Avatar } from "@/components/chat/avatar";
import { ChatHeader } from "@/components/chat/chat-header";
import { Composer } from "@/components/chat/composer";
import { ConversationList } from "@/components/chat/conversation-list";
import { EXPLORE_HREF } from "@/components/chat/format";
import { MessageBubble, NoticeLine, StreamingBubble, type Extra } from "@/components/chat/message-bubble";
import { CrisisCard, Lightbox, ProblemLine, type Problem } from "@/components/chat/message-parts";
import { ProfilePanel } from "@/components/chat/profile-panel";
import { Button, ButtonLink, cx } from "@/components/ui";
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

function problemOf(error: unknown, fallback = "Something went wrong. Try again."): Problem {
  if (error instanceof ApiError) return { text: error.message, code: error.code };
  return { text: fallback };
}

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
      <h1 className="text-2xl font-bold tracking-tight text-[var(--ink)] sm:text-3xl">{title}</h1>
      <p className="mt-3 text-sm leading-6 text-[var(--muted)]">{body}</p>
      {children ? <div className="mt-6 flex flex-wrap justify-center gap-3">{children}</div> : null}
    </div>
  );
}

function ConversationSkeleton() {
  return (
    <div className="flex min-w-0 flex-1 flex-col" aria-label="Loading chat">
      <div className="flex h-16 shrink-0 items-center gap-3 border-b border-[var(--line)] bg-[var(--bg-2)] px-4">
        <span className="h-10 w-10 animate-pulse rounded-full bg-[var(--surface)]" />
        <span className="h-3 w-28 animate-pulse rounded bg-[var(--surface)]" />
      </div>
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-end gap-3 px-4 py-6 sm:px-6">
        <div className="h-12 w-2/3 animate-pulse rounded-2xl bg-[var(--surface)]" />
        <div className="ml-auto h-10 w-1/2 animate-pulse rounded-2xl bg-[var(--surface)]" />
        <div className="h-20 w-3/4 animate-pulse rounded-2xl bg-[var(--surface)]" />
        <div className="mt-4 h-14 w-full animate-pulse rounded-3xl bg-[var(--surface)]" />
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

  // Character
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
        if (!cancelled) setCharacterState({ key: characterKey, character });
      } catch (error) {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 404) setCharacterState({ key: characterKey, character: null });
        else setCharacterState({ key: characterKey, character: null, problem: problemOf(error, "Couldn't load this character.") });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, api, characterId, characterKey, characterRetry]);

  const characterLoaded = characterState?.key === characterKey;
  const person = characterLoaded ? characterState.character : null;

  // Thread and history
  const chatKey = session && person ? `${sessionKey}:${person.id}` : null;
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [historyProblem, setHistoryProblem] = useState<{ key: string; problem: Problem } | null>(null);
  const [historyRetry, setHistoryRetry] = useState(0);
  const [thread, setThread] = useState<ThreadDTO | null>(null);
  const [messages, setMessages] = useState<MessageDTO[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [extras, setExtras] = useState<Record<string, Extra>>({});
  // Media we stopped polling because it took too long.
  const [stalled, setStalled] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    if (!chatKey || !person) return;
    let cancelled = false;
    void (async () => {
      try {
        const opened = await api<{ thread: ThreadDTO }>("/api/threads", { method: "POST", json: { characterId: person.id } });
        const page = await api<ThreadPage>(`/api/threads/${opened.thread.id}`);
        if (cancelled) return;
        setThread(page.thread);
        setMessages(page.messages);
        setHasMore(page.hasMore ?? page.messages.length >= PAGE_SIZE);
        setExtras(extrasFrom(page.messages));
        setLoadedKey(chatKey);
      } catch (error) {
        if (!cancelled) setHistoryProblem({ key: chatKey, problem: problemOf(error, "Couldn't load your chat.") });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, chatKey, person, historyRetry]);

  const chatLoaded = chatKey !== null && loadedKey === chatKey;
  const chatProblem = historyProblem && historyProblem.key === chatKey && !chatLoaded ? historyProblem.problem : null;

  // Composer and streaming
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [streamText, setStreamText] = useState<string | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [crisis, setCrisis] = useState<CrisisResource[] | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  // Credits from the latest reply, shown until /api/me catches up.
  const [credits, setCredits] = useState<{ balance: number; free: number; me: Me | null } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const shownCredits = credits && credits.me === me ? credits : me ? { balance: me.balance, free: me.freeMessagesLeft } : null;

  // Layout: the chat list refreshes after each reply so its previews stay
  // current; the profile docks beside the chat on wide screens and slides over
  // it on narrow ones; photos open full screen.
  const [listVersion, setListVersion] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(false);
  const [profileHidden, setProfileHidden] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [lightbox, setLightbox] = useState<MediaDTO | null>(null);
  const closeLightbox = useCallback(() => setLightbox(null), []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setWide(entry.contentRect.width >= DOCK_MIN));
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  const sheetShown = sheetOpen && !wide;
  useEffect(() => {
    if (!sheetShown) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setSheetOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [sheetShown]);

  function toggleProfile() {
    if ((rootRef.current?.clientWidth ?? 0) >= DOCK_MIN) setProfileHidden((value) => !value);
    else setSheetOpen((value) => !value);
  }

  // Scrolling: stay pinned to the bottom unless the user scrolled up, and keep
  // the reading position when older messages are prepended.
  const listRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const anchorRef = useRef<{ height: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    if (anchorRef.current) {
      list.scrollTop = list.scrollHeight - anchorRef.current.height + anchorRef.current.top;
      anchorRef.current = null;
      return;
    }
    if (stickRef.current) list.scrollTop = list.scrollHeight;
  }, [messages, streamText, crisis, extras, chatLoaded]);

  // The composer grows with its text, up to max-h-40.
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
  }, [draft]);

  function onScroll() {
    const list = listRef.current;
    if (!list) return;
    stickRef.current = list.scrollHeight - list.scrollTop - list.clientHeight < 120;
  }

  // Photos and videos load after the messages render; stay pinned while they grow.
  const contentRef = useRef<HTMLDivElement>(null);
  const conversationShown = Boolean(ready && session && person);
  useEffect(() => {
    const list = listRef.current;
    const content = contentRef.current;
    if (!conversationShown || !list || !content || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (stickRef.current && !anchorRef.current) list.scrollTop = list.scrollHeight;
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [conversationShown]);

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

  async function send() {
    const text = draft.trim();
    if (!text || sending || !thread) return;
    setProblem(null);
    setSending(true);
    setDraft("");
    stickRef.current = true;

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
          setCredits({ balance: event.balance, free: event.freeMessagesLeft, me });
          setListVersion((count) => count + 1);
          void refreshMe();
        } else if (event.type === "error") {
          finished = true;
          setStreamText(null);
          // Model failures are undone server-side, so put the text back to resend.
          if (!savedId || event.code === "model_error") removeMine();
          setProblem({ text: event.error, code: event.code });
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

  async function requestPhoto() {
    if (!thread || photoBusy) return;
    // The photo endpoint takes a short idea, not a whole message.
    const hint = draft.trim().slice(0, 300);
    setPhotoBusy(true);
    setProblem(null);
    try {
      const result = await api<{ message: MessageDTO; notice?: MessageDTO | null; balance: number }>(
        `/api/threads/${thread.id}/photo`,
        { method: "POST", json: hint ? { hint } : {} },
      );
      if (hint) setDraft("");
      stickRef.current = true;
      // The AI disclosure, when one was due, comes just before the photo.
      setMessages((current) => [...current, ...(result.notice ? [result.notice] : []), result.message]);
      if (typeof result.balance === "number") {
        setCredits({ balance: result.balance, free: shownCredits?.free ?? 0, me });
      }
      setListVersion((count) => count + 1);
      void refreshMe();
    } catch (error) {
      setProblem(problemOf(error, "Couldn't get a photo right now. Try again."));
    } finally {
      setPhotoBusy(false);
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
      if (code === "insufficient_credits" || code === "age_verification_required") setProblem({ text, code });
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
      if (code === "insufficient_credits" || code === "age_verification_required") setProblem({ text, code });
    }
  }

  // ---------------------------------------------------------------------------
  // Render

  // The chat list on the left (desktop) for anyone who may be signed in.
  const showList = !ready || Boolean(session);
  const list = showList ? (
    <aside
      aria-label="Your chats"
      className="hidden w-[300px] shrink-0 border-r border-[var(--line)] bg-[var(--bg-2)] lg:block 2xl:w-[320px]"
    >
      <ConversationList activeId={person?.id ?? characterId} current={person} refreshKey={listVersion} />
    </aside>
  ) : null;

  let center: ReactNode;
  let profile: ReactNode = null;
  let overlays: ReactNode = null;

  if (!ready || !characterLoaded) {
    center = <ConversationSkeleton />;
  } else if (!person) {
    const failed = characterState?.problem;
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
              <img src={person.image} alt={`Portrait of ${person.name}`} className="absolute inset-0 h-full w-full object-cover" />
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
    const canPhoto = Boolean(me?.ageVerified);
    const profileOpen = wide ? !profileHidden : sheetOpen;

    const creditLine = me?.isMember
      ? "Member · unlimited messages"
      : shownCredits
        ? shownCredits.free > 0
          ? `${shownCredits.free} free ${shownCredits.free === 1 ? "message" : "messages"} left today · ${shownCredits.balance.toLocaleString("en-US")} credits`
          : `${shownCredits.balance.toLocaleString("en-US")} credits · ${COSTS.message} per message`
        : null;
    const creditShort = me?.isMember
      ? "Unlimited"
      : shownCredits
        ? shownCredits.free > 0
          ? `${shownCredits.free} free left today`
          : `${shownCredits.balance.toLocaleString("en-US")} credits`
        : "";

    let banner: ReactNode = null;
    if (me && !me.ageVerified) {
      banner = (
        <>
          Explicit chat and photos unlock after age verification.{" "}
          <Link href="/verify" className="font-semibold text-[var(--accent)] underline-offset-2 hover:underline">
            Verify your age
          </Link>
        </>
      );
    } else if (me && me.ageVerified && !me.settings.explicit) {
      banner = (
        <>
          Explicit chat is off.{" "}
          <Link href="/settings" className="font-semibold text-[var(--accent)] underline-offset-2 hover:underline">
            Turn it on in Settings
          </Link>
        </>
      );
    }

    // Which character messages start a new run and so show the avatar.
    const avatarIds = new Set<string>();
    let previous: MessageDTO["role"] | null = null;
    for (const message of messages) {
      if (message.role === "assistant" && previous !== "assistant") avatarIds.add(message.id);
      previous = message.role;
    }

    const panelProps = {
      person,
      canPhoto,
      photoBusy,
      photoReady: chatLoaded && Boolean(thread),
    };

    center = (
      <section className="flex min-w-0 flex-1 flex-col" aria-label={`Chat with ${name}`}>
        <ChatHeader person={person} subtitle={person.role} profileOpen={profileOpen} onToggleProfile={toggleProfile} />
        {banner ? (
          <p className="shrink-0 border-b border-[var(--line)] bg-[var(--accent-soft)] px-4 py-2 text-center text-xs text-[var(--ink)]">
            {banner}
          </p>
        ) : null}

        <div ref={listRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
          <div ref={contentRef} className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-3 px-3 py-5 sm:px-6">
            {chatProblem ? (
              <div className="m-auto max-w-sm text-center">
                <p className="text-sm text-[var(--ink)]">{chatProblem.text}</p>
                <Button
                  className="mt-4"
                  onClick={() => {
                    setHistoryProblem(null);
                    setHistoryRetry((count) => count + 1);
                  }}
                >
                  Try again
                </Button>
              </div>
            ) : !chatLoaded ? (
              <div className="mt-auto flex flex-col gap-3" aria-label="Loading messages">
                <div className="h-12 w-2/3 animate-pulse rounded-2xl bg-[var(--surface)]" />
                <div className="ml-auto h-10 w-1/2 animate-pulse rounded-2xl bg-[var(--surface)]" />
                <div className="h-16 w-3/4 animate-pulse rounded-2xl bg-[var(--surface)]" />
              </div>
            ) : (
              <>
                {hasMore ? (
                  <button
                    type="button"
                    onClick={loadEarlier}
                    disabled={loadingEarlier}
                    className="mx-auto h-9 rounded-full border border-[var(--line)] bg-[var(--surface)] px-4 text-xs font-medium text-[var(--muted)] hover:text-[var(--ink)] disabled:opacity-60"
                  >
                    {loadingEarlier ? "Loading…" : "Load earlier messages"}
                  </button>
                ) : (
                  <div className="flex flex-col items-center pb-2 pt-4 text-center">
                    <Avatar person={person} size="xl" />
                    <p className="mt-3 text-lg font-bold tracking-tight text-[var(--ink)]">
                      {name}, {person.age}
                    </p>
                    <p className="mt-1 max-w-sm text-[11px] leading-5 text-[var(--muted)]">
                      {name} is an AI character. Everything here is fiction between adults.
                    </p>
                  </div>
                )}

                {messages.length === 0 && streamText === null ? (
                  <div className="m-auto max-w-sm py-10 text-center">
                    <p className="text-xl font-bold tracking-tight text-[var(--ink)]">Say hi to {name}.</p>
                    <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{person.line}</p>
                  </div>
                ) : null}

                {messages.map((message) =>
                  message.role === "notice" ? (
                    <NoticeLine key={message.id}>{message.content}</NoticeLine>
                  ) : (
                    <MessageBubble
                      key={message.id}
                      message={message}
                      person={person}
                      extra={extras[message.id]}
                      stalled={stalled}
                      showAvatar={avatarIds.has(message.id)}
                      canVoice={canVoice}
                      canAnimate={canAnimate}
                      onVoice={requestVoice}
                      onVideo={requestVideo}
                      onOpenPhoto={setLightbox}
                    />
                  ),
                )}

                {streamText !== null ? (
                  <StreamingBubble person={person} text={streamText} showAvatar={previous !== "assistant"} />
                ) : null}

                {crisis ? <CrisisCard resources={crisis} onClose={() => setCrisis(null)} /> : null}
              </>
            )}
          </div>
        </div>

        <Composer
          name={name}
          draft={draft}
          onDraft={setDraft}
          onSend={() => void send()}
          sending={sending}
          ready={chatLoaded}
          maxLength={MAX_LENGTH}
          textareaRef={inputRef}
          problem={problem ? <ProblemLine problem={problem} onDismiss={() => setProblem(null)} /> : null}
          photo={
            canPhoto && chatLoaded
              ? { onClick: () => void requestPhoto(), busy: photoBusy, disabled: photoBusy || !thread, cost: COSTS.photo }
              : null
          }
          credits={creditLine ? { full: creditLine, short: creditShort, member: Boolean(me?.isMember) } : null}
        />
      </section>
    );

    profile = (
      <aside
        aria-label={`${name}'s profile`}
        className={cx(
          "hidden w-[340px] shrink-0 border-l border-[var(--line)] bg-[var(--bg-2)]",
          !profileHidden && "@min-[1180px]:block",
        )}
      >
        <ProfilePanel {...panelProps} onClose={() => setProfileHidden(true)} closeLabel="Hide profile" onPhoto={() => void requestPhoto()} />
      </aside>
    );

    overlays = (
      <>
        {sheetShown ? (
          <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={`${name}'s profile`}>
            <button
              type="button"
              aria-label="Close profile"
              tabIndex={-1}
              className="absolute inset-0 bg-black/70 transition-opacity starting:opacity-0"
              onClick={() => setSheetOpen(false)}
            />
            <div className="absolute inset-y-0 right-0 w-full max-w-[400px] border-l border-[var(--line)] bg-[var(--bg-2)] shadow-[0_0_60px_rgba(0,0,0,0.6)] transition-transform duration-200 starting:translate-x-full">
              <ProfilePanel
                {...panelProps}
                onClose={() => setSheetOpen(false)}
                closeLabel="Close profile"
                onPhoto={() => {
                  setSheetOpen(false);
                  void requestPhoto();
                }}
              />
            </div>
          </div>
        ) : null}
        {lightbox ? <Lightbox media={lightbox} name={name} onClose={closeLightbox} /> : null}
      </>
    );
  }

  return (
    <AppShell>
      <div ref={rootRef} className="@container flex h-full min-h-0">
        {list}
        {center}
        {profile}
      </div>
      {overlays}
    </AppShell>
  );
}
