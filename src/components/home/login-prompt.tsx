"use client";

import type { ReactNode } from "react";
import { useSession } from "@/components/auth-gate";
import { LockIcon } from "@/components/icons";
import { Button, Panel } from "@/components/ui";

// What a signed-out visitor sees on a page that's only about their own things.
export function LoginPrompt({ title, body, image }: { title: string; body: ReactNode; image?: string }) {
  const { openLogin, openSignup } = useSession();
  return (
    <Panel className="relative overflow-hidden">
      {image ? (
        <>
          <img src={image} alt="" className="absolute inset-0 h-full w-full object-cover object-[70%_center] opacity-40" />
          <div className="absolute inset-0 bg-gradient-to-r from-[var(--surface)] via-[var(--surface)]/85 to-transparent" />
        </>
      ) : null}
      <div className="relative flex max-w-lg flex-col items-start px-6 py-10 sm:px-10 sm:py-14">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent)]">
          <LockIcon />
        </span>
        <h2 className="mt-4 text-2xl font-bold tracking-tight text-[var(--ink)]">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{body}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button size="lg" onClick={openLogin}>
            Log in
          </Button>
          <Button size="lg" variant="secondary" onClick={openSignup}>
            Create free account
          </Button>
        </div>
      </div>
    </Panel>
  );
}

export function RetryPanel({ message, onRetry, extra }: { message: string; onRetry: () => void; extra?: ReactNode }) {
  return (
    <Panel className="flex flex-col items-center px-6 py-12 text-center">
      <p className="text-base font-semibold text-[var(--ink)]">{message}</p>
      <div className="mt-5 flex gap-3">
        <Button onClick={onRetry}>Try again</Button>
        {extra}
      </div>
    </Panel>
  );
}
