"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { toDataURL } from "qrcode";
import { useSignAndSendTransaction, useWallets, type ConnectedStandardSolanaWallet } from "@privy-io/react-auth/solana";
import { useSession } from "@/components/auth-gate";
import { ChevronRightIcon, CloseIcon, CoinIcon } from "@/components/icons";
import { CheckIcon, CurrencyMark } from "@/components/premium/parts";
import { PremiumIcon } from "@/components/premium-icon";
import { isPrivyConfigured, solanaChain } from "@/components/privy-app";
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

type ButtonVariant = Parameters<typeof buttonClass>[0];
type ButtonSize = Parameters<typeof buttonClass>[1];

export function BuyButton({
  product,
  label,
  variant = "secondary",
  size = "md",
  className,
  "aria-label": ariaLabel,
  onBuy,
}: {
  product: Product;
  label?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  "aria-label"?: string;
  onBuy: (product: Product) => void;
}) {
  const { session, openLogin } = useSession();
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      className={buttonClass(variant, size, cx("w-full", className))}
      onClick={() => (session ? onBuy(product) : openLogin())}
    >
      {label ?? `Buy for ${formatUsd(product.usdCents)}`}
    </button>
  );
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

// A payment arrived and waits on final checks (sanctions screening) before
// anything is added. The checkout may have closed meanwhile: the payment can
// have landed just before it did.
export function isHeld(order: OrderDTO) {
  return order.signature !== null && ["pending", "expired", "underpaid"].includes(order.status);
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
  const { ready, wallets } = useWallets();
  const { signAndSendTransaction } = useSignAndSendTransaction();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!ready) return <p className="text-center text-xs text-[var(--muted)]">Loading your wallet…</p>;
  if (!wallets.length) return null;

  async function pay(wallet: ConnectedStandardSolanaWallet) {
    setBusy(wallet.address);
    setError(null);
    try {
      const { transaction } = await api<{ transaction: string; message: string }>(
        `/api/orders/${order.id}/transaction`,
        { method: "POST", json: { account: wallet.address } },
      );
      const bytes = Uint8Array.from(atob(transaction), (char) => char.charCodeAt(0));
      // Privy pays the network fee for its own embedded wallets ("App pays"),
      // so USDC buyers need no SOL. External wallets pay their own fee.
      const embedded = "privy:" in wallet.standardWallet.features;
      try {
        await signAndSendTransaction({ transaction: bytes, wallet, chain: solanaChain, options: { sponsor: embedded } });
      } catch (failure) {
        const text = failure instanceof Error ? failure.message : String(failure);
        if (!embedded || !/sponsor/i.test(text)) throw failure;
        await signAndSendTransaction({ transaction: bytes, wallet, chain: solanaChain });
      }
      onSent();
    } catch (failure) {
      setError(walletError(failure, order.currency));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-2">
      {wallets.slice(0, 3).map((wallet) => (
        <button
          key={wallet.address}
          type="button"
          disabled={busy !== null}
          onClick={() => void pay(wallet)}
          className={buttonClass("primary", "lg", "w-full")}
        >
          {busy === wallet.address
            ? "Confirm in your wallet…"
            : wallets.length > 1
              ? `Pay with ${wallet.standardWallet.name} ${shortAddress(wallet.address)}`
              : "Pay with wallet"}
        </button>
      ))}
      {wallets.length === 1 ? (
        <p className="text-center text-[11px] text-[var(--muted)]">From {shortAddress(wallets[0].address)}</p>
      ) : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
      <div className="flex items-center gap-3 pt-2 text-[11px] font-medium uppercase tracking-wide text-[var(--muted)]" aria-hidden>
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

function OtherWallet({ order, alone }: { order: OrderDTO; alone: boolean }) {
  const [qr, setQr] = useState<string | null>(null);
  const [qrFailed, setQrFailed] = useState(false);

  useEffect(() => {
    let live = true;
    // A Solana Pay transaction request: the wallet fetches a transaction we
    // build, with the order's reference and memo already inside.
    const link = `solana:${encodeURIComponent(`${window.location.origin}/api/orders/${order.id}/transaction`)}`;
    toDataURL(link, { margin: 1, width: 232, errorCorrectionLevel: "M", color: { dark: "#0d0d10", light: "#ffffff" } })
      .then((url) => live && setQr(url))
      .catch(() => live && setQrFailed(true));
    return () => {
      live = false;
    };
  }, [order.id]);

  return (
    <div className="rounded-2xl bg-[var(--surface)] p-4 ring-1 ring-white/5 sm:p-5">
      <p className="text-sm font-semibold text-[var(--ink)]">{alone ? "Pay from your wallet" : "Pay from another wallet"}</p>
      <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
        Scan with Phantom, Solflare or any Solana Pay wallet. The payment is matched to this order automatically.
      </p>
      <div className="mt-4 flex justify-center">
        <div className="rounded-2xl bg-white p-2.5 shadow-[0_10px_40px_-12px_rgba(255,79,139,0.45)]">
          {qr ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qr} alt="Solana Pay QR code for this order" width={232} height={232} className="block h-[200px] w-[200px] sm:h-[232px] sm:w-[232px]" />
          ) : (
            <div className="flex h-[200px] w-[200px] items-center justify-center px-6 text-center text-xs text-neutral-500 sm:h-[232px] sm:w-[232px]">
              {qrFailed ? "Couldn't draw the QR code. Use Open in wallet." : "Drawing QR code…"}
            </div>
          )}
        </div>
      </div>
      {order.solanaPayUrl ? (
        <a href={order.solanaPayUrl} className={buttonClass("secondary", "lg", "mt-4 w-full")}>
          Open in wallet app
        </a>
      ) : null}
      <details className="group mt-3 text-xs text-[var(--muted)]">
        <summary className="flex min-h-10 cursor-pointer select-none list-none items-center justify-center gap-1 font-medium hover:text-[var(--ink)] [&::-webkit-details-marker]:hidden">
          Payment details
          <ChevronRightIcon className="h-4 w-4 transition-transform group-open:rotate-90" />
        </summary>
        <p className="mt-1 leading-5">
          Pay from a wallet, not an exchange. A plain transfer without the reference below can&apos;t be matched to your
          order, so use the QR code or Open in wallet app when you can.
        </p>
        <div className="mt-2 divide-y divide-[var(--line)]">
          <CopyRow label="Send exactly" value={order.amountDisplay} />
          <CopyRow label="To" value={order.recipient} />
          <CopyRow label="Reference" value={order.reference} />
        </div>
      </details>
    </div>
  );
}

function Body({ children }: { children: ReactNode }) {
  return <div className="space-y-4 px-5 pb-6 pt-5 sm:px-6">{children}</div>;
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

function Steps({ current, failed }: { current: number; failed: boolean }) {
  return (
    <ol className="flex gap-2" aria-label="Checkout progress">
      {STEPS.map((label, index) => {
        const reached = index <= current;
        const bad = failed && index === current;
        const live = !failed && index === current && current < STEPS.length - 1;
        return (
          <li key={label} className="flex flex-1 flex-col gap-1.5" aria-current={index === current ? "step" : undefined}>
            <span
              className={cx(
                "h-1 rounded-full",
                bad ? "bg-red-400" : reached ? "bg-[var(--accent)]" : "bg-white/10",
                live && index > 0 && "animate-pulse motion-reduce:animate-none",
              )}
            />
            <span
              className={cx(
                "text-[11px] font-semibold",
                bad ? "text-red-300" : reached ? "text-[var(--ink)]" : "text-[var(--muted)]",
              )}
            >
              {label}
              {bad ? <span className="sr-only"> (stopped)</span> : null}
            </span>
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

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Move focus into the dialog so keyboard and screen reader users land in it.
  useEffect(() => {
    sheet.current?.focus();
  }, []);

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

  let body: ReactNode;
  if (settled && order) {
    body = (
      <Body>
        <div className="flex flex-col items-center rounded-2xl bg-[var(--surface)] px-5 py-8 text-center ring-1 ring-white/5" role="status">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--accent-ink)] shadow-[0_12px_32px_-8px_rgba(255,79,139,0.7)]">
            <CheckIcon className="h-8 w-8" />
          </span>
          <p className="mt-4 text-xl font-bold tracking-tight text-[var(--ink)]">Payment received</p>
          <p className="mt-3 flex items-center gap-1.5 text-3xl font-bold tracking-tight text-[var(--premium)]">
            <CoinIcon className="h-7 w-7" />+{product.credits.toLocaleString("en-US")}
          </p>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
            {formatCredits(product.credits)} added.
            {me ? ` Your balance is ${formatCredits(me.balance)}.` : null}
          </p>
          {product.memberDays && me?.memberUntil ? (
            <p className="mt-1 text-sm leading-6 text-[var(--ink)]">
              You&apos;re a member until {new Date(me.memberUntil).toLocaleDateString()}.
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
        <button type="button" className={buttonClass("primary", "lg", "w-full")} onClick={onClose}>
          Done
        </button>
      </Body>
    );
  } else if (order && closed) {
    const copy = CLOSED_COPY[order.status] ?? CLOSED_COPY.failed;
    body = (
      <Body>
        <div className="flex flex-col items-center rounded-2xl bg-[var(--surface)] px-5 py-7 text-center ring-1 ring-white/5" role="status">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-red-500/10 text-red-300">
            <AlertIcon />
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
    // Stop offering ways to pay a minute before the price hold ends (the
    // payment route refuses then too): a payment sent later could land too
    // late to be credited.
    const closing = remaining <= MIN_REMAINING_MS;
    const canPay = paymentsReady && !held && !closing;
    body = (
      <Body>
        <div className="rounded-2xl bg-[var(--surface)] px-5 py-5 text-center ring-1 ring-white/5">
          <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted)]">Amount due</p>
          <p className="mt-2 flex items-center justify-center gap-2 text-3xl font-bold tracking-tight text-[var(--ink)]">
            <CurrencyMark currency={order.currency} className="h-7 w-7 text-xs" />
            {order.amountDisplay}
          </p>
          <p className="mt-1 text-xs text-[var(--muted)]">{formatUsd(order.usdCents)}</p>
          <p
            className={cx(
              "mt-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold tabular-nums",
              held
                ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                : closing
                  ? "bg-red-500/10 text-red-300"
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
        {canPay ? <OtherWallet order={order} alone={!WalletPay} /> : null}
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
                        <span className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--accent-ink)]">
                          <CheckIcon className="h-3 w-3" />
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
        <p className="text-center text-[11px] leading-4 text-[var(--muted)]">
          Credits never expire. Unused credits can be refunded within 14 days.
        </p>
      </Body>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 backdrop-blur-sm sm:items-center sm:px-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Buy ${product.name}`}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={sheet}
        tabIndex={-1}
        className="max-h-[92dvh] w-full max-w-md overflow-y-auto overscroll-contain rounded-t-3xl bg-[var(--bg-2)] pb-[env(safe-area-inset-bottom)] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)] outline-none ring-1 ring-white/10 sm:rounded-3xl"
      >
        <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-white/15 sm:hidden" aria-hidden />
        <div className="flex items-start gap-3 px-5 pt-4 sm:px-6 sm:pt-6">
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
            <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--premium)]">{product.tag ?? "Credits"}</p>
            <h2 className="text-xl font-bold leading-tight tracking-tight text-[var(--ink)]">{product.name}</h2>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              {what} · {formatUsd(product.usdCents)}
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            className="-mr-2 -mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[var(--muted)] hover:bg-white/5 hover:text-[var(--ink)]"
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </div>
        <div className="px-5 pt-5 sm:px-6">
          <Steps current={step} failed={closed} />
        </div>
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
