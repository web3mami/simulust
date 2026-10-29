"use client";

import Image from "next/image";
import { useSession } from "@/components/auth-gate";
import { FilmIcon, PlayIcon, SparkIcon, UserIcon } from "@/components/icons";
import { Button, Panel } from "@/components/ui";
import { SceneTile } from "@/components/studio/parts";
import type { Character } from "@/lib/characters";
import { STUDIO_COSTS, STUDIO_SETTINGS } from "@/lib/studio";

const STEPS = [
  { icon: <UserIcon className="h-5 w-5" />, title: "Pick who stars", body: "Anyone from the catalogue, or a character you made yourself." },
  { icon: <SparkIcon className="h-5 w-5" />, title: "Set the scene", body: "A candlelit bath, a penthouse at midnight. What they wear, how they move." },
  { icon: <PlayIcon className="h-5 w-5" />, title: "Bring it to life", body: "A keyframe first, then five seconds of motion, made only for you." },
];

// What a signed-out visitor sees: what the Studio does, a few moods, who can
// star, and the way in. Everything here is regular art.
export function StudioTeaser({ people }: { people: Character[] }) {
  const { openLogin, openSignup } = useSession();
  const faces = people.filter((person) => person.image).slice(0, 4);

  return (
    <div className="flex flex-col gap-8">
      <Panel className="relative overflow-hidden">
        <Image
          src="/hero/hero-anime-penthouse.jpg"
          alt=""
          fill
          priority
          sizes="(min-width: 1024px) 1200px, 100vw"
          className="object-cover object-[70%_center] opacity-45"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-[var(--surface)] via-[var(--surface)]/85 to-transparent" />
        <div className="relative flex max-w-xl flex-col items-start px-6 py-10 sm:px-10 sm:py-14">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent-soft)] px-3 py-1 text-xs font-bold uppercase tracking-wide text-[var(--accent)]">
            <FilmIcon className="h-4 w-4" />
            Video Studio
          </span>
          <h2 className="mt-4 text-3xl font-bold tracking-tight text-[var(--ink)] sm:text-4xl">Direct your own scene</h2>
          <p className="mt-3 text-base leading-7 text-[var(--muted)]">
            Choose who you want, where you want them and how they move for you. We turn it into a short, private clip that nobody
            else will ever see.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button size="lg" onClick={openSignup}>
              Create free account
            </Button>
            <Button size="lg" variant="secondary" onClick={openLogin}>
              Log in
            </Button>
          </div>
          <p className="mt-4 text-xs text-[var(--muted)]">
            18+ only. Keyframes are {STUDIO_COSTS.frame} credits and clips {STUDIO_COSTS.clip}; new accounts start with free credits.
          </p>
        </div>
      </Panel>

      <ol className="grid gap-3 sm:grid-cols-3">
        {STEPS.map((step, index) => (
          <li key={step.title}>
            <Panel className="flex h-full gap-3 p-4 sm:flex-col sm:p-5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">{step.icon}</span>
              <div>
                <p className="text-sm font-bold text-[var(--ink)] sm:text-base">
                  <span className="text-[var(--accent)]">{index + 1}.</span> {step.title}
                </p>
                <p className="mt-1 text-sm leading-6 text-[var(--muted)]">{step.body}</p>
              </div>
            </Panel>
          </li>
        ))}
      </ol>

      <section aria-labelledby="studio-moods" className="flex flex-col gap-3">
        <h2 id="studio-moods" className="text-lg font-bold text-[var(--ink)] sm:text-2xl">
          <span className="text-[var(--accent)]">Set</span> the mood
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {STUDIO_SETTINGS.slice(0, 6).map((option) => (
            <SceneTile key={option.id} label={option.label} blurb={option.blurb} tone={option.tone} compact selected={false} onClick={openSignup} />
          ))}
        </div>
      </section>

      {faces.length ? (
        <section aria-labelledby="studio-starring" className="flex flex-col gap-3">
          <h2 id="studio-starring" className="text-lg font-bold text-[var(--ink)] sm:text-2xl">
            <span className="text-[var(--accent)]">Who</span> stars
          </h2>
          <p className="max-w-2xl text-sm leading-6 text-[var(--muted)]">
            Anyone from the catalogue, or someone you create. Alone in every scene, made only for you, and nothing held back.
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {faces.map((person) => (
              <SceneTile key={person.id} label={person.name} blurb={person.role} image={person.image} selected={false} onClick={openSignup} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
