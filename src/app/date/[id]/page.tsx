"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppHeader, AppShell } from "@/components/app-shell";
import { useSession } from "@/components/auth-gate";
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
type Problem = { text: string; code?: string };
// Voice notes and videos made from a message, loaded with history or made during this visit.
type Extra = { voice?: MediaDTO; video?: MediaDTO; busy?: "voice" | "video"; error?: string };

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

// *actions* in asterisks render as italics, the way roleplay chats write them.
function Rich({ text }: { text: string }) {
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

function ProblemLine({ problem, onDismiss }: { problem: Problem; onDismiss: () => void }) {
  let action: ReactNode = null;
  if (problem.code === "insufficient_credits") {
    action = (
      <Link href="/premium" className="shrink-0 rounded-full bg-[var(--gold)] px-3 py-1 text-xs font-medium !text-[#12110F]">
        Get credits
      </Link>
    );
  } else if (problem.code === "age_verification_required") {
    action = (
      <Link href="/verify" className="shrink-0 rounded-full bg-[var(--gold)] px-3 py-1 text-xs font-medium !text-[#12110F]">
        Verify your age
      </Link>
    );
  }
  return (
    <div role="alert" className="flex items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-sm">
      <p className="min-w-0 flex-1 text-[var(--ink)]">{problem.text}</p>
      {action}
      <button type="button" onClick={onDismiss} className="shrink-0 text-xs text-[var(--muted)] hover:text-[var(--ink)]">
        Dismiss
      </button>
    </div>
  );
}

function CrisisCard({ resources, onClose }: { resources: CrisisResource[]; onClose: () => void }) {
  return (
    <div role="region" aria-label="Crisis support" className="rounded-2xl border border-[var(--gold)]/50 bg-[var(--bg)] p-4 text-sm">
      <div className="flex items-start justify-between gap-3">
        <p className="font-medium text-[var(--ink)]">
          If you&apos;re thinking about hurting yourself, you can talk to a real person right now. It&apos;s free and
          confidential.
        </p>
        <button type="button" onClick={onClose} className="shrink-0 text-xs text-[var(--muted)] hover:text-[var(--ink)]">
          Close
        </button>
      </div>
      <ul className="mt-3 space-y-2">
        {resources.map((resource) => (
          <li key={resource.label}>
            <span className="text-[var(--gold)]">{resource.label}:</span>{" "}
            {resource.href ? (
              <a href={resource.href} className="underline underline-offset-2" target={resource.href.startsWith("http") ? "_blank" : undefined} rel="noreferrer">
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

function MediaView({ media, name, stalled }: { media: MediaDTO; name: string; stalled?: boolean }) {
  if (media.status === "pending") {
    const label = stalled
      ? "Still working on it. Reload the page later to check."
      : media.kind === "video"
        ? "Making the video…"
        : media.kind === "audio"
          ? "Recording…"
          : "Taking the photo…";
    return (
      <div
        className={`flex max-w-full items-center justify-center rounded-xl border border-dashed border-[var(--line)] px-4 text-center text-xs text-[var(--muted)] ${
          media.kind === "audio" ? "h-12 w-64" : "h-40 w-56"
        }`}
      >
        <span className={stalled ? "" : "animate-pulse"}>{label}</span>
      </div>
    );
  }
  if (media.status !== "ready" || !media.url) {
    return (
      <p className="rounded-xl border border-[var(--line)] px-3 py-2 text-xs text-[var(--muted)]">
        {media.error ?? "This couldn't be created."} Any credits for it were returned.
      </p>
    );
  }
  if (media.kind === "image") {
    return <img src={media.url} alt={`Photo from ${name}`} className="max-h-96 w-auto max-w-full rounded-xl" />;
  }
  if (media.kind === "video") {
    return <video controls playsInline src={media.url} className="max-h-96 w-auto max-w-full rounded-xl" />;
  }
  return <audio controls src={media.url} className="w-64 max-w-full" />;
}

function CharacterCard({ person, children }: { person: CharacterDTO; children?: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--line)]" style={{ background: person.color }}>
      {person.image ? <img src={person.image} alt="" className="aspect-[3/4] w-full object-cover" /> : null}
      <div className="p-5">
        <p className="text-xs uppercase text-[var(--accent-2)]">{person.role}</p>
        <h1 className="mt-2 font-[family-name:var(--font-display)] text-3xl">
          {person.name}, {person.age}
        </h1>
        <p className="mt-2 text-sm">
          {person.gender} · {person.ethnicity} · {person.body}
        </p>
        <p className="mt-3 text-xs uppercase tracking-[0.18em] text-[var(--accent-2)]">
          {person.lane === "anime" ? "Anime" : "Realistic"} · {person.heat}
        </p>
        <p className="mt-4 text-sm leading-6">{person.line}</p>
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

  if (!ready || !characterLoaded) {
    return (
      <AppShell>
        <AppHeader />
        <section className="mx-auto grid max-w-5xl gap-6 px-4 pb-6 pt-4 sm:px-6 lg:grid-cols-[280px_1fr]">
          <div className="hidden aspect-[3/4] animate-pulse rounded-2xl bg-[var(--bg-2)] lg:block" />
          <div className="h-[60vh] animate-pulse rounded-2xl bg-[var(--bg-2)]" />
        </section>
      </AppShell>
    );
  }

  if (!person) {
    const failed = characterState?.problem;
    return (
      <AppShell>
        <AppHeader />
        <section className="mx-auto max-w-xl px-6 pt-16">
          <h1 className="font-[family-name:var(--font-display)] text-3xl">
            {failed ? "We couldn't load this chat." : "That character is gone."}
          </h1>
          <p className="mt-3 text-sm text-[var(--muted)]">
            {failed ? failed.text : "They may have been deleted. Find someone new on Discover."}
          </p>
          <div className="mt-6 flex gap-3">
            {failed ? (
              <button
                type="button"
                onClick={() => {
                  setCharacterState(null);
                  setCharacterRetry((count) => count + 1);
                }}
                className="rounded-full bg-[var(--gold)] px-5 py-2 text-sm font-medium !text-[#12110F]"
              >
                Try again
              </button>
            ) : null}
            <Link href="/#explore" className="rounded-full border border-[var(--line)] px-5 py-2 text-sm">
              Back to Discover
            </Link>
          </div>
        </section>
      </AppShell>
    );
  }

  if (!session) {
    return (
      <AppShell>
        <AppHeader />
        <section className="mx-auto max-w-sm px-4 pb-10 pt-6">
          <CharacterCard person={person}>
            <button
              type="button"
              onClick={openLogin}
              className="mt-6 w-full rounded-full bg-[var(--gold)] px-5 py-3 text-sm font-medium !text-[#12110F]"
            >
              Log in to start talking
            </button>
            <p className="mt-3 text-center text-xs text-white/70">
              18+ only. {person.name} remembers you between chats.
            </p>
          </CharacterCard>
        </section>
      </AppShell>
    );
  }

  const name = person.name;
  const canVoice = Boolean(features?.voice && me?.ageVerified);
  const canAnimate = Boolean(features?.video && me?.ageVerified);
  const canPhoto = Boolean(me?.ageVerified);

  const creditLine = me?.isMember
    ? "Member · unlimited messages"
    : shownCredits
      ? shownCredits.free > 0
        ? `${shownCredits.free} free ${shownCredits.free === 1 ? "message" : "messages"} left today · ${shownCredits.balance.toLocaleString("en-US")} credits`
        : `${shownCredits.balance.toLocaleString("en-US")} credits · ${COSTS.message} per message`
      : null;

  let banner: ReactNode = null;
  if (me && !me.ageVerified) {
    banner = (
      <p className="border-b border-[var(--line)] px-5 py-2 text-xs text-[var(--muted)]">
        Explicit chat and photos unlock after age verification.{" "}
        <Link href="/verify" className="text-[var(--gold)] underline-offset-2 hover:underline">
          Verify your age
        </Link>
      </p>
    );
  } else if (me && me.ageVerified && !me.settings.explicit) {
    banner = (
      <p className="border-b border-[var(--line)] px-5 py-2 text-xs text-[var(--muted)]">
        Explicit chat is off.{" "}
        <Link href="/settings" className="text-[var(--gold)] underline-offset-2 hover:underline">
          Turn it on in Settings
        </Link>
      </p>
    );
  }

  return (
    <AppShell>
      <AppHeader />
      <section className="mx-auto grid max-w-5xl gap-6 px-4 pb-4 pt-4 sm:px-6 lg:grid-cols-[280px_1fr]">
        <aside className="hidden lg:block">
          <CharacterCard person={person}>
            <Link
              href={`/memories/${person.id}`}
              className="mt-5 block rounded-full border border-white/20 px-4 py-2 text-center text-sm hover:bg-white/10"
            >
              What {name} remembers
            </Link>
          </CharacterCard>
          {creditLine ? <p className="mt-3 px-1 text-xs text-[var(--muted)]">{creditLine}</p> : null}
        </aside>

        <div className="flex h-[calc(100dvh-9.5rem)] min-h-[420px] flex-col overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--bg-2)] lg:h-[calc(100dvh-6rem)]">
          <div className="flex items-center gap-3 border-b border-[var(--line)] px-4 py-3 lg:hidden">
            <span
              className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full border border-white/10"
              style={{ background: person.color }}
            >
              {person.image ? <img src={person.image} alt="" className="h-full w-full object-cover" /> : null}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">
                {name}, {person.age}
              </span>
              {creditLine ? <span className="block truncate text-[11px] text-[var(--muted)]">{creditLine}</span> : null}
            </span>
            <Link href={`/memories/${person.id}`} className="shrink-0 text-xs text-[var(--gold)]">
              Memories
            </Link>
          </div>
          {banner}

          <div ref={listRef} onScroll={onScroll} className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-5 sm:px-5">
            {chatProblem ? (
              <div className="m-auto max-w-sm text-center">
                <p className="text-sm text-[var(--ink)]">{chatProblem.text}</p>
                <button
                  type="button"
                  onClick={() => {
                    setHistoryProblem(null);
                    setHistoryRetry((count) => count + 1);
                  }}
                  className="mt-4 rounded-full bg-[var(--gold)] px-5 py-2 text-sm font-medium !text-[#12110F]"
                >
                  Try again
                </button>
              </div>
            ) : !chatLoaded ? (
              <div className="flex flex-col gap-3" aria-label="Loading messages">
                <div className="h-10 w-2/3 animate-pulse rounded-2xl bg-[var(--bg)]" />
                <div className="ml-auto h-10 w-1/2 animate-pulse rounded-2xl bg-[var(--bg)]" />
                <div className="h-16 w-3/4 animate-pulse rounded-2xl bg-[var(--bg)]" />
              </div>
            ) : (
              <>
                {hasMore ? (
                  <button
                    type="button"
                    onClick={loadEarlier}
                    disabled={loadingEarlier}
                    className="mx-auto rounded-full border border-[var(--line)] px-4 py-1.5 text-xs text-[var(--muted)] hover:text-[var(--ink)] disabled:opacity-60"
                  >
                    {loadingEarlier ? "Loading…" : "Load earlier"}
                  </button>
                ) : (
                  <p className="mx-auto max-w-sm text-center text-[11px] leading-5 text-[var(--muted)]">
                    {name} is an AI character. Everything here is fiction between adults.
                  </p>
                )}

                {messages.length === 0 && streamText === null ? (
                  <div className="m-auto max-w-sm py-10 text-center">
                    <p className="font-[family-name:var(--font-display)] text-xl">Say hi to {name}.</p>
                    <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{person.line}</p>
                  </div>
                ) : null}

                {messages.map((message) => {
                  if (message.role === "notice") {
                    return (
                      <p key={message.id} className="mx-auto max-w-sm text-center text-[11px] leading-5 text-[var(--muted)]">
                        {message.content}
                      </p>
                    );
                  }
                  const mine = message.role === "user";
                  const extra = extras[message.id];
                  const pending = message.id.startsWith("pending-");
                  const image = message.media?.kind === "image" && message.media.status === "ready" ? message.media : null;
                  return (
                    <div key={message.id} className={`flex max-w-[85%] flex-col gap-2 ${mine ? "ml-auto items-end" : "items-start"}`}>
                      {message.content ? (
                        <p
                          className={`whitespace-pre-wrap break-words rounded-2xl px-4 py-3 text-sm leading-6 ${
                            mine ? "bg-[var(--gold)] text-[#12110F]" : "bg-[var(--bg)] text-[var(--ink)]"
                          } ${pending ? "opacity-70" : ""}`}
                        >
                          <Rich text={message.content} />
                        </p>
                      ) : null}
                      {message.media ? (
                        <MediaView media={message.media} name={name} stalled={stalled.has(message.media.id)} />
                      ) : null}
                      {extra?.video ? <MediaView media={extra.video} name={name} stalled={stalled.has(extra.video.id)} /> : null}
                      {extra?.voice ? <MediaView media={extra.voice} name={name} stalled={stalled.has(extra.voice.id)} /> : null}
                      {!mine ? (
                        <div className="flex flex-wrap items-center gap-3 text-[11px] text-[var(--muted)]">
                          {canVoice && message.content && (!extra?.voice || extra.voice.status === "failed") ? (
                            <button
                              type="button"
                              disabled={extra?.busy === "voice"}
                              onClick={() => requestVoice(message)}
                              className="hover:text-[var(--ink)] disabled:opacity-60"
                            >
                              {extra?.busy === "voice" ? "Recording…" : `Voice · ${COSTS.voiceNote} credits`}
                            </button>
                          ) : null}
                          {canAnimate && image && (!extra?.video || extra.video.status === "failed") ? (
                            <button
                              type="button"
                              disabled={extra?.busy === "video"}
                              onClick={() => requestVideo(message, image)}
                              className="hover:text-[var(--ink)] disabled:opacity-60"
                            >
                              {extra?.busy === "video" ? "Starting…" : `Animate · ${COSTS.video} credits`}
                            </button>
                          ) : null}
                          {extra?.error ? <span className="text-[var(--ink)]">{extra.error}</span> : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })}

                {streamText !== null ? (
                  <div className="flex max-w-[85%] flex-col items-start">
                    <p className="whitespace-pre-wrap break-words rounded-2xl bg-[var(--bg)] px-4 py-3 text-sm leading-6 text-[var(--ink)]">
                      {streamText ? (
                        <Rich text={streamText} />
                      ) : (
                        <span className="inline-flex gap-1" aria-label={`${name} is typing`}>
                          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--muted)]" />
                          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--muted)] [animation-delay:150ms]" />
                          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--muted)] [animation-delay:300ms]" />
                        </span>
                      )}
                    </p>
                  </div>
                ) : null}

                {crisis ? <CrisisCard resources={crisis} onClose={() => setCrisis(null)} /> : null}
              </>
            )}
          </div>

          <div className="border-t border-[var(--line)] p-3 sm:p-4">
            {problem ? (
              <div className="mb-3">
                <ProblemLine problem={problem} onDismiss={() => setProblem(null)} />
              </div>
            ) : null}
            {canPhoto && chatLoaded ? (
              <div className="mb-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={requestPhoto}
                  disabled={photoBusy || !thread}
                  className="rounded-full border border-[var(--line)] px-3 py-1.5 text-xs text-[var(--ink)] hover:bg-white/5 disabled:opacity-60"
                  title={draft.trim() ? "Uses what you've typed as the idea for the photo" : undefined}
                >
                  {photoBusy ? "Asking…" : `Send me a photo · ${COSTS.photo} credits`}
                </button>
              </div>
            ) : null}
            <form
              className="flex items-end gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void send();
              }}
            >
              <textarea
                ref={inputRef}
                value={draft}
                onChange={(event) => setDraft(event.target.value.slice(0, MAX_LENGTH))}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    void send();
                  }
                }}
                rows={1}
                maxLength={MAX_LENGTH}
                placeholder={`Text ${name}`}
                aria-label={`Message ${name}`}
                disabled={!chatLoaded}
                className="max-h-40 min-h-[48px] flex-1 resize-none rounded-3xl border border-[var(--line)] bg-[var(--bg)] px-4 py-3 text-sm leading-6 outline-none focus:border-[var(--gold)]/60 disabled:opacity-60"
              />
              <button
                type="submit"
                disabled={!draft.trim() || sending || !chatLoaded}
                className="h-12 shrink-0 rounded-full bg-[var(--gold)] px-5 text-sm font-medium !text-[#12110F] disabled:opacity-50"
              >
                {sending ? "…" : "Send"}
              </button>
            </form>
            {draft.length > MAX_LENGTH - 500 ? (
              <p className="mt-1 text-right text-[11px] text-[var(--muted)]">
                {draft.length.toLocaleString("en-US")} / {MAX_LENGTH.toLocaleString("en-US")}
              </p>
            ) : null}
          </div>
        </div>
      </section>
    </AppShell>
  );
}
