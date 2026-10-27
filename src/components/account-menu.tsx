"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useSession } from "@/components/auth-gate";
import { PremiumIcon } from "@/components/premium-icon";
import type { AgeStatus } from "@/lib/api-types";

const AGE_LABEL: Record<AgeStatus, string> = {
  approved: "Age verified",
  pending: "Verification in progress",
  declined: "Verification not approved",
  none: "Age not verified",
};

export function AccountMenu() {
  const { session, me, signOut, openLogin, openSignup } = useSession();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onPointer(event: MouseEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  if (!session) {
    return (
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="rounded-full border border-white/20 px-4 py-1.5 text-sm text-[var(--ink)]"
          onClick={openLogin}
        >
          Login
        </button>
        <button
          type="button"
          className="rounded-full bg-[var(--gold)] px-4 py-1.5 text-sm font-medium !text-[#12110F]"
          onClick={openSignup}
        >
          Sign up
        </button>
      </div>
    );
  }

  const label = me?.displayName && me.displayName !== "You" ? me.displayName : session.display;
  const initial = label.trim().charAt(0).toUpperCase() || "U";
  const close = () => setOpen(false);

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-label="Account menu"
        aria-expanded={open}
        className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-white/15 bg-white/10 text-sm font-medium"
        onClick={() => setOpen((value) => !value)}
      >
        {initial}
      </button>
      {open ? (
        <div className="absolute right-0 z-50 mt-2 w-64 overflow-hidden rounded-2xl border border-white/10 bg-[var(--bg-2)] py-2">
          <div className="border-b border-[var(--line)] px-4 pb-3 pt-1">
            <p className="truncate text-sm font-medium text-[var(--ink)]">{label}</p>
            {me ? (
              <>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  <span className="text-[var(--gold)]">{me.balance.toLocaleString()}</span> credits
                  {me.isMember ? " · Member" : ""}
                </p>
                <Link
                  href="/verify"
                  onClick={close}
                  className={`mt-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] ${
                    me.ageVerified ? "bg-white/10 text-[var(--ink)]" : "border border-[var(--gold)]/50 text-[var(--gold)]"
                  }`}
                >
                  <span
                    aria-hidden
                    className={`h-1.5 w-1.5 rounded-full ${me.ageVerified ? "bg-emerald-400" : "bg-[var(--gold)]"}`}
                  />
                  {AGE_LABEL[me.ageStatus]}
                </Link>
              </>
            ) : (
              <p className="mt-1 text-xs text-[var(--muted)]">Loading your account…</p>
            )}
          </div>
          <MenuRow href="/profile" onClick={close} label="Profile" icon={<ProfileIcon />} />
          <MenuRow href="/settings" onClick={close} label="Settings" icon={<SettingsIcon />} />
          {me && !me.ageVerified ? (
            <MenuRow href="/verify" onClick={close} label="Verify age" icon={<ShieldIcon />} />
          ) : null}
          <MenuRow
            href="/premium"
            onClick={close}
            label="Credits"
            icon={<PremiumIcon className="h-5 w-5 text-[var(--gold)]" />}
          />
          {me?.isAdmin ? <MenuRow href="/admin" onClick={close} label="Admin" icon={<AdminIcon />} /> : null}
          <MenuRow
            label="Sign out"
            icon={<SignOutIcon />}
            onClick={() => {
              close();
              signOut();
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

function MenuRow({
  label,
  icon,
  href,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  href?: string;
  onClick?: () => void;
}) {
  const className =
    "flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-[var(--ink)] hover:bg-white/5";
  const inner = (
    <>
      <span className="flex h-5 w-5 items-center justify-center text-[var(--ink)]">{icon}</span>
      {label}
    </>
  );

  if (href) {
    return (
      <Link href={href} className={className} onClick={onClick}>
        {inner}
      </Link>
    );
  }

  return (
    <button type="button" className={className} onClick={onClick}>
      {inner}
    </button>
  );
}

function ProfileIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="12" cy="8" r="3" />
      <path d="M5.5 19c1.4-3 4-4.5 6.5-4.5S17.1 16 18.5 19" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="10" cy="17" r="2" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M12 3.5 5 6v5.5c0 4.2 2.9 7.7 7 9 4.1-1.3 7-4.8 7-9V6z" />
      <path d="m9 12 2.2 2.2L15.5 10" />
    </svg>
  );
}

function AdminIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M4 5h16v10H4z" />
      <path d="M9 19h6M12 15v4" />
    </svg>
  );
}

function SignOutIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M10 7V5.8A1.8 1.8 0 0 1 11.8 4h6.4A1.8 1.8 0 0 1 20 5.8v12.4a1.8 1.8 0 0 1-1.8 1.8h-6.4A1.8 1.8 0 0 1 10 18.2V17" />
      <path d="M4 12h10M11 9l3 3-3 3" />
    </svg>
  );
}
