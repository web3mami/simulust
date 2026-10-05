"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AppHeader, AppShell } from "@/components/app-shell";
import { findCharacter, type Character } from "@/lib/characters";

type Message = { from: "them" | "you"; text: string };

export default function DatePage() {
  const params = useParams<{ id: string }>();
  const [person, setPerson] = useState<Character | null | undefined>(undefined);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);

  useEffect(() => {
    const found = findCharacter(params.id) ?? null;
    setPerson(found);
    if (found) {
      setMessages([
        {
          from: "them",
          text: `Hey. I'm ${found.name}. ${found.line}`,
        },
      ]);
    }
  }, [params.id]);

  if (person === undefined) {
    return <main className="min-h-screen bg-[var(--bg)]" />;
  }

  if (!person) {
    return (
      <AppShell>
        <AppHeader />
        <section className="mx-auto max-w-xl px-6 pt-16">
          <h1 className="text-3xl font-semibold">That person is gone.</h1>
          <Link href="/#explore" className="mt-6 inline-block text-[var(--accent-2)]">
            Back to Discover
          </Link>
        </section>
      </AppShell>
    );
  }

  function send() {
    const text = draft.trim();
    if (!text) return;
    setMessages((current) => [
      ...current,
      { from: "you", text },
      {
        from: "them",
        text: "I heard you. The real model is not connected yet, so this reply is just the date screen. When it is, I will answer as me and keep what you train.",
      },
    ]);
    setDraft("");
  }

  return (
    <AppShell>
      <AppHeader />
      <section className="mx-auto grid max-w-5xl gap-6 px-6 pb-10 lg:grid-cols-[280px_1fr]">
        <aside
          className="overflow-hidden rounded-2xl border border-[var(--line)]"
          style={{ background: person.color }}
        >
          {person.image ? (
            <img
              src={person.image}
              alt=""
              className="aspect-[3/4] w-full object-cover"
            />
          ) : null}
          <div className="p-5">
          <p className="text-xs uppercase text-[var(--accent-2)]">
            {person.role}
          </p>
          <h1 className="mt-2 text-3xl font-semibold">
            {person.name}, {person.age}
          </h1>
          <p className="mt-2 text-sm">
            {person.gender} · {person.ethnicity} · {person.body}
          </p>
          <p className="mt-3 text-xs uppercase tracking-[0.18em] text-[var(--accent-2)]">
            {person.lane === "anime" ? "Anime" : "Realistic"} · {person.heat}
          </p>
          <p className="mt-4 text-sm leading-6">{person.line}</p>
          </div>
        </aside>

        <div className="flex min-h-[70vh] flex-col rounded-2xl border border-[var(--line)] bg-[var(--bg-2)]">
          <div className="border-b border-[var(--line)] px-5 py-4 text-sm text-[var(--muted)]">
            Talking · training comes after the model is connected
          </div>
          <div className="flex flex-1 flex-col gap-3 px-5 py-5">
            {messages.map((message, index) => (
              <p
                key={`${message.from}-${index}`}
                className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-6 ${
                  message.from === "you"
                    ? "ml-auto bg-[var(--accent)] text-white"
                    : "bg-[var(--bg)] text-[var(--ink)]"
                }`}
              >
                {message.text}
              </p>
            ))}
          </div>
          <form
            className="flex gap-2 border-t border-[var(--line)] p-4"
            onSubmit={(event) => {
              event.preventDefault();
              send();
            }}
          >
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={`Text ${person.name}`}
              className="flex-1 rounded-full border border-[var(--line)] bg-[var(--bg)] px-4 py-3"
            />
            <button
              type="submit"
              className="rounded-full bg-[var(--accent)] px-5 py-3 text-sm font-medium text-white"
            >
              Send
            </button>
          </form>
        </div>
      </section>
    </AppShell>
  );
}
