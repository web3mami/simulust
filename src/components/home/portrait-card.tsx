"use client";

import Image from "next/image";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { ChatIcon } from "@/components/icons";
import { useCardArt } from "@/components/home/card-art";
import { CARD_SIZES, buttonClass, cx, isStaticArt } from "@/components/ui";
import type { Character } from "@/lib/characters";

// Widths of a card in a sideways row (see ROW_ITEM), so rows fetch small art.
export const ROW_SIZES = "(min-width: 1024px) 224px, (min-width: 640px) 208px, 42vw";
export const ROW_ITEM = "w-[42vw] max-w-56 shrink-0 snap-start sm:w-52 lg:w-56";

type Person = Pick<Character, "id" | "name" | "age" | "image" | "explicitImage" | "color" | "role" | "line"> & { body?: string };

// The browse card for these screens. The portrait fills it and fades in over
// the character's own colour, name and age sit on a fade at the bottom, and on
// a pointer device hovering (or keyboard focus) slides up the persona line and
// a "Chat now" button. Tailwind only applies hover where the device can hover,
// so on phones a tap simply opens the chat.
export function PortraitCard({
  person,
  href = `/date/${person.id}`,
  badge,
  meta,
  className,
  sizes = CARD_SIZES,
  eager = false,
}: {
  person: Person;
  href?: string;
  badge?: ReactNode;
  // The small line under the name; defaults to role · body.
  meta?: ReactNode;
  className?: string;
  sizes?: string;
  // On screen at first paint: load now, ahead of everything else.
  eager?: boolean;
}) {
  const [loaded, setLoaded] = useState(false);
  // Nude art when the server sent it (confirmed adults only), the regular
  // portrait otherwise or if the nude art won't load.
  const { art, onError } = useCardArt(person);
  return (
    <Link
      href={href}
      className={cx(
        "group relative block aspect-[3/4] overflow-hidden rounded-2xl ring-1 ring-white/5 outline-none transition-[transform,box-shadow] duration-300 hover:-translate-y-1 hover:shadow-[0_18px_40px_-12px_rgba(0,0,0,0.8)] hover:ring-[var(--accent)]/60 focus-visible:ring-2 focus-visible:ring-[var(--accent)] motion-reduce:transition-none motion-reduce:hover:translate-y-0",
        className,
      )}
      style={{ background: person.color }}
    >
      {art ? (
        <Image
          key={art}
          src={art}
          alt=""
          fill
          sizes={sizes}
          loading={eager ? "eager" : "lazy"}
          fetchPriority={eager ? "high" : "auto"}
          // Never through the image optimizer: nude art needs the viewer's login.
          unoptimized={!isStaticArt(art)}
          onLoad={() => setLoaded(true)}
          onError={onError}
          className={cx(
            "object-cover object-top transition-[opacity,transform] duration-500 group-hover:scale-[1.04] motion-reduce:transition-none",
            loaded ? "opacity-100" : "opacity-0",
          )}
        />
      ) : null}
      {badge ? <div className="absolute left-2.5 top-2.5 z-10 flex flex-wrap gap-1">{badge}</div> : null}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent px-3 pb-3 pt-16 transition-colors duration-300 group-hover:from-black/95 group-hover:via-black/70 group-focus-visible:from-black/95 group-focus-visible:via-black/70">
        <p className="truncate text-base font-bold leading-tight text-white">
          {person.name} <span className="font-medium text-white/80">{person.age}</span>
        </p>
        <p className="mt-1 line-clamp-1 text-xs text-white/70">{meta ?? [person.role, person.body].filter(Boolean).join(" · ")}</p>
        {/* Height animates through grid rows (0fr → 1fr), so the block slides
            open without a fixed max-height. */}
        <div className="grid grid-rows-[0fr] opacity-0 transition-[grid-template-rows,opacity] duration-300 ease-out group-hover:grid-rows-[1fr] group-hover:opacity-100 group-focus-visible:grid-rows-[1fr] group-focus-visible:opacity-100 motion-reduce:transition-none">
          <div className="min-h-0 overflow-hidden">
            <p className="mt-2 line-clamp-3 text-xs leading-[1.125rem] text-white/85">{person.line}</p>
            {/* A span, not a button: the whole card is already the link. */}
            <span className={buttonClass("primary", "sm", "pointer-events-none mt-2.5 w-full")}>
              <ChatIcon className="h-4 w-4" />
              Chat now
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}

// A placeholder card for a sideways row or a grid while a list loads.
export function PortraitSkeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cx("aspect-[3/4] animate-pulse rounded-2xl bg-[var(--surface)] ring-1 ring-white/5", className)} />;
}
