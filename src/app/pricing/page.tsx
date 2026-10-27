import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { AppHeader, AppShell } from "@/components/app-shell";
import {
  COSTS,
  FREE,
  MEMBER_DAILY_MESSAGE_CAP,
  MEMBERSHIP,
  PRODUCTS,
  formatCredits,
  formatUsd,
  type CostKey,
} from "@/lib/pricing";

export const metadata: Metadata = {
  title: "Pricing · Simulust",
  description: "Every Simulust price in US dollars, paid in USDC or SOL. Credits never expire.",
};

const ACTIONS: { key: CostKey; label: string; note?: string }[] = [
  { key: "message", label: "Message", note: `First ${FREE.dailyMessages} each day are free. Free for members.` },
  { key: "voiceNote", label: "Voice note" },
  { key: "photo", label: "Photo" },
  { key: "portrait", label: "Character portrait", note: "When you create a character." },
  { key: "video", label: "Video clip" },
];

// What a credit costs in the smallest pack; bigger packs are cheaper.
const BASE = PRODUCTS[0];
const centsPerCredit = BASE.usdCents / BASE.credits;
const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="font-[family-name:var(--font-display)] text-2xl text-[var(--ink)]">{title}</h2>
      <div className="mt-3 text-[15px] leading-7 text-[var(--muted)]">{children}</div>
    </section>
  );
}

function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="mt-4 overflow-x-auto rounded-2xl border border-[var(--line)]">
      <table className="w-full min-w-[28rem] text-left text-sm">
        <thead className="bg-[var(--bg-2)] text-[11px] uppercase tracking-wide text-[var(--muted)]">
          <tr>
            {head.map((cell) => (
              <th key={cell} className="px-4 py-2.5 font-normal">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--line)]">
          {rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, column) => (
                <td key={column} className={`px-4 py-3 align-top ${column === 0 ? "text-[var(--ink)]" : "text-[var(--muted)]"}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function PricingPage() {
  return (
    <AppShell>
      <AppHeader />
      <article className="mx-auto w-full max-w-3xl px-4 py-10">
        <h1 className="font-[family-name:var(--font-display)] text-4xl font-light text-[var(--ink)]">Pricing.</h1>
        <p className="mt-3 text-[15px] leading-7 text-[var(--muted)]">
          Every price, in US dollars. You pay in USDC or SOL on Solana. Credits never expire, and nothing renews on
          its own.
        </p>

        <Section title="Free">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>{formatCredits(FREE.signupCredits)} when you sign up.</li>
            <li>{FREE.dailyMessages} messages a day, every day. The count resets at midnight UTC.</li>
          </ul>
        </Section>

        <Section title="Membership">
          <p>
            <span className="text-[var(--ink)]">{formatUsd(MEMBERSHIP.usdCents)}</span> for {MEMBERSHIP.memberDays}{" "}
            days, paid up front. It doesn&apos;t renew. Buy again any time to add another {MEMBERSHIP.memberDays} days
            on top of what you have left.
          </p>
          <ul className="mt-3 list-disc space-y-1.5 pl-5">
            {MEMBERSHIP.perks.map((perk) => (
              <li key={perk}>{perk}</li>
            ))}
            <li>
              &ldquo;Unlimited&rdquo; has a fair-use ceiling of {MEMBER_DAILY_MESSAGE_CAP} messages a day so one account
              can&apos;t run the model around the clock.
            </li>
          </ul>
        </Section>

        <Section title="Credit packs">
          <p>Credits pay for photos, voice notes, video, and messages past your free ones.</p>
          <Table
            head={["Pack", "Price", "Credits", "Per 100 credits"]}
            rows={PRODUCTS.map((product) => [
              <span key="name">
                {product.name}
                {product.tag ? <span className="ml-2 text-xs text-[var(--gold)]">{product.tag}</span> : null}
              </span>,
              formatUsd(product.usdCents),
              product.credits.toLocaleString("en-US"),
              formatUsd(Math.round((product.usdCents / product.credits) * 100)),
            ])}
          />
        </Section>

        <Section title="What things cost">
          <p>
            One credit costs about {Math.round(centsPerCredit * 10) / 10}¢ in the {BASE.name} pack, and less in bigger
            packs.
          </p>
          <Table
            head={["Action", "Credits", "About", ""]}
            rows={ACTIONS.map((action) => [
              action.label,
              COSTS[action.key].toLocaleString("en-US"),
              formatUsd(Math.round(COSTS[action.key] * centsPerCredit)),
              action.note ?? "",
            ])}
          />
          <p className="mt-3">
            If a photo, voice note or video fails, or our safety checks block it, its credits come back automatically.
          </p>
        </Section>

        <Section title="Paying">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>USDC is charged one to one with the dollar price.</li>
            <li>
              SOL is priced at checkout from two independent price feeds and held for 15 minutes. If the feeds disagree,
              we ask you to pay in USDC instead of guessing.
            </li>
            <li>Every payment is a Solana transaction, so your receipt lives on chain.</li>
            <li>Purchases are capped at {formatUsd(100_000)} per account per day.</li>
            <li>We screen paying wallets against sanctions lists, as the law requires.</li>
          </ul>
        </Section>

        <Section title="Refunds">
          <p>
            Haven&apos;t used what you bought? Ask within 14 days of buying it. By default we refund as store credit. If
            you&apos;d rather, we send USDC back to the wallet address that paid, minus the network fee.
          </p>
          <p className="mt-3">
            Credits have no cash value and can&apos;t be withdrawn, transferred or sold. To ask for a refund,{" "}
            {SUPPORT_EMAIL ? (
              <a href={`mailto:${SUPPORT_EMAIL}`} className="text-[var(--gold)] underline underline-offset-2">
                email {SUPPORT_EMAIL}
              </a>
            ) : (
              "contact support"
            )}{" "}
            with your order number. You&apos;ll find it on the{" "}
            <Link href="/premium" className="text-[var(--gold)] underline underline-offset-2">
              Premium page
            </Link>{" "}
            under Recent payments. The full rules are in our{" "}
            <Link href="/terms" className="text-[var(--gold)] underline underline-offset-2">
              terms
            </Link>
            .
          </p>
        </Section>

        <div className="mt-12 flex flex-col gap-3 sm:flex-row">
          <Link
            href="/premium"
            className="rounded-full bg-[var(--gold)] px-6 py-3 text-center text-sm font-medium !text-[#12110F]"
          >
            Get membership
          </Link>
          <Link
            href="/packs"
            className="rounded-full border border-white/20 px-6 py-3 text-center text-sm text-[var(--ink)] hover:border-[var(--ink)]"
          >
            Buy credits
          </Link>
        </div>
      </article>
    </AppShell>
  );
}
