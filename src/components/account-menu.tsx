"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useSession } from "@/components/auth-gate";
import { loadProfile } from "@/lib/profile";

export function AccountMenu() {
  const { session, signOut, openLogin, openSignup } = useSession();
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

  const profile = session ? loadProfile(session.detail) : null;
  const label = profile?.name || session.display;
  const initial = label.trim().charAt(0).toUpperCase() || "U";

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-label="Account menu"
        aria-expanded={open}
        className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-white/15 bg-white/10 text-sm font-medium"
        onClick={() => setOpen((value) => !value)}
      >
        {profile?.photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={profile.photo} alt="" className="h-full w-full object-cover" />
        ) : (
          initial
        )}
      </button>
      {open ? (
        <div className="absolute right-0 z-50 mt-2 w-52 overflow-hidden rounded-2xl border border-white/10 bg-[#1B1916] py-2">
          <MenuList
            onNavigate={() => setOpen(false)}
            onLogout={() => {
              setOpen(false);
              signOut();
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

function MenuList({
  onLogout,
  onNavigate,
}: {
  onLogout: () => void;
  onNavigate: () => void;
}) {
  return (
    <>
      <MenuRow
        href="/packs"
        onClick={onNavigate}
        label="Packs"
        icon={
          <svg viewBox="0 0 24 24" className="h-5 w-5 text-[var(--gold)]" fill="currentColor">
            <path d="m12 3 2.1 6.4H21l-5.4 3.9 2.1 6.4L12 16.8 6.3 19.7l2.1-6.4L3 9.4h6.9z" />
          </svg>
        }
      />
      <MenuRow
        href="/premium"
        onClick={onNavigate}
        label="Premium"
        icon={
          <svg viewBox="0 0 24 24" className="h-5 w-5 text-[var(--gold)]" fill="currentColor">
            <path d="M12 3.2 20 8v8l-8 4.8L4 16V8z" />
          </svg>
        }
      />
      <MenuRow
        href="/profile"
        onClick={onNavigate}
        label="Profile"
        icon={
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6">
            <circle cx="12" cy="8" r="3" />
            <path d="M5.5 19c1.4-3 4-4.5 6.5-4.5S17.1 16 18.5 19" />
          </svg>
        }
      />
      <MenuRow
        label="Logout"
        icon={
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M10 7V5.8A1.8 1.8 0 0 1 11.8 4h6.4A1.8 1.8 0 0 1 20 5.8v12.4a1.8 1.8 0 0 1-1.8 1.8h-6.4A1.8 1.8 0 0 1 10 18.2V17" />
            <path d="M4 12h10M11 9l3 3-3 3" />
          </svg>
        }
        onClick={onLogout}
      />
    </>
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
