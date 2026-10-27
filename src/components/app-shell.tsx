"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { AccountMenu } from "@/components/account-menu";
import { useSession } from "@/components/auth-gate";
import {
  ChatIcon,
  ChevronDownIcon,
  CloseIcon,
  CoinIcon,
  CompassIcon,
  FemaleIcon,
  FlagIcon,
  GalleryIcon,
  HeartIcon,
  HomeIcon,
  MaleIcon,
  MenuIcon,
  PlusCircleIcon,
  PlusIcon,
  ShieldIcon,
  SparkIcon,
} from "@/components/icons";
import { PremiumIcon } from "@/components/premium-icon";
import { cx } from "@/components/ui";
import type { Lane } from "@/lib/characters";

// ---------------------------------------------------------------------------
// Girls / Anime / Guys: picked in the top bar, remembered on this device, and
// read by any page that lists characters.

const LANES: { id: Lane; label: string; icon: ReactNode }[] = [
  { id: "girls", label: "Girls", icon: <FemaleIcon className="h-4 w-4" /> },
  { id: "anime", label: "Anime", icon: <SparkIcon className="h-4 w-4" /> },
  { id: "guys", label: "Guys", icon: <MaleIcon className="h-4 w-4" /> },
];

const LANE_KEY = "simulust-lane";

const LaneContext = createContext<{ lane: Lane; setLane: (lane: Lane) => void }>({
  lane: "girls",
  setLane: () => {},
});

export function useLane() {
  return useContext(LaneContext);
}

function useStoredLane() {
  const [lane, setLaneState] = useState<Lane>("girls");
  useEffect(() => {
    try {
      const saved = localStorage.getItem(LANE_KEY);
      // Restoring a saved choice once on mount.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved === "girls" || saved === "anime" || saved === "guys") setLaneState(saved);
    } catch {
      // Storage blocked (private window): keep the default.
    }
  }, []);
  const setLane = useCallback((next: Lane) => {
    setLaneState(next);
    try {
      localStorage.setItem(LANE_KEY, next);
    } catch {
      // Not remembered, but still applied.
    }
  }, []);
  return { lane, setLane };
}

// ---------------------------------------------------------------------------
// Navigation

type NavItem = { href: string; label: string; icon: ReactNode; match: (pathname: string) => boolean };

const NAV: NavItem[] = [
  { href: "/", label: "Home", icon: <HomeIcon />, match: (p) => p === "/" },
  { href: "/discover", label: "Discover", icon: <CompassIcon />, match: (p) => p.startsWith("/discover") },
  { href: "/chat", label: "Chat", icon: <ChatIcon />, match: (p) => p.startsWith("/chat") || p.startsWith("/date") },
  { href: "/collection", label: "Collection", icon: <GalleryIcon />, match: (p) => p.startsWith("/collection") },
  { href: "/create", label: "Create Character", icon: <PlusCircleIcon />, match: (p) => p.startsWith("/create") },
  {
    href: "/my-ai",
    label: "My AI",
    icon: <HeartIcon />,
    match: (p) => p.startsWith("/my-ai") || p.startsWith("/memories"),
  },
];

const PREMIUM_MATCH = (p: string) => p.startsWith("/premium") || p.startsWith("/packs") || p.startsWith("/pricing");

const HELP = [
  { href: "/safety", label: "Help & safety", icon: <ShieldIcon /> },
  { href: "/report", label: "Report content", icon: <FlagIcon /> },
];

const LEGAL = [
  { href: "/terms", label: "Terms" },
  { href: "/privacy", label: "Privacy" },
  { href: "/content-policy", label: "Content policy" },
  { href: "/2257", label: "2257" },
  { href: "/dmca", label: "DMCA" },
  { href: "/pricing", label: "Pricing" },
];

function Logo({ onClick }: { onClick?: () => void }) {
  return (
    <Link href="/" onClick={onClick} className="shrink-0 text-xl font-extrabold tracking-tight text-[var(--ink)]">
      simu<span className="text-[var(--accent)]">lust</span>
    </Link>
  );
}

function LaneTabs({ compact }: { compact?: boolean }) {
  const { lane, setLane } = useLane();
  const pathname = usePathname();
  const router = useRouter();
  return (
    <div className="flex items-center gap-1" role="tablist" aria-label="Show characters">
      {LANES.map((item) => {
        const on = lane === item.id;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => {
              setLane(item.id);
              // The tabs choose what the character pages show, so elsewhere they go there.
              if (pathname !== "/" && !pathname.startsWith("/discover")) router.push("/");
            }}
            className={cx(
              "flex items-center gap-1.5 rounded-full font-semibold transition-colors",
              compact ? "h-8 px-2.5 text-xs" : "h-9 px-4 text-sm",
              on ? "bg-[var(--accent-soft)] text-[var(--accent)]" : "text-[var(--muted)] hover:text-[var(--ink)]",
            )}
          >
            {item.icon}
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

// Phones have no room for three tabs: the current lane, with the others in a menu.
function LaneMenu() {
  const { lane, setLane } = useLane();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const current = LANES.find((item) => item.id === lane) ?? LANES[0];
  return (
    <div className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Showing ${current.label}. Change`}
        onClick={() => setOpen((value) => !value)}
        className="flex h-10 items-center gap-1 rounded-full px-2 text-[var(--accent)] hover:bg-white/5"
      >
        {current.icon}
        <ChevronDownIcon className="h-4 w-4" />
      </button>
      {open ? (
        <>
          <button type="button" aria-label="Close" className="fixed inset-0 z-40 cursor-default" onClick={() => setOpen(false)} />
          <div role="menu" className="absolute left-0 z-50 mt-1 w-40 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--bg-2)] py-1 shadow-[0_16px_40px_rgba(0,0,0,0.55)]">
            {LANES.map((item) => (
              <button
                key={item.id}
                type="button"
                role="menuitemradio"
                aria-checked={item.id === lane}
                onClick={() => {
                  setLane(item.id);
                  setOpen(false);
                  if (pathname !== "/" && !pathname.startsWith("/discover")) router.push("/");
                }}
                className={cx(
                  "flex h-11 w-full items-center gap-2 px-3 text-sm font-semibold",
                  item.id === lane ? "text-[var(--accent)]" : "text-[var(--ink)] hover:bg-white/5",
                )}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

function TopBar({ onMenu }: { onMenu: () => void }) {
  const { me } = useSession();
  return (
    <header className="sticky top-0 z-40 flex h-16 shrink-0 items-center gap-3 border-b border-[var(--line)] bg-[var(--bg-2)]/95 px-3 backdrop-blur sm:px-4">
      <button
        type="button"
        aria-label="Menu"
        onClick={onMenu}
        className="flex h-10 w-10 items-center justify-center rounded-xl text-[var(--ink)] hover:bg-white/5"
      >
        <MenuIcon className="h-6 w-6" />
      </button>
      <Logo />
      <div className="md:hidden">
        <LaneMenu />
      </div>
      <div className="ml-4 hidden md:block">
        <LaneTabs />
      </div>
      <div className="ml-auto flex items-center gap-2">
        {me ? (
          <Link
            href="/premium"
            className="hidden h-9 items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--surface-2)] sm:flex"
            title="Your credits"
          >
            <CoinIcon className="h-4 w-4 text-[var(--premium)]" />
            {me.balance.toLocaleString()}
          </Link>
        ) : null}
        {me?.isMember ? null : (
          <Link
            href="/premium"
            className="hidden h-9 items-center gap-1.5 rounded-full bg-gradient-to-r from-[var(--premium)] to-[var(--premium-2)] px-4 text-sm font-bold text-[#1a1206] hover:brightness-110 lg:flex"
          >
            <PremiumIcon className="h-4 w-4" />
            Premium
          </Link>
        )}
        <AccountMenu />
      </div>
    </header>
  );
}

function NavLink({
  item,
  collapsed,
  active,
  onClick,
}: {
  item: { href: string; label: string; icon: ReactNode };
  collapsed?: boolean;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <Link
      href={item.href}
      onClick={onClick}
      title={collapsed ? item.label : undefined}
      aria-current={active ? "page" : undefined}
      className={cx(
        "flex h-11 items-center rounded-xl text-sm font-medium transition-colors",
        collapsed ? "justify-center" : "gap-3 px-3",
        active ? "bg-[var(--surface-2)] text-[var(--ink)]" : "text-[var(--muted)] hover:bg-white/5 hover:text-[var(--ink)]",
      )}
    >
      <span className={active ? "text-[var(--accent)]" : undefined}>{item.icon}</span>
      {collapsed ? <span className="sr-only">{item.label}</span> : <span className="truncate">{item.label}</span>}
    </Link>
  );
}

function PremiumLink({ collapsed, active, onClick }: { collapsed?: boolean; active?: boolean; onClick?: () => void }) {
  return (
    <Link
      href="/premium"
      onClick={onClick}
      title={collapsed ? "Premium" : undefined}
      aria-current={active ? "page" : undefined}
      className={cx(
        "flex h-11 items-center rounded-xl text-sm font-bold text-[var(--premium)] transition-colors hover:bg-[var(--premium)]/10",
        collapsed ? "justify-center" : "gap-3 px-3",
        active && "bg-[var(--premium)]/10",
      )}
    >
      <PremiumIcon className="h-5 w-5" />
      {collapsed ? <span className="sr-only">Premium</span> : <span>Premium</span>}
    </Link>
  );
}

function NavList({ collapsed, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex flex-col gap-1">
      {NAV.map((item) => (
        <NavLink key={item.href} item={item} collapsed={collapsed} active={item.match(pathname)} onClick={onNavigate} />
      ))}
      <PremiumLink collapsed={collapsed} active={PREMIUM_MATCH(pathname)} onClick={onNavigate} />
    </nav>
  );
}

function HelpList({ collapsed, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <div className="flex flex-col gap-1">
      {HELP.map((item) => (
        <NavLink key={item.href} item={item} collapsed={collapsed} active={pathname.startsWith(item.href)} onClick={onNavigate} />
      ))}
    </div>
  );
}

function LegalLinks({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="px-3 text-[11px] leading-5 text-[var(--muted)]">
      <nav aria-label="Legal" className="flex flex-wrap gap-x-3 gap-y-1">
        {LEGAL.map((link) => (
          <Link key={link.href} href={link.href} onClick={onNavigate} className="hover:text-[var(--ink)]">
            {link.label}
          </Link>
        ))}
      </nav>
      <p className="mt-2">18+ only. Every character is a fictional adult and every image is AI-generated.</p>
    </div>
  );
}

const COLLAPSED_KEY = "simulust-sidebar-collapsed";

function Sidebar({ collapsed }: { collapsed: boolean }) {
  return (
    <aside
      className={cx(
        "sticky top-16 hidden h-[calc(100dvh-4rem)] shrink-0 flex-col overflow-y-auto border-r border-[var(--line)] bg-[var(--bg-2)] py-4 lg:flex",
        collapsed ? "w-[76px] px-3" : "w-60 px-3",
      )}
    >
      <NavList collapsed={collapsed} />
      <div className="mt-auto flex flex-col gap-4 pt-6">
        <HelpList collapsed={collapsed} />
        {collapsed ? null : <LegalLinks />}
      </div>
    </aside>
  );
}

function Drawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
      <button type="button" aria-label="Close menu" className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="absolute inset-y-0 left-0 flex w-[min(20rem,85vw)] flex-col overflow-y-auto border-r border-[var(--line)] bg-[var(--bg-2)] p-4">
        <div className="flex items-center justify-between">
          <Logo onClick={onClose} />
          <button
            type="button"
            aria-label="Close menu"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-xl text-[var(--ink)] hover:bg-white/5"
          >
            <CloseIcon />
          </button>
        </div>
        <div className="mt-4">
          <LaneTabs compact />
        </div>
        <div className="mt-5">
          <NavList onNavigate={onClose} />
        </div>
        <div className="mt-auto flex flex-col gap-4 pt-6">
          <HelpList onNavigate={onClose} />
          <LegalLinks onNavigate={onClose} />
        </div>
      </div>
    </div>
  );
}

// A floating bar on phones: the four places people go most, with Create in the middle.
function BottomBar() {
  const pathname = usePathname();
  const item = (href: string, label: string, icon: ReactNode, on: boolean) => (
    <Link
      href={href}
      aria-current={on ? "page" : undefined}
      className={cx(
        "flex flex-1 flex-col items-center gap-0.5 py-1.5 text-[10px] font-semibold",
        on ? "text-[var(--accent)]" : "text-[var(--muted)]",
      )}
    >
      {icon}
      {label}
    </Link>
  );
  return (
    <nav
      aria-label="Quick links"
      className="fixed inset-x-3 bottom-3 z-40 flex items-center rounded-full border border-[var(--line)] bg-[var(--bg-2)]/95 px-2 py-1.5 shadow-[0_10px_30px_rgba(0,0,0,0.5)] backdrop-blur lg:hidden"
    >
      {item("/", "Home", <HomeIcon />, pathname === "/")}
      {item("/discover", "Discover", <CompassIcon />, pathname.startsWith("/discover"))}
      <Link href="/create" aria-label="Create a character" className="flex flex-1 justify-center">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--accent-ink)] shadow-[0_6px_18px_rgba(255,79,139,0.45)]">
          <PlusIcon className="h-6 w-6" />
        </span>
      </Link>
      {item("/chat", "Chat", <ChatIcon />, pathname.startsWith("/chat") || pathname.startsWith("/date"))}
      <Link
        href="/premium"
        aria-current={PREMIUM_MATCH(pathname) ? "page" : undefined}
        className="flex flex-1 flex-col items-center gap-0.5 py-1.5 text-[10px] font-bold text-[var(--premium)]"
      >
        <PremiumIcon className="h-5 w-5" />
        Premium
      </Link>
    </nav>
  );
}

// Screens that need the whole height (a conversation) drop the phone bar and
// size their own scrolling area. The creator keeps its own Back/Next bar where
// the phone bar would be.
const FULL_HEIGHT = (pathname: string) => pathname.startsWith("/date/");
const NO_BOTTOM_BAR = (pathname: string) => FULL_HEIGHT(pathname) || pathname.startsWith("/create");

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const lanes = useStoredLane();
  const [drawer, setDrawer] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const full = FULL_HEIGHT(pathname);
  const bottomBar = !NO_BOTTOM_BAR(pathname);

  useEffect(() => {
    try {
      // Restoring the remembered sidebar width once on mount.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCollapsed(localStorage.getItem(COLLAPSED_KEY) === "1");
    } catch {
      // Storage blocked: start expanded.
    }
  }, []);

  function toggleMenu() {
    // Wide screens fold the sidebar; narrow ones open the drawer.
    if (window.matchMedia("(min-width: 1024px)").matches) {
      setCollapsed((value) => {
        try {
          localStorage.setItem(COLLAPSED_KEY, value ? "0" : "1");
        } catch {
          // Not remembered.
        }
        return !value;
      });
    } else {
      setDrawer(true);
    }
  }

  return (
    <LaneContext.Provider value={lanes}>
      <div className="min-h-dvh bg-[var(--bg)] text-[var(--ink)]">
        <TopBar onMenu={toggleMenu} />
        <div className="flex">
          <Sidebar collapsed={collapsed} />
          <main className={cx("min-w-0 flex-1", full && "h-[calc(100dvh-4rem)]", bottomBar && "pb-24 lg:pb-0")}>{children}</main>
        </div>
        {bottomBar ? <BottomBar /> : null}
        <Drawer open={drawer} onClose={() => setDrawer(false)} />
      </div>
    </LaneContext.Provider>
  );
}

// Layout for legal and policy pages: plain reading width, consistent headings.
export function DocPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <AppShell>
      <article className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
        <p className="rounded-xl border border-[var(--premium)]/40 bg-[var(--premium)]/10 px-4 py-3 text-sm text-[var(--premium)]">
          Draft: have counsel review before launch.
        </p>
        <h1 className="mt-8 text-3xl font-bold tracking-tight text-[var(--ink)] sm:text-4xl">{title}</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">Last updated {updated}</p>
        <div className="mt-6 text-[15px] leading-7 text-[var(--muted)] [&_a]:text-[var(--accent)] [&_a]:underline [&_a]:underline-offset-2 [&_h2]:mt-10 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-[var(--ink)] [&_h3]:mt-6 [&_h3]:font-semibold [&_h3]:text-[var(--ink)] [&_li]:mt-1.5 [&_ol]:mt-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:mt-3 [&_strong]:text-[var(--ink)] [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-5">
          {children}
        </div>
      </article>
    </AppShell>
  );
}
