"use client";

import Image from "next/image";
import { useEffect, useId, useRef, useState } from "react";
import { useSession } from "@/components/auth-gate";
import { MediaImage } from "@/components/create/media-image";
import styles from "@/components/create/motion.module.css";
import { CoinIcon, SparkIcon } from "@/components/icons";
import { Button, ButtonLink, cx, isStaticArt } from "@/components/ui";
import { ApiError, useApi } from "@/lib/api";
import type { CharacterDTO } from "@/lib/api-types";
import { COSTS } from "@/lib/pricing";

type Stage =
  | { kind: "offer" }
  | { kind: "drawing" }
  | { kind: "done"; character: CharacterDTO }
  | { kind: "error"; message: string; needsCredits: boolean };

type Action = { label: string; onClick: () => void };

function pronouns(gender: string) {
  if (gender === "Man") return { her: "his", they: "he is" };
  if (gender === "Woman") return { her: "her", they: "she is" };
  return { her: "their", they: "they are" };
}

// Offers, draws and shows a nude portrait of the user's own character, through
// POST /api/characters/[id]/explicit-portrait (charged like a portrait,
// refunded if it doesn't come through). Offered to every confirmed adult, with
// no switch to turn on first; the server checks again either way.
export function NudePortraitDialog({
  person,
  heading,
  skip,
  finish,
  onDrawn,
}: {
  person: CharacterDTO;
  heading: string;
  // Leaves without a portrait ("Start chatting", "Not now").
  skip: Action;
  // After the portrait is drawn ("Chat with Mira", "Done").
  finish: Action;
  onDrawn?: (character: CharacterDTO) => void;
}) {
  const api = useApi();
  const { refreshMe } = useSession();
  const [stage, setStage] = useState<Stage>({ kind: "offer" });
  const primary = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const bodyId = useId();
  const { her, they } = pronouns(person.gender);
  const busy = stage.kind === "drawing";
  const redraw = Boolean(person.explicitImage);

  useEffect(() => {
    primary.current?.focus();
  }, [stage.kind]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) skip.onClick();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, skip]);

  async function draw() {
    setStage({ kind: "drawing" });
    try {
      const { character } = await api<{ character: CharacterDTO }>(
        `/api/characters/${encodeURIComponent(person.id)}/explicit-portrait`,
        { method: "POST" },
      );
      if (!character.explicitImage) throw new Error("The portrait didn't come through. Your credits are back.");
      setStage({ kind: "done", character });
      onDrawn?.(character);
    } catch (error) {
      const needsCredits = error instanceof ApiError && error.status === 402;
      setStage({
        kind: "error",
        needsCredits,
        message: needsCredits
          ? `A nude portrait uses ${COSTS.portrait} credits and you don't have enough.`
          : error instanceof Error
            ? error.message
            : "The portrait didn't come through. Your credits are back.",
      });
    } finally {
      void refreshMe();
    }
  }

  const cost = (
    <span className="inline-flex items-center gap-1 rounded-full bg-black/20 px-2 py-0.5 text-xs">
      <CoinIcon className="h-3.5 w-3.5" />
      {COSTS.portrait}
    </span>
  );

  let picture;
  if (stage.kind === "done" && stage.character.explicitImage) {
    picture = (
      <MediaImage
        url={stage.character.explicitImage}
        alt={`Nude portrait of ${person.name}`}
        className={cx("absolute inset-0 h-full w-full object-cover", styles.reveal)}
      />
    );
  } else {
    // The regular portrait, soft, while there's nothing else to show.
    picture = (
      <>
        {person.image ? (
          <Image
            src={person.image}
            alt=""
            fill
            sizes="64px"
            unoptimized={!isStaticArt(person.image)}
            className={cx("scale-110 object-cover object-top opacity-50 blur-xl", busy && styles.drift)}
          />
        ) : null}
        {busy ? <div className={cx("absolute inset-0", styles.sweep)} aria-hidden /> : null}
        <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-black/40 text-[var(--accent)] ring-1 ring-white/10 backdrop-blur">
            <SparkIcon className="h-6 w-6" />
          </span>
          <p aria-live="polite" className="mt-3 text-sm font-semibold text-white">
            {busy ? `Drawing ${her} portrait. This can take up to a minute.` : "Just for you"}
          </p>
        </div>
      </>
    );
  }

  let body: string;
  if (stage.kind === "done") body = `Here ${they}, nothing hidden. Only you can see this.`;
  else if (stage.kind === "error") body = stage.message;
  else
    body = redraw
      ? `Draw a new nude portrait of ${person.name} from the same look. It replaces the one you have.`
      : `Also make ${her} nude portrait? It's drawn from the same look, just for you, and only you can see it.`;

  let actions;
  if (stage.kind === "done") {
    actions = (
      <Button ref={primary} size="lg" className="w-full" onClick={finish.onClick}>
        {finish.label}
      </Button>
    );
  } else {
    actions = (
      <>
        {stage.kind === "error" && stage.needsCredits ? (
          <ButtonLink href="/packs" variant="premium" size="lg" className="w-full">
            <CoinIcon className="h-5 w-5" />
            Get credits
          </ButtonLink>
        ) : (
          <Button ref={primary} size="lg" className="w-full" disabled={busy} onClick={() => void draw()}>
            {busy ? "Drawing…" : stage.kind === "error" ? "Try again" : redraw ? "Draw a new one" : `Also make ${her} nude portrait`}
            {busy ? null : cost}
          </Button>
        )}
        <Button variant="secondary" size="lg" className="w-full" disabled={busy} onClick={skip.onClick}>
          {skip.label}
        </Button>
      </>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
    >
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        className="absolute inset-0 bg-black/75 transition-opacity duration-200 starting:opacity-0"
        onClick={busy ? undefined : skip.onClick}
      />
      <div className="relative max-h-full w-full max-w-sm overflow-y-auto rounded-3xl border border-[var(--line)] bg-[var(--bg-2)] p-5 shadow-[0_24px_60px_rgba(0,0,0,0.6)] transition-[opacity,transform] duration-200 ease-out starting:translate-y-4 starting:opacity-0 motion-reduce:transition-none sm:p-6 sm:starting:translate-y-0 sm:starting:scale-95">
        <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--accent)]">18+ · Explicit</p>
        <h2 id={titleId} className="mt-1 text-xl font-bold tracking-tight text-[var(--ink)]">
          {heading}
        </h2>
        <div
          className="relative mx-auto mt-4 aspect-[3/4] w-full max-w-[15rem] overflow-hidden rounded-2xl ring-1 ring-white/10"
          style={{ background: person.color }}
        >
          {picture}
        </div>
        <p
          id={bodyId}
          role={stage.kind === "error" ? "alert" : undefined}
          className={cx("mt-4 text-sm leading-6", stage.kind === "error" ? "text-red-200" : "text-[var(--muted)]")}
        >
          {body}
        </p>
        <div className="mt-5 flex flex-col gap-2">{actions}</div>
        {stage.kind === "offer" ? (
          <p className="mt-3 text-center text-xs text-[var(--muted)]">
            {COSTS.portrait} credits. If it doesn&apos;t come through, they come back.
          </p>
        ) : null}
      </div>
    </div>
  );
}
