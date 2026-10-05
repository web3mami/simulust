"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useSession } from "@/components/auth-gate";

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

  const initial = session.display.trim().charAt(0).toUpperCase() || "U";

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-label="Account menu"
        aria-expanded={open}
        className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-white/10 text-sm font-medium"
        onClick={() => setOpen((value) => !value)}
      >
        {initial}
      </button>
      {open ? (
        <div className="absolute right-0 z-50 mt-2 w-52 overflow-hidden rounded-2xl border border-white/10 bg-[#1B1916] py-2">
          <MenuList
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

function MenuList({ onLogout }: { onLogout: () => void }) {
  return (
    <>
      <MenuRow
        label="Subscription"
        icon={
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
            <path d="M12 3.2 20 8v8l-8 4.8L4 16V8z" />
          </svg>
        }
      />
      <MenuRow
        label="Credits"
        icon={
          <svg viewBox="0 0 24 24" className="h-5 w-5 text-[var(--gold)]" fill="currentColor">
            <path d="m12 3 2.1 6.4H21l-5.4 3.9 2.1 6.4L12 16.8 6.3 19.7l2.1-6.4L3 9.4h6.9z" />
          </svg>
        }
      />
      <MenuRow
        label="Settings"
        icon={
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6">
            <circle cx="12" cy="12" r="3" />
            <path d="M12 4.5v1.6M12 17.9v1.6M4.5 12h1.6M17.9 12h1.6M6.6 6.6l1.1 1.1M16.3 16.3l1.1 1.1M17.4 6.6l-1.1 1.1M7.7 16.3l-1.1 1.1" />
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
  onClick,
}: {
  label: string;
  icon: ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-[var(--ink)] hover:bg-white/5"
      onClick={onClick}
    >
      <span className="flex h-5 w-5 items-center justify-center text-[var(--ink)]">{icon}</span>
      {label}
    </button>
  );
}
