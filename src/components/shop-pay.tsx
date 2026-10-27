"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { toDataURL } from "qrcode";
import { useSignAndSendTransaction, useWallets, type ConnectedStandardSolanaWallet } from "@privy-io/react-auth/solana";
import { useSession } from "@/components/auth-gate";
import { isPrivyConfigured, solanaChain } from "@/components/privy-app";
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

export function BuyButton({
  product,
  label,
  gold = false,
  compact = false,
  onBuy,
}: {
  product: Product;
  label?: string;
  gold?: boolean;
  compact?: boolean;
  onBuy: (product: Product) => void;
}) {
  const { session, openLogin } = useSession();
  return (
    <button
      type="button"
      className={`w-full rounded-full text-sm font-medium ${compact ? "px-4 py-2" : "px-5 py-3"} ${
        gold
          ? "bg-[var(--gold)] !text-[#12110F]"
          : "border border-white/20 text-[var(--ink)] hover:border-[var(--ink)]"
      }`}
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
          className="flex w-full items-center justify-center gap-2 rounded-full bg-[var(--gold)] px-5 py-3 text-sm font-medium !text-[#12110F] disabled:opacity-60"
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
      {error ? <p className="text-center text-xs leading-5 text-[#e8a39a]">{error}</p> : null}
    </div>
  );
}

// Privy's hooks only work inside PrivyProvider, which only exists when it's configured.
const WalletPay = isPrivyConfigured() ? PrivyWalletPay : null;

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-wide text-[var(--muted)]">{label}</p>
        <p className="truncate font-mono text-xs text-[var(--ink)]">{value}</p>
      </div>
      <button
        type="button"
        className="shrink-0 rounded-full border border-white/15 px-3 py-1 text-xs text-[var(--ink)] hover:border-[var(--ink)]"
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

function OtherWallet({ order }: { order: OrderDTO }) {
  const [qr, setQr] = useState<string | null>(null);
  const [qrFailed, setQrFailed] = useState(false);

  useEffect(() => {
    let live = true;
    // A Solana Pay transaction request: the wallet fetches a transaction we
    // build, with the order's reference and memo already inside.
    const link = `solana:${encodeURIComponent(`${window.location.origin}/api/orders/${order.id}/transaction`)}`;
    toDataURL(link, { margin: 1, width: 232, errorCorrectionLevel: "M", color: { dark: "#12110F", light: "#F3EFE6" } })
      .then((url) => live && setQr(url))
      .catch(() => live && setQrFailed(true));
    return () => {
      live = false;
    };
  }, [order.id]);

  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--bg-2)] p-4">
      <p className="text-sm font-medium text-[var(--ink)]">Pay from another wallet</p>
      <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
        Scan with Phantom, Solflare or any Solana Pay wallet. The payment is matched to this order automatically.
      </p>
      <div className="mt-3 flex justify-center">
        {qr ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={qr} alt="Solana Pay QR code for this order" width={232} height={232} className="rounded-xl" />
        ) : (
          <div className="flex h-[232px] w-[232px] items-center justify-center rounded-xl bg-white/5 text-xs text-[var(--muted)]">
            {qrFailed ? "Couldn't draw the QR code. Use Open in wallet." : "Drawing QR code…"}
          </div>
        )}
      </div>
      {order.solanaPayUrl ? (
        <a
          href={order.solanaPayUrl}
          className="mt-3 block w-full rounded-full border border-white/20 px-5 py-2.5 text-center text-sm text-[var(--ink)] hover:border-[var(--ink)]"
        >
          Open in wallet app
        </a>
      ) : null}
      <details className="mt-3 text-xs text-[var(--muted)]">
        <summary className="cursor-pointer select-none">Payment details</summary>
        <p className="mt-2 leading-5">
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

function Panel({ children }: { children: ReactNode }) {
  return <div className="space-y-4 px-5 pb-5">{children}</div>;
}

function Notice({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--bg-2)] p-4">
      <p className="text-sm font-medium text-[var(--ink)]">{title}</p>
      {children ? <div className="mt-1 text-xs leading-5 text-[var(--muted)]">{children}</div> : null}
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
  const remaining = useRemaining(order?.status === "pending" ? order.expiresAt : null);
  const paymentsReady = features?.payments === true;
  const settled = order?.status === "confirmed" || order?.status === "finalized";
  const held = order !== null && isHeld(order);

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

  let body: ReactNode;
  if (settled && order) {
    body = (
      <Panel>
        <Notice title="Payment received">
          <p>
            {formatCredits(product.credits)} added.
            {me ? ` Your balance is ${formatCredits(me.balance)}.` : null}
          </p>
          {product.memberDays && me?.memberUntil ? (
            <p>You&apos;re a member until {new Date(me.memberUntil).toLocaleDateString()}.</p>
          ) : null}
          {order.signature && !order.signature.startsWith("dev-") ? (
            <a
              href={explorerUrl(order.signature, features?.solanaCluster)}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-block text-[var(--gold)] underline-offset-2 hover:underline"
            >
              View receipt on Solscan
            </a>
          ) : null}
        </Notice>
        <button
          type="button"
          className="w-full rounded-full bg-[var(--gold)] px-5 py-3 text-sm font-medium !text-[#12110F]"
          onClick={onClose}
        >
          Done
        </button>
      </Panel>
    );
  } else if (order && order.status !== "pending" && !held) {
    const copy = CLOSED_COPY[order.status] ?? CLOSED_COPY.failed;
    body = (
      <Panel>
        <Notice title={copy.title}>
          <p>{copy.body}</p>
          <p className="mt-1 font-mono text-[11px]">Order {order.id}</p>
        </Notice>
        <button
          type="button"
          className="w-full rounded-full border border-white/20 px-5 py-3 text-sm text-[var(--ink)] hover:border-[var(--ink)]"
          onClick={() => {
            setOrder(null);
            setWatching(false);
          }}
        >
          Start again
        </button>
      </Panel>
    );
  } else if (order) {
    // Stop offering ways to pay a minute before the price hold ends (the
    // payment route refuses then too): a payment sent later could land too
    // late to be credited.
    const closing = remaining <= MIN_REMAINING_MS;
    const canPay = paymentsReady && !held && !closing;
    body = (
      <Panel>
        <div className="text-center">
          <p className="text-[11px] uppercase tracking-wide text-[var(--muted)]">Amount due</p>
          <p className="mt-1 font-[family-name:var(--font-display)] text-3xl text-[var(--ink)]">{order.amountDisplay}</p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            {formatUsd(order.usdCents)} ·{" "}
            {held
              ? "payment received"
              : remaining > 0
                ? `price held for ${formatClock(remaining)}`
                : "checking for a late payment…"}
          </p>
        </div>
        {held ? (
          <Notice title="Payment received">
            Final checks are running. This can take a few minutes. You can close this window; your credits will be
            added automatically.
          </Notice>
        ) : sent ? (
          <Notice title="Sent">Waiting for the Solana network to confirm. This usually takes a few seconds.</Notice>
        ) : closing ? (
          <Notice title={remaining > 0 ? "The price hold is ending" : "The price hold has ended"}>
            Don&apos;t send a payment now. If you already sent one, we&apos;re still looking for it.
          </Notice>
        ) : null}
        {canPay && WalletPay ? <WalletPay order={order} onSent={() => setSent(true)} /> : null}
        {canPay ? <OtherWallet order={order} /> : null}
        {IS_DEV && !held ? (
          <button
            type="button"
            disabled={busy}
            className="w-full rounded-full border border-dashed border-white/25 px-5 py-2.5 text-xs text-[var(--muted)] hover:text-[var(--ink)] disabled:opacity-60"
            onClick={() => void simulatePayment(order.id)}
          >
            Simulate payment (development only)
          </button>
        ) : null}
      </Panel>
    );
  } else {
    body = (
      <Panel>
        {paymentsReady ? (
          <>
            <fieldset>
              <legend className="text-[11px] uppercase tracking-wide text-[var(--muted)]">Pay with</legend>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {(
                  [
                    ["USDC", "Digital dollars. 1 USDC is always $1."],
                    ["SOL", "Priced at checkout and held for 15 minutes."],
                  ] as const
                ).map(([value, hint]) => (
                  <label
                    key={value}
                    className={`cursor-pointer rounded-2xl border p-3 ${
                      currency === value ? "border-[var(--gold)] bg-[var(--gold)]/10" : "border-[var(--line)] hover:bg-white/5"
                    }`}
                  >
                    <input
                      type="radio"
                      name="currency"
                      value={value}
                      checked={currency === value}
                      onChange={() => setCurrency(value)}
                      className="sr-only"
                    />
                    <span className="block text-sm font-medium text-[var(--ink)]">{value}</span>
                    <span className="mt-1 block text-[11px] leading-4 text-[var(--muted)]">{hint}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <button
              type="button"
              disabled={busy}
              className="w-full rounded-full bg-[var(--gold)] px-5 py-3 text-sm font-medium !text-[#12110F] disabled:opacity-60"
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
          <button
            type="button"
            disabled={busy}
            className="w-full rounded-full border border-dashed border-white/25 px-5 py-2.5 text-xs text-[var(--muted)] hover:text-[var(--ink)] disabled:opacity-60"
            onClick={() => void start(true)}
          >
            {busy ? "Simulating…" : "Simulate payment (development only)"}
          </button>
        ) : null}
        <p className="text-center text-[11px] leading-4 text-[var(--muted)]">
          Credits never expire. Unused credits can be refunded within 14 days.
        </p>
      </Panel>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:items-center sm:px-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Buy ${product.name}`}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-3xl border border-[var(--line)] bg-[var(--bg)] sm:rounded-3xl">
        <div className="flex items-start justify-between gap-4 px-5 pb-4 pt-5">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-[var(--gold)]">{product.tag ?? "Credits"}</p>
            <h2 className="mt-1 font-[family-name:var(--font-display)] text-2xl leading-none text-[var(--ink)]">
              {product.name}
            </h2>
            <p className="mt-1.5 text-xs text-[var(--muted)]">
              {what} · {formatUsd(product.usdCents)}
            </p>
          </div>
          <button type="button" className="text-sm text-[var(--muted)] hover:text-[var(--ink)]" onClick={onClose}>
            Close
          </button>
        </div>
        {error ? <p className="px-5 pb-3 text-center text-xs leading-5 text-[#e8a39a]">{error}</p> : null}
        {body}
      </div>
    </div>
  );
}
