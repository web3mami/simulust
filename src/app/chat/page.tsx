"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { AppShell, useLane } from "@/components/app-shell";
import { useSession } from "@/components/auth-gate";
import { ConversationList } from "@/components/chat/conversation-list";
import { EXPLORE_HREF } from "@/components/chat/format";
import { ChatIcon } from "@/components/icons";
import { ButtonLink, CharacterCard } from "@/components/ui";
import type { ThreadDTO } from "@/lib/api-types";
import { laneOf, SEED_CHARACTERS } from "@/lib/characters";

// A few people to start with, from the lane picked in the top bar.
function Suggestions({ count, className }: { count: number; className?: string }) {
  const { lane } = useLane();
  const people = SEED_CHARACTERS.filter((person) => laneOf(person) === lane).slice(0, count);
  if (people.length === 0) return null;
  return (
    <div className={className}>
      <h2 className="text-lg font-bold tracking-tight text-[var(--ink)]">
        <span className="text-[var(--accent)]">Start</span> a new chat
      </h2>
      <div className="no-scrollbar -mx-4 mt-3 flex snap-x scroll-px-4 gap-3 overflow-x-auto px-4 sm:mx-0 sm:grid sm:grid-cols-4 sm:overflow-visible sm:px-0">
        {people.map((person) => (
          <CharacterCard key={person.id} person={person} className="w-40 shrink-0 snap-start sm:w-auto" />
        ))}
      </div>
    </div>
  );
}

// Desktop centre when no conversation is open.
function PickAChat({ opening }: { opening: boolean }) {
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
        <span className="text-[var(--accent)]">Pick</span> a chat or explore characters
      </h2>
      <p className="mt-2 max-w-md text-sm leading-6 text-[var(--muted)]">
        Your conversations are on the left. Everyone you talk to remembers you, so you can pick up where you left off.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <ButtonLink href={EXPLORE_HREF} size="lg">
          Explore characters
        </ButtonLink>
        <ButtonLink href="/create" size="lg" variant="secondary">
          Create your own
        </ButtonLink>
      </div>
      <Suggestions count={4} className="mt-12 w-full text-left" />
    </div>
  );
}

export default function ChatPage() {
  const router = useRouter();
  const { ready, session } = useSession();
  // How many chats loaded (null until they do, or if loading failed).
  const [count, setCount] = useState<number | null>(null);

  // On desktop the list sits beside the conversation, so open the latest one.
  const onLoaded = useCallback(
    (threads: ThreadDTO[] | null) => {
      setCount(threads ? threads.length : 0);
      if (threads && threads.length > 0 && window.matchMedia("(min-width: 1024px)").matches) {
        router.replace(`/date/${encodeURIComponent(threads[0].character.id)}`);
      }
    },
    [router],
  );

  const loading = !ready || (Boolean(session) && count === null);
  const opening = Boolean(session) && count !== null && count > 0;

  return (
    <AppShell>
      <div className="flex lg:h-[calc(100dvh-4rem)]">
        <aside
          aria-label="Your chats"
          className="w-full lg:w-[300px] lg:shrink-0 lg:border-r lg:border-[var(--line)] lg:bg-[var(--bg-2)] 2xl:w-[320px]"
        >
          <ConversationList as="h1" onLoaded={onLoaded} />
          {session && count !== null ? <Suggestions count={8} className="px-4 pb-6 pt-4 lg:hidden" /> : null}
        </aside>
        <section className="hidden min-w-0 flex-1 overflow-y-auto lg:flex">
          {loading ? null : <PickAChat opening={opening} />}
        </section>
      </div>
    </AppShell>
  );
}
