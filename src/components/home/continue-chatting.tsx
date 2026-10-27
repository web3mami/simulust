"use client";

import Image from "next/image";
import Link from "next/link";
import { Skeleton, cx, isStaticArt } from "@/components/ui";
import { RowTitle, ScrollRow, FOCUS_RING } from "@/components/home/browse";
import { relativeTime } from "@/components/home/catalogue";
import { useThreads } from "@/components/home/threads";

const SHOWN = 12;
const ITEM = "w-[16.5rem] shrink-0 snap-start sm:w-72";

// Recent chats for a signed-in user, newest first. Once we know someone is
// signed in it holds its place with placeholders while the chats load, so
// nothing below jumps when they arrive. Signed-out visitors and people with no
// chats never see it.
export function ContinueChatting() {
  const { status, threads } = useThreads();
  if (status === "checking" || status === "signed-out" || (status === "ready" && threads.length === 0)) return null;

  return (
    <section aria-labelledby="continue-title" aria-busy={status === "loading"}>
      <RowTitle id="continue-title" accent="Continue" href="/chat" linkLabel="All chats">
        chatting
      </RowTitle>
      <ScrollRow className="mt-3 sm:mt-4" watch={threads?.length ?? 0}>
        {status === "loading"
          ? Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className={cx("h-[5.25rem]", ITEM)} />)
          : threads.slice(0, SHOWN).map((thread) => {
              const person = thread.character;
              return (
                <Link
                  key={thread.id}
                  href={`/date/${person.id}`}
                  className={cx(
                    "group flex items-center gap-3 rounded-2xl bg-[var(--surface)] p-2.5 ring-1 ring-white/5 transition hover:bg-[var(--surface-2)] hover:ring-[var(--accent)]/50",
                    ITEM,
                    FOCUS_RING,
                  )}
                >
                  <span className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl" style={{ background: person.color }}>
                    {person.image ? (
                      <Image
                        src={person.image}
                        alt=""
                        fill
                        sizes="64px"
                        unoptimized={!isStaticArt(person.image)}
                        className="object-cover object-top transition duration-300 group-hover:scale-105"
                      />
                    ) : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm font-bold text-[var(--ink)]">{person.name}</span>
                      <time dateTime={thread.lastMessageAt} className="shrink-0 text-[11px] text-[var(--muted)]">
                        {relativeTime(thread.lastMessageAt)}
                      </time>
                    </span>
                    <span className="mt-0.5 line-clamp-2 text-xs leading-[1.125rem] text-[var(--muted)]">{thread.lastPreview}</span>
                  </span>
                </Link>
              );
            })}
      </ScrollRow>
    </section>
  );
}
