"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { SettingsIcon, ShieldIcon, UserIcon } from "@/components/icons";
import { PAGE_GUTTER, PAGE_PAD_Y, Panel, buttonClass, cx } from "@/components/ui";
import type { AgeStatus } from "@/lib/api-types";

// Pieces shared by the account screens (profile, settings, verification,
// memories, report, admin). Built on the tokens and primitives in ui.tsx.

// Note: globals.css styles every <a> with `color: inherit` outside Tailwind's
// layers, so text colours on links need the `!` modifier to apply.

// Page frame for the account screens: same gutters and top padding as the rest of the app.
export const ACCOUNT_PAGE = `mx-auto w-full max-w-5xl ${PAGE_GUTTER} ${PAGE_PAD_Y}`;

export const fieldLabel = "block text-sm font-semibold text-[var(--ink)]";
export const fieldHint = "mt-1.5 block text-xs leading-5 text-[var(--muted)]";

// A filled red button for the one destructive action on a screen. ui.tsx's
// "danger" variant is the outlined, lower-key version.
export function solidDangerClass(size: "sm" | "md" | "lg" = "md", extra?: string) {
  return cx(
    "inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-red-500 font-semibold text-white transition-colors hover:bg-red-400 disabled:pointer-events-none disabled:opacity-40",
    size === "sm" ? "h-9 px-4 text-xs" : size === "md" ? "h-10 px-5 text-sm" : "h-12 px-6 text-base",
    extra,
  );
}

const ACCOUNT_LINKS = [
  { href: "/profile", label: "Profile", icon: <UserIcon className="h-4 w-4" /> },
  { href: "/settings", label: "Settings", icon: <SettingsIcon className="h-4 w-4" /> },
  { href: "/verify", label: "Age check", icon: <ShieldIcon className="h-4 w-4" /> },
];

// Profile / Settings / Age verification: a segmented control that fits a
// phone's width, and a row of pills on wider screens.
export function AccountNav({ className }: { className?: string }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Account"
      className={cx(
        "grid grid-cols-3 gap-1 rounded-full border border-[var(--line)] bg-[var(--surface)] p-1 sm:flex sm:gap-2 sm:border-0 sm:bg-transparent sm:p-0",
        className,
      )}
    >
      {ACCOUNT_LINKS.map((link) => {
        const on = pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={on ? "page" : undefined}
            className={cx(
              "inline-flex h-10 min-w-0 shrink-0 items-center justify-center gap-1.5 rounded-full border px-2 text-[13px] font-semibold transition-[background-color,color,border-color,transform] duration-150 active:scale-[0.97] motion-reduce:active:scale-100 sm:gap-2 sm:px-4 sm:text-sm",
              on
                ? "border-transparent bg-[var(--accent)] !text-[var(--accent-ink)]"
                : "border-transparent bg-transparent !text-[var(--muted)] hover:!text-[var(--ink)] sm:border-[var(--line)] sm:bg-[var(--surface)] sm:hover:border-white/25",
            )}
          >
            {link.icon}
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}

// A titled card: one section of a settings-style page.
export function SectionCard({
  title,
  description,
  icon,
  action,
  tone = "default",
  className,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  tone?: "default" | "danger";
  className?: string;
  children?: ReactNode;
}) {
  return (
    <section
      className={cx(
        "rounded-2xl border p-5 sm:p-6",
        tone === "danger" ? "border-red-500/35 bg-red-500/[0.04]" : "border-[var(--line)] bg-[var(--surface)]",
        className,
      )}
    >
      {/* Icon, title and action share the first row; on phones the description
          takes the card's full width below them instead of a narrow column. */}
      <div
        className={cx(
          "grid items-center gap-x-3 sm:gap-x-4",
          icon ? "grid-cols-[auto_minmax(0,1fr)_auto]" : "grid-cols-[minmax(0,1fr)_auto]",
        )}
      >
        {icon ? (
          <span
            aria-hidden
            className={cx(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl sm:h-10 sm:w-10",
              tone === "danger" ? "bg-red-500/15 text-red-300" : "bg-[var(--accent-soft)] text-[var(--accent)]",
            )}
          >
            {icon}
          </span>
        ) : null}
        <h2 className={cx("text-lg font-bold tracking-tight", tone === "danger" ? "text-red-200" : "text-[var(--ink)]")}>
          {title}
        </h2>
        {action ? <div className="shrink-0 justify-self-end">{action}</div> : <span aria-hidden />}
        {description ? (
          <p
            className={cx(
              "mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)] sm:mt-1",
              icon ? "col-span-3 sm:col-span-1 sm:col-start-2" : "col-span-2 sm:col-span-1",
            )}
          >
            {description}
          </p>
        ) : null}
      </div>
      {children ? <div className="mt-5">{children}</div> : null}
    </section>
  );
}

// Shown to signed-out visitors on account screens: what signing in gets them,
// with Sign up as the one primary action.
export function SignInPrompt({
  title,
  body,
  onLogin,
  onSignup,
}: {
  title: string;
  body?: ReactNode;
  onLogin: () => void;
  onSignup?: () => void;
}) {
  return (
    <Panel className="relative flex flex-col items-center overflow-hidden px-6 py-12 text-center">
      {/* A soft accent glow so the empty state doesn't read as an error. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-[radial-gradient(60%_100%_at_50%_0%,rgba(255,79,139,0.16),transparent_70%)]"
      />
      <span
        aria-hidden
        className="relative flex h-14 w-14 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent)] ring-1 ring-[var(--accent)]/25"
      >
        <UserIcon className="h-7 w-7" />
      </span>
      <p className="relative mt-4 text-lg font-bold tracking-tight text-[var(--ink)]">{title}</p>
      {body ? <p className="relative mt-2 max-w-sm text-sm leading-6 text-[var(--muted)]">{body}</p> : null}
      <div className="relative mt-6 flex flex-wrap justify-center gap-3">
        {onSignup ? (
          <button type="button" className={buttonClass("primary", "lg")} onClick={onSignup}>
            Sign up
          </button>
        ) : null}
        <button type="button" className={buttonClass(onSignup ? "secondary" : "primary", "lg")} onClick={onLogin}>
          Log in
        </button>
      </div>
    </Panel>
  );
}

// Grey placeholder blocks while a card loads.
export function SkeletonCard({ lines = 3, label }: { lines?: number; label?: string }) {
  return (
    <Panel className="p-5 sm:p-6" aria-busy="true" aria-label={label}>
      <div className="flex items-center gap-3">
        <div className="h-9 w-9 animate-pulse rounded-xl bg-white/[0.06] motion-reduce:animate-none sm:h-10 sm:w-10" />
        <div className="h-5 w-40 animate-pulse rounded-full bg-white/[0.06] motion-reduce:animate-none" />
      </div>
      <div className="mt-5 space-y-3">
        {Array.from({ length: lines }, (_, index) => (
          <div
            key={index}
            className="h-4 animate-pulse rounded-full bg-white/[0.06] motion-reduce:animate-none"
            style={{ width: `${90 - index * 15}%` }}
          />
        ))}
      </div>
    </Panel>
  );
}

export const AGE_STATUS_LABEL: Record<AgeStatus, string> = {
  none: "Not verified",
  pending: "Checking",
  approved: "Verified",
  declined: "Not approved",
};

const AGE_TONE: Record<AgeStatus, { pill: string; dot: string }> = {
  none: { pill: "bg-white/[0.07] text-[var(--muted)]", dot: "bg-white/40" },
  // Sky, not amber: amber means Premium and credits only.
  pending: { pill: "bg-sky-400/15 text-sky-200", dot: "animate-pulse bg-sky-300 motion-reduce:animate-none" },
  approved: { pill: "bg-emerald-400/15 text-emerald-300", dot: "bg-emerald-400" },
  declined: { pill: "bg-red-500/15 text-red-300", dot: "bg-red-400" },
};

export function AgeStatusBadge({ status, label, className }: { status: AgeStatus; label?: string; className?: string }) {
  const tone = AGE_TONE[status];
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
        tone.pill,
        className,
      )}
    >
      <span aria-hidden className={cx("h-2 w-2 rounded-full", tone.dot)} />
      {label ?? AGE_STATUS_LABEL[status]}
    </span>
  );
}

// An inline notice: errors, holds, confirmations.
export function Notice({
  tone = "error",
  role,
  className,
  children,
}: {
  tone?: "error" | "hold" | "info";
  role?: "alert" | "status";
  className?: string;
  children: ReactNode;
}) {
  const tones = {
    error: "border-red-500/35 bg-red-500/10 text-red-200",
    hold: "border-sky-400/30 bg-sky-400/10 text-sky-100",
    info: "border-[var(--line)] bg-[var(--surface-2)] text-[var(--ink)]",
  };
  return (
    <p role={role} className={cx("rounded-xl border px-4 py-3 text-sm leading-6", tones[tone], className)}>
      {children}
    </p>
  );
}
