"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { SettingsIcon, ShieldIcon, UserIcon } from "@/components/icons";
import { Panel, buttonClass, cx } from "@/components/ui";
import type { AgeStatus } from "@/lib/api-types";

// Pieces shared by the account screens (profile, settings, verification,
// memories, report, admin). Built on the tokens and primitives in ui.tsx.

// Note: globals.css styles every <a> with `color: inherit` outside Tailwind's
// layers, so text colours on links need the `!` modifier to apply.

// Page frame for the account screens: same gutters as the rest of the app.
export const ACCOUNT_PAGE = "mx-auto w-full max-w-5xl px-4 pb-12 pt-6 sm:px-6 sm:pt-8 lg:px-8";

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

// Profile / Settings / Age verification, as a row of pills that scrolls
// sideways on phones.
export function AccountNav({ className }: { className?: string }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Account"
      className={cx("no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0", className)}
    >
      {ACCOUNT_LINKS.map((link) => {
        const on = pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={on ? "page" : undefined}
            className={cx(
              "inline-flex h-10 shrink-0 items-center gap-2 rounded-full px-4 text-sm font-semibold transition-colors",
              on
                ? "bg-[var(--accent)] !text-[var(--accent-ink)]"
                : "border border-[var(--line)] bg-[var(--surface)] !text-[var(--muted)] hover:border-white/25 hover:!text-[var(--ink)]",
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
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        {icon ? (
          <span
            aria-hidden
            className={cx(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
              tone === "danger" ? "bg-red-500/15 text-red-300" : "bg-[var(--accent-soft)] text-[var(--accent)]",
            )}
          >
            {icon}
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <h2 className={cx("text-lg font-bold tracking-tight", tone === "danger" ? "text-red-200" : "text-[var(--ink)]")}>
            {title}
          </h2>
          {description ? <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--muted)]">{description}</p> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
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
    <Panel className="flex flex-col items-center px-6 py-12 text-center">
      <span
        aria-hidden
        className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent)]"
      >
        <UserIcon className="h-7 w-7" />
      </span>
      <p className="mt-4 text-lg font-bold tracking-tight text-[var(--ink)]">{title}</p>
      {body ? <p className="mt-2 max-w-sm text-sm leading-6 text-[var(--muted)]">{body}</p> : null}
      <div className="mt-6 flex flex-wrap justify-center gap-3">
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
      <div className="h-5 w-40 animate-pulse rounded-full bg-white/[0.06]" />
      <div className="mt-5 space-y-3">
        {Array.from({ length: lines }, (_, index) => (
          <div key={index} className="h-4 animate-pulse rounded-full bg-white/[0.06]" style={{ width: `${90 - index * 15}%` }} />
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
  pending: { pill: "bg-[var(--premium)]/15 text-[var(--premium)]", dot: "animate-pulse bg-[var(--premium)]" },
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
    hold: "border-[var(--premium)]/40 bg-[var(--premium)]/10 text-[var(--premium)]",
    info: "border-[var(--line)] bg-[var(--surface-2)] text-[var(--ink)]",
  };
  return (
    <p role={role} className={cx("rounded-xl border px-4 py-3 text-sm leading-6", tones[tone], className)}>
      {children}
    </p>
  );
}
