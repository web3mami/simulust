"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useSession } from "@/components/auth-gate";
import { BuyButton, Checkout, isHeld } from "@/components/shop-pay";
import { useApi } from "@/lib/api";
import type { LedgerEntryDTO, OrderDTO } from "@/lib/api-types";
import { MEMBERSHIP, PRODUCTS, findProduct, formatCredits, formatUsd, type Product } from "@/lib/pricing";

function Highlights({ items }: { items: string[] }) {
  return (
    <ul className="mt-2.5 space-y-1">
      {items.map((item) => (
        <li key={item} className="flex gap-2 text-[13px] leading-5 text-[var(--ink)]">
          <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[var(--gold)]" />
          {item}
        </li>
      ))}
    </ul>
  );
}

function PackShell({ gold, children }: { gold?: boolean; children: ReactNode }) {
  return (
    <div className="relative pb-2 pr-2">
      <div
        className="absolute inset-0 translate-x-[4px] translate-y-[4px] rounded-[1.15rem] border border-[var(--line)] bg-[var(--bg)]"
        aria-hidden
      />
      <div
        className="absolute inset-0 translate-x-[8px] translate-y-[8px] rounded-[1.15rem] border border-[var(--gold)]/20"
        aria-hidden
      />
      <article
        className={`relative flex h-full flex-col overflow-hidden rounded-[1.15rem] border ${
          gold ? "border-[var(--gold)]/55 bg-[var(--bg-2)]" : "border-[var(--line)] bg-[var(--bg-2)]"
        }`}
      >
        <div className={`h-1 ${gold ? "bg-[var(--gold)]" : "bg-[var(--gold)]/35"}`} />
        {children}
      </article>
    </div>
  );
}

// Cost of 100 credits in a pack, to make the bonus visible.
function per100(product: Product) {
  return formatUsd(Math.round((product.usdCents / product.credits) * 100));
}

function Pack({ product, onBuy }: { product: Product; onBuy: (product: Product) => void }) {
  return (
    <PackShell gold={product.featured}>
      <div className="flex flex-1 flex-col px-4 pb-3.5 pt-3">
        <p className="min-h-[1rem] text-[10px] uppercase tracking-wide text-[var(--gold)]">
          {product.tag ? (
            <>
              {product.featured ? <span aria-hidden>★ </span> : null}
              {product.tag}
            </>
          ) : null}
        </p>
        <h3 className="mt-1 font-[family-name:var(--font-display)] text-2xl leading-none">{product.name}</h3>
        <p className="mt-2.5 font-[family-name:var(--font-display)] text-xl leading-none text-[var(--ink)]">
          {formatUsd(product.usdCents)}
        </p>
        <p className="mt-1 text-xs text-[var(--muted)]">{per100(product)} per 100 credits</p>
        <Highlights items={product.perks} />
        <div className="mt-auto pt-3">
          <BuyButton product={product} gold={product.featured} compact onBuy={onBuy} />
        </div>
      </div>
    </PackShell>
  );
}

function PacksTrack({ onBuy }: { onBuy: (product: Product) => void }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onScroll = () => {
      const cards = [...el.children] as HTMLElement[];
      const mid = el.scrollLeft + el.clientWidth / 2;
      let best = 0;
      let nearest = Infinity;
      cards.forEach((card, index) => {
        const distance = Math.abs(card.offsetLeft + card.offsetWidth / 2 - mid);
        if (distance < nearest) {
          nearest = distance;
          best = index;
        }
      });
      setActive(best);
    };
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  const goTo = (index: number) => {
    const el = scroller.current;
    const card = el?.children[index] as HTMLElement | undefined;
    if (!el || !card) return;
    el.scrollTo({ left: Math.max(0, card.offsetLeft - (el.clientWidth - card.offsetWidth) / 2), behavior: "smooth" });
  };

  return (
    <div className="mt-5 lg:mt-4">
      <div
        ref={scroller}
        className="flex snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain pb-4 [scrollbar-width:none] [-ms-overflow-style:none] [touch-action:pan-x] [&::-webkit-scrollbar]:hidden lg:grid lg:grid-cols-4 lg:gap-4 lg:overflow-visible lg:pb-1"
      >
        {PRODUCTS.map((product) => (
          <div key={product.id} className="w-[min(72vw,20rem)] shrink-0 snap-center lg:w-auto">
            <Pack product={product} onBuy={onBuy} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex items-center justify-center gap-2 lg:hidden" role="tablist" aria-label="Packs">
        {PRODUCTS.map((product, index) => {
          const on = active === index;
          return (
            <button
              key={product.id}
              type="button"
              role="tab"
              aria-label={product.name}
              aria-selected={on}
              onClick={() => goTo(index)}
              className={`rounded-full transition-[width,background-color] ${
                on ? "h-1.5 w-5 bg-[var(--gold)]" : "h-1.5 w-1.5 bg-[var(--ink)]/30"
              }`}
            />
          );
        })}
      </div>
    </div>
  );
}

function Membership({ onBuy }: { onBuy: (product: Product) => void }) {
  const { me } = useSession();
  const until = me?.isMember && me.memberUntil ? new Date(me.memberUntil).toLocaleDateString() : null;
  return (
    <PackShell gold>
      <div className="flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5 sm:py-4">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] uppercase tracking-wide text-[var(--gold)]">
            {until ? `Member until ${until}` : MEMBERSHIP.tag}
          </p>
          <p className="mt-1.5 font-[family-name:var(--font-display)] text-2xl leading-none sm:text-3xl">
            {formatUsd(MEMBERSHIP.usdCents)}
            <span className="ml-1.5 font-sans text-sm text-[var(--muted)]">for {MEMBERSHIP.memberDays} days</span>
          </p>
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
            {MEMBERSHIP.perks.map((item) => (
              <li key={item} className="flex gap-2 text-[13px] text-[var(--ink)]">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[var(--gold)]" />
                {item}
              </li>
            ))}
          </ul>
        </div>
        <div className="w-full shrink-0 sm:w-44">
          <BuyButton
            product={MEMBERSHIP}
            gold
            compact
            label={until ? `Add ${MEMBERSHIP.memberDays} days` : `Join for ${formatUsd(MEMBERSHIP.usdCents)}`}
            onBuy={onBuy}
          />
        </div>
      </div>
    </PackShell>
  );
}

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

type Activity =
  | { state: "loading" }
  | { state: "error" }
  | { state: "ready"; balance: number; ledger: LedgerEntryDTO[]; orders: OrderDTO[] };

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

  return (
    <section className="mt-8 rounded-[1.15rem] border border-[var(--line)] bg-[var(--bg-2)] p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-[family-name:var(--font-display)] text-2xl leading-none">Your credits</h2>
        <p className="text-sm text-[var(--ink)]">
          {formatCredits(activity.state === "ready" ? activity.balance : (me?.balance ?? 0))}
          {me?.isMember && me.memberUntil ? (
            <span className="text-[var(--muted)]"> · member until {new Date(me.memberUntil).toLocaleDateString()}</span>
          ) : null}
        </p>
      </div>

      {activity.state === "loading" ? <p className="mt-4 text-xs text-[var(--muted)]">Loading your activity…</p> : null}
      {activity.state === "error" ? (
        <p className="mt-4 text-xs text-[var(--muted)]">
          We couldn&apos;t load your activity.{" "}
          <button type="button" className="text-[var(--gold)]" onClick={() => void load()}>
            Try again
          </button>
        </p>
      ) : null}

      {payments.length ? (
        <div className="mt-4">
          <h3 className="text-[11px] uppercase tracking-wide text-[var(--muted)]">Recent payments</h3>
          <ul className="mt-2 divide-y divide-[var(--line)]">
            {payments.map((order) => (
              <li key={order.id} className="flex items-center justify-between gap-3 py-2 text-[13px]">
                <div className="min-w-0">
                  <p className="truncate text-[var(--ink)]">
                    {findProduct(order.productId)?.name ?? order.productId} · {order.amountDisplay}
                  </p>
                  <p className="truncate font-mono text-[11px] text-[var(--muted)]">{order.id}</p>
                </div>
                {order.signature && !order.signature.startsWith("dev-") ? (
                  <a
                    href={`https://solscan.io/tx/${order.signature}${cluster}`}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 text-xs text-[var(--gold)]"
                  >
                    {orderLabel(order)} ↗
                  </a>
                ) : (
                  <span className="shrink-0 text-xs text-[var(--muted)]">{orderLabel(order)}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {activity.state === "ready" ? (
        <div className="mt-4">
          <h3 className="text-[11px] uppercase tracking-wide text-[var(--muted)]">History</h3>
          {ledger.length ? (
            <ul className="mt-2 divide-y divide-[var(--line)]">
              {ledger.map((entry) => (
                <li key={entry.id} className="flex items-center justify-between gap-3 py-2 text-[13px]">
                  <span className="text-[var(--ink)]">
                    {REASONS[entry.reason] ?? entry.reason}
                    <span className="ml-2 text-[11px] text-[var(--muted)]">
                      {new Date(entry.createdAt).toLocaleDateString()}
                    </span>
                  </span>
                  <span className={entry.delta > 0 ? "text-[var(--gold)]" : "text-[var(--muted)]"}>
                    {entry.delta > 0 ? "+" : ""}
                    {entry.delta.toLocaleString("en-US")}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-[var(--muted)]">Nothing yet.</p>
          )}
          {activity.ledger.length > 8 && !showAll ? (
            <button type="button" className="mt-2 text-xs text-[var(--gold)]" onClick={() => setShowAll(true)}>
              Show more
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export function Shop({ focus = "membership" }: { focus?: "membership" | "packs" }) {
  const { session } = useSession();
  const [buying, setBuying] = useState<Product | null>(null);
  const [version, setVersion] = useState(0);
  const onBuy = useCallback((product: Product) => setBuying(product), []);
  const closeCheckout = useCallback(() => {
    setBuying(null);
    setVersion((value) => value + 1);
  }, []);

  const membership = (
    <section key="membership">
      <h2 className="font-[family-name:var(--font-display)] text-4xl font-light leading-none text-[var(--ink)]">
        Membership.
      </h2>
      <div className="mt-4">
        <Membership onBuy={onBuy} />
      </div>
    </section>
  );
  const packs = (
    <section key="packs">
      <h2 className="font-[family-name:var(--font-display)] text-4xl font-light leading-none text-[var(--ink)]">
        Credits.
      </h2>
      <p className="mt-2 text-sm text-[var(--muted)]">For photos, voice notes, video, and messages past your free daily ones.</p>
      <PacksTrack onBuy={onBuy} />
    </section>
  );
  const sections = focus === "packs" ? [packs, membership] : [membership, packs];

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:py-5">
      <h1 className="sr-only">{focus === "packs" ? "Credit packs" : "Premium"}</h1>
      <div className="space-y-8">{sections}</div>
      <p className="mt-6 text-xs leading-5 text-[var(--muted)]">
        Prices in US dollars, paid in USDC or SOL on Solana. Credits never expire. No subscriptions, nothing renews.{" "}
        <Link href="/pricing" className="text-[var(--gold)] underline-offset-2 hover:underline">
          See every price and the refund policy
        </Link>
        .
      </p>
      {session ? <ActivityPanel version={version} /> : null}
      {buying ? <Checkout product={buying} onClose={closeCheckout} /> : null}
    </div>
  );
}
