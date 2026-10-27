"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, type Ref } from "react";
import motion from "@/components/chat/chat-motion.module.css";
import { reportHref } from "@/components/chat/format";
import { BrainIcon, CameraIcon, CloseIcon, CoinIcon, FlagIcon, ShieldIcon } from "@/components/icons";
import { Button, ButtonLink, buttonClass, cx, isStaticArt, Skeleton } from "@/components/ui";
import type { CharacterDTO, MediaDTO } from "@/lib/api-types";
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

// Photos this character has sent you: null while loading.
export type Gallery = { photos: MediaDTO[] | null; error?: string };

// The most thumbnails the panel shows; the rest are a swipe away in the viewer.
const GALLERY_MAX = 9;

function Thumb({ media, label, onOpen, more }: { media: MediaDTO; label: string; onOpen: () => void; more?: number }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={more ? `${label}, and ${more} more` : label}
      className={cx(
        "group relative aspect-square overflow-hidden rounded-xl bg-[var(--surface-2)] ring-1 ring-white/5 focus-visible:outline-2 focus-visible:outline-[var(--accent)]",
        loaded ? null : motion.shimmer,
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- generated media needs the viewer's login, so not next/image */}
      <img
        ref={(img) => {
          if (img?.complete && img.naturalWidth > 0) setLoaded(true);
        }}
        src={media.url ?? undefined}
        alt=""
        loading="lazy"
        decoding="async"
        onLoad={() => setLoaded(true)}
        onError={() => setLoaded(true)}
        className={cx(
          "absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-105 motion-reduce:transition-none",
          loaded ? "opacity-100" : "opacity-0",
        )}
      />
      {more ? (
        <span className="absolute inset-0 flex items-center justify-center bg-black/55 text-base font-bold text-white">+{more}</span>
      ) : null}
    </button>
  );
}

// The character's profile beside the conversation: a big portrait, what you
// can do, the photos they've sent you, and who they are.
export function ProfilePanel({
  person,
  onClose,
  closeLabel = "Hide profile",
  closeRef,
  onPhoto,
  photoBusy,
  canPhoto,
  photoReady,
  gallery,
  onOpenPhoto,
  galleryRequest = 0,
  className,
}: {
  person: CharacterDTO;
  onClose: () => void;
  closeLabel?: string;
  closeRef?: Ref<HTMLButtonElement>;
  onPhoto: () => void;
  photoBusy: boolean;
  // Photos unlock after age verification.
  canPhoto: boolean;
  // The conversation has loaded, so a photo can be asked for.
  photoReady: boolean;
  gallery: Gallery;
  onOpenPhoto: (index: number) => void;
  // Goes up each time "Photos from …" is picked, to bring the gallery into view.
  galleryRequest?: number;
  className?: string;
}) {
  const traits = traitsOf(person);
  const galleryRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (galleryRequest > 0) galleryRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [galleryRequest]);

  const photos = gallery.photos;
  const extra = photos && photos.length > GALLERY_MAX ? photos.length - GALLERY_MAX + 1 : 0;

  return (
    <div className={cx("h-full min-h-0 overflow-y-auto overscroll-contain px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-4", className)}>
      <div className="relative aspect-[3/4] overflow-hidden rounded-3xl ring-1 ring-white/10" style={{ background: person.color }}>
        {person.image ? (
          <Image
            src={person.image}
            alt={`Portrait of ${person.name}`}
            fill
            sizes="(min-width: 1180px) 300px, 370px"
            loading="eager"
            fetchPriority="high"
            unoptimized={!isStaticArt(person.image)}
            className="object-cover"
          />
        ) : null}
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label={closeLabel}
          title={closeLabel}
          className="absolute right-3 top-3 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white ring-1 ring-white/15 backdrop-blur transition-colors hover:bg-black/70"
        >
          <CloseIcon />
        </button>
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent px-4 pb-4 pt-20">
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

      <div className="mt-4 flex flex-col gap-2">
        {canPhoto ? (
          <Button onClick={onPhoto} disabled={photoBusy || !photoReady} className="w-full">
            <CameraIcon className="h-4 w-4" />
            {photoBusy ? "Taking a photo…" : "New photo"}
            {photoBusy ? null : (
              <span className="ml-1 inline-flex items-center gap-0.5 rounded-full bg-black/20 px-2 py-0.5 text-xs" title={`${COSTS.photo} credits`}>
                <CoinIcon className="h-3.5 w-3.5" />
                {COSTS.photo}
              </span>
            )}
          </Button>
        ) : (
          <ButtonLink href="/verify" className="w-full" title="Photos unlock after age verification">
            <CameraIcon className="h-4 w-4" />
            Unlock photos
          </ButtonLink>
        )}
        <div className="grid grid-cols-2 gap-2">
          <ButtonLink href={`/memories/${encodeURIComponent(person.id)}`} variant="secondary">
            <BrainIcon className="h-4 w-4" />
            Memories
          </ButtonLink>
          <Link href={reportHref(`/date/${person.id}`)} className={buttonClass("ghost", "md", "border border-[var(--line)]")}>
            <FlagIcon className="h-4 w-4" />
            Report
          </Link>
        </div>
      </div>

      <section ref={galleryRef} className="mt-6 scroll-mt-4" aria-label={`Photos from ${person.name}`}>
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-sm font-bold text-[var(--ink)]">
            <span className="text-[var(--accent)]">Photos</span> from {person.name}
          </h3>
          {photos && photos.length > 0 ? (
            <Link href="/collection" className="text-xs font-medium text-[var(--muted)] hover:text-[var(--ink)]">
              {photos.length} in Collection
            </Link>
          ) : null}
        </div>
        {photos === null && !gallery.error ? (
          <div className="mt-3 grid grid-cols-3 gap-1.5" aria-label="Loading photos">
            {[0, 1, 2].map((tile) => (
              <Skeleton key={tile} className="aspect-square rounded-xl" />
            ))}
          </div>
        ) : gallery.error ? (
          <p className="mt-3 text-xs text-[var(--muted)]">{gallery.error}</p>
        ) : photos && photos.length > 0 ? (
          <div className="mt-3 grid grid-cols-3 gap-1.5">
            {photos.slice(0, GALLERY_MAX).map((media, index) => (
              <Thumb
                key={media.id}
                media={media}
                label={`Photo ${index + 1} from ${person.name}`}
                onOpen={() => onOpenPhoto(index)}
                more={extra && index === GALLERY_MAX - 1 ? extra : undefined}
              />
            ))}
          </div>
        ) : (
          <div className="mt-3 flex flex-col items-center rounded-2xl border border-dashed border-white/15 px-4 py-5 text-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent)]">
              <CameraIcon className="h-5 w-5" />
            </span>
            <p className="mt-2 text-sm font-semibold text-[var(--ink)]">No photos yet</p>
            <p className="mt-0.5 text-xs leading-5 text-[var(--muted)]">
              {canPhoto ? `Ask ${person.name} for one. Every photo is made just for you.` : "Photos unlock after age verification."}
            </p>
            {canPhoto ? (
              <Button variant="secondary" className="mt-3" onClick={onPhoto} disabled={photoBusy || !photoReady}>
                <CameraIcon className="h-4 w-4" />
                New photo
              </Button>
            ) : null}
          </div>
        )}
      </section>

      {traits.length > 0 ? (
        <section className="mt-6" aria-label={`About ${person.name}`}>
          <h3 className="text-sm font-bold text-[var(--ink)]">
            <span className="text-[var(--accent)]">About</span> {person.name}
          </h3>
          <dl className="mt-3 grid grid-cols-2 gap-2">
            {traits.map((trait) => (
              <div key={trait.label} className="min-w-0 rounded-xl bg-[var(--surface)] px-3 py-2 ring-1 ring-white/5">
                <dt className="text-xs text-[var(--muted)]">{trait.label}</dt>
                <dd className="mt-0.5 line-clamp-2 text-sm font-medium leading-5 text-[var(--ink)]" title={trait.value}>
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

      <p className="mt-6 flex gap-2 rounded-xl border border-[var(--line)] px-3 py-2.5 text-xs leading-5 text-[var(--muted)]">
        <ShieldIcon className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          {person.name} is an AI character. Everything here is fiction between adults, and every image is AI-generated.
        </span>
      </p>
    </div>
  );
}
