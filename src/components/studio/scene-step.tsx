"use client";

import type { ReactNode } from "react";
import { Panel, cx } from "@/components/ui";
import { Face, FOCUS, MotionCard, SceneTile } from "@/components/studio/parts";
import type { Character } from "@/lib/characters";
import {
  STUDIO_ACTIONS,
  STUDIO_DETAILS_MAX,
  STUDIO_OUTFITS,
  STUDIO_SETTINGS,
  outfitLabel,
  studioPerson,
  type StudioActionId,
  type StudioOutfitId,
  type StudioSettingId,
} from "@/lib/studio";

export type SceneChoice = {
  setting: StudioSettingId;
  outfit: StudioOutfitId;
  action: StudioActionId;
  details: string;
};

function Group({ id, title, picked, children }: { id: string; title: string; picked?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id={id} className="text-base font-bold text-[var(--ink)] sm:text-lg">
          {title}
        </h2>
        {picked ? <p className="truncate text-sm text-[var(--muted)]">{picked}</p> : null}
      </div>
      {children}
    </section>
  );
}

// Step 2: where, what they're wearing, how they move, and a line of extras.
// Every confirmed adult gets every option. Topless, nude and the undress are
// simply left out for anyone who can't make them (an account on a hold, or
// one that hasn't confirmed its age yet): no locks, no hints.
export function SceneStep({
  person,
  scene,
  onChange,
  nudity,
  onChangeCharacter,
}: {
  person: Character;
  scene: SceneChoice;
  onChange: (scene: SceneChoice) => void;
  // Whether to offer the options that show nudity.
  nudity: boolean;
  onChangeCharacter: () => void;
}) {
  const who = studioPerson(person.gender);
  const outfits = STUDIO_OUTFITS.filter((option) => nudity || !("nudity" in option && option.nudity));
  const actions = STUDIO_ACTIONS.filter((option) => nudity || !("nudity" in option && option.nudity));
  const outfit = STUDIO_OUTFITS.find((option) => option.id === scene.outfit);
  const action = STUDIO_ACTIONS.find((option) => option.id === scene.action);
  const setting = STUDIO_SETTINGS.find((option) => option.id === scene.setting);
  const left = STUDIO_DETAILS_MAX - scene.details.length;

  return (
    <div className="flex flex-col gap-7">
      <Panel className="flex items-center gap-3 p-3">
        <Face person={person} className="h-12 w-12" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-[var(--ink)]">
            Starring {person.name} <span className="font-medium text-[var(--muted)]">{person.age}</span>
          </p>
          <p className="truncate text-xs text-[var(--muted)]">Alone in every scene, just for you.</p>
        </div>
        <button
          type="button"
          onClick={onChangeCharacter}
          className={cx("h-10 shrink-0 rounded-full px-3 text-sm font-semibold text-[var(--accent)] hover:bg-white/5", FOCUS)}
        >
          Change
        </button>
      </Panel>

      <Group id="studio-setting" title="Setting" picked={setting?.label}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {STUDIO_SETTINGS.map((option, index) => (
            <SceneTile
              key={option.id}
              label={option.label}
              blurb={option.blurb}
              tone={option.tone}
              compact
              eager={index < 4}
              selected={scene.setting === option.id}
              onClick={() => onChange({ ...scene, setting: option.id })}
            />
          ))}
        </div>
      </Group>

      <Group id="studio-outfit" title="Outfit" picked={outfit ? outfitLabel(outfit, who) : undefined}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {outfits.map((option) => (
            <SceneTile
              key={option.id}
              label={outfitLabel(option, who)}
              blurb={option.blurb}
              image={person.image}
              selected={scene.outfit === option.id}
              onClick={() => onChange({ ...scene, outfit: option.id })}
            />
          ))}
        </div>
      </Group>

      <Group id="studio-motion" title="Motion" picked={action?.label}>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {actions.map((option) => (
            <MotionCard
              key={option.id}
              label={option.label}
              blurb={option.blurb}
              selected={scene.action === option.id}
              onClick={() => onChange({ ...scene, action: option.id })}
            />
          ))}
        </div>
      </Group>

      <Group id="studio-details" title="Extra details">
        <label className="flex flex-col gap-2">
          <span className="text-sm text-[var(--muted)]">
            Optional. Styling and atmosphere only: studio scenes star {person.name}, alone.
          </span>
          {/* 16px text on phones, so iOS doesn't zoom the page on focus. */}
          <textarea
            value={scene.details}
            maxLength={STUDIO_DETAILS_MAX}
            rows={3}
            onChange={(event) => onChange({ ...scene, details: event.target.value.slice(0, STUDIO_DETAILS_MAX) })}
            placeholder="Red silk sheets, rain on the window, gold jewelry…"
            className="w-full resize-none rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-base text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--muted)] hover:border-white/20 focus:border-[var(--accent)] sm:text-sm"
          />
          <span className={cx("self-end text-xs tabular-nums", left < 20 ? "text-[var(--accent)]" : "text-[var(--muted)]")} aria-live="polite">
            {left} left
          </span>
        </label>
      </Group>
    </div>
  );
}
