"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { AGE_DOT } from "@/components/account-menu";
import { SectionCard } from "@/components/account/account-ui";
import { ChevronRightIcon, CoinIcon, SignOutIcon, UserIcon } from "@/components/icons";
import { PremiumIcon } from "@/components/premium-icon";
import { Button, buttonClass, cx } from "@/components/ui";
import { useWalletStatus, walletStatusOf } from "@/components/wallet-sync";
import type { Me } from "@/lib/api-types";
import { ageLine, shortAddress, walletOf, type Session } from "@/lib/session";

// Username, wallet, credits, plan and age, with links to change each, and the
// account id last (support and operators ask for it; ADMIN_USER_IDS takes it).
export function AccountCard({ session, me, onSignOut }: { session: Session; me: Me | null; onSignOut: () => void }) {
  // The live wallet only while it's this account's, "setting up" included.
  const live = walletStatusOf(useWalletStatus(), me?.id);
  const wallet = walletOf(me) ?? live.address;
  const age = me ? ageLine(me) : null;
  return (
    <SectionCard title="Account" icon={<UserIcon />}>
      <dl className="divide-y divide-[var(--line)] border-y border-[var(--line)]">
        <AccountRow label="Username">
          <span className="block break-all font-semibold text-[var(--ink)]">
            {me?.username ? `@${me.username}` : session.display}
          </span>
        </AccountRow>
        {wallet ? (
          <AccountRow label="Solana wallet" action={<CopyButton value={wallet} label="wallet address" />}>
            <span className="font-mono text-[13px] font-semibold text-[var(--ink)]" title={wallet}>
              {shortAddress(wallet)}
            </span>
            <span className="block text-xs text-[var(--muted)]">Made for your account. Pay for credits from it.</span>
          </AccountRow>
        ) : live.state === "setting-up" ? (
          <AccountRow label="Solana wallet">
            <span className="text-sm text-[var(--muted)]">Setting up your wallet…</span>
          </AccountRow>
        ) : null}
        {me ? (
          <>
            <AccountRow label="Credits" href="/premium" linkLabel="Buy credits" premium>
              <span className="inline-flex items-center gap-1.5 font-semibold text-[var(--ink)]">
                <CoinIcon className="h-4 w-4 text-[var(--premium)]" />
                {me.balance.toLocaleString()}
              </span>
            </AccountRow>
            <AccountRow label="Plan" href="/premium" linkLabel={me.isMember ? "Manage" : "Go Premium"} premium>
              {me.isMember ? (
                <>
                  <span className="inline-flex items-center gap-1.5 font-semibold text-[var(--premium)]">
                    <PremiumIcon className="h-4 w-4" />
                    Premium
                  </span>
                  {me.memberUntil ? (
                    <span className="block text-xs text-[var(--muted)]">
                      Until {new Date(me.memberUntil).toLocaleDateString(undefined, { dateStyle: "medium" })}
                    </span>
                  ) : null}
                </>
              ) : (
                <span className="font-semibold text-[var(--ink)]">Free</span>
              )}
            </AccountRow>
            {age ? (
              <AccountRow label="Age" href={age.href} linkLabel={age.href ? "Confirm" : undefined}>
                <span className="inline-flex items-center gap-2 font-semibold text-[var(--ink)]">
                  <span aria-hidden className={cx("h-2 w-2 rounded-full", AGE_DOT[age.tone])} />
                  {age.label}
                </span>
                {age.tone === "hold" ? (
                  <span className="mt-0.5 block text-xs leading-5 text-[var(--muted)]">
                    Explicit content is paused while we review this account.
                  </span>
                ) : null}
              </AccountRow>
            ) : null}
            <AccountRow label="Account ID" action={<CopyButton value={me.id} label="account ID" small />}>
              <span className="block break-all font-mono text-xs text-[var(--muted)]">{me.id}</span>
            </AccountRow>
          </>
        ) : null}
      </dl>
      <div className="mt-5 flex flex-wrap gap-3">
        <Link href="/settings" className={buttonClass("secondary", "md", "flex-1")}>
          Settings
        </Link>
        <Button variant="ghost" className="flex-1" onClick={onSignOut}>
          <SignOutIcon className="h-4 w-4" />
          Log out
        </Button>
      </div>
    </SectionCard>
  );
}

function CopyButton({ value, label, small }: { value: string; label: string; small?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={copied ? `${label} copied` : `Copy ${label}`}
      className={
        small
          ? buttonClass("ghost", "sm", "h-10 min-w-14 !text-xs !text-[var(--muted)] hover:!text-[var(--ink)]")
          : buttonClass("secondary", "sm", "h-10 min-w-[4.5rem]")
      }
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
  );
}

function AccountRow({
  label,
  href,
  linkLabel,
  premium,
  action,
  children,
}: {
  label: string;
  href?: string;
  linkLabel?: string;
  // Credits and Premium links take the amber Premium colour.
  premium?: boolean;
  // A control in place of the link (Copy).
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 py-3">
      <div className="min-w-0 flex-1">
        <dt className="text-xs text-[var(--muted)]">{label}</dt>
        <dd className="mt-1 text-sm">{children}</dd>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
      {href && linkLabel ? (
        <Link
          href={href}
          className={cx(
            "inline-flex h-10 shrink-0 items-center gap-0.5 rounded-full pl-3 pr-2 text-sm font-semibold",
            premium ? "!text-[var(--premium)] hover:bg-[var(--premium)]/10" : "!text-[var(--accent)] hover:bg-[var(--accent-soft)]",
          )}
        >
          {linkLabel}
          <ChevronRightIcon className="h-4 w-4" />
        </Link>
      ) : null}
    </div>
  );
}
