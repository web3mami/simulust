import type { ReactNode } from "react";

// Extra line icons for the account screens, drawn like the ones in
// components/icons.tsx (24px grid, currentColor).

function Icon({ children, className = "h-5 w-5" }: { children: ReactNode; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`shrink-0 ${className}`}
      fill="none"
      stroke="currentColor"
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

export const PencilIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <path d="M14.5 5.5 18.5 9.5M5 19l1-4.5L16 4.5a2 2 0 0 1 2.8 0l.7.7a2 2 0 0 1 0 2.8L9.5 18z" />
  </Icon>
);

export const PinIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <path d="M9 4h6l-1 5 3.5 3.5V14h-11v-1.5L10 9z" />
    <path d="M12 14v6" />
  </Icon>
);

export const TrashIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <path d="M4.5 7h15M9.5 7V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v2M6.5 7l.8 11.2A2 2 0 0 0 9.3 20h5.4a2 2 0 0 0 2-1.8L17.5 7" />
  </Icon>
);

export const MailIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <rect x="3.5" y="5.5" width="17" height="13" rx="2.5" />
    <path d="m4.5 7 7.5 6 7.5-6" />
  </Icon>
);

export const WalletIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H17v3" />
    <rect x="4" y="8" width="16" height="11" rx="2.5" />
    <path d="M15.5 13.5h1.5" />
  </Icon>
);

export const DownloadIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14" />
  </Icon>
);

export const CheckIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Icon>
);

export const AlertIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <path d="M12 4 3 19.5h18z" />
    <path d="M12 10v4.5M12 17.2v.3" />
  </Icon>
);

export const IdCardIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <rect x="3" y="5.5" width="18" height="13" rx="2.5" />
    <circle cx="8.5" cy="11" r="2" />
    <path d="M5.5 16c.6-1.4 1.7-2.1 3-2.1s2.4.7 3 2.1M14 10h4M14 13.5h3" />
  </Icon>
);

export const EyeOffIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <path d="M4 4l16 16" />
    <path d="M10.6 6.1A9.6 9.6 0 0 1 12 6c5 0 8.5 4.4 9 6-.2.7-1 2-2.3 3.3M6.6 7.6C4.6 8.9 3.3 10.8 3 12c.5 1.6 4 6 9 6 1.6 0 3-.4 4.2-1.1" />
    <path d="M9.9 10a3 3 0 0 0 4.1 4.1" />
  </Icon>
);

export const InfoIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 11v5M12 8v.3" />
  </Icon>
);

// Brand marks for the sign-in buttons.
export function GoogleGlyph({ className = "h-5 w-5" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={`shrink-0 ${className}`} aria-hidden>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.1A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.34-2.1V7.06H2.18A11 11 0 0 0 1 12c0 1.77.43 3.45 1.18 4.94l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z" />
    </svg>
  );
}

export function XGlyph({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={`shrink-0 ${className}`} fill="currentColor" aria-hidden>
      <path d="M17.75 3h3.07l-6.7 7.66L22 21h-6.17l-4.83-6.32L5.47 21H2.4l7.17-8.2L2 3h6.33l4.37 5.77zm-1.08 16.18h1.7L7.4 4.73H5.57z" />
    </svg>
  );
}
