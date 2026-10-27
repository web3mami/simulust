import type { ReactNode } from "react";
import { HeartIcon, LockIcon, MicIcon, SparkIcon, UserIcon } from "@/components/icons";
import { cx } from "@/components/ui";

// Small pictures for the text choices in the creator, so each option reads at a
// glance. Line icons in the same weight as icons.tsx.

function Glyph({ children, className = "h-5 w-5" }: { children: ReactNode; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cx("shrink-0", className)} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}

const CrownIcon = () => (
  <Glyph>
    <path d="m4 8 4 4 4-6 4 6 4-4-1.5 10h-13Z" />
  </Glyph>
);

const SmileIcon = () => (
  <Glyph>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M8.5 14c.9 1.3 2.1 2 3.5 2s2.6-.7 3.5-2M9 9.5h.01M15 9.5h.01" />
  </Glyph>
);

const BoltIcon = () => (
  <Glyph>
    <path d="M13 3 5 13.5h6L10.5 21 19 10h-6Z" />
  </Glyph>
);

const SnowIcon = () => (
  <Glyph>
    <path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9M9.5 4.5 12 7l2.5-2.5M9.5 19.5 12 17l2.5 2.5" />
  </Glyph>
);

const FlameIcon = () => (
  <Glyph>
    <path d="M12 21c3.6 0 6-2.4 6-5.8 0-3.4-2.6-5.4-3.6-8.7-2 1.2-3 3-3 4.7-1-.6-1.7-1.6-1.9-2.9C7.8 10 6 12.4 6 15.2 6 18.6 8.4 21 12 21Z" />
  </Glyph>
);

export const PERSONALITY_ICONS: Record<string, ReactNode> = {
  Submissive: <HeartIcon className="h-5 w-5" />,
  Dominant: <CrownIcon />,
  Sweet: <SmileIcon />,
  Bratty: <BoltIcon />,
  Playful: <SparkIcon className="h-5 w-5" />,
  Cold: <SnowIcon />,
};

export const ROLE_ICONS: Record<string, ReactNode> = {
  Girlfriend: <HeartIcon className="h-5 w-5" />,
  Boyfriend: <HeartIcon className="h-5 w-5" />,
  Stranger: <UserIcon className="h-5 w-5" />,
  Exclusive: <LockIcon className="h-5 w-5" />,
  "Friends with benefits": <FlameIcon />,
};

export const VOICE_ICON = <MicIcon className="h-5 w-5" />;
