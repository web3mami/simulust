"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "@/components/auth-gate";
import styles from "@/components/create/motion.module.css";
import { useCatalogue } from "@/components/home/catalogue";
import { ChevronRightIcon, ShieldIcon } from "@/components/icons";
import { Button, ButtonLink, PageHeader, Skeleton } from "@/components/ui";
import { CharacterStep } from "@/components/studio/character-step";
import { GenerateStep, type Busy, type Take } from "@/components/studio/generate-step";
import { BalancePill, STUDIO_PAUSED, StudioBar, StudioSteps, type Problem, type StudioAccess, type StudioStage } from "@/components/studio/parts";
import { SceneStep, type SceneChoice } from "@/components/studio/scene-step";
import { StudioTeaser } from "@/components/studio/teaser";
import { ApiError, useApi } from "@/lib/api";
import type { MediaDTO } from "@/lib/api-types";
import type { Character } from "@/lib/characters";
import { showsNudity, studioAction, studioMotion, studioOutfit } from "@/lib/studio";
import type { StudioFrameResponse } from "@/app/api/studio/frame/route";

const POLL_MS = 3000;
// Give up polling a clip after this long; it still lands in the Collection.
const POLL_GIVE_UP_MS = 20 * 60_000;

const DEFAULT_SCENE: SceneChoice = { setting: "bedroom", outfit: "lingerie", action: "tease", details: "" };

function sceneKey(characterId: string, scene: SceneChoice) {
  return [characterId, scene.setting, scene.outfit, scene.action, scene.details.trim()].join("|");
}

function problemOf(error: unknown, fallback: string): Problem {
  return error instanceof ApiError ? { text: error.message, code: error.code } : { text: fallback };
}

// The clip's own error, with the refund said plainly: a failed or blocked clip
// is always refunded (src/server/video.ts).
function clipProblem(media: MediaDTO): Problem {
  const base = media.error?.trim() || "The clip didn't render.";
  return { text: /credits/i.test(base) ? base : `${base} Your credits are back.` };
}

// The Video Studio: pick a character, set a scene, make a keyframe, animate it.
export function StudioFlow() {
  const { me } = useSession();
  // A sign-out or account switch destroys every private draft and take. A
  // router.refresh() preserves component state, so it cannot do this for us.
  return <AccountStudioFlow key={me?.id ?? "signed-out"} />;
}

function AccountStudioFlow() {
  const router = useRouter();
  const params = useSearchParams();
  const { ready, session, me, features, refreshMe } = useSession();
  const api = useApi();
  const { characters, status } = useCatalogue();

  const wanted = params.get("character");
  const [characterId, setCharacterId] = useState<string | null>(wanted);
  const [stage, setStage] = useState<StudioStage>(wanted ? "scene" : "character");
  const [scene, setScene] = useState<SceneChoice>(DEFAULT_SCENE);
  const [take, setTake] = useState<Take | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  // The balance a response just reported, until /api/me catches up.
  const [reported, setReported] = useState<number | null>(null);
  const top = useRef<HTMLDivElement>(null);
  const lifetime = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    // The server can still finish an already-submitted job in its owner's
    // Collection. Its response must never update another account or ask the
    // shared auth provider to refresh after this studio session has ended.
    return () => controller.abort();
  }, []);

  const person: Character | undefined = useMemo(
    () => (characterId ? characters.find((item) => item.id === characterId) : undefined),
    [characters, characterId],
  );
  // A ?character= that isn't (or is no longer) visible: back to picking, once
  // the real list has answered.
  const missing = Boolean(characterId) && !person && status !== "loading";
  const shownStage: StudioStage = !person ? "character" : stage;

  // Every confirmed adult gets every outfit and motion; there's no explicit
  // switch. me.ageVerified is exactly that (age confirmed, no explicit hold).
  // An account on a hold is paused; one that never confirmed its age (older
  // and dev accounts) is asked to.
  const access: StudioAccess = me?.ageVerified ? "open" : me?.explicitHold ? "held" : "unconfirmed";
  // Nude options are only shown to someone who can make them, so a scene picked
  // before that changed (a hold placed mid-session) falls back to the tame ones.
  const effectiveScene = useMemo<SceneChoice>(() => {
    if (access === "open" || !showsNudity(scene)) return scene;
    return {
      ...scene,
      outfit: studioOutfit(scene.outfit)?.nudity ? "lingerie" : scene.outfit,
      action: studioAction(scene.action)?.nudity ? "tease" : scene.action,
    };
  }, [access, scene]);

  const balance = reported ?? me?.balance ?? 0;
  const currentKey = person ? sceneKey(person.id, effectiveScene) : "";
  // A take made before the account was paused isn't shown any more (its files
  // aren't served to a held account either).
  const shownTake = access === "open" && take && take.key === currentKey ? take : null;

  const go = useCallback((next: StudioStage) => {
    setStage(next);
    setProblem(null);
    requestAnimationFrame(() => top.current?.scrollIntoView({ block: "start", behavior: "smooth" }));
  }, []);

  function pick(next: Character) {
    setCharacterId(next.id);
    // Keep the address shareable and the back button sane.
    router.replace(`/studio?character=${encodeURIComponent(next.id)}`, { scroll: false });
    go("scene");
  }

  async function makeFrame() {
    const signal = lifetime.current?.signal;
    if (!person || busy || !signal || signal.aborted) return;
    const key = currentKey;
    setBusy("frame");
    setProblem(null);
    try {
      const result = await api<StudioFrameResponse>("/api/studio/frame", {
        method: "POST",
        signal,
        json: {
          characterId: person.id,
          setting: effectiveScene.setting,
          outfit: effectiveScene.outfit,
          action: effectiveScene.action,
          details: effectiveScene.details.trim() || undefined,
        },
      });
      if (signal.aborted) return;
      setTake({ key, frame: result.media, clip: null });
      setReported(result.balance);
    } catch (error) {
      if (!signal.aborted) setProblem(problemOf(error, "Couldn't create that scene. Check your connection and try again."));
    } finally {
      if (!signal.aborted) {
        setBusy(null);
        void refreshMe().then(() => {
          if (!signal.aborted) setReported(null);
        });
      }
    }
  }

  async function animate() {
    const frame = shownTake?.frame;
    const signal = lifetime.current?.signal;
    if (!frame || busy || !signal || signal.aborted) return;
    setBusy("clip");
    setProblem(null);
    try {
      const result = await api<{ media: MediaDTO; balance: number }>(`/api/media/${frame.id}/animate`, {
        method: "POST",
        signal,
        json: { prompt: studioMotion(effectiveScene.action) },
      });
      if (signal.aborted) return;
      setTake((current) => (current && current.frame?.id === frame.id ? { ...current, clip: result.media, stalled: false } : current));
      setReported(result.balance);
      if (result.media.status === "failed" || result.media.status === "blocked") setProblem(clipProblem(result.media));
    } catch (error) {
      if (!signal.aborted) setProblem(problemOf(error, "Couldn't start the clip. Check your connection and try again."));
    } finally {
      if (!signal.aborted) {
        setBusy(null);
        void refreshMe().then(() => {
          if (!signal.aborted) setReported(null);
        });
      }
    }
  }

  // Poll a rendering clip until it settles.
  const clipId = shownTake?.clip?.status === "pending" && !shownTake.stalled ? shownTake.clip.id : null;
  useEffect(() => {
    if (!clipId) return;
    const controller = new AbortController();
    const started = Date.now();
    const timer = window.setInterval(() => {
      if (Date.now() - started > POLL_GIVE_UP_MS) {
        window.clearInterval(timer);
        setTake((current) => (current?.clip?.id === clipId ? { ...current, stalled: true } : current));
        return;
      }
      void api<{ media: MediaDTO }>(`/api/media/${clipId}/status`, { signal: controller.signal })
        .then(({ media }) => {
          if (controller.signal.aborted || media.status === "pending") return;
          setTake((current) => (current?.clip?.id === media.id ? { ...current, clip: media } : current));
          if (media.status !== "ready") {
            setProblem(clipProblem(media));
            void refreshMe();
          }
        })
        .catch(() => {
          // Try again on the next tick.
        });
    }, POLL_MS);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [clipId, api, refreshMe]);

  const header = (
    <PageHeader
      accent="Video"
      title="Studio"
      subtitle="Set a scene, choose how they move, and watch it come to life. Private to you, saved to your Collection."
      action={session && me ? <BalancePill balance={balance} /> : undefined}
    />
  );

  if (!ready) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <Skeleton className="h-10 w-full max-w-md" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
          {Array.from({ length: 10 }, (_, index) => (
            <Skeleton key={index} className="aspect-[3/4]" />
          ))}
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <StudioTeaser people={characters.filter((item) => !item.own)} />
      </div>
    );
  }

  // Held accounts are told plainly, with nothing to click: the review is ours.
  // The Generate step's bar says this itself, so only the first two steps show it.
  const ageNotice = !me ? null : access === "unconfirmed" ? (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-sm">
      <ShieldIcon className="h-5 w-5 shrink-0 text-[var(--accent)]" />
      <p className="min-w-0 flex-[1_1_15rem] leading-6 text-[var(--ink)]">
        Confirm you&apos;re 18 or over to start creating. It takes a moment, and we never keep your date of birth.
      </p>
      <ButtonLink href="/verify" size="sm">
        Confirm your age
      </ButtonLink>
    </div>
  ) : access === "held" ? (
    <div role="status" className="flex items-center gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-sm">
      <ShieldIcon className="h-5 w-5 shrink-0 text-[var(--accent)]" />
      <p className="min-w-0 flex-1 leading-6 text-[var(--ink)]">{STUDIO_PAUSED}</p>
    </div>
  ) : null;

  return (
    <div ref={top} className="flex scroll-mt-24 flex-col gap-6">
      {header}
      <StudioSteps
        stage={shownStage}
        canVisit={(target) => target === "character" || Boolean(person)}
        onGo={go}
      />
      {missing && shownStage === "character" ? (
        <p role="status" className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--muted)]">
          That character isn&apos;t available any more. Pick someone else to star in your scene.
        </p>
      ) : null}

      <div key={shownStage} className={styles.step}>
        {shownStage === "character" ? (
          <div className="flex flex-col gap-6">
            {ageNotice}
            <CharacterStep characters={characters} loading={status === "loading"} selectedId={person?.id ?? null} onPick={pick} />
          </div>
        ) : shownStage === "scene" && person ? (
          <div className="flex flex-col gap-6">
            {ageNotice}
            <SceneStep person={person} scene={effectiveScene} onChange={setScene} nudity={access === "open"} onChangeCharacter={() => go("character")} />
            <StudioBar note="Next, a keyframe to see it before it moves.">
              <Button size="lg" onClick={() => go("generate")} className="flex-1 sm:flex-none">
                Continue
                <ChevronRightIcon className="h-5 w-5" />
              </Button>
            </StudioBar>
          </div>
        ) : person ? (
          <GenerateStep
            person={person}
            scene={effectiveScene}
            take={shownTake}
            busy={busy}
            problem={problem}
            balance={balance}
            access={access}
            videoOn={features?.video !== false}
            onFrame={() => void makeFrame()}
            onAnimate={() => void animate()}
            onNewTake={() => setTake(null)}
            onEditScene={() => go("scene")}
            onDismissProblem={() => setProblem(null)}
          />
        ) : null}
      </div>
    </div>
  );
}
