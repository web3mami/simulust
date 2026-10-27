"use client";

import Image from "next/image";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useSession } from "@/components/auth-gate";
import { ChatIcon, ChevronLeftIcon, ChevronRightIcon, CoinIcon, PlusIcon } from "@/components/icons";
import { PremiumIcon } from "@/components/premium-icon";
import { Badge, ButtonLink, cx, isStaticArt } from "@/components/ui";
import { FREE, MEMBERSHIP, PRODUCTS, formatUsd } from "@/lib/pricing";
import type { Character, Lane } from "@/lib/characters";

const ADVANCE_MS = 6000;

// Landscape art (1280×720, dark on the left for the copy). It shows groups of
// models, never a named character, so it is never captioned with a name.
const CREATE_ART: Record<Lane, { image: string; title: [string, string]; noun: string }> = {
  girls: { image: "/hero/hero-girls-maid.jpg", title: ["Create your own", "AI Girlfriend"], noun: "her" },
  anime: { image: "/hero/hero-anime-wet.jpg", title: ["Create your own", "Anime Partner"], noun: "them" },
  guys: { image: "/hero/hero-guys-thirst.jpg", title: ["Create your own", "AI Boyfriend"], noun: "him" },
};

const PREMIUM_ART: Record<Lane, string> = {
  girls: "/hero/hero-girls-pool.jpg",
  anime: "/hero/hero-anime-night.jpg",
  guys: "/hero/hero-guys-rooftop.jpg",
};

type Slide = { kind: "character"; person: Character } | { kind: "create" } | { kind: "premium" };

const slideKey = (slide: Slide) => (slide.kind === "character" ? slide.person.id : slide.kind);

function subscribeReducedMotion(onChange: () => void) {
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

// No auto-advance or sliding when the user asked for less motion. The server
// render assumes reduced motion, so nothing moves before hydration.
function usePrefersReducedMotion() {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => true,
  );
}

const CTA_SHADOW = "shadow-[0_10px_30px_-6px_rgba(255,79,139,0.6)]";

// The copy column, the same on every slide so the buttons line up as it slides.
function Copy({ children }: { children: ReactNode }) {
  return (
    <div className="relative z-10 flex h-full max-w-[68%] flex-col justify-end px-5 pb-12 sm:max-w-[52%] sm:justify-center sm:px-16 sm:pb-10 lg:max-w-[50%] lg:px-20">
      {children}
    </div>
  );
}

// Darkens the left for the copy and the bottom for the dots.
function Shade() {
  return (
    <>
      <div className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/40 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/70 to-transparent" />
    </>
  );
}

// Slow push-in on the slide being shown, for a bit of life.
const KEN_BURNS = "motion-safe:transition-transform motion-safe:duration-[7000ms] motion-safe:ease-out";

function CharacterSlide({ person, active, first, media }: { person: Character; active: boolean; first: boolean; media: boolean }) {
  const optimised = person.image ? isStaticArt(person.image) : false;
  return (
    <>
      <div className="absolute inset-0" style={{ background: person.color }} />
      {media && person.image ? (
        <>
          {/* A 64px copy stretched and blurred makes the backdrop: about 1KB. */}
          <Image
            src={person.image}
            alt=""
            aria-hidden
            fill
            sizes="64px"
            unoptimized={!optimised}
            loading={first ? "eager" : "lazy"}
            className="scale-125 object-cover object-top opacity-60 blur-2xl"
          />
          <div
            className={cx(
              "absolute inset-y-0 right-0 w-[64%] [mask-image:linear-gradient(to_right,transparent,#000_30%)] sm:w-[50%] lg:w-[46%] lg:[mask-image:linear-gradient(to_right,transparent,#000_25%,#000_88%,transparent)]",
              "overflow-hidden",
            )}
          >
            <Image
              src={person.image}
              alt=""
              fill
              sizes="(min-width: 1024px) 640px, (min-width: 640px) 50vw, 64vw"
              unoptimized={!optimised}
              loading={first ? "eager" : "lazy"}
              fetchPriority={first ? "high" : "auto"}
              className={cx("object-cover object-[center_18%]", KEN_BURNS, active ? "scale-[1.06]" : "scale-100")}
            />
          </div>
        </>
      ) : null}
      <Shade />
      <Copy>
        <Badge className="self-start">Featured</Badge>
        <h2 className="mt-3 text-4xl font-extrabold leading-none tracking-tight text-white sm:text-6xl lg:text-7xl">{person.name}</h2>
        <p className="mt-2 text-sm font-semibold text-white/90 sm:text-base">
          {person.age} · {person.role}
        </p>
        <p className="mt-2 line-clamp-2 text-xs leading-5 text-white/75 sm:line-clamp-3 sm:text-sm sm:leading-6">{person.line}</p>
        <ButtonLink href={`/date/${person.id}`} size="lg" className={cx("mt-4 self-start sm:mt-6", CTA_SHADOW)}>
          <ChatIcon className="h-5 w-5" />
          Chat now
          <span className="sr-only"> with {person.name}</span>
        </ButtonLink>
      </Copy>
    </>
  );
}

// Full-bleed landscape art behind the copy.
function ArtBackdrop({ src, active, media }: { src: string; active: boolean; media: boolean }) {
  return (
    <>
      <div className="absolute inset-0 bg-[var(--bg-2)]" />
      {media ? (
        <Image
          src={src}
          alt=""
          fill
          sizes="(min-width: 1024px) 1200px, 100vw"
          className={cx("object-cover object-[72%_center]", KEN_BURNS, active ? "scale-[1.06]" : "scale-100")}
        />
      ) : null}
      <Shade />
    </>
  );
}

function CreateSlide({ lane, active, media }: { lane: Lane; active: boolean; media: boolean }) {
  const copy = CREATE_ART[lane];
  return (
    <>
      <ArtBackdrop src={copy.image} active={active} media={media} />
      <Copy>
        <Badge className="self-start">Create</Badge>
        <h2 className="mt-3 text-3xl font-extrabold leading-[1.05] tracking-tight text-white sm:text-5xl lg:text-6xl">
          {copy.title[0]} <span className="block text-[var(--accent)]">{copy.title[1]}</span>
        </h2>
        <p className="mt-3 line-clamp-2 text-xs leading-5 text-white/80 sm:line-clamp-none sm:text-base sm:leading-7">
          Pick the look, the personality and the pace. Make {copy.noun} once and pick up where you left off every time.
        </p>
        <ButtonLink href="/create" size="lg" className={cx("mt-4 self-start sm:mt-6", CTA_SHADOW)}>
          <PlusIcon className="h-5 w-5" />
          Create now
        </ButtonLink>
      </Copy>
    </>
  );
}

// Premium for visitors; members already have it, so theirs offers credit packs.
function PremiumSlide({ lane, active, media }: { lane: Lane; active: boolean; media: boolean }) {
  const { me } = useSession();
  const member = me?.isMember === true;
  return (
    <>
      <ArtBackdrop src={PREMIUM_ART[lane]} active={active} media={media} />
      <Copy>
        <Badge tone="premium" className="self-start">
          {member ? "Credits" : "Premium"}
        </Badge>
        {member ? (
          <>
            <h2 className="mt-3 text-3xl font-extrabold leading-[1.05] tracking-tight text-white sm:text-5xl lg:text-6xl">
              Top up <span className="block text-[var(--premium)]">for photos & video</span>
            </h2>
            <p className="mt-3 line-clamp-2 text-xs leading-5 text-white/80 sm:line-clamp-none sm:text-base sm:leading-7">
              Packs from {formatUsd(PRODUCTS[0].usdCents)}, paid in USDC or SOL. Credits never expire, and a photo or video that
              fails refunds itself.
            </p>
            <ButtonLink href="/packs" variant="premium" size="lg" className="mt-4 self-start sm:mt-6">
              <CoinIcon className="h-5 w-5" />
              Buy credits
            </ButtonLink>
          </>
        ) : (
          <>
            <h2 className="mt-3 text-3xl font-extrabold leading-[1.05] tracking-tight text-white sm:text-5xl lg:text-6xl">
              Unlimited <span className="block text-[var(--premium)]">messages</span>
            </h2>
            <p className="mt-3 line-clamp-2 text-xs leading-5 text-white/80 sm:line-clamp-none sm:text-base sm:leading-7">
              {formatUsd(MEMBERSHIP.usdCents)} for {MEMBERSHIP.memberDays} days with {MEMBERSHIP.credits} credits included, paid in
              USDC or SOL. Nothing renews on its own. Free accounts get {FREE.dailyMessages} messages a day.
            </p>
            <ButtonLink href="/premium" variant="premium" size="lg" className="mt-4 self-start sm:mt-6">
              <PremiumIcon className="h-5 w-5" />
              Get Premium
            </ButtonLink>
          </>
        )}
      </Copy>
    </>
  );
}

export function HeroCarousel({ lane, people }: { lane: Lane; people: Character[] }) {
  // Featured characters, with Create third and Premium last.
  const slides: Slide[] = people.map((person) => ({ kind: "character", person }));
  slides.splice(Math.min(2, slides.length), 0, { kind: "create" });
  slides.push({ kind: "premium" });

  const count = slides.length;
  const [index, setIndex] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const reduced = usePrefersReducedMotion();
  const touchX = useRef<number | null>(null);
  const current = Math.min(index, count - 1);
  const paused = hovered || focused;

  useEffect(() => {
    if (paused || reduced || count < 2) return;
    const timer = window.setTimeout(() => setIndex((value) => (value + 1) % count), ADVANCE_MS);
    return () => window.clearTimeout(timer);
  }, [current, paused, reduced, count]);

  const go = (next: number) => setIndex(((next % count) + count) % count);
  // Pictures only for the slide on screen and its neighbours, so a visit
  // downloads one or two hero images instead of all of them.
  const near = (position: number) => {
    const distance = Math.abs(position - current);
    return Math.min(distance, count - distance) <= 1;
  };

  const arrowClass =
    "absolute top-1/2 z-20 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur transition hover:bg-black/70 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 sm:flex [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/hero:opacity-100";

  return (
    <section
      aria-roledescription="carousel"
      aria-label="Featured"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") go(current - 1);
        if (event.key === "ArrowRight") go(current + 1);
      }}
      onTouchStart={(event) => {
        touchX.current = event.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(event) => {
        const start = touchX.current;
        const end = event.changedTouches[0]?.clientX;
        touchX.current = null;
        if (start === null || end === undefined || Math.abs(end - start) < 40) return;
        go(end < start ? current + 1 : current - 1);
      }}
      className="group/hero relative h-[20rem] overflow-hidden rounded-2xl bg-[var(--surface)] ring-1 ring-white/5 sm:h-[24rem] sm:rounded-3xl lg:h-[28rem]"
    >
      <div
        className={cx("flex h-full", reduced ? "" : "transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]")}
        style={{ transform: `translateX(-${current * 100}%)` }}
        aria-live={paused || reduced ? "polite" : "off"}
      >
        {slides.map((slide, position) => {
          const active = position === current;
          const media = near(position);
          return (
            <div
              key={slideKey(slide)}
              role="group"
              aria-roledescription="slide"
              aria-label={`${position + 1} of ${count}`}
              aria-hidden={!active}
              inert={!active}
              className="relative h-full w-full shrink-0 overflow-hidden"
            >
              {slide.kind === "character" ? (
                <CharacterSlide person={slide.person} active={active} first={position === 0} media={media} />
              ) : slide.kind === "create" ? (
                <CreateSlide lane={lane} active={active} media={media} />
              ) : (
                <PremiumSlide lane={lane} active={active} media={media} />
              )}
            </div>
          );
        })}
      </div>

      {count > 1 ? (
        <>
          <button type="button" aria-label="Previous slide" onClick={() => go(current - 1)} className={cx(arrowClass, "left-3")}>
            <ChevronLeftIcon />
          </button>
          <button type="button" aria-label="Next slide" onClick={() => go(current + 1)} className={cx(arrowClass, "right-3")}>
            <ChevronRightIcon />
          </button>
          <div className="absolute inset-x-0 bottom-0 z-20 flex justify-center sm:bottom-1">
            {slides.map((slide, position) => (
              <button
                key={slideKey(slide)}
                type="button"
                aria-label={`Show slide ${position + 1}: ${
                  slide.kind === "character" ? slide.person.name : slide.kind === "create" ? "Create your own" : "Premium"
                }`}
                aria-current={position === current ? "true" : undefined}
                onClick={() => go(position)}
                className="group/dot flex h-10 items-center px-2 focus-visible:outline-none"
              >
                <span
                  className={cx(
                    "block h-1.5 rounded-full transition-all duration-300 group-focus-visible/dot:ring-2 group-focus-visible/dot:ring-white/70",
                    position === current ? "w-7 bg-[var(--accent)]" : "w-3.5 bg-white/40 group-hover/dot:bg-white/70",
                  )}
                />
              </button>
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}
