"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { useSession } from "@/components/auth-gate";
import { ACCOUNT_PAGE, Notice, SectionCard, SignInPrompt, solidDangerClass } from "@/components/account/account-ui";
import { PencilIcon, PinIcon, TrashIcon } from "@/components/account/account-icons";
import { BrainIcon, ChevronLeftIcon } from "@/components/icons";
import { Button, Panel, buttonClass, cx, inputClass } from "@/components/ui";
import { ApiError, useApi } from "@/lib/api";
import type { CharacterDTO, MemoryDTO } from "@/lib/api-types";

const MAX_LENGTH = 280;
// Matches PINNED_CAP in server/memory.ts: the server refuses a pin past this.
const PIN_LIMIT = 40;

const KIND: Record<MemoryDTO["kind"], { label: string; className: string }> = {
  fact: { label: "Fact", className: "bg-white/[0.07] text-[var(--muted)]" },
  preference: { label: "Preference", className: "bg-[var(--accent-soft)] text-[var(--accent)]" },
  event: { label: "Event", className: "bg-sky-400/10 text-sky-200" },
  boundary: { label: "Boundary", className: "bg-red-500/15 text-red-200 ring-1 ring-red-400/30" },
};

const itemAction =
  "inline-flex h-10 items-center gap-1.5 rounded-full px-3 text-xs font-semibold text-[var(--muted)] transition-colors hover:bg-white/5 hover:text-[var(--ink)] disabled:opacity-60";

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
    <li
      className={cx(
        "flex flex-col rounded-2xl border bg-[var(--surface)] p-4 sm:p-5",
        memory.pinned ? "border-[var(--accent)]/40" : "border-[var(--line)]",
      )}
    >
      <div className="flex items-center gap-2">
        <span className={cx("rounded-full px-2.5 py-0.5 text-[11px] font-semibold", kind.className)}>{kind.label}</span>
        {memory.pinned ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--accent)]">
            <PinIcon className="h-3.5 w-3.5" />
            Pinned
          </span>
        ) : null}
      </div>

      {editing ? (
        <form
          className="mt-3"
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
            rows={3}
            maxLength={MAX_LENGTH}
            autoFocus
            aria-label="Edit memory"
            className={cx(inputClass, "resize-none py-3 leading-6")}
          />
          <div className="mt-3 flex items-center gap-2">
            <button type="submit" disabled={busy} className={buttonClass("primary", "md")}>
              {busy ? "Saving…" : "Save"}
            </button>
            <Button
              variant="ghost"
              onClick={() => {
                setEditing(false);
                setText(memory.content);
                setError(null);
              }}
            >
              Cancel
            </Button>
            <span className="ml-auto text-xs text-[var(--muted)]">
              {text.length}/{MAX_LENGTH}
            </span>
          </div>
        </form>
      ) : (
        <>
          <p className="mt-3 flex-1 break-words text-[15px] leading-6 text-[var(--ink)]">{memory.content}</p>
          <div className="-mx-2 -mb-1 mt-3 flex items-center gap-1 border-t border-[var(--line)] pt-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setText(memory.content);
                setEditing(true);
              }}
              className={itemAction}
            >
              <PencilIcon className="h-4 w-4" />
              Edit
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(onTogglePin)}
              className={itemAction}
            >
              <PinIcon className="h-4 w-4" />
              {memory.pinned ? "Unpin" : "Pin"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(onDelete)}
              className={cx(itemAction, "ml-auto hover:bg-red-500/10 hover:text-red-300")}
            >
              <TrashIcon className="h-4 w-4" />
              Delete
            </button>
          </div>
        </>
      )}
      {error ? (
        <p role="alert" className="mt-2 text-xs text-red-300">
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
      <ul className="grid gap-3 sm:grid-cols-2" aria-label="Loading memories">
        {[0, 1, 2, 3].map((row) => (
          <li key={row} className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
            <div className="h-5 w-20 animate-pulse rounded-full bg-white/[0.06]" />
            <div className="mt-4 h-4 w-full animate-pulse rounded-full bg-white/[0.06]" />
            <div className="mt-2 h-4 w-2/3 animate-pulse rounded-full bg-white/[0.06]" />
          </li>
        ))}
      </ul>
    );
  } else if (!session) {
    body = (
      <SignInPrompt
        title="Log in to see memories"
        body="Log in to see and edit what characters remember about you."
        onLogin={openLogin}
      />
    );
  } else if (!loaded?.memories) {
    body = (
      <Panel className="flex flex-col items-start gap-4 p-6">
        <p className="text-sm text-[var(--ink)]">{loaded?.error ?? "Couldn't load memories."}</p>
        <Button
          size="lg"
          onClick={() => {
            setState(null);
            setRetry((count) => count + 1);
          }}
        >
          Try again
        </Button>
      </Panel>
    );
  } else if (loaded.memories.length === 0) {
    body = (
      <Panel className="flex flex-col items-center px-6 py-12 text-center">
        <span
          aria-hidden
          className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent)]"
        >
          <BrainIcon className="h-7 w-7" />
        </span>
        <p className="mt-4 max-w-md text-sm leading-6 text-[var(--muted)]">
          {Name} hasn&apos;t saved anything about you yet. As you talk, the things that matter show up here, and you can edit
          or delete any of them.
        </p>
        {person ? (
          <Link href={`/date/${person.id}`} className={buttonClass("primary", "lg", "mt-6")}>
            Talk to {name}
          </Link>
        ) : null}
      </Panel>
    );
  } else {
    const count = loaded.memories.length;
    body = (
      <>
        <ul className="grid gap-3 sm:grid-cols-2">
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

        <SectionCard
          tone="danger"
          className="mt-8"
          icon={<TrashIcon />}
          title={confirming ? `Forget everything ${name} knows about you?` : "Forget everything"}
          description={
            confirming ? (
              <>
                This deletes all {count} {count === 1 ? "memory" : "memories"} and the summary of your older chats. Your
                chat history stays, and {name} still sees your most recent messages. This can&apos;t be undone.
              </>
            ) : (
              "Want a clean slate?"
            )
          }
          action={
            confirming ? null : (
              <Button
                variant="danger"
                onClick={() => {
                  setNotice(null);
                  setConfirming(true);
                }}
              >
                Forget everything
              </Button>
            )
          }
        >
          {confirming ? (
            <div className="flex flex-wrap gap-3">
              <button type="button" onClick={forgetEverything} disabled={forgetting} className={solidDangerClass("md")}>
                {forgetting ? "Forgetting…" : "Forget everything"}
              </button>
              <Button variant="secondary" onClick={() => setConfirming(false)} disabled={forgetting}>
                Cancel
              </Button>
            </div>
          ) : null}
        </SectionCard>
      </>
    );
  }

  const memories = loaded?.memories ?? null;
  const pinnedCount = memories ? memories.filter((memory) => memory.pinned).length : 0;

  return (
    <AppShell>
      <div className={ACCOUNT_PAGE}>
        <Link
          href={person ? `/date/${person.id}` : "/chat"}
          className="-ml-2 inline-flex h-10 items-center gap-1 rounded-full pl-1 pr-3 text-sm font-semibold !text-[var(--muted)] hover:bg-white/5 hover:!text-[var(--ink)]"
        >
          <ChevronLeftIcon className="h-5 w-5" />
          {person ? `Back to ${person.name}` : "Back to chats"}
        </Link>

        <Panel className="relative mt-3 overflow-hidden">
          {person?.image ? (
            <img
              src={person.image}
              alt=""
              className="pointer-events-none absolute inset-0 h-full w-full scale-110 object-cover opacity-25 blur-2xl"
            />
          ) : null}
          <div className="absolute inset-0 bg-gradient-to-r from-[var(--surface)] via-[var(--surface)]/85 to-[var(--surface)]/60" />
          <div className="relative grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 p-5 sm:items-start sm:gap-x-6 sm:p-6">
            {person ? (
              <span
                className="relative aspect-[3/4] w-16 shrink-0 overflow-hidden rounded-xl ring-1 ring-white/10 sm:row-span-3 sm:w-28"
                style={{ background: person.color }}
              >
                {person.image ? <img src={person.image} alt="" className="h-full w-full object-cover" /> : null}
              </span>
            ) : (
              <span
                aria-hidden
                className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)] sm:row-span-3"
              >
                <BrainIcon className="h-7 w-7" />
              </span>
            )}
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-wide text-[var(--accent)]">Memories</p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight text-[var(--ink)] sm:text-3xl">What {name} remembers</h1>
            </div>
            <p className="col-span-2 max-w-2xl text-sm leading-6 text-[var(--muted)] sm:col-span-1">
              This is what {name} remembers about you. Edit or delete anything. Pinned memories and boundaries are always on{" "}
              {person ? `${name}'s` : "their"} mind; the rest come up when they&apos;re relevant.
            </p>
            {memories && memories.length ? (
              <div className="col-span-2 flex flex-wrap gap-2 text-xs font-semibold sm:col-span-1">
                <span className="rounded-full bg-white/[0.07] px-3 py-1.5 text-[var(--ink)]">
                  {memories.length} {memories.length === 1 ? "memory" : "memories"}
                </span>
                <span
                  className={cx(
                    "inline-flex items-center gap-1 rounded-full px-3 py-1.5",
                    pinnedCount >= PIN_LIMIT ? "bg-red-500/15 text-red-200" : "bg-[var(--accent-soft)] text-[var(--accent)]",
                  )}
                >
                  <PinIcon className="h-3.5 w-3.5" />
                  {pinnedCount} of {PIN_LIMIT} pinned
                </span>
              </div>
            ) : null}
          </div>
        </Panel>

        {notice ? (
          <Notice tone="info" role="status" className="mt-4">
            {notice}
          </Notice>
        ) : null}
        <div className="mt-6">{body}</div>
      </div>
    </AppShell>
  );
}
