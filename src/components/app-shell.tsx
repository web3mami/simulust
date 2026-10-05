"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { AccountMenu } from "@/components/account-menu";
import { useSession } from "@/components/auth-gate";

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

export function AppShell({ children }: { children: ReactNode }) {
  const { openLogin } = useSession();
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
          <button
            type="button"
            aria-label="Premium"
            title={railOpen ? undefined : "Premium"}
            className={`${railOpen ? "justify-start gap-3 px-3" : "justify-center"} mt-auto flex h-11 w-full items-center rounded-2xl bg-[var(--gold)] !text-[#12110F]`}
            onClick={openLogin}
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="currentColor">
              <path d="M6.2 10.2 12 4.8l5.8 5.4-2.2 8.4H8.4z" />
            </svg>
            {railOpen ? <span className="text-sm font-medium">Premium</span> : null}
          </button>
        </aside>

        <div className="min-w-0 flex-1 pb-16 lg:pb-0">{children}</div>
      </div>

      <nav
        className="fixed inset-x-0 bottom-0 z-40 flex border-t border-[var(--line)] bg-[var(--bg)]/95 backdrop-blur lg:hidden"
        aria-label="Mobile"
      >
        {NAV.map((item) => {
          const on = navActive(item.href, pathname);
          return (
            <Link
              key={item.label}
              href={item.href}
              className={`flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] ${
                on ? "text-[var(--gold)]" : "text-[var(--muted)]"
              }`}
            >
              {item.icon}
              {item.label}
            </Link>
          );
        })}
        <button
          type="button"
          className="flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] text-[var(--gold)]"
          onClick={openLogin}
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
            <path d="M6.2 10.2 12 4.8l5.8 5.4-2.2 8.4H8.4z" />
          </svg>
          Premium
        </button>
      </nav>
    </div>
  );
}
