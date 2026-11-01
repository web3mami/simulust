"use client";

import Image from "next/image";
import { useState, type ComponentProps } from "react";
import { isStaticArt, type Character } from "@/lib/characters";

type Art = Pick<Character, "image" | "explicitImage">;

// The art a card, a hero slide or a private-photo tile shows: the nude art when
// the API sent it (it does only to a confirmed adult with no hold, and only
// while the art is servable), otherwise the regular portrait. `failed` is a
// nude-art URL that wouldn't load (a hold placed or a takedown since the list
// loaded, or a sign-out in another tab): the regular portrait takes its place.
// A redrawn portrait has a new URL, so it gets its own try.
export function cardArt(person: Art, failed: string | null = null) {
  const explicit = person.explicitImage && person.explicitImage !== failed ? person.explicitImage : undefined;
  return { art: explicit ?? person.image, explicit };
}

export function useCardArt(person: Art) {
  const [failed, setFailed] = useState<string | null>(null);
  const { art, explicit } = cardArt(person, failed);
  return {
    art,
    explicit: Boolean(explicit),
    onError: explicit ? () => setFailed(explicit) : undefined,
  };
}

// next/image with that fallback. Never through the image optimizer unless it's
// our own static art: nude art needs the viewer's login.
export function CardArt({
  person,
  alt,
  onError,
  ...props
}: Omit<ComponentProps<typeof Image>, "src" | "unoptimized"> & { person: Art }) {
  const { art, onError: fallBack } = useCardArt(person);
  if (!art) return null;
  return (
    <Image
      key={art}
      src={art}
      alt={alt}
      unoptimized={!isStaticArt(art)}
      onError={(event) => {
        fallBack?.();
        onError?.(event);
      }}
      {...props}
    />
  );
}
