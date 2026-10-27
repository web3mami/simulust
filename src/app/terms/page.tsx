import type { Metadata } from "next";
import Link from "next/link";
import { DocPage } from "@/components/app-shell";

export const metadata: Metadata = { title: "Terms of Service · Simulust" };

export default function TermsPage() {
  return (
    <DocPage title="Terms of Service" updated="October 26, 2026">
      <p>
        These terms are an agreement between you and [Company legal name], [registered address] (&ldquo;Simulust&rdquo;,
        &ldquo;we&rdquo;). By creating an account or using Simulust you agree to them, to our{" "}
        <Link href="/content-policy">content policy</Link> and to our <Link href="/privacy">privacy policy</Link>.
      </p>

      <h2>1. Adults only</h2>
      <ul>
        <li>You must be at least 18, and old enough to view adult content where you live.</li>
        <li>
          Explicit content (explicit chat, photos, voice notes and video) unlocks only after a one-time ID and selfie
          check with our verification provider. Using someone else&apos;s ID, or helping a minor get access, ends your
          account.
        </li>
        <li>
          Simulust isn&apos;t available in some countries and regions. Don&apos;t use a VPN or other tool to get around
          that, and don&apos;t use Simulust where it&apos;s illegal for you.
        </li>
      </ul>

      <h2>2. Your account</h2>
      <p>
        You sign in with email, a social account or a Solana wallet. Keep your login secure; you&apos;re responsible
        for what happens on your account. One person per account, and accounts can&apos;t be sold or shared.
      </p>

      <h2>3. You&apos;re talking to an AI</h2>
      <ul>
        <li>Every character is an AI. None is a real person, and no person writes their replies.</li>
        <li>All characters are fictional adults. Any resemblance to a real person is unintended; report it and we&apos;ll remove it.</li>
        <li>
          Characters can be wrong, inconsistent or make things up. They are not therapists, doctors, lawyers or
          financial advisers, and nothing they say is professional advice. See our <Link href="/safety">safety page</Link>.
        </li>
      </ul>

      <h2>4. Content rules</h2>
      <p>
        Follow the <Link href="/content-policy">content policy</Link>. In short: adults only, no minors or anyone who
        looks like one (anime included), no real people, no bestiality or necrophilia, nothing illegal. We screen
        messages, prompts and generated media automatically, review reports by hand, and may block content, remove
        characters, or suspend or close accounts that break the rules.
      </p>

      <h2>5. Your content and generated content</h2>
      <ul>
        <li>
          You keep whatever rights you have in what you write and the characters you create. You give us a license to
          store, process and show that content to you so we can run Simulust, and to review it for safety.
        </li>
        <li>We don&apos;t use your chats to train AI models.</li>
        <li>
          You may use media generated for you for personal, non-commercial purposes, within the content policy. You
          may not use it to depict, impersonate or harass a real person. Official characters and the Simulust brand
          remain ours.
        </li>
      </ul>

      <h2>6. Credits, membership and payments</h2>
      <ul>
        <li>Prices are set in US dollars and paid in USDC or SOL on the Solana network. Published prices for every action are on our <Link href="/pricing">pricing page</Link>.</li>
        <li>
          Credits never expire. They have no cash value and can&apos;t be withdrawn, transferred, sold or exchanged for
          crypto or money.
        </li>
        <li>Membership is a prepaid period. It doesn&apos;t renew automatically.</li>
        <li>
          Blockchain payments are final once confirmed. Send the exact amount, on Solana, to the address shown at
          checkout. We can&apos;t recover funds sent to the wrong address or network.
        </li>
        <li>
          If something you paid credits for fails or is blocked by our safety checks, the credits come back
          automatically.
        </li>
        <li>
          Refunds of unused purchased credits: ask within [14] days of purchase through [support email]. We refund as
          store credit by default, or as USDC to the wallet that paid, minus network fees, at our discretion and where
          the law allows.
        </li>
        <li>
          We may cap purchases per account, and we screen payments against sanctions lists. We may refuse or hold
          payments from sanctioned or high-risk wallets, as the law requires.
        </li>
      </ul>

      <h2>7. Things you must not do</h2>
      <ul>
        <li>Try to get around our safety filters, age checks, region blocks or rate limits.</li>
        <li>Scrape, copy or resell the service, or access it with bots.</li>
        <li>Attack, overload or probe the service for vulnerabilities, except through responsible disclosure to [security email].</li>
        <li>Use Simulust to harass, threaten, defraud or impersonate anyone.</li>
      </ul>

      <h2>8. Ending your account</h2>
      <p>
        You can delete your account at any time in <Link href="/settings">Settings</Link>. Deleting it removes your
        chats, characters, memories and media, and any remaining credits are lost. We may suspend or close accounts
        that break these terms or the content policy. For serious violations, including anything involving minors,
        remaining credits are forfeited and we may report the account to authorities.
      </p>

      <h2>9. Disclaimers and liability</h2>
      <p>
        Simulust is provided &ldquo;as is&rdquo;. To the extent the law allows, we make no promises that it will be
        uninterrupted or error-free, and we aren&apos;t liable for indirect or consequential losses. Our total
        liability to you is limited to the amount you paid us in the 12 months before the claim. Nothing in these
        terms limits rights you have under consumer law that can&apos;t be waived.
      </p>

      <h2>10. Law and disputes</h2>
      <p>
        These terms are governed by the laws of [jurisdiction]. Disputes go to [courts of jurisdiction / arbitration
        provider], except where your local consumer law gives you the right to sue at home.
      </p>

      <h2>11. Changes</h2>
      <p>
        We&apos;ll tell you about material changes in the app or by email at least 14 days before they take effect.
        Continuing to use Simulust after that means you accept the new terms.
      </p>

      <h2>12. Contact</h2>
      <p>
        [support email] · To report content, use the <Link href="/report">report form</Link>.
      </p>
    </DocPage>
  );
}
