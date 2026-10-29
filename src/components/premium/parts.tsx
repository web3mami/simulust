import Link from "next/link";
import type { ReactNode } from "react";
import { CameraIcon, ChatIcon, ChevronRightIcon, CoinIcon, MicIcon, PlayIcon, UserIcon } from "@/components/icons";
import { PremiumIcon } from "@/components/premium-icon";
import { cx } from "@/components/ui";
import {
  COSTS,
  FREE,
  MEMBER_DAILY_MESSAGE_CAP,
  MEMBERSHIP,
  PRODUCTS,
  formatUsd,
  type CostKey,
  type Product,
} from "@/lib/pricing";
import styles from "@/components/premium/motion.module.css";

// Pieces shared by the Premium and credit pack pages, the checkout and the
// public price list. No hooks here, so server pages can use them too.

const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL;

export function CheckIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cx("shrink-0", className)}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}

// A small coin mark for each currency we take.
export function CurrencyMark({ currency, className = "h-6 w-6 text-[11px]" }: { currency: "USDC" | "SOL"; className?: string }) {
  return (
    <span
      aria-hidden
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white",
        currency === "USDC" ? "bg-[#2775ca]" : "bg-gradient-to-br from-[#9945ff] to-[#14f195]",
        className,
      )}
    >
      {currency === "USDC" ? "$" : "◎"}
    </span>
  );
}

// Cost of 100 credits in a pack, to make the bonus visible. The one unit every
// page uses for value, so a pack card and the price table always agree.
export function per100(product: Product) {
  return formatUsd(Math.round((product.usdCents / product.credits) * 100));
}

// The pack with the lowest price per credit, worked out rather than claimed.
export const BEST_VALUE_ID = [...PRODUCTS].sort((a, b) => a.usdCents / a.credits - b.usdCents / b.credits)[0]?.id;

// What a number of credits buys at the published costs, e.g. "≈ 62 photos or 8 videos".
export function creditsBuy(credits: number) {
  return `≈ ${Math.floor(credits / COSTS.photo).toLocaleString("en-US")} photos or ${Math.floor(credits / COSTS.video).toLocaleString("en-US")} videos`;
}

// "Nov 26, 2026", the same in every browser, to match the en-US numbers.
export function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// For reading only: "$1,000" or "$12.99". Amounts charged still use formatUsd.
export function formatUsdDisplay(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents % 100 ? 2 : 0,
    maximumFractionDigits: cents % 100 ? 2 : 0,
  }).format(cents / 100);
}

// What membership adds, each point said once. Built from the same constants
// the server enforces.
export const MEMBER_PERKS: { title: string; note?: string }[] = [
  { title: "Unlimited messages", note: `Fair use: up to ${MEMBER_DAILY_MESSAGE_CAP} a day` },
  { title: `${MEMBERSHIP.credits} credits for photos, voice and video`, note: "Credits never expire" },
  { title: "No auto-renew", note: "Top up when you want" },
];

// The payment and trust marks shown next to every buy button.
export function TrustRow({ className, compact }: { className?: string; compact?: boolean }) {
  const chip = "inline-flex h-7 items-center gap-1 rounded-full bg-white/5 px-2 text-xs font-medium text-[var(--ink)]/85";
  const points = compact ? ["No auto-renew", "Credits never expire"] : ["No auto-renew", "Credits never expire", "Receipt on chain"];
  return (
    <ul className={cx("flex flex-wrap justify-center gap-1.5", className)} aria-label="How you pay">
      <li className={chip}>
        <span className="flex -space-x-1">
          <CurrencyMark currency="USDC" className="h-4 w-4 text-[9px] ring-1 ring-[var(--surface)]" />
          <CurrencyMark currency="SOL" className="h-4 w-4 text-[9px] ring-1 ring-[var(--surface)]" />
        </span>
        USDC or SOL
      </li>
      {points.map((point) => (
        <li key={point} className={chip}>
          <CheckIcon className="h-3 w-3 text-[var(--accent)]" />
          {point}
        </li>
      ))}
    </ul>
  );
}

// Free next to Member, line by line, from the published constants only.
const COMPARE: { label: string; icon: ReactNode; free: string; member: string }[] = [
  {
    label: "Messages",
    icon: <ChatIcon className="h-4 w-4" />,
    free: `${FREE.dailyMessages} a day, then ${COSTS.message} credit each`,
    member: `Unlimited (fair use, ${MEMBER_DAILY_MESSAGE_CAP} a day)`,
  },
  {
    label: "Credits",
    icon: <CoinIcon className="h-4 w-4" />,
    free: `${FREE.signupCredits} when you sign up`,
    member: `${MEMBERSHIP.credits} with every ${MEMBERSHIP.memberDays} days`,
  },
  {
    label: "Photos, voice, video",
    icon: <CameraIcon className="h-4 w-4" />,
    free: "Paid with credits",
    member: "Paid with credits",
  },
  {
    label: "Price",
    icon: <PremiumIcon className="h-4 w-4" />,
    free: "$0",
    member: `${formatUsd(MEMBERSHIP.usdCents)} for ${MEMBERSHIP.memberDays} days, no auto-renew`,
  },
];

export function CompareTable() {
  return (
    <div className="overflow-hidden rounded-2xl bg-[var(--surface)] ring-1 ring-white/5">
      <table className="w-full table-fixed text-left text-sm">
        <caption className="sr-only">Free account compared with membership</caption>
        <colgroup>
          <col className="w-[34%] sm:w-[28%]" />
          <col />
          <col />
        </colgroup>
        <thead>
          <tr className="text-xs font-bold uppercase tracking-wide">
            <th scope="col" className="px-3 py-3 sm:px-5">
              <span className="sr-only">What you get</span>
            </th>
            <th scope="col" className="px-3 py-3 text-[var(--muted)] sm:px-5">
              Free
            </th>
            <th scope="col" className="bg-[var(--accent-soft)] px-3 py-3 text-[var(--accent)] sm:px-5">
              <span className="inline-flex items-center gap-1.5">
                <PremiumIcon className="h-3.5 w-3.5 text-[var(--premium)]" />
                Member
              </span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--line)] border-t border-[var(--line)]">
          {COMPARE.map((row) => (
            <tr key={row.label}>
              <th scope="row" className="px-3 py-3.5 align-top font-semibold text-[var(--ink)] sm:px-5">
                <span className="flex items-start gap-2">
                  <span className="mt-0.5 hidden text-[var(--muted)] sm:inline">{row.icon}</span>
                  {row.label}
                </span>
              </th>
              <td className="px-3 py-3.5 align-top text-[var(--muted)] sm:px-5">{row.free}</td>
              <td className="bg-[var(--accent-soft)] px-3 py-3.5 align-top font-medium text-[var(--ink)] sm:px-5">{row.member}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const COST_ACTIONS: { key: CostKey; label: string; note?: string; icon: ReactNode }[] = [
  {
    key: "message",
    label: "Message",
    note: `First ${FREE.dailyMessages} each day are free. Free for members.`,
    icon: <ChatIcon />,
  },
  { key: "voiceNote", label: "Voice note", icon: <MicIcon /> },
  { key: "photo", label: "Photo", icon: <CameraIcon /> },
  { key: "portrait", label: "Character portrait", note: "When you create a character.", icon: <UserIcon /> },
  { key: "video", label: "Video clip", icon: <PlayIcon /> },
];

export function CostGrid() {
  return (
    <div>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-5">
        {COST_ACTIONS.map((action) => (
          <li
            key={action.key}
            className="flex flex-col rounded-2xl bg-[var(--surface)] p-4 ring-1 ring-white/5 first:col-span-2 sm:p-5 sm:first:col-span-1"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
              {action.icon}
            </span>
            <p className="mt-3 text-sm font-semibold text-[var(--ink)]">{action.label}</p>
            <p className="mt-1 flex items-baseline gap-1.5 text-xl font-bold tracking-tight text-[var(--ink)]">
              <CoinIcon className="h-4 w-4 self-center text-[var(--premium)]" />
              {COSTS[action.key].toLocaleString("en-US")}
              <span className="text-xs font-medium text-[var(--muted)]">{COSTS[action.key] === 1 ? "credit" : "credits"}</span>
            </p>
            {action.note ? <p className="mt-1.5 text-xs leading-5 text-[var(--muted)]">{action.note}</p> : null}
          </li>
        ))}
      </ul>
      <p className="mt-4 text-sm leading-6 text-[var(--muted)]">
        If a photo, voice note or video fails, or our safety checks block it, its credits come back automatically.
      </p>
    </div>
  );
}

const PAY_STEPS = [
  { title: "Pick a plan or a pack", body: "Prices are set in US dollars. Nothing renews on its own." },
  {
    title: "Choose USDC or SOL",
    body: "USDC is charged one to one with the dollar price. SOL is priced at checkout and held for 15 minutes.",
  },
  {
    title: "Pay from your wallet",
    body: "Use the wallet that comes with your account, or scan the Solana Pay QR code with Phantom, Solflare or any Solana Pay wallet.",
  },
  {
    title: "Credits are added for you",
    body: "Usually seconds after the network confirms. Final checks can take a few minutes.",
  },
];

export function PaymentGuide() {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:gap-6">
      <ol className="grid gap-3 sm:grid-cols-2 sm:gap-4">
        {PAY_STEPS.map((step, index) => (
          <li key={step.title} className="flex gap-4 rounded-2xl bg-[var(--surface)] p-4 ring-1 ring-white/5 sm:p-5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-sm font-bold text-[var(--accent-ink)]">
              {index + 1}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[var(--ink)]">{step.title}</p>
              <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
      <div className="rounded-2xl bg-[var(--surface)] p-4 ring-1 ring-white/5 sm:p-5">
        <ul className="space-y-4">
          <li className="flex gap-3">
            <CurrencyMark currency="USDC" className="h-9 w-9 text-sm" />
            <div>
              <p className="text-sm font-semibold text-[var(--ink)]">USDC</p>
              <p className="mt-0.5 text-xs leading-5 text-[var(--muted)]">Digital dollars. 1 USDC is always $1.</p>
            </div>
          </li>
          <li className="flex gap-3">
            <CurrencyMark currency="SOL" className="h-9 w-9 text-sm" />
            <div>
              <p className="text-sm font-semibold text-[var(--ink)]">SOL</p>
              <p className="mt-0.5 text-xs leading-5 text-[var(--muted)]">
                Priced at checkout from two independent price feeds and held for 15 minutes. If the feeds disagree, we
                ask you to pay in USDC instead.
              </p>
            </div>
          </li>
        </ul>
        <ul className="mt-5 space-y-2 border-t border-[var(--line)] pt-4 text-xs leading-5 text-[var(--muted)]">
          <li className="flex gap-2">
            <CheckIcon className="mt-1 h-3 w-3 text-[var(--accent)]" />
            Pay from a wallet, not an exchange: a plain transfer can&apos;t be matched to your order.
          </li>
          <li className="flex gap-2">
            <CheckIcon className="mt-1 h-3 w-3 text-[var(--accent)]" />
            Every payment is a Solana transaction, so your receipt lives on chain.
          </li>
          <li className="flex gap-2">
            <CheckIcon className="mt-1 h-3 w-3 text-[var(--accent)]" />
            We screen paying wallets against sanctions lists, as the law requires.
          </li>
        </ul>
      </div>
    </div>
  );
}

const FAQ: { q: string; a: ReactNode }[] = [
  {
    q: "Does membership renew automatically?",
    a: (
      <>
        No. Membership is {formatUsd(MEMBERSHIP.usdCents)} for {MEMBERSHIP.memberDays} days, paid up front. Buy again
        any time to add another {MEMBERSHIP.memberDays} days on top of what you have left.
      </>
    ),
  },
  {
    q: "What does unlimited messages mean?",
    a: (
      <>
        Members can send as many messages as they like, up to a fair-use ceiling of {MEMBER_DAILY_MESSAGE_CAP} a day so
        one account can&apos;t run the model around the clock.
      </>
    ),
  },
  {
    q: "What are credits for?",
    a: (
      <>
        Photos, voice notes, video, character portraits, and messages past your {FREE.dailyMessages} free ones each day.
        You get {FREE.signupCredits} credits when you sign up and {MEMBERSHIP.credits} with each membership.
      </>
    ),
  },
  {
    q: "Do credits expire?",
    a: <>Never. Credits have no cash value and can&apos;t be withdrawn, transferred or sold.</>,
  },
  {
    q: "How do I pay?",
    a: (
      <>
        In USDC or SOL on Solana. Pay from the wallet that comes with your account, or scan the Solana Pay QR code with
        Phantom, Solflare or any Solana Pay wallet. Pay from a wallet, not an exchange: a plain transfer without the order&apos;s reference
        can&apos;t be matched to your order.
      </>
    ),
  },
  {
    q: "What if a photo, voice note or video fails?",
    a: <>Its credits come back automatically, including when our safety checks block it.</>,
  },
  {
    q: "Can I get a refund?",
    a: (
      <>
        Haven&apos;t used what you bought? Ask within 14 days of buying it. By default we refund as store credit. If
        you&apos;d rather, we send USDC back to the wallet address that paid, minus the network fee.{" "}
        {SUPPORT_EMAIL ? (
          <a href={`mailto:${SUPPORT_EMAIL}`} className="!text-[var(--accent)] !underline underline-offset-2">
            Email {SUPPORT_EMAIL}
          </a>
        ) : (
          "Contact support"
        )}{" "}
        with your order number, which you&apos;ll find on the Premium page under Recent payments. The full rules are on{" "}
        <Link href="/pricing" className="!text-[var(--accent)] !underline underline-offset-2">
          our pricing page
        </Link>
        .
      </>
    ),
  },
  {
    q: "Are there limits on buying?",
    a: (
      <>
        Purchases are capped at {formatUsdDisplay(100_000)} per account per day, and we screen paying wallets against sanctions
        lists, as the law requires.
      </>
    ),
  },
];

// One answer open at a time (the shared name), sliding open where supported.
export function Faq() {
  return (
    <div className="divide-y divide-[var(--line)] rounded-2xl bg-[var(--surface)] ring-1 ring-white/5">
      {FAQ.map((item) => (
        <details key={item.q} name="faq" className={cx("group px-4 sm:px-6", styles.faq)}>
          <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 rounded-lg py-3 text-sm font-semibold text-[var(--ink)] outline-none transition-colors hover:text-white focus-visible:ring-2 focus-visible:ring-[var(--accent)] sm:text-base [&::-webkit-details-marker]:hidden">
            {item.q}
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/5 text-[var(--muted)] transition group-open:rotate-90 group-open:bg-[var(--accent-soft)] group-open:text-[var(--accent)]">
              <ChevronRightIcon className="h-4 w-4" />
            </span>
          </summary>
          <div className="pb-5 pr-6 text-sm leading-6 text-[var(--muted)]">{item.a}</div>
        </details>
      ))}
    </div>
  );
}
