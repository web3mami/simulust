"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useDeviceRefused } from "@/components/age-gate";
import { useSession } from "@/components/auth-gate";
import {
  AdminIcon,
  CoinIcon,
  GalleryIcon,
  HeartIcon,
  SettingsIcon,
  ShieldIcon,
  SignOutIcon,
  UserIcon,
} from "@/components/icons";
import { preloadLoginArt } from "@/components/login-screen";
import { PremiumIcon } from "@/components/premium-icon";
import { cx } from "@/components/ui";
import { useWalletStatus, walletStatusOf } from "@/components/wallet-sync";
import { ageLine, shortAddress, walletOf, type AgeLine } from "@/lib/session";

// The dot beside the age line.
export const AGE_DOT: Record<AgeLine["tone"], string> = {
  ok: "bg-emerald-400",
  hold: "bg-sky-300",
  pending: "animate-pulse bg-sky-300 motion-reduce:animate-none",
  todo: "bg-[var(--accent)]",
};

// The filled avatar used for the signed-in person everywhere (top bar, menu,
// profile), so it always reads as the same person.
export const AVATAR_FILL =
  "bg-gradient-to-br from-[var(--accent)] to-[var(--accent-2)] font-bold text-white ring-2 ring-white/10";

// Dropdown behaviour shared by the account menu and the phone lane menu:
// focus moves into the menu, arrows walk its items, Escape closes it and
// returns focus to the button, and a tap outside closes it.
export function useMenu(open: boolean, setOpen: (open: boolean) => void) {
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const items = () => Array.from(panel.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []);
    const first = items();
    const start =
      first.find((item) => item.getAttribute("aria-checked") === "true") ??
      first.find((item) => item.hasAttribute("data-menu-start")) ??
      first[0];
    start?.focus({ preventScroll: true });

    function onKey(event: KeyboardEvent) {
      const list = items();
      const index = list.indexOf(document.activeElement as HTMLElement);
      const move = (next: number) => {
        event.preventDefault();
        list[(next + list.length) % list.length]?.focus();
      };
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        trigger.current?.focus();
      } else if (event.key === "ArrowDown") move(index + 1);
      else if (event.key === "ArrowUp") move(index < 0 ? -1 : index - 1);
      else if (event.key === "Home") move(0);
      else if (event.key === "End") move(-1);
      else if (event.key === "Tab") setOpen(false);
    }
    function onPointer(event: PointerEvent) {
      const target = event.target as Node;
      if (!panel.current?.contains(target) && !trigger.current?.contains(target)) setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open, setOpen]);

  return { trigger, panel };
}

// Log in / Join in the top bar. Written out rather than via buttonClass so
// the 36px height and tighter phone padding don't fight its size presets.
const SIGNED_OUT_BUTTON =
  "inline-flex h-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold transition-[background-color,color,transform] duration-150 active:scale-[0.97] motion-reduce:active:scale-100";

export function AccountMenu({ lane }: { lane?: string }) {
  const { ready, session, me, signOut, openLogin, openSignup } = useSession();
  const wallet = useWalletStatus();
  const refused = useDeviceRefused();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const { trigger, panel } = useMenu(open, setOpen);

  // Until the login provider knows who this is, hold the avatar's place:
  // signed-in people shouldn't see "Log in" flash first.
  if (!ready) {
    return <span aria-hidden className="block h-10 w-10 animate-pulse rounded-full bg-[var(--surface-2)] motion-reduce:animate-none" />;
  }

  // A device the age check turned away is offered no way to sign up or log in
  // (the open pages it can still read show the top bar).
  if (!session && refused) return null;

  if (!session) {
    // Fetch the sign-up art as soon as someone shows intent, so the modal opens complete.
    const warm = () => preloadLoginArt(lane);
    return (
      <div className="flex items-center gap-1.5 sm:gap-2">
        <button
          type="button"
          className={cx(
            SIGNED_OUT_BUTTON,
            "px-3 text-[var(--ink)] hover:bg-white/[0.06] sm:border sm:border-[var(--line)] sm:bg-[var(--surface)] sm:px-4 sm:hover:bg-[var(--surface-2)]",
          )}
          onPointerEnter={warm}
          onFocus={warm}
          onClick={openLogin}
        >
          Log in
        </button>
        <button
          type="button"
          className={cx(
            SIGNED_OUT_BUTTON,
            "bg-[var(--accent)] px-3.5 text-[var(--accent-ink)] shadow-[0_6px_18px_rgba(255,79,139,0.3)] hover:bg-[var(--accent-2)] sm:px-4",
          )}
          onPointerEnter={warm}
          onFocus={warm}
          onClick={openSignup}
        >
          <span className="sm:hidden">Join free</span>
          <span className="hidden sm:inline">Create free account</span>
        </button>
      </div>
    );
  }

  const label = session.display;
  // The initial waits for the account so it never switches letters mid-load.
  const initial = me ? label.trim().charAt(0).toUpperCase() || "U" : "";
  const close = () => setOpen(false);
  const age = me ? ageLine(me) : null;
  // The live wallet only while it's this account's, never the one before.
  const address = walletOf(me) ?? walletStatusOf(wallet, me?.id).address;

  function copyAddress(value: string) {
    void navigator.clipboard
      .writeText(value)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => undefined);
  }

  return (
    <div className="relative">
      <button
        ref={trigger}
        type="button"
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? "account-menu" : undefined}
        className={cx(
          "flex h-10 w-10 items-center justify-center overflow-hidden rounded-full text-sm transition-transform duration-150 active:scale-95 motion-reduce:active:scale-100",
          AVATAR_FILL,
          !me && "animate-pulse motion-reduce:animate-none",
        )}
        onClick={() => setOpen(!open)}
      >
        {initial}
      </button>
      {open ? (
        <div
          ref={panel}
          id="account-menu"
          role="menu"
          aria-label="Account"
          className="animate-menu-in absolute right-0 z-50 mt-2 w-[min(18rem,calc(100vw-1rem))] origin-top-right overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--bg-2)] shadow-[0_20px_50px_rgba(0,0,0,0.6)]"
        >
          <div className="flex items-center gap-3 px-4 pb-3 pt-4">
            <span aria-hidden className={cx("flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-base", AVATAR_FILL)}>
              {initial}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-[var(--ink)]">{label}</p>
              {me?.username && label !== me.username ? (
                <p className="truncate text-xs text-[var(--muted)]">@{me.username}</p>
              ) : null}
              {me ? (
                <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[var(--muted)]">
                  {me.isMember ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-[var(--premium)] to-[var(--premium-2)] px-2 py-0.5 font-bold text-[#1a1206]">
                      <PremiumIcon className="h-3 w-3" />
                      Premium
                    </span>
                  ) : (
                    <span className="rounded-full bg-white/[0.08] px-2 py-0.5 font-semibold text-[var(--ink)]">Free</span>
                  )}
                  {age ? (
                    <span className="inline-flex items-center gap-1">
                      <span aria-hidden className={cx("h-1.5 w-1.5 rounded-full", AGE_DOT[age.tone])} />
                      {age.label}
                    </span>
                  ) : null}
                </p>
              ) : (
                <p className="mt-1 text-xs text-[var(--muted)]">Loading your account…</p>
              )}
            </div>
          </div>

          {address ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => copyAddress(address)}
              aria-label={copied ? "Wallet address copied" : `Copy wallet address ${address}`}
              className="mx-3 mb-2 flex min-h-10 w-[calc(100%-1.5rem)] items-center gap-3 rounded-xl bg-[var(--surface)] py-2 pl-3 pr-3 text-left text-sm transition-colors hover:bg-[var(--surface-2)] focus-visible:-outline-offset-2"
            >
              <span className="min-w-0 flex-1 text-[var(--muted)]">
                Wallet <span className="font-mono text-xs text-[var(--ink)]">{shortAddress(address)}</span>
              </span>
              <span className="text-xs font-semibold text-[var(--accent)]">{copied ? "Copied" : "Copy"}</span>
            </button>
          ) : null}

          {me ? (
            <div className="mx-3 mb-2 flex items-center gap-3 rounded-xl bg-[var(--surface)] py-2 pl-3 pr-2">
              <CoinIcon className="h-5 w-5 text-[var(--premium)]" />
              <p className="min-w-0 flex-1 text-sm text-[var(--muted)]">
                <span className="font-bold tabular-nums text-[var(--ink)]">{me.balance.toLocaleString()}</span> credits
              </p>
              <Link
                href="/packs"
                role="menuitem"
                onClick={close}
                className="inline-flex h-8 items-center rounded-full bg-gradient-to-r from-[var(--premium)] to-[var(--premium-2)] px-3.5 text-xs font-bold !text-[#1a1206] transition-[filter,transform] hover:brightness-110 active:scale-95 motion-reduce:active:scale-100"
              >
                Buy
              </Link>
            </div>
          ) : null}

          <div className="border-t border-[var(--line)] py-1.5">
            <MenuRow href="/my-ai" onClick={close} label="My AI" icon={<HeartIcon />} start />
            <MenuRow href="/collection" onClick={close} label="Collection" icon={<GalleryIcon />} />
          </div>
          <div className="border-t border-[var(--line)] py-1.5">
            <MenuRow href="/profile" onClick={close} label="Profile" icon={<UserIcon />} />
            <MenuRow href="/settings" onClick={close} label="Settings" icon={<SettingsIcon />} />
            {age?.href ? (
              <MenuRow href={age.href} onClick={close} label={age.label} icon={<ShieldIcon />} accent />
            ) : null}
            {me?.isAdmin ? <MenuRow href="/admin" onClick={close} label="Admin" icon={<AdminIcon />} /> : null}
          </div>
          <div className="border-t border-[var(--line)] py-1.5">
            <MenuRow
              label="Log out"
              icon={<SignOutIcon />}
              onClick={() => {
                close();
                signOut();
              }}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MenuRow({
  label,
  icon,
  href,
  accent,
  start,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  href?: string;
  accent?: boolean;
  // Where keyboard focus lands when the menu opens.
  start?: boolean;
  onClick?: () => void;
}) {
  const className = cx(
    "flex min-h-11 w-full items-center gap-3 px-4 text-left text-sm transition-colors hover:bg-white/[0.06] focus-visible:bg-white/[0.06] focus-visible:-outline-offset-2 active:bg-white/[0.1]",
    accent ? "font-semibold !text-[var(--accent)]" : "!text-[var(--ink)]",
  );
  const inner = (
    <>
      <span className={cx("flex h-5 w-5 items-center justify-center", accent ? "text-[var(--accent)]" : "text-[var(--muted)]")}>
        {icon}
      </span>
      {label}
    </>
  );

  if (href) {
    return (
      <Link href={href} role="menuitem" data-menu-start={start || undefined} className={className} onClick={onClick}>
        {inner}
      </Link>
    );
  }

  return (
    <button type="button" role="menuitem" className={className} onClick={onClick}>
      {inner}
    </button>
  );
}
