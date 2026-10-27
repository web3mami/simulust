"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { AppShell, useLane } from "@/components/app-shell";
import { useSession } from "@/components/auth-gate";
import { ConversationList } from "@/components/chat/conversation-list";
import { EXPLORE_HREF } from "@/components/chat/format";
import { ChatIcon } from "@/components/icons";
import { ButtonLink, CharacterCard, cx } from "@/components/ui";
import type { ThreadDTO } from "@/lib/api-types";
import { laneOf, SEED_CHARACTERS } from "@/lib/characters";

// A few people to start with, from the lane picked in the top bar, leaving out
// anyone you already talk to. A grid when there's nothing else on the page, a
// row to swipe through under your chats otherwise.
function Suggestions({
  count,
  exclude,
  layout,
  title = "a new chat",
  className,
}: {
  count: number;
  exclude: ReadonlySet<string>;
  layout: "grid" | "row";
  title?: string;
  className?: string;
}) {
  const { lane } = useLane();
  const people = SEED_CHARACTERS.filter((person) => laneOf(person) === lane && !exclude.has(person.id)).slice(0, count);
  if (people.length === 0) return null;
  return (
    <div className={className}>
      <h2 className="text-lg font-bold tracking-tight text-[var(--ink)]">
        <span className="text-[var(--accent)]">Start</span> {title}
      </h2>
      <div
        className={cx(
          "mt-3 gap-3",
          layout === "grid"
            ? "grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4"
            : "no-scrollbar -mx-4 flex snap-x scroll-px-4 overflow-x-auto px-4 sm:mx-0 sm:grid sm:grid-cols-4 sm:overflow-visible sm:px-0",
        )}
      >
        {people.map((person, index) => (
          <CharacterCard
            key={person.id}
            person={person}
            priority={index < 2}
            className={layout === "row" ? "w-40 shrink-0 snap-start sm:w-auto" : undefined}
          />
        ))}
      </div>
    </div>
  );
}

// Desktop centre when no conversation is open.
function PickAChat({ opening, first, exclude }: { opening: boolean; first: boolean; exclude: ReadonlySet<string> }) {
  if (opening) {
    return (
      <p className="m-auto animate-pulse text-sm text-[var(--muted)]" role="status">
        Opening your latest chat…
      </p>
    );
  }
  return (
    <div className="m-auto flex w-full max-w-3xl flex-col items-center px-8 py-12 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent)]">
        <ChatIcon className="h-8 w-8" />
      </span>
      <h2 className="mt-5 text-2xl font-bold tracking-tight text-[var(--ink)]">
        {first ? (
          <>
            <span className="text-[var(--accent)]">Start</span> your first chat
          </>
        ) : (
          <>
            <span className="text-[var(--accent)]">Pick</span> a chat or explore characters
          </>
        )}
      </h2>
      <p className="mt-2 max-w-md text-sm leading-6 text-[var(--muted)]">
        {first
          ? "Pick someone below. They'll remember you next time."
          : "Everyone you talk to remembers you, so you can pick up where you left off."}
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <ButtonLink href={EXPLORE_HREF} size="lg">
          Explore characters
        </ButtonLink>
        <ButtonLink href="/create" size="lg" variant="secondary">
          Create your own
        </ButtonLink>
      </div>
      <Suggestions count={4} exclude={exclude} layout="grid" className="mt-12 w-full text-left" />
    </div>
  );
}

const NONE: ReadonlySet<string> = new Set();

export default function ChatPage() {
  const router = useRouter();
  const { ready, session } = useSession();
  // The chats once they load (null until they do, or if loading failed).
  const [threads, setThreads] = useState<ThreadDTO[] | null>(null);
  const [failed, setFailed] = useState(false);
  // The list reports cached rows and then fresh ones; open the latest chat once.
  const redirected = useRef(false);

  // On desktop the list sits beside the conversation, so open the latest one.
  const onLoaded = useCallback(
    (loaded: ThreadDTO[] | null) => {
      setThreads(loaded);
      setFailed(loaded === null);
      if (!redirected.current && loaded && loaded.length > 0 && window.matchMedia("(min-width: 1024px)").matches) {
        redirected.current = true;
        router.replace(`/date/${encodeURIComponent(loaded[0].character.id)}`);
      }
    },
    [router],
  );

  const count = threads ? threads.length : failed ? 0 : null;
  const exclude = threads ? new Set(threads.map((thread) => thread.character.id)) : NONE;
  const loading = !ready || (Boolean(session) && count === null);
  const opening = Boolean(session) && count !== null && count > 0;

  return (
    <AppShell>
      <div className="flex lg:h-[calc(100dvh-4rem)]">
        <aside
          aria-label="Your chats"
          className="w-full lg:w-[280px] lg:shrink-0 lg:border-r lg:border-[var(--line)] lg:bg-[var(--bg-2)] 2xl:w-[320px]"
        >
          <ConversationList as="h1" onLoaded={onLoaded} />
          {session && threads ? (
            threads.length === 0 ? (
              <Suggestions count={6} exclude={exclude} layout="grid" title="your first chat" className="px-4 pb-6 pt-2 lg:hidden" />
            ) : (
              <Suggestions count={8} exclude={exclude} layout="row" className="px-4 pb-6 pt-4 lg:hidden" />
            )
          ) : null}
        </aside>
        <section className="hidden min-w-0 flex-1 overflow-y-auto lg:flex">
          {loading ? null : <PickAChat opening={opening} first={count === 0 && !failed} exclude={exclude} />}
        </section>
      </div>
    </AppShell>
  );
}
