import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { CoinIcon } from "@/components/icons";
import { COST_ACTIONS, CheckIcon, MEMBER_PERKS, TrustRow, formatUsdDisplay, per100 } from "@/components/premium/parts";
import { PremiumIcon } from "@/components/premium-icon";
import { ButtonLink, PageHeader, SectionTitle, cx } from "@/components/ui";
import { COSTS, FREE, MEMBER_DAILY_MESSAGE_CAP, MEMBERSHIP, PRODUCTS, formatCredits, formatUsd } from "@/lib/pricing";

export const metadata: Metadata = {
  title: "Pricing · Simulust",
  description: "Every Simulust price in US dollars, paid in USDC or SOL. Credits never expire.",
};

// What a credit costs in the smallest pack; bigger packs are cheaper.
const BASE = PRODUCTS[0];
const centsPerCredit = BASE.usdCents / BASE.credits;
const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL;
// Links need the important modifier: the unlayered `a` rule in globals.css
// otherwise wins over colour and underline utilities.
const LINK = "!text-[var(--accent)] !underline underline-offset-2";

function Section({ accent, title, children }: { accent: string; title: string; children: ReactNode }) {
  return (
    <section className="mt-12">
      <SectionTitle accent={accent}>{title}</SectionTitle>
      <div className="mt-4 text-[15px] leading-7 text-[var(--muted)]">{children}</div>
    </section>
  );
}

function Bullets({ items }: { items: ReactNode[] }) {
  return (
    <ul className="space-y-2">
      {items.map((item, index) => (
        <li key={index} className="flex gap-3">
          <span className="mt-1.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent)]">
            <CheckIcon className="h-2.5 w-2.5" />
          </span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

// A table on wider screens; on phones each row becomes a small card so nothing
// scrolls sideways. Columns with an empty heading read as a note; numeric ones
// line up on the right.
function Table({ head, rows, numeric = [] }: { head: string[]; rows: ReactNode[][]; numeric?: number[] }) {
  return (
    <>
      <ul className="mt-4 space-y-2 sm:hidden">
        {rows.map((row, index) => (
          <li key={index} className="rounded-2xl bg-[var(--surface)] p-4 ring-1 ring-white/5">
            <div className="font-semibold text-[var(--ink)]">{row[0]}</div>
            <dl className="mt-2 grid grid-cols-3 gap-2 text-sm leading-6">
              {row.slice(1).map((cell, column) =>
                head[column + 1] ? (
                  <div key={column}>
                    <dt className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                      {head[column + 1]}
                    </dt>
                    <dd className="text-[var(--ink)]">{cell}</dd>
                  </div>
                ) : null,
              )}
            </dl>
            {row.slice(1).map((cell, column) =>
              !head[column + 1] && cell ? (
                <p key={column} className="mt-2 text-xs leading-5 text-[var(--muted)]">
                  {cell}
                </p>
              ) : null,
            )}
          </li>
        ))}
      </ul>
      <TableWide head={head} rows={rows} numeric={numeric} />
    </>
  );
}

function TableWide({ head, rows, numeric }: { head: string[]; rows: ReactNode[][]; numeric: number[] }) {
  return (
    <div className="mt-4 hidden overflow-x-auto rounded-2xl bg-[var(--surface)] ring-1 ring-white/5 sm:block">
      <table className="w-full min-w-[30rem] text-left text-sm">
        <thead className="bg-[var(--surface-2)] text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
          <tr>
            {head.map((cell, index) => (
              <th key={cell || index} scope="col" className={cx("px-4 py-3 font-semibold", numeric.includes(index) && "text-right")}>
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--line)]">
          {rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, column) => (
                <td
                  key={column}
                  className={cx(
                    "px-4 py-3.5 align-top",
                    column === 0 ? "font-semibold text-[var(--ink)]" : "text-[var(--muted)]",
                    numeric.includes(column) && "text-right tabular-nums",
                  )}
                >
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

function SummaryCard({
  label,
  price,
  unit,
  points,
  highlight,
  icon,
  action,
}: {
  label: string;
  price: string;
  unit?: string;
  points: string[];
  highlight?: boolean;
  icon: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      className={cx(
        "flex flex-col rounded-2xl bg-[var(--surface)] p-4 sm:p-5",
        highlight
          ? "bg-[linear-gradient(180deg,var(--accent-soft),transparent_55%)] ring-2 ring-[var(--accent)]"
          : "ring-1 ring-white/5",
      )}
    >
      <p className="flex items-center gap-2 text-sm font-semibold text-[var(--muted)]">
        {icon}
        {label}
      </p>
      <p className="mt-2 text-2xl font-bold tracking-tight text-[var(--ink)] sm:mt-3 sm:text-3xl">
        {price}
        {unit ? <span className="ml-1.5 text-sm font-medium text-[var(--muted)]">{unit}</span> : null}
      </p>
      <ul className="mt-2 space-y-1 text-sm text-[var(--muted)] sm:mt-3">
        {points.map((point) => (
          <li key={point} className="flex items-start gap-2">
            <CheckIcon className="mt-1 h-3 w-3 text-[var(--accent)]" />
            {point}
          </li>
        ))}
      </ul>
      {action ? <div className="mt-auto pt-4">{action}</div> : null}
    </div>
  );
}

export default function PricingPage() {
  return (
    <AppShell>
      <article className="mx-auto w-full max-w-4xl px-4 pb-16 pt-6 sm:px-6 sm:pt-8 lg:px-8 lg:pt-10">
        <PageHeader
          accent="Pricing"
          title="and refunds"
          subtitle="Every price, in US dollars. You pay in USDC or SOL on Solana. Credits never expire, and nothing renews on its own."
        />

        <div className="mt-8 grid gap-3 sm:grid-cols-3 sm:gap-4">
          <SummaryCard
            label="Free"
            price="$0"
            icon={<span className="h-2 w-2 rounded-full bg-[var(--muted)]" />}
            points={[`${formatCredits(FREE.signupCredits)} to start`, `${FREE.dailyMessages} messages a day`]}
          />
          <SummaryCard
            label="Membership"
            price={formatUsd(MEMBERSHIP.usdCents)}
            unit={`/ ${MEMBERSHIP.memberDays} days`}
            icon={<PremiumIcon className="h-4 w-4 text-[var(--premium)]" />}
            points={["Unlimited messages", `${formatCredits(MEMBERSHIP.credits)} included`, "No auto-renew"]}
            highlight
            action={
              <ButtonLink href="/premium" size="sm" className="h-10 w-full sm:w-auto">
                See membership
              </ButtonLink>
            }
          />
          <SummaryCard
            label="Credit packs"
            price={`From ${formatUsd(BASE.usdCents)}`}
            icon={<CoinIcon className="h-4 w-4 text-[var(--premium)]" />}
            points={[
              `${PRODUCTS[0].credits.toLocaleString("en-US")} to ${PRODUCTS[PRODUCTS.length - 1].credits.toLocaleString("en-US")} credits`,
              "Never expire",
            ]}
            action={
              <ButtonLink href="/packs" variant="secondary" size="sm" className="h-10 w-full !bg-[var(--surface-2)] hover:!bg-white/10 sm:w-auto">
                See packs
              </ButtonLink>
            }
          />
        </div>
        <TrustRow className="mt-4 sm:justify-start" />

        <Section accent="Free" title="account">
          <Bullets
            items={[
              `${formatCredits(FREE.signupCredits)} when you sign up.`,
              `${FREE.dailyMessages} messages a day, every day. The count resets at midnight UTC.`,
            ]}
          />
        </Section>

        <Section accent="Membership" title="plan">
          <p>
            <span className="font-semibold text-[var(--ink)]">{formatUsd(MEMBERSHIP.usdCents)}</span> for{" "}
            {MEMBERSHIP.memberDays} days, paid up front. It doesn&apos;t renew. Buy again any time to add another{" "}
            {MEMBERSHIP.memberDays} days on top of what you have left.
          </p>
          <div className="mt-4">
            <Bullets
              items={MEMBER_PERKS.map((perk, index) =>
                index === 0 ? (
                  <>
                    {perk.title}. &ldquo;Unlimited&rdquo; has a fair-use ceiling of {MEMBER_DAILY_MESSAGE_CAP} messages a
                    day so one account can&apos;t run the model around the clock.
                  </>
                ) : (
                  `${perk.title}.${perk.note ? ` ${perk.note}.` : ""}`
                ),
              )}
            />
          </div>
        </Section>

        <Section accent="Credit" title="packs">
          <p>Credits pay for photos, voice notes, video, and messages past your free ones.</p>
          <Table
            head={["Pack", "Price", "Credits", "Per 100 credits"]}
            numeric={[1, 2, 3]}
            rows={PRODUCTS.map((product) => [
              <span key="name" className="inline-flex flex-wrap items-center gap-2">
                {product.name}
                {product.tag ? (
                  <span className="rounded-full bg-[var(--premium)]/15 px-2 py-0.5 text-[11px] font-bold text-[var(--premium)]">
                    {product.tag}
                  </span>
                ) : null}
              </span>,
              <span key="price" className="font-semibold text-[var(--ink)]">
                {formatUsd(product.usdCents)}
              </span>,
              product.credits.toLocaleString("en-US"),
              per100(product),
            ])}
          />
        </Section>

        <Section accent="What" title="things cost">
          <p>
            One credit costs about {Math.round(centsPerCredit * 10) / 10}¢ in the {BASE.name} pack, and less in bigger
            packs.
          </p>
          <Table
            head={["Action", "Credits", "About", ""]}
            numeric={[1, 2]}
            rows={COST_ACTIONS.map((action) => [
              action.label,
              <span key="credits" className="font-semibold text-[var(--ink)]">
                {COSTS[action.key].toLocaleString("en-US")}
              </span>,
              formatUsd(Math.round(COSTS[action.key] * centsPerCredit)),
              action.note ?? "",
            ])}
          />
          <p className="mt-4">
            If a photo, voice note or video fails, or our safety checks block it, its credits come back automatically.
          </p>
        </Section>

        <Section accent="Paying" title="in USDC or SOL">
          <Bullets
            items={[
              "USDC is charged one to one with the dollar price.",
              "SOL is priced at checkout from two independent price feeds and held for 15 minutes. If the feeds disagree, we ask you to pay in USDC instead of guessing.",
              "Every payment is a Solana transaction, so your receipt lives on chain.",
              `Purchases are capped at ${formatUsdDisplay(100_000)} per account per day.`,
              "We screen paying wallets against sanctions lists, as the law requires.",
            ]}
          />
        </Section>

        <Section accent="Refund" title="policy">
          <p>
            Haven&apos;t used what you bought? Ask within 14 days of buying it. By default we refund as store credit. If
            you&apos;d rather, we send USDC back to the wallet address that paid, minus the network fee.
          </p>
          <p className="mt-3">
            Credits have no cash value and can&apos;t be withdrawn, transferred or sold. To ask for a refund,{" "}
            {SUPPORT_EMAIL ? (
              <a href={`mailto:${SUPPORT_EMAIL}`} className={LINK}>
                email {SUPPORT_EMAIL}
              </a>
            ) : (
              "contact support"
            )}{" "}
            with your order number. You&apos;ll find it on the{" "}
            <Link href="/premium" className={LINK}>
              Premium page
            </Link>{" "}
            under Recent payments. The full rules are in our{" "}
            <Link href="/terms" className={LINK}>
              terms
            </Link>
            .
          </p>
        </Section>

        <div className="mt-12 flex flex-col gap-3 rounded-2xl bg-[var(--surface)] p-5 ring-1 ring-white/5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <p className="text-base font-semibold text-[var(--ink)]">Ready when you are.</p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <ButtonLink href="/premium" size="lg">
              Get membership
            </ButtonLink>
            <ButtonLink href="/packs" variant="secondary" size="lg">
              Buy credits
            </ButtonLink>
          </div>
        </div>
      </article>
    </AppShell>
  );
}
