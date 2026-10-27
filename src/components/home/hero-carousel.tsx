"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ChatIcon, ChevronLeftIcon, ChevronRightIcon, PlusIcon } from "@/components/icons";
import { Badge, ButtonLink, cx } from "@/components/ui";
import type { Character, Lane } from "@/lib/characters";

const ADVANCE_MS = 6000;

const CREATE: Record<Lane, { image: string; title: string; noun: string }> = {
  girls: { image: "/hero/hero-girls-maid.jpg", title: "Create your own AI Girlfriend", noun: "her" },
  anime: { image: "/hero/hero-anime-wet.jpg", title: "Create your own Anime AI", noun: "them" },
  guys: { image: "/hero/hero-guys-thirst.jpg", title: "Create your own AI Boyfriend", noun: "him" },
};

type Slide = { kind: "character"; person: Character } | { kind: "create" };

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

function CharacterSlide({ person, active }: { person: Character; active: boolean }) {
  return (
    <>
      {person.image ? (
        <>
          <img
            src={person.image}
            alt=""
            aria-hidden
            className="absolute inset-0 h-full w-full scale-125 object-cover object-top opacity-60 blur-2xl"
          />
          <img
            src={person.image}
            alt=""
            loading={active ? "eager" : "lazy"}
            className="absolute inset-y-0 right-0 h-full w-[62%] object-cover object-top [mask-image:linear-gradient(to_right,transparent,#000_35%)] sm:w-auto sm:max-w-none sm:[mask-image:linear-gradient(to_right,transparent,#000_30%,#000_85%,transparent)] lg:right-[6%]"
          />
        </>
      ) : (
        <div className="absolute inset-0" style={{ background: person.color }} />
      )}
      <div className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/45 to-transparent sm:via-black/30" />
      <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/60 to-transparent" />
      <div className="relative z-10 flex h-full max-w-[70%] flex-col justify-center px-5 pb-8 sm:max-w-md sm:px-10 lg:max-w-lg lg:px-14">
        <Badge className="self-start">Featured</Badge>
        <h2 className="mt-3 text-4xl font-extrabold leading-none tracking-tight text-white sm:text-6xl lg:text-7xl">
          {person.name}
        </h2>
        <p className="mt-2 text-sm font-semibold text-white/90 sm:text-base">
          {person.age} · {person.role}
        </p>
        <p className="mt-2 line-clamp-2 text-xs leading-5 text-white/75 sm:line-clamp-3 sm:text-sm sm:leading-6">{person.line}</p>
        <ButtonLink
          href={`/date/${person.id}`}
          size="lg"
          className="mt-4 self-start shadow-[0_8px_24px_rgba(255,79,139,0.35)] sm:mt-6"
        >
          <ChatIcon className="h-5 w-5" />
          Chat now
          <span className="sr-only"> with {person.name}</span>
        </ButtonLink>
      </div>
    </>
  );
}

function CreateSlide({ lane, active }: { lane: Lane; active: boolean }) {
  const copy = CREATE[lane];
  return (
    <>
      <img
        src={copy.image}
        alt=""
        loading={active ? "eager" : "lazy"}
        className="absolute inset-0 h-full w-full object-cover object-[70%_center]"
      />
      <div className="absolute inset-0 bg-gradient-to-r from-black/90 via-black/55 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/60 to-transparent" />
      <div className="relative z-10 flex h-full max-w-[75%] flex-col justify-center px-5 pb-8 sm:max-w-lg sm:px-10 lg:px-14">
        <Badge className="self-start">New</Badge>
        <h2 className="mt-3 text-3xl font-extrabold leading-[1.05] tracking-tight text-white sm:text-5xl lg:text-6xl">
          {copy.title.split(" ").slice(0, -2).join(" ")}{" "}
          <span className="block text-[var(--accent)]">{copy.title.split(" ").slice(-2).join(" ")}</span>
        </h2>
        <p className="mt-3 line-clamp-2 text-xs leading-5 text-white/80 sm:line-clamp-none sm:text-base sm:leading-7">
          Pick the look, the personality and the pace. Make {copy.noun} once and pick up where you left off every time.
        </p>
        <ButtonLink
          href="/create"
          size="lg"
          className="mt-4 self-start shadow-[0_8px_24px_rgba(255,79,139,0.35)] sm:mt-6"
        >
          <PlusIcon className="h-5 w-5" />
          Create now
        </ButtonLink>
      </div>
    </>
  );
}

export function HeroCarousel({ lane, people }: { lane: Lane; people: Character[] }) {
  // Featured characters with the create slide third (or last, if there are few).
  const slides: Slide[] = people.map((person) => ({ kind: "character", person }));
  slides.splice(Math.min(2, slides.length), 0, { kind: "create" });

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

  return (
    <section
      aria-roledescription="carousel"
      aria-label="Featured characters"
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
      className="group/hero relative h-[19rem] overflow-hidden rounded-2xl bg-[var(--surface)] ring-1 ring-white/5 sm:h-[22rem] lg:h-[26rem]"
    >
      <div
        className={cx("flex h-full", reduced ? "" : "transition-transform duration-700 ease-out")}
        style={{ transform: `translateX(-${current * 100}%)` }}
        aria-live={paused || reduced ? "polite" : "off"}
      >
        {slides.map((slide, position) => {
          const active = position === current;
          return (
            <div
              key={slide.kind === "character" ? slide.person.id : "create"}
              role="group"
              aria-roledescription="slide"
              aria-label={`${position + 1} of ${count}`}
              aria-hidden={!active}
              inert={!active}
              className="relative h-full w-full shrink-0 overflow-hidden"
            >
              {slide.kind === "character" ? (
                <CharacterSlide person={slide.person} active={active} />
              ) : (
                <CreateSlide lane={lane} active={active} />
              )}
            </div>
          );
        })}
      </div>

      {count > 1 ? (
        <>
          <button
            type="button"
            aria-label="Previous slide"
            onClick={() => go(current - 1)}
            className="absolute left-3 top-1/2 z-20 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur transition hover:bg-black/70 sm:flex"
          >
            <ChevronLeftIcon />
          </button>
          <button
            type="button"
            aria-label="Next slide"
            onClick={() => go(current + 1)}
            className="absolute right-3 top-1/2 z-20 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur transition hover:bg-black/70 sm:flex"
          >
            <ChevronRightIcon />
          </button>
          <div className="absolute inset-x-0 bottom-0 z-20 flex justify-center sm:bottom-1">
            {slides.map((slide, position) => (
              <button
                key={slide.kind === "character" ? slide.person.id : "create"}
                type="button"
                aria-label={`Show slide ${position + 1}${slide.kind === "character" ? `: ${slide.person.name}` : ": Create your own"}`}
                aria-current={position === current ? "true" : undefined}
                onClick={() => go(position)}
                className="group/dot flex h-10 items-center px-1"
              >
                <span
                  className={cx(
                    "block h-1.5 rounded-full transition-all",
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
