"use client";

import Image from "next/image";
import type { ReactNode } from "react";
import { MediaImage } from "@/components/create/media-image";
import styles from "@/components/create/motion.module.css";
import { RefreshIcon } from "@/components/create/tiles";
import { CoinIcon, FilmIcon, GalleryIcon, PlayIcon, ShieldIcon, SparkIcon } from "@/components/icons";
import { Button, ButtonLink, Panel, cx, isStaticArt } from "@/components/ui";
import { Cost, Developing, isAgeProblem, ProblemNotice, STUDIO_PAUSED, StudioBar, type Problem, type StudioAccess } from "@/components/studio/parts";
import type { SceneChoice } from "@/components/studio/scene-step";
import type { MediaDTO } from "@/lib/api-types";
import type { Character } from "@/lib/characters";
import { STUDIO_ACTIONS, STUDIO_COSTS, STUDIO_OUTFITS, STUDIO_SETTINGS, outfitLabel, studioPerson } from "@/lib/studio";

// One attempt at a scene: the keyframe and, once animated, its clip.
export type Take = {
  key: string;
  frame: MediaDTO | null;
  clip: MediaDTO | null;
  // Polling stopped before the clip finished; it lands in the Collection later.
  stalled?: boolean;
};

export type Busy = "frame" | "clip" | null;

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-[var(--line)] py-2.5 last:border-b-0">
      <dt className="shrink-0 text-sm text-[var(--muted)]">{label}</dt>
      <dd className="min-w-0 text-right text-sm font-semibold text-[var(--ink)]">{value}</dd>
    </div>
  );
}

const MEDIA_CLASS = "absolute inset-0 h-full w-full rounded-3xl object-cover";

// The big picture on the left: the portrait until there's a keyframe, the
// keyframe, the clip rendering over it, then the clip.
function Stage({ person, scene, take, busy }: { person: Character; scene: SceneChoice; take: Take | null; busy: Busy }) {
  const setting = STUDIO_SETTINGS.find((option) => option.id === scene.setting)!;
  const outfit = STUDIO_OUTFITS.find((option) => option.id === scene.outfit)!;
  const action = STUDIO_ACTIONS.find((option) => option.id === scene.action)!;
  const frame = take?.frame?.status === "ready" && take.frame.url ? take.frame : null;
  const clip = take?.clip ?? null;

  if (busy === "frame") {
    return (
      <Developing
        preview={person.image}
        color={person.color}
        title="Setting the scene"
        lines={[
          `${person.name} heads to the ${setting.label.toLowerCase()}`,
          `${outfitLabel(outfit, studioPerson(person.gender))}, just as you asked`,
          "Finding the light",
          "Framing the shot",
          "Almost there",
        ]}
      />
    );
  }

  return (
    <div className="relative aspect-[4/5] w-full overflow-hidden rounded-3xl border border-[var(--line)]" style={{ background: person.color }}>
      {clip?.status === "ready" && clip.url ? (
        <video
          key={clip.id}
          src={clip.url}
          controls
          autoPlay
          muted
          loop
          playsInline
          className={cx(MEDIA_CLASS, "bg-black", styles.reveal)}
        />
      ) : frame?.url ? (
        <MediaImage key={frame.id} url={frame.url} alt={`${person.name}, ${setting.label.toLowerCase()}`} className={cx(MEDIA_CLASS, styles.reveal)} />
      ) : (
        <>
          {person.image ? (
            <Image
              src={person.image}
              alt=""
              fill
              sizes="(min-width: 1024px) 420px, 100vw"
              unoptimized={!isStaticArt(person.image)}
              className="object-cover object-top"
            />
          ) : null}
          <div
            aria-hidden
            className="absolute inset-0 opacity-60 mix-blend-soft-light"
            style={{ background: `linear-gradient(160deg, ${setting.tone[1]}, ${setting.tone[0]})` }}
          />
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent px-5 pb-5 pt-24">
            <p className="text-lg font-bold text-white">Ready when you are</p>
            <p className="mt-1 text-sm text-white/75">
              {setting.label} · {action.label}
            </p>
          </div>
        </>
      )}

      {busy === "clip" || clip?.status === "pending" ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/55 px-6 text-center backdrop-blur-[2px]" role="status">
          <div className={cx("absolute inset-0", styles.sweep)} aria-hidden />
          <span className="relative flex h-14 w-14 items-center justify-center rounded-full bg-black/40 text-[var(--accent)] ring-1 ring-white/10">
            <FilmIcon className="h-6 w-6 animate-pulse motion-reduce:animate-none" />
          </span>
          <p className="relative text-lg font-bold text-white">{take?.stalled ? "Still rendering" : "Bringing it to life"}</p>
          <div className="relative h-1 w-full max-w-[14rem] overflow-hidden rounded-full bg-white/10" aria-hidden>
            <div className={cx("h-full rounded-full bg-gradient-to-r from-[var(--accent)] to-[var(--accent-2)]", styles.bar)} />
          </div>
          <p className="relative max-w-[18rem] text-sm leading-5 text-white/80">
            {take?.stalled
              ? "This one is taking longer than usual. It'll be in your Collection when it's done."
              : "A few minutes, usually. You can leave: it'll be waiting in your Collection."}
          </p>
        </div>
      ) : null}
    </div>
  );
}

// Step 3: make the keyframe, then animate it.
export function GenerateStep({
  person,
  scene,
  take,
  busy,
  problem,
  balance,
  access,
  videoOn,
  onFrame,
  onAnimate,
  onNewTake,
  onEditScene,
  onDismissProblem,
}: {
  person: Character;
  scene: SceneChoice;
  take: Take | null;
  busy: Busy;
  problem: Problem | null;
  balance: number;
  // "open" for a confirmed adult; otherwise paused or asked to confirm.
  access: StudioAccess;
  videoOn: boolean;
  onFrame: () => void;
  onAnimate: () => void;
  onNewTake: () => void;
  onEditScene: () => void;
  onDismissProblem: () => void;
}) {
  const setting = STUDIO_SETTINGS.find((option) => option.id === scene.setting)!;
  const outfit = STUDIO_OUTFITS.find((option) => option.id === scene.outfit)!;
  const action = STUDIO_ACTIONS.find((option) => option.id === scene.action)!;
  const frame = take?.frame?.status === "ready" ? take.frame : null;
  const clip = take?.clip ?? null;
  const rendering = busy === "clip" || clip?.status === "pending";
  const done = clip?.status === "ready";
  const needFrame = balance < STUDIO_COSTS.frame;
  const needClip = balance < STUDIO_COSTS.clip;

  let primary: ReactNode;
  let note: ReactNode = null;
  if (access === "held") {
    // Nothing to click: confirming an age again doesn't lift a hold.
    primary = (
      <Button size="lg" disabled className="flex-1 sm:flex-none">
        <ShieldIcon className="h-5 w-5" />
        Paused
      </Button>
    );
    note = STUDIO_PAUSED;
  } else if (access === "unconfirmed") {
    primary = (
      <ButtonLink href="/verify" size="lg" className="flex-1 sm:flex-none">
        <ShieldIcon className="h-5 w-5" />
        Confirm your age
      </ButtonLink>
    );
    note = "Confirm you're 18 or over to start creating. We never keep your date of birth.";
  } else if (done) {
    primary = (
      <ButtonLink href="/collection" size="lg" className="flex-1 sm:flex-none">
        <GalleryIcon className="h-5 w-5" />
        See it in Collection
      </ButtonLink>
    );
    note = "Saved to your Collection. Only you can see it.";
  } else if (rendering) {
    primary = (
      <Button size="lg" disabled className="flex-1 sm:flex-none">
        <FilmIcon className="h-5 w-5" />
        Rendering…
      </Button>
    );
    note = "Your credits come back if the clip doesn't render.";
  } else if (frame) {
    primary = needClip ? (
      <ButtonLink href="/premium" size="lg" variant="premium" className="flex-1 sm:flex-none">
        <CoinIcon className="h-5 w-5" />
        Get credits to animate
      </ButtonLink>
    ) : (
      <Button size="lg" onClick={onAnimate} disabled={!videoOn || busy !== null} className="flex-1 sm:flex-none">
        <PlayIcon className="h-5 w-5" />
        {clip?.status === "failed" || clip?.status === "blocked" ? "Animate again" : "Animate"}
        <Cost credits={STUDIO_COSTS.clip} className="ml-1 text-[var(--accent-ink)]/85" />
      </Button>
    );
    note = videoOn
      ? needClip
        ? `A clip is ${STUDIO_COSTS.clip} credits; you have ${balance}.`
        : "Five seconds of motion, made from this frame."
      : "Video isn't available right now. Nothing is charged.";
  } else {
    primary = needFrame ? (
      <ButtonLink href="/premium" size="lg" variant="premium" className="flex-1 sm:flex-none">
        <CoinIcon className="h-5 w-5" />
        Get credits
      </ButtonLink>
    ) : (
      <Button size="lg" onClick={onFrame} disabled={busy !== null} className="flex-1 sm:flex-none">
        <SparkIcon className="h-5 w-5" />
        {busy === "frame" ? "Creating…" : "Create keyframe"}
        {busy === "frame" ? null : <Cost credits={STUDIO_COSTS.frame} className="ml-1 text-[var(--accent-ink)]/85" />}
      </Button>
    );
    note = needFrame ? `A keyframe is ${STUDIO_COSTS.frame} credits; you have ${balance}.` : "First a still keyframe, then you decide whether to animate it.";
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:items-start">
        <div className="mx-auto w-full max-w-md lg:max-w-none">
          <Stage person={person} scene={scene} take={take} busy={busy} />
        </div>

        <div className="flex flex-col gap-4">
          {/* The bar below already says why a paused or unconfirmed account
              can't create here, so an age error isn't said twice. */}
          {problem && !(access !== "open" && isAgeProblem(problem)) ? (
            <ProblemNotice problem={problem} held={access === "held"} onDismiss={onDismissProblem} />
          ) : null}

          <Panel className="p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-bold text-[var(--ink)] sm:text-lg">Your scene</h2>
              <button
                type="button"
                onClick={onEditScene}
                disabled={busy !== null}
                className="h-9 rounded-full px-3 text-sm font-semibold text-[var(--accent)] hover:bg-white/5 disabled:opacity-50"
              >
                Edit
              </button>
            </div>
            <dl className="mt-2">
              <Row label="Starring" value={`${person.name}, ${person.age}`} />
              <Row label="Setting" value={setting.label} />
              <Row label="Outfit" value={outfitLabel(outfit, studioPerson(person.gender))} />
              <Row label="Motion" value={action.label} />
              {scene.details.trim() ? <Row label="Details" value={<span className="line-clamp-2">{scene.details.trim()}</span>} /> : null}
            </dl>
          </Panel>

          <Panel className="p-4 sm:p-5">
            <h2 className="text-base font-bold text-[var(--ink)] sm:text-lg">How it works</h2>
            <ol className="mt-3 flex flex-col gap-3 text-sm">
              <li className="flex items-start gap-3">
                <span className={cx("flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold", frame ? "bg-[var(--accent-soft)] text-[var(--accent)]" : "bg-[var(--accent)] text-[var(--accent-ink)]")}>
                  1
                </span>
                <span className="min-w-0 flex-1 text-[var(--muted)]">
                  <span className="font-semibold text-[var(--ink)]">Keyframe.</span> A still of the scene, to see it before it moves.
                </span>
                <Cost credits={STUDIO_COSTS.frame} className="text-[var(--premium)]" />
              </li>
              <li className="flex items-start gap-3">
                <span className={cx("flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold", frame && !done ? "bg-[var(--accent)] text-[var(--accent-ink)]" : "bg-[var(--surface-2)] text-[var(--muted)]")}>
                  2
                </span>
                <span className="min-w-0 flex-1 text-[var(--muted)]">
                  <span className="font-semibold text-[var(--ink)]">Animate.</span> Five seconds of {action.label.toLowerCase()}, rendered from the keyframe.
                </span>
                <Cost credits={STUDIO_COSTS.clip} className="text-[var(--premium)]" />
              </li>
            </ol>
            <p className="mt-4 text-xs leading-5 text-[var(--muted)]">
              If something doesn&apos;t render or doesn&apos;t pass our safety checks, the credits go straight back. Everything you make is private
              and saved to your Collection.
            </p>
          </Panel>

          {frame ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={onFrame} disabled={busy !== null || rendering || needFrame}>
                <RefreshIcon className="h-4 w-4" />
                Retake keyframe
                <Cost credits={STUDIO_COSTS.frame} className="ml-0.5 text-[var(--premium)]" />
              </Button>
              {done ? (
                <Button variant="secondary" onClick={onNewTake}>
                  <SparkIcon className="h-4 w-4" />
                  Start a new take
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <StudioBar note={note}>{primary}</StudioBar>
    </div>
  );
}
