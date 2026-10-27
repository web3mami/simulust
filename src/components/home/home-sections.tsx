"use client";

import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { BrainIcon, CameraIcon, ChevronDownIcon, CompassIcon, PlusIcon } from "@/components/icons";
import { ButtonLink, cx } from "@/components/ui";
import { FOCUS_RING, Reveal, RowTitle } from "@/components/home/browse";
import { COSTS, FREE, MEMBERSHIP, formatUsd } from "@/lib/pricing";
import type { Lane } from "@/lib/characters";

// ---------------------------------------------------------------------------
// "Create your own" band: copy on the left, a fan of three portraits from the
// creator on the right.

const PROMO: Record<Lane, { noun: string; pronoun: string; art: [string, string, string] }> = {
  girls: {
    noun: "AI girlfriend",
    pronoun: "she",
    art: ["/creator/hair-red.jpg", "/creator/body-curvy.jpg", "/creator/hair-blonde.jpg"],
  },
  anime: {
    noun: "anime partner",
    pronoun: "they",
    art: ["/creator/eth-girl-anime-asian.jpg", "/creator/eth-girl-anime-caucasian.jpg", "/creator/eth-girl-anime-latina.jpg"],
  },
  guys: {
    noun: "AI boyfriend",
    pronoun: "he",
    art: ["/creator/eth-guy-realistic-caucasian.jpg", "/creator/body-guy-muscular.jpg", "/creator/eth-guy-realistic-black.jpg"],
  },
};

// Where each portrait sits in the fan: the middle one forward and upright.
const FAN = [
  "left-[4%] top-[14%] -rotate-[9deg] group-hover/promo:-rotate-[12deg] group-hover/promo:-translate-x-2",
  "left-1/2 top-[4%] z-10 -translate-x-1/2 group-hover/promo:-translate-y-1.5",
  "right-[4%] top-[14%] rotate-[9deg] group-hover/promo:rotate-[12deg] group-hover/promo:translate-x-2",
];

export function CreatePromo({ lane, className }: { lane: Lane; className?: string }) {
  const copy = PROMO[lane];
  const points = [
    "Choose the look, down to hair, eyes and body",
    "Set the personality and how far things go",
    `${copy.pronoun === "they" ? "They remember" : `${copy.pronoun[0].toUpperCase()}${copy.pronoun.slice(1)} remembers`} every chat`,
  ];
  return (
    <Reveal
      as="section"
      aria-label="Create your own"
      className={cx(
        "group/promo relative overflow-hidden rounded-3xl bg-[var(--bg-2)] ring-1 ring-white/5",
        "bg-[radial-gradient(120%_120%_at_100%_0%,rgba(255,79,139,0.22),transparent_55%)]",
        className,
      )}
    >
      <div className="relative grid items-center gap-6 px-5 py-7 sm:px-10 sm:py-10 md:grid-cols-[1.1fr_1fr] lg:px-14">
        <div className="relative z-10 max-w-lg">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--accent)]">Create</p>
          <h2 className="mt-2 text-2xl font-extrabold leading-tight tracking-tight text-[var(--ink)] sm:text-4xl">
            Create your own <span className="text-[var(--accent)]">{copy.noun}</span>
          </h2>
          <ul className="mt-4 flex flex-col gap-2 text-sm text-[var(--muted)] sm:text-base">
            {points.map((point) => (
              <li key={point} className="flex items-start gap-2.5">
                <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
                {point}
              </li>
            ))}
          </ul>
          <ButtonLink href="/create" size="lg" className="mt-6 shadow-[0_10px_30px_-6px_rgba(255,79,139,0.6)]">
            <PlusIcon className="h-5 w-5" />
            Create now
          </ButtonLink>
        </div>
        <div aria-hidden className="relative mx-auto -mb-2 h-48 w-full max-w-xs sm:mb-0 sm:h-72 sm:max-w-sm md:h-80">
          {copy.art.map((src, index) => (
            <div
              key={src}
              className={cx(
                "absolute aspect-[3/4] h-[78%] overflow-hidden rounded-2xl shadow-[0_20px_50px_-12px_rgba(0,0,0,0.85)] ring-1 ring-white/10 motion-safe:transition-transform motion-safe:duration-500",
                FAN[index],
              )}
            >
              <Image src={src} alt="" fill sizes="(min-width: 640px) 220px, 160px" className="object-cover object-top" />
            </div>
          ))}
        </div>
      </div>
    </Reveal>
  );
}

// ---------------------------------------------------------------------------
// How it works: three steps, side by side on wide screens, swiped on phones.

const STEPS: { icon: ReactNode; title: string; body: string }[] = [
  {
    icon: <CompassIcon className="h-6 w-6" />,
    title: "Pick someone, or make them",
    body: "Browse girls, anime characters and guys, or create your own from the look up.",
  },
  {
    icon: <BrainIcon className="h-6 w-6" />,
    title: "Chat. They remember.",
    body: "What you tell them becomes a memory you can see, edit or delete, so every chat picks up where you left off.",
  },
  {
    icon: <CameraIcon className="h-6 w-6" />,
    title: "Ask for photos, voice and video",
    body: `Pay per credit in USDC or SOL: a photo is ${COSTS.photo} credits, a voice note ${COSTS.voiceNote}. If one fails, its credits come back.`,
  },
];

export function HowItWorks() {
  return (
    <Reveal as="section" aria-labelledby="how-title">
      <RowTitle id="how-title" accent="How" href="/pricing" linkLabel="Pricing">
        it works
      </RowTitle>
      <ol className="no-scrollbar -mx-4 mt-3 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-4 px-4 sm:mx-0 sm:mt-4 sm:grid sm:grid-cols-3 sm:gap-4 sm:overflow-visible sm:px-0">
        {STEPS.map((step, index) => (
          <li
            key={step.title}
            className="relative w-[78%] shrink-0 snap-start overflow-hidden rounded-2xl bg-[var(--surface)] p-5 ring-1 ring-white/5 sm:w-auto sm:p-6"
          >
            <span aria-hidden className="absolute right-5 top-4 text-5xl font-extrabold leading-none tracking-tight text-white/[0.06] sm:right-6 sm:top-5">
              {index + 1}
            </span>
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">{step.icon}</span>
            <h3 className="mt-4 text-base font-bold text-[var(--ink)]">
              <span className="sr-only">Step {index + 1}: </span>
              {step.title}
            </h3>
            <p className="mt-1.5 text-sm leading-6 text-[var(--muted)]">{step.body}</p>
          </li>
        ))}
      </ol>
    </Reveal>
  );
}

// ---------------------------------------------------------------------------
// FAQ: answers taken from the pricing, privacy, safety and policy pages.

const LINK = "font-semibold text-[var(--accent)] underline-offset-2 hover:underline";

const FAQ: { q: string; a: ReactNode }[] = [
  {
    q: "Who can use Simulust?",
    a: (
      <>
        Adults only. You must be at least 18, and old enough to view adult content where you live. Explicit messages, photos,
        voice notes and video unlock after a quick ID check, done by our verification provider, so we never keep your document.
        Every character is a fictional adult and every image is AI-generated.
      </>
    ),
  },
  {
    q: "Am I talking to a real person?",
    a: (
      <>
        No. Every character is an AI, and nobody reads your chats to reply. Characters can sound caring and remember a lot about you,
        but they don&apos;t have feelings and they can get things wrong.
      </>
    ),
  },
  {
    q: "Do characters really remember me?",
    a: (
      <>
        Yes. Characters keep memories of the facts and preferences you share, and follow long conversations. You can see, edit and
        delete what each one remembers on its memory page.
      </>
    ),
  },
  {
    q: "How do credits work?",
    a: (
      <>
        You get {FREE.signupCredits} credits when you sign up and {FREE.dailyMessages} free messages a day. Credits pay for photos (
        {COSTS.photo}), voice notes ({COSTS.voiceNote}), video ({COSTS.video}) and messages past your free ones. Credits never
        expire, and if a photo, voice note or video fails or our safety checks block it, its credits come back automatically.{" "}
        <Link href="/pricing" className={LINK}>
          See all prices
        </Link>
      </>
    ),
  },
  {
    q: "How do I pay?",
    a: (
      <>
        Prices are in US dollars and you pay in USDC or SOL on Solana. Premium is {formatUsd(MEMBERSHIP.usdCents)} for{" "}
        {MEMBERSHIP.memberDays} days and doesn&apos;t renew on its own. Haven&apos;t used what you bought? Ask within 14 days for a
        refund as store credit, or as USDC back to the wallet that paid.
      </>
    ),
  },
  {
    q: "Are my chats private?",
    a: (
      <>
        We never sell your data or use your chats to train AI models. Everything is encrypted in transit and at rest, but chats
        aren&apos;t end-to-end encrypted: our servers have to read a message to write the reply. You can download or delete your data
        in Settings.{" "}
        <Link href="/privacy" className={LINK}>
          Privacy policy
        </Link>
      </>
    ),
  },
  {
    q: "What if I'm going through something hard?",
    a: (
      <>
        We check every message for signs that you might be in crisis. If we see them, the character steps out of the roleplay and
        shows you places to get help. We don&apos;t contact anyone or share your messages because of it.{" "}
        <Link href="/safety" className={LINK}>
          Help & safety
        </Link>
      </>
    ),
  },
  {
    q: "Can I make my own character?",
    a: (
      <>
        Yes. Pick the look, the personality and how they talk to you. Characters you create live in My AI, and only you can chat
        with them.
      </>
    ),
  },
];

export function Faq() {
  return (
    <Reveal as="section" aria-labelledby="faq-title">
      <RowTitle id="faq-title" accent="Questions," href="/safety" linkLabel="Help">
        answered
      </RowTitle>
      <div className="mt-3 grid gap-2 sm:mt-4 lg:grid-cols-2 lg:items-start lg:gap-3">
        {[FAQ.slice(0, Math.ceil(FAQ.length / 2)), FAQ.slice(Math.ceil(FAQ.length / 2))].map((column, at) => (
          <div key={at} className="flex flex-col gap-2 lg:gap-3">
            {column.map((item) => (
              <details
                key={item.q}
                className="group rounded-2xl bg-[var(--surface)] ring-1 ring-white/5 transition-colors open:bg-[var(--surface-2)]/60 open:ring-white/10"
              >
                <summary
                  className={cx(
                    "flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 rounded-2xl px-4 py-3 text-left text-sm font-semibold text-[var(--ink)] sm:px-5 sm:text-base [&::-webkit-details-marker]:hidden",
                    FOCUS_RING,
                  )}
                >
                  {item.q}
                  <ChevronDownIcon className="h-5 w-5 shrink-0 text-[var(--muted)] transition-transform duration-200 group-open:rotate-180" />
                </summary>
                <p className="px-4 pb-4 text-sm leading-6 text-[var(--muted)] sm:px-5 sm:pb-5">{item.a}</p>
              </details>
            ))}
          </div>
        ))}
      </div>
    </Reveal>
  );
}

// ---------------------------------------------------------------------------
// The foot of Home: what this is, the 18+ notice and the legal links, which on
// a phone otherwise only live in the menu drawer.

const LEGAL = [
  { href: "/terms", label: "Terms" },
  { href: "/privacy", label: "Privacy" },
  { href: "/content-policy", label: "Content policy" },
  { href: "/2257", label: "2257" },
  { href: "/dmca", label: "DMCA" },
  { href: "/pricing", label: "Pricing" },
  { href: "/safety", label: "Help & safety" },
  { href: "/report", label: "Report content" },
];

export function HomeFooter() {
  return (
    <footer className="border-t border-[var(--line)] pt-8 text-sm text-[var(--muted)]">
      <div className="grid gap-8 lg:grid-cols-[1.4fr_1fr]">
        <div className="max-w-2xl">
          <p className="text-lg font-extrabold tracking-tight text-[var(--ink)]">
            simu<span className="text-[var(--accent)]">lust</span>
          </p>
          <p className="mt-3 leading-6">
            Simulust is a place to chat with AI girlfriends, anime characters and AI boyfriends who remember you: what you
            like, what you told them last week, how you like to be talked to. Pick someone from the gallery or create your own,
            then ask for photos, voice notes and video when you want them. Prices are published up front, you pay in USDC or
            SOL, and credits never expire.
          </p>
          <p className="mt-4 flex items-start gap-2.5 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3.5 py-3 leading-6">
            <span className="mt-0.5 inline-flex h-6 shrink-0 items-center rounded-full bg-[var(--accent-soft)] px-2 text-[11px] font-bold text-[var(--accent)]">
              18+
            </span>
            Adults only. Every character is a fictional adult, every image is AI-generated, and no real person is on the other end
            of your chats.
          </p>
        </div>
        <nav aria-label="Legal and help">
          <ul className="grid grid-cols-2 gap-x-6 sm:grid-cols-3 lg:grid-cols-2">
            {LEGAL.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className={cx("flex h-10 items-center rounded-lg transition-colors hover:text-[var(--ink)]", "outline-none focus-visible:text-[var(--ink)] focus-visible:underline")}
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </footer>
  );
}
