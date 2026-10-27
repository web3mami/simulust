"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { AccountMenu } from "@/components/account-menu";
import { PremiumIcon } from "@/components/premium-icon";

const NAV = [
  {
    href: "/",
    label: "Home",
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M4 11 12 4l8 7" />
        <path d="M6 9.5V20h4.5v-6h3V20H18V9.5" />
      </svg>
    ),
  },
  {
    href: "/#explore",
    label: "Discover",
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6">
        <circle cx="11" cy="11" r="6.5" />
        <path d="m16 16 4 4" />
      </svg>
    ),
  },
  {
    href: "/create",
    label: "Create",
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6">
        <circle cx="12" cy="12" r="8" />
        <path d="M12 8v8M8 12h8" />
      </svg>
    ),
  },
  {
    href: "/chat",
    label: "Chat",
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M5 7.2A3.2 3.2 0 0 1 8.2 4h7.6A3.2 3.2 0 0 1 19 7.2v5.6A3.2 3.2 0 0 1 15.8 16H10l-4.5 3.2V16H8.2A3.2 3.2 0 0 1 5 12.8z" />
      </svg>
    ),
  },
];

function navActive(href: string, pathname: string) {
  if (href === "/create") return pathname.startsWith("/create");
  if (href === "/chat") return pathname.startsWith("/chat") || pathname.startsWith("/date");
  if (href === "/premium") {
    return pathname.startsWith("/premium") || pathname.startsWith("/packs") || pathname.startsWith("/pricing");
  }
  if (href === "/#explore") return false;
  return pathname === "/";
}

export function AppHeader({ center }: { center?: ReactNode }) {
  return (
    <header className="sticky top-0 z-30 flex shrink-0 items-center gap-3 border-b border-[var(--line)] bg-[var(--bg)]/95 px-4 py-3 backdrop-blur">
      {center ? (
        <div className="mx-auto flex items-center gap-6">{center}</div>
      ) : (
        <Link
          href="/"
          className="font-[family-name:var(--font-display)] text-lg text-[var(--ink)]"
        >
          Simu<span className="text-[var(--gold)]">Lust</span>
        </Link>
      )}
      <div className="ml-auto flex items-center gap-2">
        <AccountMenu />
      </div>
    </header>
  );
}

const FOOTER_LINKS = [
  { href: "/terms", label: "Terms" },
  { href: "/privacy", label: "Privacy" },
  { href: "/content-policy", label: "Content policy" },
  { href: "/safety", label: "Safety" },
  { href: "/report", label: "Report" },
  { href: "/2257", label: "2257" },
  { href: "/dmca", label: "DMCA" },
  { href: "/pricing", label: "Pricing" },
];

function SiteFooter() {
  return (
    <footer className="border-t border-[var(--line)] px-4 py-6 text-xs text-[var(--muted)]">
      <div className="mx-auto max-w-5xl">
        <nav aria-label="Legal" className="flex flex-wrap gap-x-5 gap-y-2">
          {FOOTER_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="hover:text-[var(--ink)]">
              {link.label}
            </Link>
          ))}
        </nav>
        <p className="mt-3 leading-5">
          18+ only. Every character is a fictional adult, and every image is AI-generated. You are talking to an AI, not
          a person.
        </p>
      </div>
    </footer>
  );
}

// Layout for legal and policy pages: plain reading width, consistent headings.
export function DocPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <AppShell>
      <AppHeader />
      <article className="mx-auto w-full max-w-3xl px-4 py-10">
        <p className="rounded-2xl border border-[var(--gold)]/40 bg-[var(--gold)]/10 px-4 py-3 text-sm text-[var(--gold)]">
          Draft: have counsel review before launch.
        </p>
        <h1 className="mt-8 font-[family-name:var(--font-display)] text-4xl text-[var(--ink)]">{title}</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">Last updated {updated}</p>
        <div className="mt-6 text-[15px] leading-7 text-[var(--muted)] [&_a]:text-[var(--gold)] [&_a]:underline [&_a]:underline-offset-2 [&_h2]:mt-10 [&_h2]:font-[family-name:var(--font-display)] [&_h2]:text-2xl [&_h2]:text-[var(--ink)] [&_h3]:mt-6 [&_h3]:font-medium [&_h3]:text-[var(--ink)] [&_li]:mt-1.5 [&_ol]:mt-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:mt-3 [&_strong]:text-[var(--ink)] [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-5">
          {children}
        </div>
      </article>
    </AppShell>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [railOpen, setRailOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--ink)]">
      <div className="flex min-h-screen">
        <aside
          className={`${railOpen ? "w-56 px-3" : "w-16 items-center px-2"} sticky top-0 z-40 hidden h-screen shrink-0 flex-col border-r border-[var(--line)] bg-[var(--bg)] py-4 lg:flex`}
        >
          <div className={`flex items-center ${railOpen ? "gap-2 px-1" : "flex-col"}`}>
            <button
              type="button"
              aria-label={railOpen ? "Collapse menu" : "Expand menu"}
              aria-expanded={railOpen}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[var(--ink)] hover:bg-white/5"
              onClick={() => setRailOpen((open) => !open)}
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6">
                <path d="M5 7h14M5 12h14M5 17h14" />
              </svg>
            </button>
            {railOpen ? (
              <Link
                href="/"
                className="truncate font-[family-name:var(--font-display)] text-lg text-[var(--ink)]"
              >
                Simu<span className="text-[var(--gold)]">Lust</span>
              </Link>
            ) : null}
          </div>
          <nav className="mt-6 flex flex-1 flex-col gap-1.5">
            {NAV.map((item) => {
              const on = navActive(item.href, pathname);
              return (
                <Link
                  key={item.label}
                  href={item.href}
                  aria-label={item.label}
                  title={railOpen ? undefined : item.label}
                  className={`${railOpen ? "justify-start gap-3 px-3" : "justify-center"} flex h-11 items-center rounded-2xl ${
                    on ? "bg-white/10 text-[var(--ink)]" : "text-[var(--muted)] hover:bg-white/5 hover:text-[var(--ink)]"
                  }`}
                >
                  <span className="shrink-0">{item.icon}</span>
                  {railOpen ? <span className="text-sm">{item.label}</span> : null}
                </Link>
              );
            })}
          </nav>
          <Link
            href="/premium"
            aria-label="Premium"
            title={railOpen ? undefined : "Premium"}
            className={`${railOpen ? "justify-start gap-3 px-3" : "justify-center"} mt-auto flex h-11 w-full items-center rounded-2xl bg-[var(--gold)] !text-[#12110F]`}
          >
            <PremiumIcon />
            {railOpen ? <span className="text-sm font-medium">Premium</span> : null}
          </Link>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col pb-20 lg:pb-0">
          <div className="flex-1">{children}</div>
          {/* The chat screen needs the full height for the conversation. */}
          {pathname.startsWith("/date/") ? null : <SiteFooter />}
        </div>
      </div>

      <nav
        className="fixed inset-x-0 bottom-0 z-40 flex items-end border-t border-[var(--line)] bg-[var(--bg)]/95 px-1 pb-2 pt-1.5 backdrop-blur lg:hidden"
        aria-label="Mobile"
      >
        {NAV.filter((item) => item.href !== "/create").slice(0, 2).map((item) => {
          const on = navActive(item.href, pathname);
          return (
            <Link
              key={item.label}
              href={item.href}
              className={`flex flex-1 flex-col items-center gap-1 py-2 text-[11px] ${
                on ? "text-[var(--gold)]" : "text-[var(--muted)]"
              }`}
            >
              {item.icon}
              {item.label}
            </Link>
          );
        })}
        <Link
          href="/create"
          aria-label="Create"
          className="create-dock relative -mt-7 mb-0.5 flex w-[4.5rem] shrink-0 flex-col items-center"
        >
          <span className="create-dock-ring" aria-hidden />
          <span className="relative z-10 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--gold)] !text-[#12110F] shadow-[0_8px_20px_rgba(198,161,91,0.35)]">
            <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 6v12M6 12h12" />
            </svg>
          </span>
          <span className="mt-1 text-[11px] text-[var(--gold)]">Create</span>
        </Link>
        {NAV.filter((item) => item.href === "/chat").map((item) => {
          const on = navActive(item.href, pathname);
          return (
            <Link
              key={item.label}
              href={item.href}
              className={`flex flex-1 flex-col items-center gap-1 py-2 text-[11px] ${
                on ? "text-[var(--gold)]" : "text-[var(--muted)]"
              }`}
            >
              {item.icon}
              {item.label}
            </Link>
          );
        })}
        <Link
          href="/premium"
          className="flex flex-1 flex-col items-center gap-1 py-2 text-[11px] text-[var(--gold)]"
        >
          <PremiumIcon />
          Premium
        </Link>
      </nav>
    </div>
  );
}
