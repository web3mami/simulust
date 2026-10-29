"use client";

import Image from "next/image";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { useLane } from "@/components/app-shell";
import { useSession } from "@/components/auth-gate";
import { CameraIcon, ChatIcon, ChevronRightIcon, CoinIcon, MicIcon, PlayIcon } from "@/components/icons";
import { BuyButton, isHeld } from "@/components/premium/buy";
import styles from "@/components/premium/motion.module.css";
import {
  BEST_VALUE_ID,
  CheckIcon,
  CompareTable,
  CostGrid,
  Faq,
  MEMBER_PERKS,
  PaymentGuide,
  TrustRow,
  creditsBuy,
  formatDate,
  per100,
} from "@/components/premium/parts";
import { PremiumIcon } from "@/components/premium-icon";
import { Badge, SectionTitle, Skeleton, buttonClass, cx } from "@/components/ui";
import { useApi } from "@/lib/api";
import type { LedgerEntryDTO, OrderDTO } from "@/lib/api-types";
import type { Lane } from "@/lib/characters";
import { COSTS, MEMBERSHIP, PRODUCTS, findProduct, formatCredits, formatUsd, type Product } from "@/lib/pricing";

// The checkout (wallet hooks and the QR code library) loads only when someone
// presses Buy, not with every visit to the shop.
const Checkout = dynamic(() => import("@/components/shop-pay").then((module) => module.Checkout), {
  ssr: false,
  loading: () => (
    <div className={cx("fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm", styles.overlayIn)} role="status">
      <span className="h-10 w-10 animate-spin rounded-full border-[3px] border-white/15 border-t-[var(--accent)] motion-reduce:animate-none" />
      <span className="sr-only">Opening checkout…</span>
    </div>
  ),
});

type OnBuy = (product: Product) => void;

const DAYS = MEMBERSHIP.memberDays ?? 30;

// Tall pictures for the Premium hero, wide ones for the credits banner, in the
// lane picked in the top bar. Each banner is framed so the faces stay in view.
const PORTRAIT: Record<Lane, string> = {
  girls: "/hero/hero-pair-girls.jpg",
  anime: "/hero/hero-pair-anime.jpg",
  guys: "/hero/hero-pair-guys.jpg",
};

const BANNER: Record<Lane, { src: string; position: string }> = {
  girls: { src: "/hero/hero-girls-lounge.jpg", position: "sm:object-[100%_14%]" },
  anime: { src: "/hero/hero-anime-night.jpg", position: "sm:object-[100%_12%]" },
  guys: { src: "/hero/hero-guys-rooftop.jpg", position: "sm:object-[100%_16%]" },
};

// Whether the viewer's account (membership, balance) is still on its way. Gives
// up after a few seconds so a failed /api/me never hides the buy buttons.
function useAccountLoading() {
  const { ready, session, me } = useSession();
  const waiting = !ready || (Boolean(session) && !me);
  const [gaveUp, setGaveUp] = useState(false);
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setTimeout(() => setGaveUp(true), 5000);
    return () => window.clearTimeout(timer);
  }, [waiting]);
  return waiting && !gaveUp;
}

function useMemberUntil() {
  const { me } = useSession();
  return me?.isMember && me.memberUntil ? formatDate(me.memberUntil) : null;
}

// Hero art in the viewer's lane (the server already knows it from the lane
// cookie), preloaded as the page's largest picture. A shimmer holds the space
// until it has loaded, then it fades in.
function LaneArt({
  pick,
  sizes,
  className,
}: {
  pick: (lane: Lane) => { src: string; position?: string };
  sizes: string;
  className?: string;
}) {
  const { lane } = useLane();
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const art = pick(lane);
  const loaded = loadedSrc === art.src;
  return (
    <>
      <div
        aria-hidden
        className={cx(
          "absolute inset-0 transition-opacity duration-500",
          styles.shimmer,
          loaded ? "opacity-0" : "opacity-100",
        )}
      />
      <Image
        key={art.src}
        src={art.src}
        alt=""
        fill
        sizes={sizes}
        preload
        onLoad={() => setLoadedSrc(art.src)}
        className={cx(
          "object-cover transition-opacity duration-500",
          loaded ? "opacity-100" : "opacity-0",
          art.position,
          className,
        )}
      />
    </>
  );
}

function BalanceChip({ className }: { className?: string }) {
  const { me } = useSession();
  const loading = useAccountLoading();
  if (loading) return <Skeleton className={cx("h-10 w-36 rounded-full", className)} />;
  if (!me) return null;
  return (
    <a
      href="#activity"
      className={cx(
        "inline-flex h-10 items-center gap-1.5 rounded-full bg-black/40 px-4 text-sm font-semibold !text-[var(--ink)] ring-1 ring-white/10 backdrop-blur transition-colors hover:bg-black/60",
        className,
      )}
    >
      <CoinIcon className="h-4 w-4 text-[var(--premium)]" />
      <span className="tabular-nums">{me.balance.toLocaleString("en-US")}</span>
      <span className="font-medium text-[var(--muted)]">credits</span>
    </a>
  );
}

// Membership and Credit packs are two pages; this switches between them.
function ShopTabs({ focus }: { focus: "membership" | "packs" }) {
  const tab = (href: string, on: boolean, icon: ReactNode, label: string) => (
    <Link
      href={href}
      aria-current={on ? "page" : undefined}
      className={cx(
        "flex h-10 items-center gap-2 rounded-full px-4 text-sm font-semibold transition-colors",
        on ? "bg-[var(--accent)] !text-[var(--accent-ink)]" : "!text-[var(--muted)] hover:!text-[var(--ink)]",
      )}
    >
      {icon}
      {label}
    </Link>
  );
  return (
    <nav aria-label="Shop" className="inline-flex rounded-full bg-[var(--surface)] p-1 ring-1 ring-white/5">
      {tab("/premium", focus === "membership", <PremiumIcon className="h-4 w-4" />, "Membership")}
      {tab("/packs", focus === "packs", <CoinIcon className="h-4 w-4" />, "Credit packs")}
    </nav>
  );
}

function PerkList({ className }: { className?: string }) {
  return (
    <ul className={cx("grid gap-3", className)}>
      {MEMBER_PERKS.map((perk) => (
        <li key={perk.title} className="flex gap-3 text-sm leading-5 text-[var(--ink)]">
          <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--accent-ink)]">
            <CheckIcon className="h-3 w-3" />
          </span>
          <span>
            <span className="font-semibold">{perk.title}</span>
            {perk.note ? <span className="block text-xs text-[var(--muted)]">{perk.note}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

// The membership buy button, or its shape while we find out whether the
// viewer is already a member (the label depends on it).
function MembershipButton({ onBuy, className }: { onBuy: OnBuy; className?: string }) {
  const until = useMemberUntil();
  const loading = useAccountLoading();
  if (loading) return <Skeleton className={cx("h-12 w-full rounded-full", className)} />;
  return (
    <BuyButton
      product={MEMBERSHIP}
      variant="primary"
      size="lg"
      className={className}
      label={until ? `Add ${DAYS} days` : `Join for ${formatUsd(MEMBERSHIP.usdCents)}`}
      onBuy={onBuy}
    />
  );
}

// ---------------------------------------------------------------------------
// Membership

// What a membership's credits pay for, from the published costs.
const CREDIT_BUYS = [
  { key: "photo", label: "photos", icon: <CameraIcon className="h-4 w-4" /> },
  { key: "voiceNote", label: "voice notes", icon: <MicIcon className="h-4 w-4" /> },
  { key: "video", label: "video clips", icon: <PlayIcon className="h-4 w-4" /> },
] as const;

function PlanCard({ onBuy, ctaRef }: { onBuy: OnBuy; ctaRef: RefObject<HTMLDivElement | null> }) {
  const until = useMemberUntil();
  const loading = useAccountLoading();
  const perDay = formatUsd(Math.round(MEMBERSHIP.usdCents / DAYS));
  return (
    <div className="relative flex flex-col overflow-hidden rounded-3xl bg-[var(--surface)] p-5 ring-1 ring-[var(--accent)]/35 sm:p-8">
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(110%_70%_at_100%_0%,var(--accent-soft),transparent_65%)]"
        aria-hidden
      />
      <div className="relative flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[var(--premium)] to-[var(--premium-2)] text-[#1a1206]">
          <PremiumIcon className="h-6 w-6" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold tracking-tight text-[var(--ink)]">Premium membership</h2>
          {loading ? (
            <Skeleton className="mt-1 h-3 w-40 rounded-full" />
          ) : (
            <p className="text-xs text-[var(--muted)]">{until ? `You're a member until ${until}` : `${DAYS} days, paid once`}</p>
          )}
        </div>
        {until ? <Badge tone="premium">Active</Badge> : null}
      </div>

      <div className="relative mt-6 flex flex-wrap items-end gap-x-2">
        <p className="text-5xl font-bold tracking-tight text-[var(--ink)]">{formatUsd(MEMBERSHIP.usdCents)}</p>
        <p className="pb-1.5 text-sm font-medium text-[var(--muted)]">for {DAYS} days</p>
      </div>
      <p className="relative mt-1 text-sm text-[var(--muted)]">About {perDay} a day. Paid once, never renews.</p>

      {/* Phones show the button before the details so it is on the first screen. */}
      <PerkList className="relative order-2 mt-6 sm:grid-cols-3 sm:gap-x-5 lg:order-none lg:grid-cols-1" />

      <div className="relative order-2 mt-6 rounded-2xl bg-black/25 p-4 ring-1 ring-white/5 lg:order-none">
        <p className="text-xs font-medium text-[var(--muted)]">{MEMBERSHIP.credits} credits are enough for up to</p>
        <ul className="mt-3 grid grid-cols-3 divide-x divide-[var(--line)] text-center">
          {CREDIT_BUYS.map((item, index) => (
            <li key={item.key} className="px-1">
              <p className="flex items-center justify-center gap-1.5 text-xl font-bold tracking-tight text-[var(--ink)] sm:text-2xl">
                <span className="text-[var(--accent)]">{item.icon}</span>
                {Math.floor(MEMBERSHIP.credits / COSTS[item.key])}
              </p>
              <p className="mt-0.5 text-xs text-[var(--muted)]">
                {index ? "or " : ""}
                {item.label}
              </p>
            </li>
          ))}
        </ul>
      </div>

      <div ref={ctaRef} className="relative order-1 mt-6 lg:order-none lg:mt-auto lg:pt-8">
        <MembershipButton onBuy={onBuy} />
        <TrustRow className="mt-3" />
        <a
          href="#packs"
          className="mt-3 flex min-h-10 items-center justify-center gap-1 text-sm font-semibold !text-[var(--ink)] hover:!text-[var(--accent)]"
        >
          Just need credits? See credit packs
          <ChevronRightIcon className="h-4 w-4" />
        </a>
      </div>
    </div>
  );
}

const HIGHLIGHTS = [
  { label: "Unlimited chat", icon: <ChatIcon className="h-4 w-4" /> },
  { label: "Photos", icon: <CameraIcon className="h-4 w-4" /> },
  { label: "Voice notes", icon: <MicIcon className="h-4 w-4" /> },
  { label: "Video", icon: <PlayIcon className="h-4 w-4" /> },
];

function PremiumHero({ onBuy, ctaRef }: { onBuy: OnBuy; ctaRef: RefObject<HTMLDivElement | null> }) {
  return (
    <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:gap-6">
      <div className="relative min-h-[15rem] overflow-hidden rounded-3xl bg-[var(--surface)] ring-1 ring-white/5 sm:min-h-[24rem] lg:min-h-[38rem]">
        <LaneArt
          pick={(lane) => ({ src: PORTRAIT[lane] })}
          sizes="(min-width: 1024px) 45vw, 100vw"
          className="object-[50%_20%]"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/45 to-black/0" aria-hidden />
        <div className="absolute inset-x-0 bottom-0 p-5 sm:p-8">
          <Badge tone="premium" className="gap-1 px-2.5 py-1">
            <PremiumIcon className="h-3 w-3" />
            Premium
          </Badge>
          <h1 className="mt-3 text-4xl font-bold tracking-tight text-white sm:text-5xl">
            Go <span className="text-[var(--accent)]">unlimited</span>
          </h1>
          <p className="mt-2 max-w-md text-sm leading-6 text-white/80 sm:text-base">
            Unlimited messages (fair use) and {MEMBERSHIP.credits} credits for photos, voice notes and video.{" "}
            {DAYS} days, paid once.
          </p>
          <ul className="mt-4 hidden max-w-sm grid-cols-2 gap-2 sm:grid">
            {HIGHLIGHTS.map((item) => (
              <li
                key={item.label}
                className="inline-flex h-8 items-center gap-1.5 rounded-full bg-black/45 px-3 text-xs font-semibold text-white ring-1 ring-white/10 backdrop-blur"
              >
                <span className="text-[var(--accent)]">{item.icon}</span>
                {item.label}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <PlanCard onBuy={onBuy} ctaRef={ctaRef} />
    </section>
  );
}

// On the credits page: membership as the upgrade below the packs.
function MembershipStrip({ onBuy }: { onBuy: OnBuy }) {
  const until = useMemberUntil();
  return (
    <section className="relative overflow-hidden rounded-3xl bg-[var(--surface)] p-5 ring-1 ring-[var(--accent)]/35 sm:p-8">
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(80%_120%_at_100%_0%,var(--accent-soft),transparent_65%)]"
        aria-hidden
      />
      <div className="relative grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-center lg:gap-10">
        <div>
          <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-[var(--premium)]">
            <PremiumIcon className="h-4 w-4" />
            {until ? `Member until ${until}` : "Premium membership"}
          </p>
          <h2 className="mt-3 text-2xl font-bold tracking-tight text-[var(--ink)] sm:text-3xl">
            <span className="text-[var(--accent)]">Unlimited</span> messages and {MEMBERSHIP.credits} credits
          </h2>
          <PerkList className="mt-5 sm:grid-cols-3 sm:gap-x-5" />
        </div>
        <div className="lg:text-center">
          <p className="text-4xl font-bold tracking-tight text-[var(--ink)]">
            {formatUsd(MEMBERSHIP.usdCents)}
            <span className="ml-1.5 text-sm font-medium text-[var(--muted)]">for {DAYS} days</span>
          </p>
          <MembershipButton onBuy={onBuy} className="mt-4" />
          <TrustRow compact className="mt-3 lg:justify-center" />
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Credit packs

function PacksHero() {
  return (
    <section className="relative overflow-hidden rounded-3xl bg-[var(--surface)] ring-1 ring-white/5">
      <LaneArt
        pick={(lane) => BANNER[lane]}
        sizes="(min-width: 1024px) calc(100vw - 18rem), 100vw"
        className="object-[70%_25%]"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/50 to-black/10 sm:bg-gradient-to-r sm:from-black/95 sm:via-black/60 sm:to-transparent" aria-hidden />
      <div className="relative flex min-h-[10rem] flex-col justify-end p-5 sm:min-h-[20rem] sm:justify-center sm:p-10">
        <Badge tone="premium" className="w-fit gap-1 px-2.5 py-1">
          <CoinIcon className="h-3 w-3" />
          Credits
        </Badge>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-5xl">
          Top up <span className="text-[var(--accent)]">credits</span>
        </h1>
        <p className="mt-2 hidden max-w-md text-sm leading-6 text-white/80 sm:block sm:text-base">
          For photos, voice notes, video, and messages past your free daily ones. Credits never expire.
        </p>
        {/* Phones already show the balance in the top bar. */}
        <div className="mt-4 hidden sm:block">
          <BalanceChip />
        </div>
      </div>
    </section>
  );
}

function PackCard({ product, onBuy }: { product: Product; onBuy: OnBuy }) {
  const featured = product.featured === true;
  const best = product.id === BEST_VALUE_ID && !featured;
  return (
    <article
      className={cx(
        "relative flex flex-col rounded-2xl bg-[var(--surface)] p-4 transition duration-200 hover:-translate-y-0.5 sm:p-5",
        featured
          ? "bg-[linear-gradient(180deg,var(--accent-soft),transparent_45%)] ring-2 ring-[var(--accent)] shadow-[0_18px_50px_-18px_rgba(255,79,139,0.6)]"
          : "ring-1 ring-white/5 hover:ring-white/15",
      )}
    >
      {featured ? (
        <Badge className="absolute -top-2.5 left-1/2 -translate-x-1/2 whitespace-nowrap px-3 py-1">Recommended</Badge>
      ) : best ? (
        <Badge tone="premium" className="absolute -top-2.5 left-1/2 -translate-x-1/2 whitespace-nowrap px-3 py-1">
          Lowest price per credit
        </Badge>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <h3 className="text-sm font-semibold text-[var(--muted)]">{product.name}</h3>
        {product.tag ? (
          <span className="rounded-full bg-[var(--premium)]/15 px-2 py-0.5 text-[11px] font-bold text-[var(--premium)]">
            {product.tag}
          </span>
        ) : null}
      </div>
      <p className="mt-3 flex items-center gap-1.5 text-2xl font-bold tracking-tight text-[var(--ink)] tabular-nums sm:text-3xl">
        <CoinIcon className="h-5 w-5 text-[var(--premium)] sm:h-6 sm:w-6" />
        {product.credits.toLocaleString("en-US")}
      </p>
      <p className="text-xs text-[var(--muted)]">credits, never expire</p>
      <p className="mt-2 text-xs leading-5 text-[var(--ink)]/80">{creditsBuy(product.credits)}</p>
      <div className="mt-4 border-t border-[var(--line)] pt-4">
        <p className="text-xl font-bold tracking-tight text-[var(--ink)]">{formatUsd(product.usdCents)}</p>
        <p className="text-xs text-[var(--muted)]">{per100(product)} / 100 credits</p>
      </div>
      <div className="mt-auto pt-4">
        <BuyButton
          product={product}
          variant={featured ? "primary" : "secondary"}
          label={`Buy · ${formatUsd(product.usdCents)}`}
          aria-label={`Buy ${product.name}: ${formatCredits(product.credits)} for ${formatUsd(product.usdCents)}`}
          onBuy={onBuy}
        />
      </div>
    </article>
  );
}

function PacksSection({ onBuy, focus, gridRef }: { onBuy: OnBuy; focus: "membership" | "packs"; gridRef?: RefObject<HTMLDivElement | null> }) {
  return (
    <section id="packs" className="scroll-mt-24">
      {focus === "packs" ? (
        <SectionTitle accent="Choose">a pack</SectionTitle>
      ) : (
        <SectionTitle accent="Credit" action={<BalanceChip />}>
          packs
        </SectionTitle>
      )}
      <div className="mt-1.5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <p className="max-w-2xl text-sm leading-6 text-[var(--muted)]">
          {focus === "packs"
            ? "Bigger packs cost less per credit."
            : "Credits pay for photos, voice notes, video, and messages past your free ones. Bigger packs cost less per credit."}
        </p>
        <TrustRow compact className="justify-start" />
      </div>
      <div ref={gridRef} className="mt-6 grid grid-cols-2 gap-3 sm:mt-7 sm:gap-4 lg:grid-cols-4">
        {PRODUCTS.map((product) => (
          <PackCard key={product.id} product={product} onBuy={onBuy} />
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Phones: a buy bar that appears once the main offer has scrolled out of view,
// sitting just above the app's bottom bar.

function useOutOfView(target: RefObject<HTMLElement | null>) {
  const [out, setOut] = useState(false);
  useEffect(() => {
    const node = target.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => setOut(entry ? !entry.isIntersecting : false));
    observer.observe(node);
    return () => observer.disconnect();
  }, [target]);
  return out;
}

function StickyBuyBar({
  target,
  product,
  title,
  detail,
  label,
  onBuy,
}: {
  target: RefObject<HTMLElement | null>;
  product: Product;
  title: string;
  detail: string;
  label: string;
  onBuy: OnBuy;
}) {
  const out = useOutOfView(target);
  const loading = useAccountLoading();
  if (!out || loading) return null;
  return (
    <div className={cx("fixed inset-x-3 bottom-20 z-30 lg:hidden", styles.rise)}>
      <div className="flex items-center gap-3 rounded-2xl border border-[var(--line)] bg-[var(--bg-2)]/95 p-2 pl-4 shadow-[0_10px_30px_rgba(0,0,0,0.55)] backdrop-blur">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-[var(--ink)]">{title}</p>
          <p className="truncate text-xs text-[var(--muted)]">{detail}</p>
        </div>
        <BuyButton product={product} variant="primary" size="md" className="!w-auto shrink-0 px-5" label={label} onBuy={onBuy} />
      </div>
    </div>
  );
}

function MembershipBuyBar({ target, onBuy }: { target: RefObject<HTMLElement | null>; onBuy: OnBuy }) {
  const until = useMemberUntil();
  return (
    <StickyBuyBar
      target={target}
      product={MEMBERSHIP}
      title={`${formatUsd(MEMBERSHIP.usdCents)} for ${DAYS} days`}
      detail={until ? `Member until ${until}` : "Unlimited messages · no auto-renew"}
      label={until ? `Add ${DAYS} days` : "Join"}
      onBuy={onBuy}
    />
  );
}

// ---------------------------------------------------------------------------
// Your credits: balance, recent payments and history

const REASONS: Record<string, string> = {
  signup: "Welcome credits",
  purchase: "Credit pack",
  membership: "Membership",
  message: "Message",
  photo: "Photo",
  portrait: "Portrait",
  voice: "Voice note",
  video: "Video",
  refund: "Refund",
  admin: "Adjustment",
};

const ORDER_STATUS: Record<OrderDTO["status"], string> = {
  pending: "Waiting for payment",
  confirmed: "Paid",
  finalized: "Paid",
  expired: "Expired",
  failed: "Failed",
  underpaid: "Underpaid",
  blocked: "Not accepted",
  refund_due: "Refund due",
};

// A payment waiting on final checks reads as received, whatever the checkout's own status.
function orderLabel(order: OrderDTO) {
  return isHeld(order) ? "Received, final checks" : ORDER_STATUS[order.status];
}

function orderTone(order: OrderDTO) {
  // Important: these also colour links, which the global `a` rule would otherwise override.
  if (isHeld(order) || order.status === "pending") return "bg-white/5 !text-[var(--ink)]";
  if (order.status === "confirmed" || order.status === "finalized") return "bg-[var(--accent-soft)] !text-[var(--accent)]";
  return "bg-red-500/10 !text-red-300";
}

function CopyIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cx("shrink-0", className)} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2.5" />
      <path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" />
    </svg>
  );
}

// The short order number, with a button that copies the full one (support
// asks for it when a refund is due).
function OrderNumber({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="inline-flex items-center gap-1">
      <span className="font-mono">#{id.slice(0, 8)}</span>
      <button
        type="button"
        aria-label={copied ? "Order number copied" : "Copy order number"}
        title={copied ? "Copied" : "Copy order number"}
        className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--muted)] transition-colors hover:bg-white/5 hover:text-[var(--ink)]"
        onClick={() => {
          void navigator.clipboard
            .writeText(id)
            .then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            })
            .catch(() => undefined);
        }}
      >
        {copied ? <CheckIcon className="h-3.5 w-3.5 text-[var(--accent)]" /> : <CopyIcon className="h-3.5 w-3.5" />}
      </button>
    </span>
  );
}

type Activity =
  | { state: "loading" }
  | { state: "error" }
  | { state: "ready"; balance: number; ledger: LedgerEntryDTO[]; orders: OrderDTO[] };

function RowsSkeleton() {
  return (
    <div className="mt-3 space-y-2" aria-hidden>
      <Skeleton className="h-11 rounded-xl" />
      <Skeleton className="h-11 rounded-xl" />
      <Skeleton className="h-11 rounded-xl" />
    </div>
  );
}

function ActivityPanel({ version }: { version: number }) {
  const api = useApi();
  const { me, features } = useSession();
  const [activity, setActivity] = useState<Activity>({ state: "loading" });
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    try {
      const [credits, mine] = await Promise.all([
        api<{ balance: number; ledger: LedgerEntryDTO[] }>("/api/credits"),
        api<{ orders: OrderDTO[] }>("/api/orders"),
      ]);
      setActivity({ state: "ready", balance: credits.balance, ledger: credits.ledger, orders: mine.orders });
    } catch {
      setActivity({ state: "error" });
    }
  }, [api]);

  useEffect(() => {
    // Fetch on mount, after each checkout closes, and when the balance moves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, version, me?.balance]);

  const cluster = features?.solanaCluster === "devnet" ? "?cluster=devnet" : "";
  const payments =
    activity.state === "ready"
      ? activity.orders.filter((order) => order.status !== "expired" || order.signature).slice(0, 5)
      : [];
  const ledger = activity.state === "ready" ? activity.ledger.slice(0, showAll ? 50 : 8) : [];
  const balance = activity.state === "ready" ? activity.balance : me?.balance;

  return (
    <section id="activity" className="scroll-mt-24">
      <SectionTitle accent="Your">credits</SectionTitle>
      <div className="mt-5 rounded-2xl bg-[var(--surface)] p-4 ring-1 ring-white/5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--premium)]/15 text-[var(--premium)]">
              <CoinIcon className="h-6 w-6" />
            </span>
            <div>
              <p className="text-xs font-medium text-[var(--muted)]">Balance</p>
              {balance === undefined ? (
                <Skeleton className="mt-1 h-7 w-32 rounded-lg" />
              ) : (
                <p className="text-2xl font-bold tracking-tight text-[var(--ink)] tabular-nums">{formatCredits(balance)}</p>
              )}
            </div>
          </div>
          {me?.isMember && me.memberUntil ? (
            <span className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[var(--premium)]/10 px-3.5 text-sm font-semibold text-[var(--premium)]">
              <PremiumIcon className="h-4 w-4" />
              Member until {formatDate(me.memberUntil)}
            </span>
          ) : null}
        </div>

        {activity.state === "loading" ? (
          <div className="mt-6 grid gap-6 lg:grid-cols-2 lg:gap-10" role="status" aria-label="Loading your activity">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Recent payments</h3>
              <RowsSkeleton />
            </div>
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">History</h3>
              <RowsSkeleton />
            </div>
          </div>
        ) : null}
        {activity.state === "error" ? (
          <div className="mt-5 flex flex-wrap items-center gap-3 text-sm text-[var(--muted)]">
            We couldn&apos;t load your activity.
            <button type="button" className={buttonClass("secondary", "md")} onClick={() => void load()}>
              Try again
            </button>
          </div>
        ) : null}

        {activity.state === "ready" ? (
          <div className={cx("mt-6 grid gap-6", payments.length ? "lg:grid-cols-2 lg:gap-10" : null, styles.fade)}>
            {payments.length ? (
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Recent payments</h3>
                <ul className="mt-2 divide-y divide-[var(--line)]">
                  {payments.map((order) => (
                    <li key={order.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-[var(--ink)]">
                          {findProduct(order.productId)?.name ?? order.productId} · {order.amountDisplay}
                        </p>
                        {/* The order's hold ends 15 minutes after it starts, so its date is the day it ran. */}
                        <p className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
                          {formatDate(order.expiresAt)}
                          <span aria-hidden>·</span>
                          <OrderNumber id={order.id} />
                        </p>
                      </div>
                      {order.signature && !order.signature.startsWith("dev-") ? (
                        <a
                          href={`https://solscan.io/tx/${order.signature}${cluster}`}
                          target="_blank"
                          rel="noreferrer"
                          className={cx(
                            "inline-flex min-h-8 shrink-0 items-center rounded-full px-3 text-xs font-semibold hover:brightness-125",
                            orderTone(order),
                          )}
                        >
                          {orderLabel(order)} ↗
                        </a>
                      ) : (
                        <span
                          className={cx(
                            "inline-flex min-h-8 shrink-0 items-center rounded-full px-3 text-xs font-semibold",
                            orderTone(order),
                          )}
                        >
                          {orderLabel(order)}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">History</h3>
              {ledger.length ? (
                <ul className="mt-2 divide-y divide-[var(--line)]">
                  {ledger.map((entry) => (
                    <li key={entry.id} className="flex min-h-11 items-center justify-between gap-3 py-2.5 text-sm">
                      <span className="min-w-0 text-[var(--ink)]">
                        {REASONS[entry.reason] ?? entry.reason}
                        <span className="ml-2 text-xs text-[var(--muted)]">{formatDate(entry.createdAt)}</span>
                      </span>
                      <span
                        className={cx(
                          "shrink-0 font-semibold tabular-nums",
                          entry.delta > 0 ? "text-[var(--premium)]" : "text-[var(--muted)]",
                        )}
                      >
                        {entry.delta > 0 ? "+" : ""}
                        {entry.delta.toLocaleString("en-US")}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-[var(--muted)]">Nothing yet.</p>
              )}
              {activity.ledger.length > 8 && !showAll ? (
                <button type="button" className={buttonClass("secondary", "md", "mt-3")} onClick={() => setShowAll(true)}>
                  Show more
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------

export function Shop({ focus = "membership" }: { focus?: "membership" | "packs" }) {
  const { session } = useSession();
  const [buying, setBuying] = useState<Product | null>(null);
  const [version, setVersion] = useState(0);
  const planCta = useRef<HTMLDivElement>(null);
  const packGrid = useRef<HTMLDivElement>(null);
  const onBuy = useCallback((product: Product) => setBuying(product), []);
  const closeCheckout = useCallback(() => {
    setBuying(null);
    setVersion((value) => value + 1);
  }, []);
  const featured = PRODUCTS.find((product) => product.featured) ?? PRODUCTS[0];

  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 pb-32 pt-4 sm:px-6 sm:pt-6 lg:px-8 lg:pb-12 lg:pt-8">
      <ShopTabs focus={focus} />
      <div className="mt-4 space-y-12 sm:mt-6 sm:space-y-16">
        {focus === "packs" ? (
          <>
            <PacksHero />
            <PacksSection focus={focus} onBuy={onBuy} gridRef={packGrid} />
            <MembershipStrip onBuy={onBuy} />
          </>
        ) : (
          <>
            <PremiumHero onBuy={onBuy} ctaRef={planCta} />
            <section>
              <SectionTitle accent="Free" action={null}>
                or member
              </SectionTitle>
              <p className="mt-1.5 max-w-2xl text-sm leading-6 text-[var(--muted)]">
                Everything else is the same for everyone: the same characters, memory and replies.
              </p>
              <div className="mt-6">
                <CompareTable />
              </div>
            </section>
            <PacksSection focus={focus} onBuy={onBuy} />
          </>
        )}

        <section>
          <SectionTitle accent="Spend">your credits</SectionTitle>
          <p className="mt-1.5 max-w-2xl text-sm leading-6 text-[var(--muted)]">
            What each thing costs, in credits. Members send messages for free.
          </p>
          <div className="mt-6">
            <CostGrid />
          </div>
        </section>

        <section>
          <SectionTitle accent="Pay">with USDC or SOL</SectionTitle>
          <p className="mt-1.5 max-w-2xl text-sm leading-6 text-[var(--muted)]">
            Every price is in US dollars. You pay on Solana, from the wallet that comes with your account or any Solana Pay wallet.
          </p>
          <div className="mt-6">
            <PaymentGuide />
          </div>
        </section>

        {session ? <ActivityPanel version={version} /> : null}

        <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:gap-10">
          <div>
            <SectionTitle accent="Questions">and answers</SectionTitle>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
              Prices in US dollars, paid in USDC or SOL on Solana. Credits never expire. No subscriptions, nothing
              renews.
            </p>
            <Link href="/pricing" className={buttonClass("secondary", "md", "mt-5")}>
              See every price and the refund policy
            </Link>
          </div>
          <Faq />
        </section>
      </div>
      {buying ? null : focus === "packs" ? (
        <StickyBuyBar
          target={packGrid}
          product={featured}
          title={`${featured.name} · ${formatCredits(featured.credits)}`}
          detail={`${formatUsd(featured.usdCents)} · ${per100(featured)} / 100 credits`}
          label="Buy"
          onBuy={onBuy}
        />
      ) : (
        <MembershipBuyBar target={planCta} onBuy={onBuy} />
      )}
      {buying ? <Checkout product={buying} onClose={closeCheckout} /> : null}
    </div>
  );
}
