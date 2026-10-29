import type { ReactNode } from "react";

// Line icons on a 24px grid, drawn in currentColor so they take the text colour.

function Icon({ children, className = "h-5 w-5", fill = false }: { children: ReactNode; className?: string; fill?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`shrink-0 ${className}`}
      fill={fill ? "currentColor" : "none"}
      stroke={fill ? "none" : "currentColor"}
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

type IconProps = { className?: string };

export const HomeIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <path d="M4 11 12 4l8 7" />
    <path d="M6 9.5V20h4.5v-6h3V20H18V9.5" />
  </Icon>
);

export const CompassIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="m15.5 8.5-2 5-5 2 2-5z" />
  </Icon>
);

export const ChatIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <path d="M5 7.2A3.2 3.2 0 0 1 8.2 4h7.6A3.2 3.2 0 0 1 19 7.2v5.6A3.2 3.2 0 0 1 15.8 16H10l-4.5 3.2V16H8.2A3.2 3.2 0 0 1 5 12.8z" />
  </Icon>
);

export const GalleryIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="m20.5 15.5-4.5-4.5-7.5 8" />
  </Icon>
);

export const PlusCircleIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 8.5v7M8.5 12h7" />
  </Icon>
);

export const PlusIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

export const HeartIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <path d="M12 19.5s-7.5-4.4-7.5-10A4.3 4.3 0 0 1 12 6.8a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10-7.5 10z" />
  </Icon>
);

export const MenuIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Icon>
);

export const CloseIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Icon>
);

export const SearchIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4 4" />
  </Icon>
);

export const UserIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <circle cx="12" cy="8" r="3.5" />
    <path d="M5 19.5c1.5-3.2 4.2-4.8 7-4.8s5.5 1.6 7 4.8" />
  </Icon>
);

export const SettingsIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="10" cy="17" r="2" />
  </Icon>
);

export const ShieldIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <path d="M12 3.5 5 6v5.5c0 4.2 2.9 7.7 7 9 4.1-1.3 7-4.8 7-9V6z" />
    <path d="m9 12 2.2 2.2L15.5 10" />
  </Icon>
);

export const FlagIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <path d="M5.5 20.5V4.5M5.5 5h11l-2 4 2 4h-11" />
  </Icon>
);

export const CoinIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M14.5 9.3c-.5-.8-1.4-1.3-2.5-1.3-1.5 0-2.6.8-2.6 2s1.1 1.7 2.6 2 2.6.8 2.6 2-1.1 2-2.6 2c-1.1 0-2-.5-2.5-1.3M12 6.5V8M12 16v1.5" />
  </Icon>
);

export const ChevronRightIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <path d="m9.5 6 6 6-6 6" />
  </Icon>
);

export const ChevronDownIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <path d="m6 9.5 6 6 6-6" />
  </Icon>
);

export const ChevronLeftIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <path d="m14.5 6-6 6 6 6" />
  </Icon>
);

export const CameraIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.8l1.4-2h4.6l1.4 2h1.8A2.5 2.5 0 0 1 20 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5z" />
    <circle cx="12" cy="12.5" r="3.5" />
  </Icon>
);

export const FilmIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
    <path d="M7.5 5v14M16.5 5v14M3.5 9.5h4M3.5 14.5h4M16.5 9.5h4M16.5 14.5h4" />
  </Icon>
);

export const MicIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <rect x="9" y="3.5" width="6" height="11" rx="3" />
    <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5" />
  </Icon>
);

export const PlayIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <path d="M8 5.5v13l10-6.5z" />
  </Icon>
);

export const SendIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <path d="M4.5 12 20 4.5 13.5 20l-2.3-6.2z" />
    <path d="m11.2 13.8 3.8-3.8" />
  </Icon>
);

export const BrainIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <path d="M9 4.5a3 3 0 0 0-3 3 3 3 0 0 0-1.5 5.5A3 3 0 0 0 9 18v1.5M15 4.5a3 3 0 0 1 3 3 3 3 0 0 1 1.5 5.5A3 3 0 0 1 15 18v1.5M9 4.5a3 3 0 0 1 6 0M12 4.5v15" />
  </Icon>
);

export const SparkIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <path d="M12 3.5 13.8 9 19.5 10.5 13.8 12 12 18 10.2 12 4.5 10.5 10.2 9z" />
  </Icon>
);

export const FemaleIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <circle cx="12" cy="9" r="5" />
    <path d="M12 14v7M9 18h6" />
  </Icon>
);

export const MaleIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <circle cx="10" cy="14" r="5" />
    <path d="M13.5 10.5 19 5M14.5 5H19v4.5" />
  </Icon>
);

export const LockIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <rect x="5" y="10.5" width="14" height="9.5" rx="2.5" />
    <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
  </Icon>
);

export const MoreIcon = ({ className }: IconProps) => (
  <Icon className={className} fill>
    <circle cx="6" cy="12" r="1.7" />
    <circle cx="12" cy="12" r="1.7" />
    <circle cx="18" cy="12" r="1.7" />
  </Icon>
);

export const SignOutIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <path d="M10 7V5.8A1.8 1.8 0 0 1 11.8 4h6.4A1.8 1.8 0 0 1 20 5.8v12.4a1.8 1.8 0 0 1-1.8 1.8h-6.4A1.8 1.8 0 0 1 10 18.2V17" />
    <path d="M4 12h10M11 9l3 3-3 3" />
  </Icon>
);

export const AdminIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <path d="M4 5h16v10H4z" />
    <path d="M9 19h6M12 15v4" />
  </Icon>
);
