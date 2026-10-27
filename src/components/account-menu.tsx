"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useSession } from "@/components/auth-gate";
import { AdminIcon, CoinIcon, SettingsIcon, ShieldIcon, SignOutIcon, UserIcon } from "@/components/icons";
import { buttonClass } from "@/components/ui";
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
        <button type="button" className={buttonClass("secondary", "md", "h-9")} onClick={openLogin}>
          Log in
        </button>
        <button type="button" className={buttonClass("primary", "md", "h-9")} onClick={openSignup}>
          <span className="sm:hidden">Join free</span>
          <span className="hidden sm:inline">Create free account</span>
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
        className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-[var(--accent-soft)] text-sm font-bold text-[var(--accent)] ring-2 ring-[var(--accent)]/60"
        onClick={() => setOpen((value) => !value)}
      >
        {initial}
      </button>
      {open ? (
        <div className="absolute right-0 z-50 mt-2 w-64 overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--bg-2)] py-2 shadow-[0_16px_40px_rgba(0,0,0,0.55)]">
          <div className="border-b border-[var(--line)] px-4 pb-3 pt-1">
            <p className="truncate text-sm font-medium text-[var(--ink)]">{label}</p>
            {me ? (
              <>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  <span className="font-semibold text-[var(--premium)]">{me.balance.toLocaleString()}</span> credits
                  {me.isMember ? " · Member" : ""}
                </p>
                <Link
                  href="/verify"
                  onClick={close}
                  className={`mt-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] ${
                    me.ageVerified ? "bg-white/10 text-[var(--ink)]" : "border border-[var(--accent)]/50 text-[var(--accent)]"
                  }`}
                >
                  <span
                    aria-hidden
                    className={`h-1.5 w-1.5 rounded-full ${me.ageVerified ? "bg-emerald-400" : "bg-[var(--accent)]"}`}
                  />
                  {AGE_LABEL[me.ageStatus]}
                </Link>
              </>
            ) : (
              <p className="mt-1 text-xs text-[var(--muted)]">Loading your account…</p>
            )}
          </div>
          <MenuRow href="/profile" onClick={close} label="Profile" icon={<UserIcon />} />
          <MenuRow href="/settings" onClick={close} label="Settings" icon={<SettingsIcon />} />
          {me && !me.ageVerified ? (
            <MenuRow href="/verify" onClick={close} label="Verify age" icon={<ShieldIcon />} />
          ) : null}
          <MenuRow
            href="/premium"
            onClick={close}
            label="Credits"
            icon={<CoinIcon className="h-5 w-5 text-[var(--premium)]" />}
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
