"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from "react";
import { AccountMenu, useMenu } from "@/components/account-menu";
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
import { PAGE_GUTTER, cx } from "@/components/ui";
import type { Lane } from "@/lib/characters";
import { MEMBERSHIP } from "@/lib/pricing";

// ---------------------------------------------------------------------------
// Girls / Anime / Guys: picked in the top bar, remembered on this device, and
// read by any page that lists characters.

const LANES: { id: Lane; label: string; icon: ReactNode }[] = [
  { id: "girls", label: "Girls", icon: <FemaleIcon className="h-4 w-4" /> },
  { id: "anime", label: "Anime", icon: <SparkIcon className="h-4 w-4" /> },
  { id: "guys", label: "Guys", icon: <MaleIcon className="h-4 w-4" /> },
];

// Also the cookie name the root layout reads, so the server renders the saved lane.
const LANE_KEY = "simulust-lane";

function isLane(value: unknown): value is Lane {
  return value === "girls" || value === "anime" || value === "guys";
}

type LaneValue = { lane: Lane; setLane: (lane: Lane) => void };

const LaneContext = createContext<LaneValue | null>(null);
const NO_LANE: LaneValue = { lane: "girls", setLane: () => {} };

export function useLane() {
  return useContext(LaneContext) ?? NO_LANE;
}

function rememberLane(lane: Lane) {
  try {
    localStorage.setItem(LANE_KEY, lane);
    // The cookie lets the server render this lane on the next hard load.
    document.cookie = `${LANE_KEY}=${lane}; path=/; max-age=31536000; samesite=lax`;
  } catch {
    // Not remembered, but still applied.
  }
}

// Above the login modal and the shell, so both read the same lane and it
// survives every navigation.
export function LaneProvider({ initialLane, children }: { initialLane?: string | null; children: ReactNode }) {
  const fromCookie = isLane(initialLane) ? initialLane : null;
  const [lane, setLaneState] = useState<Lane>(fromCookie ?? "girls");

  useEffect(() => {
    if (fromCookie) return;
    // No cookie yet (a choice saved before the cookie existed): restore it once.
    try {
      const saved = localStorage.getItem(LANE_KEY);
      if (isLane(saved)) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setLaneState(saved);
        rememberLane(saved);
      }
    } catch {
      // Storage blocked (private window): keep the default.
    }
  }, [fromCookie]);

  const setLane = useCallback((next: Lane) => {
    setLaneState(next);
    rememberLane(next);
  }, []);
  const value = useMemo(() => ({ lane, setLane }), [lane, setLane]);
  return <LaneContext.Provider value={value}>{children}</LaneContext.Provider>;
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
    <Link
      href="/"
      onClick={onClick}
      className="shrink-0 rounded-lg text-lg font-extrabold tracking-tight text-[var(--ink)] sm:text-xl"
    >
      simu<span className="text-[var(--accent)]">lust</span>
    </Link>
  );
}

// The tabs choose what the character pages show, so elsewhere they go there.
function useLaneSwitch() {
  const { lane, setLane } = useLane();
  const pathname = usePathname();
  const router = useRouter();
  const pick = (next: Lane) => {
    setLane(next);
    if (pathname !== "/" && !pathname.startsWith("/discover")) router.push("/");
  };
  return { lane, pick };
}

function LaneTabs({ compact }: { compact?: boolean }) {
  const { lane, pick } = useLaneSwitch();
  return (
    <div
      className={cx("flex items-center gap-1", compact && "rounded-full border border-[var(--line)] bg-[var(--surface)] p-1")}
      role="tablist"
      aria-label="Show characters"
    >
      {LANES.map((item) => {
        const on = lane === item.id;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => pick(item.id)}
            className={cx(
              "flex items-center justify-center gap-1.5 rounded-full font-semibold transition-[background-color,color,transform] duration-150 active:scale-95 motion-reduce:active:scale-100",
              compact ? "h-9 flex-1 px-2.5 text-[13px]" : "h-9 px-4 text-sm",
              on
                ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                : "text-[var(--muted)] hover:bg-white/[0.05] hover:text-[var(--ink)]",
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
  const { lane, pick } = useLaneSwitch();
  const [open, setOpen] = useState(false);
  const { trigger, panel } = useMenu(open, setOpen);
  const current = LANES.find((item) => item.id === lane) ?? LANES[0];
  return (
    <div className="relative">
      <button
        ref={trigger}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Showing ${current.label}. Change`}
        onClick={() => setOpen(!open)}
        className="flex h-10 items-center gap-1 rounded-full px-1.5 text-[var(--accent)] transition-[background-color,transform] hover:bg-white/5 active:scale-95 motion-reduce:active:scale-100"
      >
        {current.icon}
        <ChevronDownIcon className={cx("h-4 w-4 transition-transform duration-200", open && "rotate-180")} />
      </button>
      {open ? (
        <div
          ref={panel}
          role="menu"
          aria-label="Show characters"
          className="animate-menu-in absolute left-0 z-50 mt-1 w-44 origin-top-left overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--bg-2)] p-1 shadow-[0_16px_40px_rgba(0,0,0,0.55)]"
        >
          {LANES.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitemradio"
              aria-checked={item.id === lane}
              onClick={() => {
                pick(item.id);
                setOpen(false);
              }}
              className={cx(
                "flex h-11 w-full items-center gap-2.5 rounded-xl px-3 text-sm font-semibold transition-colors focus-visible:-outline-offset-2",
                item.id === lane
                  ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                  : "text-[var(--ink)] hover:bg-white/[0.06] active:bg-white/[0.1]",
              )}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function TopBar({
  menuButton,
  menuLabel,
  menuExpanded,
  menuControls,
  onMenu,
  phoneHidden,
}: {
  menuButton: RefObject<HTMLButtonElement | null>;
  menuLabel: string;
  menuExpanded: boolean;
  menuControls: string;
  onMenu: () => void;
  // A phone conversation has its own header; the site bar would only take room.
  phoneHidden?: boolean;
}) {
  const { ready, session, me } = useSession();
  const { lane } = useLane();
  // Premium sells itself to signed-out visitors and free accounts; members never see it.
  const showPremium = (ready && !session) || (me !== null && !me.isMember);
  return (
    <header
      className={cx(
        "sticky top-0 z-40 h-16 shrink-0 items-center gap-2 border-b border-[var(--line)] bg-[var(--bg-2)]/90 px-2 backdrop-blur-xl sm:gap-3 sm:px-4",
        phoneHidden ? "hidden lg:flex" : "flex",
      )}
    >
      <button
        ref={menuButton}
        type="button"
        aria-label={menuLabel}
        aria-expanded={menuExpanded}
        aria-controls={menuControls}
        onClick={onMenu}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[var(--ink)] transition-[background-color,transform] hover:bg-white/[0.06] active:scale-95 motion-reduce:active:scale-100"
      >
        <MenuIcon className="h-6 w-6" />
      </button>
      <Logo />
      <div className="md:hidden">
        <LaneMenu />
      </div>
      <div className="ml-2 hidden md:block">
        <LaneTabs />
      </div>
      <div className="ml-auto flex items-center gap-2">
        {showPremium ? (
          <Link
            href="/premium"
            className="hidden h-9 items-center gap-1.5 rounded-full bg-gradient-to-r from-[var(--premium)] to-[var(--premium-2)] px-4 text-sm font-bold !text-[#1a1206] shadow-[0_6px_20px_rgba(244,183,64,0.25)] transition-[filter,transform] hover:brightness-110 active:scale-95 motion-reduce:active:scale-100 lg:flex"
          >
            <PremiumIcon className="h-4 w-4" />
            Premium
          </Link>
        ) : null}
        {me ? (
          <Link
            href="/premium"
            aria-label={`${me.balance.toLocaleString()} credits. Get more`}
            className="flex h-9 items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--surface)] px-2.5 text-[13px] font-semibold tabular-nums text-[var(--ink)] transition-[background-color,transform] hover:bg-[var(--surface-2)] active:scale-95 motion-reduce:active:scale-100 sm:pr-1.5 sm:text-sm"
          >
            <CoinIcon className="h-4 w-4 text-[var(--premium)]" />
            {me.balance.toLocaleString()}
            <span
              aria-hidden
              className="ml-1 hidden h-6 w-6 items-center justify-center rounded-full bg-[var(--premium)]/20 text-[var(--premium)] sm:flex"
            >
              <PlusIcon className="h-3.5 w-3.5" />
            </span>
          </Link>
        ) : session ? (
          // Holds the balance's place while the account loads, so nothing jumps.
          <span aria-hidden className="h-9 w-[80px] animate-pulse rounded-full bg-[var(--surface)] motion-reduce:animate-none sm:w-[112px]" />
        ) : null}
        <AccountMenu lane={lane} />
      </div>
    </header>
  );
}

// One row of the sidebar or drawer. Active rows get the accent fill and a bar
// on the left edge; on the folded rail the label fades out and a tooltip names it.
const ROW =
  "group relative flex items-center gap-3 rounded-xl px-4 text-sm transition-[background-color,color,transform] duration-150 active:scale-[0.98] motion-reduce:active:scale-100";
const ACTIVE_BAR =
  "before:absolute before:left-0 before:top-1/2 before:h-5 before:w-[3px] before:-translate-y-1/2 before:rounded-r-full";
const LABEL = "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap transition-opacity duration-150 in-rail:opacity-0";

function RailTip({ label }: { label: string }) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute left-full top-1/2 z-10 ml-3 hidden -translate-y-1/2 whitespace-nowrap rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-1.5 text-xs font-semibold text-[var(--ink)] opacity-0 shadow-[0_8px_24px_rgba(0,0,0,0.5)] transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 in-rail:block"
    >
      {label}
    </span>
  );
}

function NavLink({
  item,
  active,
  onClick,
}: {
  item: { href: string; label: string; icon: ReactNode };
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <Link
      href={item.href}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cx(
        ROW,
        "h-11",
        active
          ? cx(ACTIVE_BAR, "bg-[var(--accent-soft)] font-semibold text-[var(--ink)] before:bg-[var(--accent)]")
          : "font-medium text-[var(--muted)] hover:bg-white/[0.06] hover:text-[var(--ink)] active:bg-white/[0.09]",
      )}
    >
      <span className={cx("transition-colors", active ? "text-[var(--accent)]" : undefined)}>{item.icon}</span>
      <span className={LABEL}>{item.label}</span>
      <RailTip label={item.label} />
    </Link>
  );
}

// Premium is a tile, not a plain row: members see when it runs until, everyone
// else one real reason to join.
function PremiumLink({ active, onClick }: { active?: boolean; onClick?: () => void }) {
  const { ready, session, me } = useSession();
  const loading = !ready || (session !== null && me === null);
  const until = me?.isMember && me.memberUntil
    ? new Date(me.memberUntil).toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : null;
  return (
    <Link
      href="/premium"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cx(
        ROW,
        "mt-2 min-h-11 bg-gradient-to-r from-[var(--premium)]/[0.16] to-[var(--premium-2)]/[0.06] py-2 ring-1 ring-inset hover:from-[var(--premium)]/25 hover:to-[var(--premium-2)]/10",
        active
          ? cx(ACTIVE_BAR, "ring-[var(--premium)]/55 before:bg-[var(--premium)]")
          : "ring-[var(--premium)]/25 hover:ring-[var(--premium)]/45",
      )}
    >
      <PremiumIcon className="h-5 w-5 shrink-0 text-[var(--premium)]" />
      <span className={cx(LABEL, "flex flex-col")}>
        <span className="text-sm font-bold text-[var(--premium)]">{me?.isMember ? "Premium" : "Go Premium"}</span>
        <span className="text-[11px] leading-4 text-[var(--muted)] in-rail:hidden">
          {loading ? (
            <span aria-hidden className="mt-1 block h-2.5 w-28 animate-pulse rounded-full bg-white/[0.08] motion-reduce:animate-none" />
          ) : me?.isMember ? (
            until ? `Member until ${until}` : "You're a member"
          ) : (
            `Unlimited messages + ${MEMBERSHIP.credits} credits`
          )}
        </span>
      </span>
      <RailTip label="Premium" />
    </Link>
  );
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex flex-col gap-1">
      {NAV.map((item) => (
        <NavLink key={item.href} item={item} active={item.match(pathname)} onClick={onNavigate} />
      ))}
      <PremiumLink active={PREMIUM_MATCH(pathname)} onClick={onNavigate} />
    </nav>
  );
}

function HelpList({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <div className="flex flex-col gap-1">
      {HELP.map((item) => (
        <NavLink key={item.href} item={item} active={pathname.startsWith(item.href)} onClick={onNavigate} />
      ))}
    </div>
  );
}

function LegalLinks({ onNavigate, roomy, className }: { onNavigate?: () => void; roomy?: boolean; className?: string }) {
  return (
    <div className={cx("px-3 text-[var(--muted)]", roomy ? "text-[13px] leading-6" : "text-[11px] leading-5", className)}>
      <nav aria-label="Legal" className={cx("flex flex-wrap gap-x-3", roomy ? "gap-y-1" : "gap-y-0.5")}>
        {LEGAL.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            onClick={onNavigate}
            className={cx("rounded transition-colors hover:text-[var(--ink)]", roomy ? "py-1.5" : "py-0.5")}
          >
            {link.label}
          </Link>
        ))}
      </nav>
      <p className="mt-2">18+ only. Every character is a fictional adult and every image is AI-generated.</p>
    </div>
  );
}

const COLLAPSED_KEY = "simulust-sidebar-collapsed";
// Conversations default to the folded rail so the chat gets the width; unfolding
// it there is remembered separately from the rest of the app.
const CHAT_COLLAPSED_KEY = "simulust-sidebar-chat";

function savedCollapsed(chat: boolean) {
  try {
    return chat ? localStorage.getItem(CHAT_COLLAPSED_KEY) !== "0" : localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return chat;
  }
}

function applyCollapsed(next: boolean) {
  if (next) document.documentElement.dataset.sidebar = "collapsed";
  else delete document.documentElement.dataset.sidebar;
}

// Its width comes from the html attribute (see the `rail` variants in
// globals.css), so the first paint is already right and folding animates.
function Sidebar() {
  return (
    <aside
      id="app-sidebar"
      aria-label="Sidebar"
      // Above pages' own sticky bars (z-30) so rail tooltips show, below the top bar.
      className="sticky top-16 z-[35] hidden h-[calc(100dvh-4rem)] w-60 shrink-0 flex-col overflow-y-auto overflow-x-hidden border-r border-[var(--line)] bg-[var(--bg-2)] px-3 py-4 transition-[width] duration-200 ease-out motion-reduce:transition-none lg:flex rail:w-[76px] rail:overflow-visible"
    >
      <NavList />
      <div className="mt-auto flex flex-col gap-4 pt-6">
        <HelpList />
        {/* A fixed width so the text doesn't reflow while the sidebar unfolds. */}
        <LegalLinks className="animate-fade-in w-[13.5rem] shrink-0 in-rail:hidden" />
      </div>
    </aside>
  );
}

function Drawer({
  open,
  onClose,
  returnFocus,
}: {
  open: boolean;
  onClose: () => void;
  returnFocus: RefObject<HTMLButtonElement | null>;
}) {
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    const overflow = root.style.overflow;
    // The page behind stays put while the menu is open.
    root.style.overflow = "hidden";
    closeButton.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const opener = returnFocus.current;
    return () => {
      document.removeEventListener("keydown", onKey);
      root.style.overflow = overflow;
      opener?.focus({ preventScroll: true });
    };
  }, [open, onClose, returnFocus]);

  // Always mounted so it can slide out as well as in; `inert` keeps the closed
  // panel out of the tab order and away from screen readers.
  return (
    <div
      id="app-drawer"
      className={cx("fixed inset-0 z-50 lg:hidden", !open && "pointer-events-none")}
      role="dialog"
      aria-modal="true"
      aria-label="Menu"
      inert={!open}
    >
      <button
        type="button"
        tabIndex={-1}
        aria-hidden
        className={cx(
          "absolute inset-0 bg-black/70 backdrop-blur-[2px] transition-opacity duration-200 motion-reduce:transition-none",
          open ? "opacity-100" : "opacity-0",
        )}
        onClick={onClose}
      />
      <div
        className={cx(
          "absolute inset-y-0 left-0 flex w-[min(20rem,85vw)] flex-col overflow-y-auto overscroll-contain border-r border-[var(--line)] bg-[var(--bg-2)] px-3 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))] shadow-[16px_0_48px_rgba(0,0,0,0.5)] transition-transform duration-[250ms] ease-[cubic-bezier(.2,.8,.2,1)] motion-reduce:transition-none",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex items-center justify-between pl-4">
          <Logo onClick={onClose} />
          <button
            ref={closeButton}
            type="button"
            aria-label="Close menu"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-xl text-[var(--ink)] transition-[background-color,transform] hover:bg-white/[0.06] active:scale-95 motion-reduce:active:scale-100"
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
          <LegalLinks roomy onNavigate={onClose} />
        </div>
      </div>
    </div>
  );
}

// Text fields that bring up the phone keyboard (not checkboxes or radios).
function isTypingField(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target.tagName === "TEXTAREA") return true;
  if (target.tagName !== "INPUT") return false;
  const type = (target as HTMLInputElement).type;
  return !["checkbox", "radio", "range", "button", "submit", "reset", "file", "color"].includes(type);
}

// A floating bar on phones: the four places people go most, with Create in the middle.
function BottomBar() {
  const pathname = usePathname();
  const [typing, setTyping] = useState(false);

  // Out of the way while the keyboard is up, so it never sits on a text field.
  useEffect(() => {
    const onIn = (event: FocusEvent) => isTypingField(event.target) && setTyping(true);
    const onOut = (event: FocusEvent) => !isTypingField(event.relatedTarget) && setTyping(false);
    document.addEventListener("focusin", onIn);
    document.addEventListener("focusout", onOut);
    return () => {
      document.removeEventListener("focusin", onIn);
      document.removeEventListener("focusout", onOut);
    };
  }, []);

  const item = (href: string, label: string, icon: ReactNode, on: boolean) => (
    <Link
      href={href}
      aria-current={on ? "page" : undefined}
      className={cx(
        "flex flex-1 flex-col items-center gap-0.5 rounded-full py-1 text-[11px] font-semibold transition-[color,transform] duration-150 active:scale-95 motion-reduce:active:scale-100",
        on ? "text-[var(--accent)]" : "text-[var(--muted)] hover:text-[var(--ink)]",
      )}
    >
      <span
        className={cx(
          "flex h-7 w-12 items-center justify-center rounded-full transition-colors duration-200",
          on && "bg-[var(--accent-soft)]",
        )}
      >
        {icon}
      </span>
      {label}
    </Link>
  );
  const premiumOn = PREMIUM_MATCH(pathname);
  return (
    <nav
      aria-label="Quick links"
      className={cx(
        "fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 flex items-center gap-0.5 rounded-full border border-white/[0.08] bg-[var(--bg-2)]/90 p-1.5 shadow-[0_10px_30px_rgba(0,0,0,0.5)] backdrop-blur-xl transition-[transform,opacity] duration-200 motion-reduce:transition-none sm:inset-x-auto sm:left-1/2 sm:w-[26rem] sm:-translate-x-1/2 lg:hidden",
        typing && "pointer-events-none translate-y-[150%] opacity-0",
      )}
    >
      {item("/", "Home", <HomeIcon />, pathname === "/")}
      {item("/discover", "Discover", <CompassIcon />, pathname.startsWith("/discover"))}
      <Link href="/create" aria-label="Create a character" className="group flex flex-1 justify-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-[var(--accent)] to-[var(--accent-2)] text-[var(--accent-ink)] shadow-[0_6px_18px_rgba(255,79,139,0.45)] transition-transform duration-150 group-active:scale-90 motion-reduce:group-active:scale-100">
          <PlusIcon className="h-6 w-6" />
        </span>
      </Link>
      {item("/chat", "Chat", <ChatIcon />, pathname.startsWith("/chat") || pathname.startsWith("/date"))}
      <Link
        href="/premium"
        aria-current={premiumOn ? "page" : undefined}
        className={cx(
          "flex flex-1 flex-col items-center gap-0.5 rounded-full bg-gradient-to-b from-[var(--premium)]/20 to-[var(--premium)]/[0.06] py-1 text-[11px] font-bold text-[var(--premium)] ring-1 ring-inset transition-transform duration-150 active:scale-95 motion-reduce:active:scale-100",
          premiumOn ? "ring-[var(--premium)]/60" : "ring-[var(--premium)]/30",
        )}
      >
        <span className="flex h-7 items-center justify-center">
          <PremiumIcon className="h-5 w-5" />
        </span>
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

const WIDE = "(min-width: 1024px)";

function subscribeWide(onChange: () => void) {
  const query = window.matchMedia(WIDE);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

// Set when the shell is already on the page (it lives in the root layout), so
// a page's own <AppShell> just renders its content.
const ShellContext = createContext(false);

// The top bar, sidebar, drawer and phone bar. Rendered once in the root layout
// so it stays put between pages: nothing blinks, menus keep their state, and
// route loading screens show inside it.
export function ShellRoot({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [drawer, setDrawer] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const wide = useSyncExternalStore(
    subscribeWide,
    () => window.matchMedia(WIDE).matches,
    () => false,
  );
  const full = FULL_HEIGHT(pathname);
  const bottomBar = !NO_BOTTOM_BAR(pathname);

  useEffect(() => {
    // The boot script applied the right width on first paint; moving between a
    // conversation and the rest of the app switches to that side's preference.
    const next = savedCollapsed(full);
    applyCollapsed(next);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCollapsed(next);
  }, [full]);

  // A new page closes the phone menu.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDrawer(false);
  }, [pathname]);

  const closeDrawer = useCallback(() => setDrawer(false), []);

  function toggleMenu() {
    // Wide screens fold the sidebar; narrow ones open the drawer.
    if (!window.matchMedia(WIDE).matches) {
      setDrawer(true);
      return;
    }
    const next = !collapsed;
    setCollapsed(next);
    applyCollapsed(next);
    try {
      localStorage.setItem(full ? CHAT_COLLAPSED_KEY : COLLAPSED_KEY, next ? "1" : "0");
    } catch {
      // Not remembered.
    }
  }

  return (
    <ShellContext.Provider value={true}>
      <div className="min-h-dvh bg-[var(--bg)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] text-[var(--ink)]">
        <TopBar
          menuButton={menuButton}
          menuLabel={wide ? (collapsed ? "Expand sidebar" : "Collapse sidebar") : "Open menu"}
          menuExpanded={wide ? !collapsed : drawer}
          menuControls={wide ? "app-sidebar" : "app-drawer"}
          onMenu={toggleMenu}
          phoneHidden={full}
        />
        <div className="flex">
          <Sidebar />
          <main
            className={cx(
              "min-w-0 flex-1",
              full && "h-dvh lg:h-[calc(100dvh-4rem)]",
              bottomBar && "pb-[calc(6rem+env(safe-area-inset-bottom))] lg:pb-0",
            )}
          >
            {children}
          </main>
        </div>
        {bottomBar ? <BottomBar /> : null}
        <Drawer open={drawer} onClose={closeDrawer} returnFocus={menuButton} />
      </div>
    </ShellContext.Provider>
  );
}

// Pages wrap themselves in this. Inside the root layout's shell it's a
// passthrough; on its own (a test, a page outside the layout) it draws the shell.
export function AppShell({ children }: { children: ReactNode }) {
  const inside = useContext(ShellContext);
  const lanes = useContext(LaneContext);
  if (inside) return <>{children}</>;
  const shell = <ShellRoot>{children}</ShellRoot>;
  return lanes ? shell : <LaneProvider>{shell}</LaneProvider>;
}

const DOCS = [
  { href: "/terms", label: "Terms" },
  { href: "/privacy", label: "Privacy" },
  { href: "/content-policy", label: "Content policy" },
  { href: "/safety", label: "Safety" },
  { href: "/dmca", label: "DMCA" },
  { href: "/2257", label: "2257" },
];

// Layout for legal and policy pages: plain reading width, consistent headings,
// and a row of pills to move between them.
export function DocPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  const pathname = usePathname();
  return (
    <AppShell>
      <article className={cx("mx-auto w-full max-w-3xl pb-16 pt-6 sm:pt-8", PAGE_GUTTER)}>
        <h1 className="text-3xl font-bold tracking-tight text-[var(--ink)] sm:text-4xl">{title}</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">Last updated {updated}</p>
        <nav aria-label="Policies" className="no-scrollbar -mx-4 mt-5 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
          {DOCS.map((doc) => {
            const on = pathname === doc.href;
            return (
              <Link
                key={doc.href}
                href={doc.href}
                aria-current={on ? "page" : undefined}
                className={cx(
                  "inline-flex h-10 shrink-0 items-center rounded-full px-4 text-sm font-medium transition-[background-color,color,border-color,transform] duration-150 active:scale-[0.97] motion-reduce:active:scale-100",
                  on
                    ? "bg-[var(--accent)] !text-[var(--accent-ink)]"
                    : "border border-[var(--line)] bg-[var(--surface)] !text-[var(--muted)] hover:border-white/25 hover:!text-[var(--ink)]",
                )}
              >
                {doc.label}
              </Link>
            );
          })}
        </nav>
        <p className="mt-5 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-4 py-3 text-sm text-[var(--muted)]">
          Draft: have counsel review before launch.
        </p>
        <div className="mt-6 text-[15px] leading-7 text-[var(--muted)] [&_a]:text-[var(--accent)] [&_a]:underline [&_a]:underline-offset-2 [&_h2]:mt-10 [&_h2]:scroll-mt-24 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-[var(--ink)] [&_h3]:mt-6 [&_h3]:font-semibold [&_h3]:text-[var(--ink)] [&_li]:mt-1.5 [&_ol]:mt-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:mt-3 [&_strong]:text-[var(--ink)] [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-5">
          {children}
        </div>
      </article>
    </AppShell>
  );
}
