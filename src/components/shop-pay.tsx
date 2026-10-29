"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useSignAndSendTransaction, useWallets, type ConnectedStandardSolanaWallet } from "@privy-io/react-auth/solana";
import { useSession } from "@/components/auth-gate";
import { ChevronRightIcon, CloseIcon, CoinIcon } from "@/components/icons";
import { isHeld } from "@/components/premium/buy";
import styles from "@/components/premium/motion.module.css";
import { CheckIcon, CurrencyMark, TrustRow, formatDate } from "@/components/premium/parts";
import { prefersReducedMotion, useDialog } from "@/components/premium/use-dialog";
import { PremiumIcon } from "@/components/premium-icon";
import { isPrivyConfigured, solanaChain } from "@/components/privy-app";
import { payingWallet, useWalletStatus } from "@/components/wallet-sync";
import { buttonClass, cx } from "@/components/ui";
import { ApiError, useApi } from "@/lib/api";
import type { OrderDTO } from "@/lib/api-types";
import { MIN_REMAINING_MS } from "@/lib/checkout";
import { formatCredits, formatUsd, type Product } from "@/lib/pricing";

type Currency = "USDC" | "SOL";

// watching: the server could still credit a payment to the order.
type OrderPoll = { order: OrderDTO; watching: boolean };

const POLL_MS = 2_000;
// A closed checkout may still take a late payment for about an hour; it's
// checked less often than an open one.
const CLOSED_POLL_MS = 15_000;
const IS_DEV = process.env.NODE_ENV !== "production";
// How long a checkout holds its price; the same 15 minutes the server sets
// (ORDER_TTL_MS). Only used to draw the countdown bar.
const HOLD_MS = 15 * 60_000;

function messageOf(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback;
}

function formatClock(ms: number) {
  const seconds = Math.ceil(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function shortAddress(value: string) {
  return value.length > 12 ? `${value.slice(0, 4)}…${value.slice(-4)}` : value;
}

function explorerUrl(signature: string, cluster: "mainnet" | "devnet" | undefined) {
  return `https://solscan.io/tx/${signature}${cluster === "devnet" ? "?cluster=devnet" : ""}`;
}

function useRemaining(expiresAt: string | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!expiresAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);
  return expiresAt ? Math.max(0, Date.parse(expiresAt) - now) : 0;
}

// Polls the order for as long as the server says a payment could still be
// credited to it: open, held for final checks, or closed within the hour. The
// server re-checks the chain on each poll, so this also settles QR payments
// from other devices and late ones.
function useOrderPolling(order: OrderDTO | null, watching: boolean, onUpdate: (poll: OrderPoll) => void) {
  const api = useApi();
  const id = watching ? order?.id : undefined;
  const delay = order && (order.status === "pending" || isHeld(order)) ? POLL_MS : CLOSED_POLL_MS;
  useEffect(() => {
    if (!id) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const next = await api<OrderPoll>(`/api/orders/${id}`);
        if (stopped) return;
        onUpdate(next);
        if (!next.watching) return;
      } catch {
        // A dropped poll is fine; the next one catches up.
      }
      if (!stopped) timer = setTimeout(tick, delay);
    };
    timer = setTimeout(tick, delay);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [id, delay, api, onUpdate]);
}

function walletError(error: unknown, currency: Currency) {
  if (error instanceof ApiError) return error.message;
  const text = error instanceof Error ? error.message : String(error);
  if (/reject|cancel|denied|closed|abort/i.test(text)) return "You cancelled in your wallet. Try again when you're ready.";
  return `Your wallet couldn't send the payment. Check it holds enough ${currency} and try again.`;
}

// ---------------------------------------------------------------------------
// Small presentational pieces

function ClockIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cx("shrink-0", className)} fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" strokeLinecap="round" />
    </svg>
  );
}

function AlertIcon({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cx("shrink-0", className)}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5v5.5M12 16.4v.1" />
    </svg>
  );
}

function CrossIcon({ className = "h-3 w-3" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cx("shrink-0", className)} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden>
      <path d="m7 7 10 10M17 7 7 17" />
    </svg>
  );
}

function ErrorText({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="rounded-xl bg-red-500/10 px-4 py-3 text-center text-xs leading-5 text-red-300">
      {children}
    </p>
  );
}

const DEV_BUTTON = buttonClass("ghost", "md", "w-full border border-dashed border-white/20");

function PrivyWalletPay({ order, onSent }: { order: OrderDTO; onSent: () => void }) {
  const api = useApi();
  const { me } = useSession();
  const status = useWalletStatus();
  const { ready, wallets } = useWallets();
  const { signAndSendTransaction } = useSignAndSendTransaction();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The account's own embedded wallet (made at sign-up by WalletSync), and
  // only the one synced for whoever is signed in now: just after switching
  // accounts Privy can still hold the last account's. No other wallets
  // connect here: Phantom and Solflare pay through Solana Pay below.
  const wallet = ready ? payingWallet(wallets, status, me?.id ?? null) : undefined;

  if (!wallet) {
    // Privy couldn't set one up: the QR code and wallet link still work.
    // Anything else (syncing, a switch of account, Privy's list catching up)
    // is still being set up.
    if (status.state === "unavailable" || status.state === "none") return null;
    return (
      <p
        role="status"
        className="flex items-center justify-center gap-2 rounded-2xl bg-[var(--surface)] px-4 py-3 text-xs text-[var(--muted)] ring-1 ring-white/5"
      >
        <span aria-hidden className="h-2 w-2 animate-pulse rounded-full bg-[var(--accent)] motion-reduce:animate-none" />
        Setting up your wallet…
      </p>
    );
  }

  async function pay(from: ConnectedStandardSolanaWallet) {
    setBusy(true);
    setError(null);
    try {
      const { transaction } = await api<{ transaction: string; message: string }>(
        `/api/orders/${order.id}/transaction`,
        { method: "POST", json: { account: from.address } },
      );
      const bytes = Uint8Array.from(atob(transaction), (char) => char.charCodeAt(0));
      // Privy pays the network fee for its own embedded wallets ("App pays"),
      // so USDC buyers need no SOL. Without sponsorship the wallet pays it.
      try {
        await signAndSendTransaction({ transaction: bytes, wallet: from, chain: solanaChain, options: { sponsor: true } });
      } catch (failure) {
        const text = failure instanceof Error ? failure.message : String(failure);
        if (!/sponsor/i.test(text)) throw failure;
        await signAndSendTransaction({ transaction: bytes, wallet: from, chain: solanaChain });
      }
      onSent();
    } catch (failure) {
      setError(walletError(failure, order.currency));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <button type="button" disabled={busy} onClick={() => void pay(wallet)} className={buttonClass("primary", "lg", "w-full")}>
        {busy ? "Confirm in your wallet…" : "Pay from your wallet"}
      </button>
      <p className="text-center text-[11px] text-[var(--muted)]">Your Simulust wallet {shortAddress(wallet.address)}</p>
      {error ? <ErrorText>{error}</ErrorText> : null}
      <div className="flex items-center gap-3 pt-2 text-[11px] font-medium uppercase tracking-wide text-[var(--muted)] md:hidden" aria-hidden>
        <span className="h-px flex-1 bg-[var(--line)]" />
        or
        <span className="h-px flex-1 bg-[var(--line)]" />
      </div>
    </div>
  );
}

// Privy's hooks only work inside PrivyProvider, which only exists when it's configured.
const WalletPay = isPrivyConfigured() ? PrivyWalletPay : null;

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <div className="min-w-0">
        <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted)]">{label}</p>
        <p className="truncate font-mono text-xs text-[var(--ink)]">{value}</p>
      </div>
      <button
        type="button"
        aria-label={copied ? `${label} copied` : `Copy ${label.toLowerCase()}`}
        className={buttonClass("secondary", "sm", "h-10 min-w-[4.5rem]")}
        onClick={() => {
          void navigator.clipboard
            .writeText(value)
            .then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            })
            .catch(() => undefined);
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

// Draws the Solana Pay QR code. The library loads only here, once a checkout
// has an order to pay.
function useQrCode(orderId: string | null) {
  // Kept with the order it was drawn for, so a new order never shows an old code.
  const [drawn, setDrawn] = useState<{ id: string; url: string | null } | null>(null);
  useEffect(() => {
    if (!orderId) return;
    let live = true;
    // A Solana Pay transaction request: the wallet fetches a transaction we
    // build, with the order's reference and memo already inside.
    const link = `solana:${encodeURIComponent(`${window.location.origin}/api/orders/${orderId}/transaction`)}`;
    import("qrcode")
      .then(({ toDataURL }) =>
        toDataURL(link, { margin: 1, width: 232, errorCorrectionLevel: "M", color: { dark: "#0d0d10", light: "#ffffff" } }),
      )
      .then((url) => live && setDrawn({ id: orderId, url }))
      .catch(() => live && setDrawn({ id: orderId, url: null }));
    return () => {
      live = false;
    };
  }, [orderId]);
  const mine = drawn && drawn.id === orderId ? drawn : null;
  return { qr: mine?.url ?? null, failed: mine !== null && mine.url === null };
}

function QrImage({ qr, failed, small }: { qr: string | null; failed: boolean; small?: boolean }) {
  const box = small ? "h-[200px] w-[200px]" : "h-[200px] w-[200px] sm:h-[232px] sm:w-[232px]";
  return (
    <div className="rounded-2xl bg-white p-2.5 shadow-[0_10px_40px_-12px_rgba(255,79,139,0.45)]">
      {qr ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={qr} alt="Solana Pay QR code for this order" width={232} height={232} className={cx("block", box)} />
      ) : failed ? (
        <div className={cx("flex items-center justify-center px-6 text-center text-xs text-neutral-500", box)}>
          Couldn&apos;t draw the QR code. Use Open in wallet app.
        </div>
      ) : (
        <div className={cx("rounded-lg", box, styles.shimmerLight)} role="status">
          <span className="sr-only">Drawing the QR code…</span>
        </div>
      )}
    </div>
  );
}

function ScanCaption({ order }: { order: OrderDTO }) {
  return (
    <p className="mt-3 flex items-start justify-center gap-2 text-center text-xs leading-5 text-[var(--muted)]">
      <CurrencyMark currency={order.currency} className="mt-0.5 h-4 w-4 text-[9px]" />
      <span>Scan with Phantom, Solflare or any Solana Pay wallet. It&apos;s matched to this order automatically.</span>
    </p>
  );
}

function OpenInWallet({ order, className }: { order: OrderDTO; className?: string }) {
  if (!order.solanaPayUrl) return null;
  return (
    <a href={order.solanaPayUrl} className={buttonClass("secondary", "lg", cx("w-full", className))}>
      Open in wallet app
    </a>
  );
}

function canPayId(order: OrderDTO | null, paymentsReady: boolean) {
  return order && paymentsReady && order.status === "pending" && !isHeld(order) ? order.id : null;
}

// From sm up: the QR code in its own card, with its caption and the deep link.
function QrCard({ order, qr, failed, alone }: { order: OrderDTO; qr: string | null; failed: boolean; alone: boolean }) {
  return (
    <div className="rounded-2xl bg-[var(--surface)] p-5 ring-1 ring-white/5">
      <p className="text-center text-sm font-semibold text-[var(--ink)]">{alone ? "Scan to pay" : "Pay from another wallet"}</p>
      <div className="mt-4 flex justify-center">
        <QrImage qr={qr} failed={failed} />
      </div>
      <ScanCaption order={order} />
      <OpenInWallet order={order} className="mt-4" />
    </div>
  );
}

function PaymentDetails({ order }: { order: OrderDTO }) {
  return (
    <details className="group text-xs text-[var(--muted)]">
      <summary className="flex min-h-10 cursor-pointer select-none list-none items-center justify-center gap-1 rounded-full font-medium outline-none hover:text-[var(--ink)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] [&::-webkit-details-marker]:hidden">
        Payment details
        <ChevronRightIcon className="h-4 w-4 transition-transform group-open:rotate-90" />
      </summary>
      <p className="mt-1 leading-5">
        Pay from a wallet, not an exchange. A plain transfer without the reference below can&apos;t be matched to your
        order, so use the QR code or Open in wallet app when you can.
      </p>
      <div className="mt-2 divide-y divide-[var(--line)] rounded-2xl bg-[var(--surface)] px-4 ring-1 ring-white/5">
        <CopyRow label="Send exactly" value={order.amountDisplay} />
        <CopyRow label="To" value={order.recipient} />
        <CopyRow label="Reference" value={order.reference} />
      </div>
    </details>
  );
}

// How much of the price hold is left, as a bar that warms up as it runs down.
function HoldBar({ remaining, closing }: { remaining: number; closing: boolean }) {
  const share = Math.max(0, Math.min(1, remaining / HOLD_MS));
  return (
    <div className="mx-auto mt-4 h-1 max-w-[16rem] overflow-hidden rounded-full bg-white/10" aria-hidden>
      <div
        className={cx(
          "h-full rounded-full transition-[width,background-color] duration-1000 ease-linear",
          closing ? "bg-red-400" : remaining <= 2 * 60_000 ? "bg-[var(--premium)]" : "bg-white/40",
        )}
        style={{ width: `${share * 100}%` }}
      />
    </div>
  );
}

function Body({ children }: { children: ReactNode }) {
  return <div className={cx("space-y-4 px-5 pb-6 pt-5 sm:px-6", styles.fade)}>{children}</div>;
}

const NOTICE_TONES = {
  info: "bg-[var(--surface)] ring-white/5",
  good: "bg-[var(--accent-soft)] ring-[var(--accent)]/30",
  warn: "bg-[var(--premium)]/10 ring-[var(--premium)]/30",
} as const;

function Notice({
  title,
  tone = "info",
  children,
}: {
  title: string;
  tone?: keyof typeof NOTICE_TONES;
  children?: ReactNode;
}) {
  return (
    <div role="status" className={cx("rounded-2xl p-4 ring-1", NOTICE_TONES[tone])}>
      <p className="flex items-center gap-2 text-sm font-semibold text-[var(--ink)]">
        {tone === "good" ? (
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inset-0 animate-ping rounded-full bg-[var(--accent)] opacity-60 motion-reduce:animate-none" />
            <span className="relative h-2.5 w-2.5 rounded-full bg-[var(--accent)]" />
          </span>
        ) : null}
        {title}
      </p>
      {children ? <div className="mt-1 text-xs leading-5 text-[var(--muted)]">{children}</div> : null}
    </div>
  );
}

// Where the buyer is: choosing a currency, paying, waiting on the network and
// final checks, done.
const STEPS = ["Choose", "Pay", "Confirm", "Done"] as const;

// How a stopped checkout looks on the step bar: an expiry is calm, a short or
// late payment a warning, a refused or failed one an error.
type StopTone = "calm" | "warn" | "bad";

function Steps({ current, failed, tone = "bad" }: { current: number; failed: boolean; tone?: StopTone }) {
  return (
    <ol className="flex items-start" aria-label="Checkout progress">
      {STEPS.map((label, index) => {
        const here = index === current;
        const stopped = failed && here;
        const done = index < current || (here && index === STEPS.length - 1 && !failed);
        const live = here && !failed && index > 0 && index < STEPS.length - 1;
        return (
          <li
            key={label}
            className={cx("flex items-start", index < STEPS.length - 1 && "flex-1")}
            aria-current={here ? "step" : undefined}
          >
            <div className="flex w-12 flex-col items-center gap-1.5">
              <span
                className={cx(
                  "relative flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold transition-colors",
                  stopped
                    ? tone === "calm"
                      ? "bg-white/15 text-[var(--ink)]"
                      : tone === "warn"
                        ? "bg-[var(--premium)] text-[#1a1206]"
                        : "bg-red-400 text-[#1a0a0a]"
                    : done
                      ? "bg-[var(--accent)] text-[var(--accent-ink)]"
                      : here
                        ? "bg-[var(--accent)] text-[var(--accent-ink)] ring-4 ring-[var(--accent-soft)]"
                        : "text-[var(--muted)] ring-1 ring-inset ring-white/15",
                )}
              >
                {stopped ? (
                  tone === "calm" ? <ClockIcon className="h-3.5 w-3.5" /> : <CrossIcon />
                ) : done ? (
                  <CheckIcon className="h-3 w-3" />
                ) : (
                  index + 1
                )}
                {live ? (
                  <span
                    aria-hidden
                    className="absolute -inset-[5px] animate-spin rounded-full border-2 border-transparent border-t-[var(--accent)] motion-reduce:hidden"
                  />
                ) : null}
              </span>
              <span
                className={cx(
                  "text-xs font-semibold",
                  stopped && tone === "bad" ? "text-red-300" : index <= current ? "text-[var(--ink)]" : "text-[var(--muted)]",
                )}
              >
                {label}
                {stopped ? <span className="sr-only"> (stopped)</span> : done ? <span className="sr-only"> (done)</span> : null}
              </span>
            </div>
            {index < STEPS.length - 1 ? (
              <span
                aria-hidden
                className={cx(
                  "-mx-3 mt-[11px] h-0.5 flex-1 rounded-full transition-colors",
                  index < current ? "bg-[var(--accent)]" : "bg-white/10",
                )}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function SummaryRow({ label, value, strong }: { label: string; value: ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <dt className={strong ? "font-semibold text-[var(--ink)]" : "text-[var(--muted)]"}>{label}</dt>
      <dd className={cx("text-right", strong ? "text-base font-bold text-[var(--ink)]" : "font-medium text-[var(--ink)]")}>
        {value}
      </dd>
    </div>
  );
}

// The look of each closed status. The words stay in CLOSED_COPY.
const CLOSED_TONE: Record<string, { tone: StopTone; badge: string }> = {
  expired: { tone: "calm", badge: "bg-white/5 text-[var(--muted)]" },
  underpaid: { tone: "warn", badge: "bg-[var(--premium)]/10 text-[var(--premium)]" },
  refund_due: { tone: "warn", badge: "bg-[var(--premium)]/10 text-[var(--premium)]" },
  blocked: { tone: "bad", badge: "bg-red-500/10 text-red-300" },
  failed: { tone: "bad", badge: "bg-red-500/10 text-red-300" },
};

// Counts up to a number once, over a moment; straight to it for reduced motion.
function useCountUp(target: number, ms = 600) {
  const [value, setValue] = useState(() => (prefersReducedMotion() ? target : 0));
  useEffect(() => {
    if (prefersReducedMotion()) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / ms);
      setValue(Math.round(target * (1 - Math.pow(1 - progress, 3))));
      if (progress < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return value;
}

function Received({ credits }: { credits: number }) {
  const shown = useCountUp(credits);
  return (
    <p className="mt-3 flex items-center gap-1.5 text-3xl font-bold tracking-tight text-[var(--premium)] tabular-nums">
      <CoinIcon className="h-7 w-7" />+{shown.toLocaleString("en-US")}
    </p>
  );
}

const CLOSED_COPY: Record<string, { title: string; body: string }> = {
  expired: {
    title: "This checkout expired",
    body: "No payment arrived in time. A payment that lands within an hour of the checkout closing is still added. One that lands later isn't: contact support with your order number for a refund. Start again for a fresh price.",
  },
  underpaid: {
    title: "We received less than the amount due",
    body: "Nothing was added. Contact support with your order number for a refund or to add the difference.",
  },
  blocked: {
    title: "We can't accept this payment",
    body: "The sending wallet didn't pass our sanctions screening, so nothing was added. Contact support with your order number.",
  },
  refund_due: {
    title: "This payment arrived too late",
    body: "It landed more than an hour after the checkout closed, so nothing was added. Contact support with your order number for a refund.",
  },
  failed: {
    title: "This payment failed",
    body: "Nothing was added. Start again to try another payment.",
  },
};

export function Checkout({ product, onClose }: { product: Product; onClose: () => void }) {
  const api = useApi();
  const { me, features, refreshMe } = useSession();
  const [currency, setCurrency] = useState<Currency>("USDC");
  const [order, setOrder] = useState<OrderDTO | null>(null);
  const [watching, setWatching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const remaining = useRemaining(order?.status === "pending" ? order.expiresAt : null);
  const paymentsReady = features?.payments === true;
  const settled = order?.status === "confirmed" || order?.status === "finalized";
  const held = order !== null && isHeld(order);
  const closed = order !== null && !settled && order.status !== "pending" && !held;

  const onUpdate = useCallback((poll: OrderPoll) => {
    setOrder(poll.order);
    setWatching(poll.watching);
  }, []);
  useOrderPolling(order, watching, onUpdate);

  useEffect(() => {
    if (settled) void refreshMe();
  }, [settled, refreshMe]);

  // Closing plays the sheet's exit first; the shop unmounts it after.
  const [leaving, setLeaving] = useState(false);
  const leaveTimer = useRef<number | undefined>(undefined);
  const close = useCallback(() => {
    if (leaveTimer.current !== undefined) return;
    if (prefersReducedMotion()) {
      onClose();
      return;
    }
    setLeaving(true);
    leaveTimer.current = window.setTimeout(onClose, 180);
  }, [onClose]);
  useEffect(() => () => window.clearTimeout(leaveTimer.current), []);

  // Focus moves into the sheet and stays there, Escape closes it, the page
  // behind doesn't scroll, and focus returns to the Buy button afterwards.
  useDialog(sheet, close);

  async function start(simulate = false) {
    setBusy(true);
    setError(null);
    setSent(false);
    try {
      const created = await api<{ order: OrderDTO }>("/api/orders", {
        method: "POST",
        json: { productId: product.id, currency },
      });
      setOrder(created.order);
      setWatching(true);
      if (simulate) await simulatePayment(created.order.id);
    } catch (failure) {
      setError(messageOf(failure, "We couldn't start the checkout. Try again."));
    } finally {
      setBusy(false);
    }
  }

  async function simulatePayment(id: string) {
    setBusy(true);
    setError(null);
    try {
      onUpdate(await api<OrderPoll>(`/api/orders/${id}/dev-settle`, { method: "POST" }));
    } catch (failure) {
      setError(messageOf(failure, "The simulated payment failed."));
    } finally {
      setBusy(false);
    }
  }

  const what = product.memberDays
    ? `${product.memberDays} days of membership + ${formatCredits(product.credits)}`
    : formatCredits(product.credits);

  const step = settled ? 3 : closed ? (order?.status === "blocked" ? 2 : 1) : held || sent ? 2 : order ? 1 : 0;

  // Only an order that can still be paid gets a QR code.
  const qr = useQrCode(canPayId(order, paymentsReady));
  const closedTone = order && closed ? (CLOSED_TONE[order.status] ?? CLOSED_TONE.failed) : null;
  // Stop offering ways to pay a minute before the price hold ends (the
  // payment route refuses then too): a payment sent later could land too
  // late to be credited.
  const closing = remaining <= MIN_REMAINING_MS;
  const canPay = order !== null && !settled && !closed && paymentsReady && !held && !closing;

  let body: ReactNode;
  if (settled && order) {
    body = (
      <Body>
        <div className="flex flex-col items-center rounded-2xl bg-[var(--surface)] px-5 py-8 text-center ring-1 ring-white/5" role="status">
          <span
            className={cx(
              "flex h-16 w-16 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--accent-ink)] shadow-[0_12px_32px_-8px_rgba(255,79,139,0.7)]",
              styles.pop,
            )}
          >
            <CheckIcon className="h-8 w-8" />
          </span>
          <p className="mt-4 text-xl font-bold tracking-tight text-[var(--ink)]">Payment received</p>
          <Received credits={product.credits} />
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
            {formatCredits(product.credits)} added.
            {me ? ` Your balance is ${formatCredits(me.balance)}.` : null}
          </p>
          {product.memberDays && me?.memberUntil ? (
            <p className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-full bg-[var(--premium)]/10 px-3 text-sm font-semibold text-[var(--premium)]">
              <PremiumIcon className="h-4 w-4" />
              Member until {formatDate(me.memberUntil)}
            </p>
          ) : null}
          {order.signature && !order.signature.startsWith("dev-") ? (
            <a
              href={explorerUrl(order.signature, features?.solanaCluster)}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex min-h-10 items-center text-sm font-semibold !text-[var(--accent)] underline-offset-2 hover:!underline"
            >
              View receipt on Solscan ↗
            </a>
          ) : null}
        </div>
        <button type="button" className={buttonClass("primary", "lg", "w-full")} onClick={close}>
          Done
        </button>
        <Link href="/chat" className={buttonClass("secondary", "lg", "w-full")}>
          Start chatting
        </Link>
      </Body>
    );
  } else if (order && closed && closedTone) {
    const copy = CLOSED_COPY[order.status] ?? CLOSED_COPY.failed;
    body = (
      <Body>
        <div className="flex flex-col items-center rounded-2xl bg-[var(--surface)] px-5 py-7 text-center ring-1 ring-white/5" role="status">
          <span className={cx("flex h-14 w-14 items-center justify-center rounded-full", closedTone.badge)}>
            {closedTone.tone === "calm" ? <ClockIcon className="h-7 w-7" /> : <AlertIcon />}
          </span>
          <p className="mt-4 text-lg font-bold tracking-tight text-[var(--ink)]">{copy.title}</p>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{copy.body}</p>
        </div>
        <div className="rounded-2xl bg-[var(--surface)] px-4 ring-1 ring-white/5">
          <CopyRow label="Order number" value={order.id} />
        </div>
        <button
          type="button"
          className={buttonClass("primary", "lg", "w-full")}
          onClick={() => {
            setOrder(null);
            setWatching(false);
          }}
        >
          Start again
        </button>
      </Body>
    );
  } else if (order) {
    body = (
      <Body>
        <div className={cx(canPay && "md:grid md:grid-cols-[minmax(0,1fr)_19rem] md:items-start md:gap-6")}>
          <div className="space-y-4">
            <div className="rounded-2xl bg-[var(--surface)] px-5 py-5 text-center ring-1 ring-white/5">
              <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted)]">Amount due</p>
              <p className="mt-2 flex items-center justify-center gap-2 text-3xl font-bold tracking-tight text-[var(--ink)] tabular-nums">
                <CurrencyMark currency={order.currency} className="h-7 w-7 text-xs" />
                {order.amountDisplay}
              </p>
              <p className="mt-1 text-xs text-[var(--muted)]">{formatUsd(order.usdCents)}</p>
              {!held && remaining > 0 ? <HoldBar remaining={remaining} closing={closing} /> : null}
              <p
                className={cx(
                  "mt-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold tabular-nums",
                  held
                    ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                    : closing
                      ? "bg-red-500/10 text-red-300"
                      : remaining <= 2 * 60_000
                        ? "bg-[var(--premium)]/10 text-[var(--premium)]"
                        : "bg-white/5 text-[var(--ink)]",
                )}
              >
                {held ? <CheckIcon className="h-3.5 w-3.5" /> : <ClockIcon />}
                {held
                  ? "Payment received"
                  : remaining > 0
                    ? `Price held for ${formatClock(remaining)}`
                    : "Checking for a late payment…"}
              </p>
            </div>
            {held ? (
              <Notice title="Payment received" tone="good">
                Final checks are running. This can take a few minutes. You can close this window; your credits will be
                added automatically.
              </Notice>
            ) : sent ? (
              <Notice title="Sent" tone="good">
                Waiting for the Solana network to confirm. This usually takes a few seconds.
              </Notice>
            ) : closing ? (
              <Notice title={remaining > 0 ? "The price hold is ending" : "The price hold has ended"} tone="warn">
                Don&apos;t send a payment now. If you already sent one, we&apos;re still looking for it.
              </Notice>
            ) : null}
            {canPay && WalletPay ? <WalletPay order={order} onSent={() => setSent(true)} /> : null}
            {canPay ? (
              // Phones: the wallet is usually on this device, so the deep link
              // comes first and the QR code waits behind a tap.
              <div className="space-y-3 sm:hidden">
                <OpenInWallet order={order} />
                <details className="group rounded-2xl bg-[var(--surface)] ring-1 ring-white/5">
                  <summary className="flex min-h-12 cursor-pointer select-none list-none items-center justify-between gap-2 px-4 text-sm font-semibold text-[var(--ink)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] [&::-webkit-details-marker]:hidden">
                    Pay from another device
                    <ChevronRightIcon className="h-4 w-4 text-[var(--muted)] transition-transform group-open:rotate-90" />
                  </summary>
                  <div className="flex flex-col items-center px-4 pb-4">
                    <QrImage qr={qr.qr} failed={qr.failed} small />
                    <ScanCaption order={order} />
                  </div>
                </details>
              </div>
            ) : null}
            {IS_DEV && !held ? (
              <button
                type="button"
                disabled={busy}
                className={DEV_BUTTON}
                onClick={() => void simulatePayment(order.id)}
              >
                Simulate payment (development only)
              </button>
            ) : null}
          </div>
          {canPay ? (
            <div className="mt-4 hidden sm:block md:mt-0">
              <QrCard order={order} qr={qr.qr} failed={qr.failed} alone={!WalletPay} />
            </div>
          ) : null}
        </div>
        {canPay ? <PaymentDetails order={order} /> : null}
      </Body>
    );
  } else {
    body = (
      <Body>
        {paymentsReady ? (
          <>
            <fieldset>
              <legend className="text-sm font-semibold text-[var(--ink)]">Pay with</legend>
              <div className="mt-3 grid grid-cols-2 gap-3">
                {(
                  [
                    ["USDC", "Digital dollars. 1 USDC is always $1."],
                    ["SOL", "Priced at checkout and held for 15 minutes."],
                  ] as const
                ).map(([value, hint]) => {
                  const on = currency === value;
                  return (
                    <label
                      key={value}
                      className={cx(
                        "relative flex cursor-pointer flex-col rounded-2xl p-4 transition has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--accent)]",
                        on
                          ? "bg-[var(--accent-soft)] ring-2 ring-[var(--accent)]"
                          : "bg-[var(--surface)] ring-1 ring-white/10 hover:ring-white/25",
                      )}
                    >
                      <input
                        type="radio"
                        name="currency"
                        value={value}
                        checked={on}
                        onChange={() => setCurrency(value)}
                        className="sr-only"
                      />
                      <span className="flex items-center gap-2">
                        <CurrencyMark currency={value} className="h-7 w-7 text-xs" />
                        <span className="text-base font-bold text-[var(--ink)]">{value}</span>
                      </span>
                      <span className="mt-2 block text-xs leading-5 text-[var(--muted)]">{hint}</span>
                      {on ? (
                        <span
                          className={cx(
                            "absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--accent-ink)]",
                            styles.pop,
                          )}
                        >
                          <CheckIcon className="h-3.5 w-3.5" />
                        </span>
                      ) : null}
                    </label>
                  );
                })}
              </div>
            </fieldset>
            <dl className="divide-y divide-[var(--line)] rounded-2xl bg-[var(--surface)] px-4 text-sm ring-1 ring-white/5">
              {product.memberDays ? <SummaryRow label="Membership" value={`${product.memberDays} days`} /> : null}
              <SummaryRow label="Credits" value={product.credits.toLocaleString("en-US")} />
              <SummaryRow label="Total" value={formatUsd(product.usdCents)} strong />
            </dl>
            <button
              type="button"
              disabled={busy}
              className={buttonClass("primary", "lg", "w-full")}
              onClick={() => void start()}
            >
              {busy ? "Starting checkout…" : `Continue with ${currency}`}
            </button>
          </>
        ) : (
          <Notice title="Payments aren't configured yet">
            Checkout opens once a payment address is set up. Nothing has been charged.
          </Notice>
        )}
        {!paymentsReady && IS_DEV ? (
          <button type="button" disabled={busy} className={DEV_BUTTON} onClick={() => void start(true)}>
            {busy ? "Simulating…" : "Simulate payment (development only)"}
          </button>
        ) : null}
        <div className="space-y-2 pt-1">
          <TrustRow compact />
          <p className="text-center text-[11px] leading-4 text-[var(--muted)]">
            Unused credits can be refunded within 14 days.
          </p>
        </div>
      </Body>
    );
  }

  return (
    <div
      className={cx(
        "fixed inset-0 z-50 flex items-end justify-center bg-black/75 backdrop-blur-sm sm:items-center sm:px-4",
        leaving ? styles.overlayOut : styles.overlayIn,
      )}
      role="dialog"
      aria-modal="true"
      aria-label={`Buy ${product.name}`}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        ref={sheet}
        tabIndex={-1}
        className={cx(
          "max-h-[92dvh] w-full max-w-md overflow-y-auto overscroll-contain rounded-t-3xl bg-[var(--bg-2)] pb-[env(safe-area-inset-bottom)] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)] outline-none ring-1 ring-white/10 transition-[max-width] duration-300 ease-out sm:rounded-3xl",
          canPay && "md:max-w-3xl",
          leaving ? styles.sheetOut : styles.sheetIn,
        )}
      >
        <div className="flex items-start gap-3 px-5 pt-5 sm:px-6 sm:pt-6">
          <span
            className={cx(
              "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl",
              product.memberDays
                ? "bg-gradient-to-br from-[var(--premium)] to-[var(--premium-2)] text-[#1a1206]"
                : "bg-[var(--premium)]/15 text-[var(--premium)]",
            )}
          >
            {product.memberDays ? <PremiumIcon className="h-6 w-6" /> : <CoinIcon className="h-6 w-6" />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--premium)]">
              {product.memberDays ? "Membership" : "Credit pack"}
            </p>
            <h2 className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xl font-bold leading-tight tracking-tight text-[var(--ink)]">
              {product.name}
              {product.tag ? (
                <span className="rounded-full bg-[var(--premium)]/15 px-2 py-0.5 text-[11px] font-bold tracking-normal text-[var(--premium)]">
                  {product.tag}
                </span>
              ) : null}
            </h2>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              {what} · {formatUsd(product.usdCents)}
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            className="-mr-2 -mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[var(--muted)] hover:bg-white/5 hover:text-[var(--ink)]"
            onClick={close}
          >
            <CloseIcon />
          </button>
        </div>
        {!paymentsReady && !order ? null : (
          <div className="px-5 pt-5 sm:px-6">
            <Steps current={step} failed={closed} tone={closedTone?.tone} />
          </div>
        )}
        {error ? (
          <div className="px-5 pt-4 sm:px-6">
            <ErrorText>{error}</ErrorText>
          </div>
        ) : null}
        {body}
      </div>
    </div>
  );
}
