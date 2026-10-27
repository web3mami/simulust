"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { AppHeader, AppShell } from "@/components/app-shell";
import { useSession } from "@/components/auth-gate";
import { ApiError, useApi } from "@/lib/api";
import type { CharacterDTO, MemoryDTO } from "@/lib/api-types";

const MAX_LENGTH = 280;

const KIND: Record<MemoryDTO["kind"], { label: string; className: string }> = {
  fact: { label: "Fact", className: "border-white/15 text-[var(--muted)]" },
  preference: { label: "Preference", className: "border-[var(--gold)]/40 text-[var(--gold)]" },
  event: { label: "Event", className: "border-sky-300/30 text-sky-200" },
  boundary: { label: "Boundary", className: "border-rose-300/40 text-rose-200" },
};

function messageOf(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback;
}

function sortMemories(rows: MemoryDTO[]) {
  return [...rows].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt));
}

function MemoryItem({
  memory,
  onSave,
  onTogglePin,
  onDelete,
}: {
  memory: MemoryDTO;
  onSave: (content: string) => Promise<string | null>;
  onTogglePin: () => Promise<string | null>;
  onDelete: () => Promise<string | null>;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(memory.content);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const kind = KIND[memory.kind];

  async function run(action: () => Promise<string | null>, after?: () => void) {
    setBusy(true);
    setError(null);
    const failure = await action();
    setBusy(false);
    if (failure) setError(failure);
    else after?.();
  }

  return (
    <li className="py-4">
      <div className="flex items-center gap-2">
        <span className={`rounded-full border px-2 py-0.5 text-[11px] ${kind.className}`}>{kind.label}</span>
        {memory.pinned ? <span className="text-[11px] text-[var(--gold)]">Pinned</span> : null}
      </div>

      {editing ? (
        <form
          className="mt-2"
          onSubmit={(event) => {
            event.preventDefault();
            const next = text.trim();
            if (!next) {
              setError("A memory can't be empty. Delete it instead.");
              return;
            }
            if (next === memory.content) {
              setEditing(false);
              return;
            }
            void run(() => onSave(next), () => setEditing(false));
          }}
        >
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value.slice(0, MAX_LENGTH))}
            rows={2}
            maxLength={MAX_LENGTH}
            autoFocus
            aria-label="Edit memory"
            className="w-full resize-none rounded-xl border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-sm leading-6 outline-none focus:border-[var(--gold)]/60"
          />
          <div className="mt-2 flex items-center gap-3 text-xs">
            <button
              type="submit"
              disabled={busy}
              className="rounded-full bg-[var(--gold)] px-4 py-1.5 font-medium !text-[#12110F] disabled:opacity-60"
            >
              {busy ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setText(memory.content);
                setError(null);
              }}
              className="text-[var(--muted)] hover:text-[var(--ink)]"
            >
              Cancel
            </button>
            <span className="ml-auto text-[var(--muted)]">
              {text.length}/{MAX_LENGTH}
            </span>
          </div>
        </form>
      ) : (
        <>
          <p className="mt-2 text-sm leading-6 text-[var(--ink)]">{memory.content}</p>
          <div className="mt-2 flex items-center gap-4 text-xs text-[var(--muted)]">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setText(memory.content);
                setEditing(true);
              }}
              className="hover:text-[var(--ink)] disabled:opacity-60"
            >
              Edit
            </button>
            <button type="button" disabled={busy} onClick={() => void run(onTogglePin)} className="hover:text-[var(--ink)] disabled:opacity-60">
              {memory.pinned ? "Unpin" : "Pin"}
            </button>
            <button type="button" disabled={busy} onClick={() => void run(onDelete)} className="hover:text-rose-200 disabled:opacity-60">
              Delete
            </button>
          </div>
        </>
      )}
      {error ? (
        <p role="alert" className="mt-2 text-xs text-rose-200">
          {error}
        </p>
      ) : null}
    </li>
  );
}

export default function MemoriesPage() {
  const params = useParams<{ characterId: string }>();
  const characterId = params.characterId;
  const { ready, session, openLogin } = useSession();
  const api = useApi();
  const sessionKey = session?.detail ?? null;
  const loadKey = sessionKey ? `${sessionKey}:${characterId}` : null;

  const [state, setState] = useState<{
    key: string;
    character: CharacterDTO | null;
    memories: MemoryDTO[] | null;
    error?: string;
  } | null>(null);
  const [retry, setRetry] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [forgetting, setForgetting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!loadKey) return;
    let cancelled = false;
    void (async () => {
      const [character, memories] = await Promise.allSettled([
        api<{ character: CharacterDTO }>(`/api/characters/${encodeURIComponent(characterId)}`),
        api<{ memories: MemoryDTO[] }>(`/api/memories?characterId=${encodeURIComponent(characterId)}`),
      ]);
      if (cancelled) return;
      setState({
        key: loadKey,
        // A deleted character can still have memories worth reviewing or deleting.
        character: character.status === "fulfilled" ? character.value.character : null,
        memories: memories.status === "fulfilled" ? sortMemories(memories.value.memories) : null,
        error:
          memories.status === "rejected"
            ? messageOf(memories.reason, "Couldn't load memories. Check your connection and try again.")
            : undefined,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [api, characterId, loadKey, retry]);

  const loaded = state && state.key === loadKey ? state : null;
  const person = loaded?.character ?? null;
  const name = person?.name ?? "this character";
  const Name = person?.name ?? "This character";

  function replace(memory: MemoryDTO) {
    setState((current) =>
      current && current.memories
        ? { ...current, memories: sortMemories(current.memories.map((row) => (row.id === memory.id ? memory : row))) }
        : current,
    );
  }

  function remove(id: string) {
    setState((current) =>
      current && current.memories ? { ...current, memories: current.memories.filter((row) => row.id !== id) } : current,
    );
  }

  async function patch(id: string, body: { content?: string; pinned?: boolean }) {
    try {
      const { memory } = await api<{ memory: MemoryDTO }>(`/api/memories/${id}`, { method: "PATCH", json: body });
      replace(memory);
      return null;
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        remove(id);
        return null;
      }
      return messageOf(error, "Couldn't save that. Try again.");
    }
  }

  async function destroy(id: string) {
    try {
      await api<{ ok: true }>(`/api/memories/${id}`, { method: "DELETE" });
      remove(id);
      return null;
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        remove(id);
        return null;
      }
      return messageOf(error, "Couldn't delete that. Try again.");
    }
  }

  async function forgetEverything() {
    setForgetting(true);
    setNotice(null);
    try {
      await api<{ ok: true; deleted: number }>(`/api/memories?characterId=${encodeURIComponent(characterId)}`, {
        method: "DELETE",
      });
      setState((current) => (current ? { ...current, memories: [] } : current));
      setConfirming(false);
      setNotice(`Done. ${Name} has forgotten everything about you.`);
    } catch (error) {
      setNotice(messageOf(error, "Couldn't forget everything just now. Try again."));
    } finally {
      setForgetting(false);
    }
  }

  let body: ReactNode;
  if (!ready || (loadKey && !loaded)) {
    body = (
      <div className="mt-8 space-y-4" aria-label="Loading memories">
        {[0, 1, 2].map((row) => (
          <div key={row} className="space-y-2">
            <div className="h-4 w-20 animate-pulse rounded-full bg-[var(--bg-2)]" />
            <div className="h-4 w-3/4 animate-pulse rounded bg-[var(--bg-2)]" />
          </div>
        ))}
      </div>
    );
  } else if (!session) {
    body = (
      <div className="mt-8 rounded-2xl border border-[var(--line)] bg-[var(--bg-2)] p-6">
        <p className="text-sm leading-6 text-[var(--muted)]">Log in to see and edit what characters remember about you.</p>
        <button
          type="button"
          onClick={openLogin}
          className="mt-4 rounded-full bg-[var(--gold)] px-5 py-2 text-sm font-medium !text-[#12110F]"
        >
          Log in
        </button>
      </div>
    );
  } else if (!loaded?.memories) {
    body = (
      <div className="mt-8 rounded-2xl border border-[var(--line)] bg-[var(--bg-2)] p-6">
        <p className="text-sm text-[var(--ink)]">{loaded?.error ?? "Couldn't load memories."}</p>
        <button
          type="button"
          onClick={() => {
            setState(null);
            setRetry((count) => count + 1);
          }}
          className="mt-4 rounded-full bg-[var(--gold)] px-5 py-2 text-sm font-medium !text-[#12110F]"
        >
          Try again
        </button>
      </div>
    );
  } else if (loaded.memories.length === 0) {
    body = (
      <div className="mt-8 rounded-2xl border border-[var(--line)] bg-[var(--bg-2)] p-6">
        <p className="text-sm leading-6 text-[var(--muted)]">
          {Name} hasn&apos;t saved anything about you yet. As you talk, the things that matter show up here, and you can edit
          or delete any of them.
        </p>
        {person ? (
          <Link
            href={`/date/${person.id}`}
            className="mt-4 inline-block rounded-full bg-[var(--gold)] px-5 py-2 text-sm font-medium !text-[#12110F]"
          >
            Talk to {name}
          </Link>
        ) : null}
      </div>
    );
  } else {
    const count = loaded.memories.length;
    body = (
      <>
        <ul className="mt-6 divide-y divide-[var(--line)] border-y border-[var(--line)]">
          {loaded.memories.map((memory) => (
            <MemoryItem
              key={`${memory.id}:${memory.updatedAt}`}
              memory={memory}
              onSave={(content) => patch(memory.id, { content })}
              onTogglePin={() => patch(memory.id, { pinned: !memory.pinned })}
              onDelete={() => destroy(memory.id)}
            />
          ))}
        </ul>

        <div className="mt-8 rounded-2xl border border-[var(--line)] bg-[var(--bg-2)] p-5">
          {confirming ? (
            <>
              <p className="text-sm font-medium text-[var(--ink)]">Forget everything {name} knows about you?</p>
              <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                This deletes all {count} {count === 1 ? "memory" : "memories"} and the summary of your older chats. Your chat
                history stays, and {name} still sees your most recent messages. This can&apos;t be undone.
              </p>
              <div className="mt-4 flex gap-3">
                <button
                  type="button"
                  onClick={forgetEverything}
                  disabled={forgetting}
                  className="rounded-full bg-rose-300 px-5 py-2 text-sm font-medium text-[#12110F] disabled:opacity-60"
                >
                  {forgetting ? "Forgetting…" : "Forget everything"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  disabled={forgetting}
                  className="rounded-full border border-[var(--line)] px-5 py-2 text-sm"
                >
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-[var(--muted)]">Want a clean slate?</p>
              <button
                type="button"
                onClick={() => {
                  setNotice(null);
                  setConfirming(true);
                }}
                className="rounded-full border border-rose-300/40 px-4 py-2 text-sm text-rose-200 hover:bg-rose-300/10"
              >
                Forget everything
              </button>
            </div>
          )}
        </div>
      </>
    );
  }

  return (
    <AppShell>
      <AppHeader />
      <section className="mx-auto w-full max-w-xl px-4 pb-10 pt-6">
        {person ? (
          <Link href={`/date/${person.id}`} className="text-xs text-[var(--muted)] hover:text-[var(--ink)]">
            ← Back to {person.name}
          </Link>
        ) : (
          <Link href="/chat" className="text-xs text-[var(--muted)] hover:text-[var(--ink)]">
            ← Back to chats
          </Link>
        )}
        <div className="mt-4 flex items-center gap-4">
          {person ? (
            <span
              className="relative h-14 w-14 shrink-0 overflow-hidden rounded-full border border-white/10"
              style={{ background: person.color }}
            >
              {person.image ? <img src={person.image} alt="" className="h-full w-full object-cover" /> : null}
            </span>
          ) : null}
          <div className="min-w-0">
            <h1 className="font-[family-name:var(--font-display)] text-3xl text-[var(--ink)]">What {name} remembers</h1>
          </div>
        </div>
        <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
          This is what {name} remembers about you. Edit or delete anything. Pinned memories and boundaries are always on{" "}
          {person ? `${name}'s` : "their"} mind; the rest come up when they&apos;re relevant.
        </p>
        {notice ? (
          <p role="status" className="mt-4 rounded-xl border border-[var(--line)] px-3 py-2 text-sm text-[var(--ink)]">
            {notice}
          </p>
        ) : null}
        {body}
      </section>
    </AppShell>
  );
}
