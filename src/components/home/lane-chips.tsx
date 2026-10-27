"use client";

import type { ReactNode } from "react";
import { useLane } from "@/components/app-shell";
import { FemaleIcon, MaleIcon, SparkIcon } from "@/components/icons";
import { Chip, cx } from "@/components/ui";
import type { Lane } from "@/lib/characters";

const LANES: { id: Lane; label: string; icon: ReactNode }[] = [
  { id: "girls", label: "Girls", icon: <FemaleIcon className="h-4 w-4" /> },
  { id: "anime", label: "Anime", icon: <SparkIcon className="h-4 w-4" /> },
  { id: "guys", label: "Guys", icon: <MaleIcon className="h-4 w-4" /> },
];

// The same choice as the Girls / Anime / Guys tabs in the top bar, on the page
// itself (the top bar has no room for them on phones).
export function LaneChips({ onPick, fill, className }: { onPick?: (lane: Lane) => void; fill?: boolean; className?: string }) {
  const { lane, setLane } = useLane();
  return (
    <div className={cx("flex gap-2", className)} role="group" aria-label="Show characters">
      {LANES.map((item) => (
        <Chip
          key={item.id}
          active={lane === item.id}
          onClick={() => {
            setLane(item.id);
            onPick?.(item.id);
          }}
          className={cx(fill && "flex-1 justify-center")}
        >
          {item.icon}
          {item.label}
        </Chip>
      ))}
    </div>
  );
}
