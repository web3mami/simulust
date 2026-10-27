"use client";

import Link from "next/link";
import { reportHref } from "@/components/chat/format";
import { BrainIcon, CameraIcon, CloseIcon, FlagIcon, ShieldIcon } from "@/components/icons";
import { Button, ButtonLink, cx } from "@/components/ui";
import type { CharacterDTO } from "@/lib/api-types";
import { COSTS } from "@/lib/pricing";

function traitsOf(person: CharacterDTO): { label: string; value: string }[] {
  const hair = [person.hairStyle, person.hair].filter(Boolean).join(", ");
  const rows = [
    { label: "Relationship", value: person.role },
    { label: "Personality", value: person.personality },
    { label: "Occupation", value: person.occupation },
    { label: "Body", value: person.body },
    { label: "Ethnicity", value: person.ethnicity },
    { label: "Vibe", value: person.heat },
    { label: "Hair", value: hair },
    { label: "Eyes", value: person.eyeColor },
  ];
  return rows.filter((row): row is { label: string; value: string } => Boolean(row.value));
}

// The character's profile beside the conversation: portrait, who they are,
// and the two things you can do from here.
export function ProfilePanel({
  person,
  onClose,
  closeLabel = "Hide profile",
  onPhoto,
  photoBusy,
  canPhoto,
  photoReady,
  className,
}: {
  person: CharacterDTO;
  onClose: () => void;
  closeLabel?: string;
  onPhoto: () => void;
  photoBusy: boolean;
  // Photos unlock after age verification.
  canPhoto: boolean;
  // The conversation has loaded, so a photo can be asked for.
  photoReady: boolean;
  className?: string;
}) {
  const traits = traitsOf(person);
  return (
    <div className={cx("flex h-full min-h-0 flex-col", className)}>
      <div className="flex h-14 shrink-0 items-center justify-between gap-2 px-4">
        <p className="text-sm font-semibold text-[var(--muted)]">Profile</p>
        <button
          type="button"
          onClick={onClose}
          aria-label={closeLabel}
          title={closeLabel}
          className="flex h-10 w-10 items-center justify-center rounded-full text-[var(--muted)] hover:bg-white/5 hover:text-[var(--ink)]"
        >
          <CloseIcon />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        <div
          className="relative aspect-[3/4] overflow-hidden rounded-2xl ring-1 ring-white/10"
          style={{ background: person.color }}
        >
          {person.image ? <img src={person.image} alt={`Portrait of ${person.name}`} className="absolute inset-0 h-full w-full object-cover" /> : null}
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent px-4 pb-4 pt-16">
            <p className="text-2xl font-bold tracking-tight text-white">
              {person.name} <span className="font-medium text-white/80">{person.age}</span>
            </p>
            <p className="mt-0.5 text-sm text-white/75">
              {person.role}
              {person.lane === "anime" ? " · Anime" : null}
            </p>
          </div>
        </div>

        <p className="mt-4 text-sm leading-6 text-[var(--ink)]">{person.line}</p>

        <div className="mt-4 grid grid-cols-2 gap-2">
          {canPhoto ? (
            <Button onClick={onPhoto} disabled={photoBusy || !photoReady} title={`A new photo costs ${COSTS.photo} credits`}>
              <CameraIcon className="h-4 w-4" />
              {photoBusy ? "Asking…" : "New photo"}
            </Button>
          ) : (
            <ButtonLink href="/verify" title="Photos unlock after age verification">
              <CameraIcon className="h-4 w-4" />
              Unlock photos
            </ButtonLink>
          )}
          <ButtonLink href={`/memories/${encodeURIComponent(person.id)}`} variant="secondary">
            <BrainIcon className="h-4 w-4" />
            Memories
          </ButtonLink>
        </div>
        <p className="mt-2 text-center text-[11px] text-[var(--muted)]">
          {canPhoto ? `${COSTS.photo} credits per photo` : "Photos unlock after age verification"}
        </p>

        {traits.length > 0 ? (
          <section className="mt-6" aria-label={`About ${person.name}`}>
            <h3 className="text-sm font-bold text-[var(--ink)]">
              <span className="text-[var(--accent)]">About</span> {person.name}
            </h3>
            <dl className="mt-3 grid grid-cols-2 gap-2">
              {traits.map((trait) => (
                <div key={trait.label} className="min-w-0 rounded-xl bg-[var(--surface)] px-3 py-2 ring-1 ring-white/5">
                  <dt className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">{trait.label}</dt>
                  <dd className="mt-0.5 truncate text-sm font-medium text-[var(--ink)]" title={trait.value}>
                    {trait.value}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}

        {person.tags.length > 0 ? (
          <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Tags">
            {person.tags.map((tag) => (
              <li key={tag} className="rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-xs font-medium text-[var(--accent)]">
                {tag}
              </li>
            ))}
          </ul>
        ) : null}

        <p className="mt-6 flex gap-2 rounded-xl border border-[var(--line)] px-3 py-2.5 text-[11px] leading-5 text-[var(--muted)]">
          <ShieldIcon className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {person.name} is an AI character. Everything here is fiction between adults, and every image is AI-generated.
          </span>
        </p>
        <Link
          href={reportHref(`/date/${person.id}`)}
          className="mt-2 flex h-10 items-center justify-center gap-1.5 rounded-full text-xs font-medium text-[var(--muted)] hover:bg-white/5 hover:text-[var(--ink)]"
        >
          <FlagIcon className="h-4 w-4" />
          Report {person.name}
        </Link>
      </div>
    </div>
  );
}
