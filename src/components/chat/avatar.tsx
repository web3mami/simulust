import { cx } from "@/components/ui";
import type { CharacterDTO } from "@/lib/api-types";

const SIZES = {
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-12 w-12 text-base",
  xl: "h-20 w-20 text-2xl",
} as const;

// A round character portrait; falls back to their colour and initial.
export function Avatar({
  person,
  size = "md",
  className,
}: {
  person: Pick<CharacterDTO, "name" | "image" | "color">;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  return (
    <span
      className={cx(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-bold text-white/90 ring-1 ring-white/10",
        SIZES[size],
        className,
      )}
      style={{ background: person.color }}
      aria-hidden
    >
      {person.image ? (
        <img src={person.image} alt="" className="absolute inset-0 h-full w-full object-cover object-top" />
      ) : (
        person.name.slice(0, 1)
      )}
    </span>
  );
}
