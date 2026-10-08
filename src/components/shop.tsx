"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { PaySolButton } from "@/components/shop-pay";
import { PACKS, PREMIUM, formatSave, formatSol, type ShopOffer } from "@/lib/packs";

function Highlights({ items }: { items: string[] }) {
  return (
    <ul className="mt-2.5 space-y-1">
      {items.map((item) => (
        <li key={item} className="flex gap-2 text-[13px] leading-5 text-[var(--ink)]">
          <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[var(--gold)]" />
          {item}
        </li>
      ))}
    </ul>
  );
}

function PackShell({
  gold,
  children,
}: {
  gold?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="relative pb-2 pr-2">
      <div
        className="absolute inset-0 translate-x-[4px] translate-y-[4px] rounded-[1.15rem] border border-[var(--line)] bg-[var(--bg)]"
        aria-hidden
      />
      <div
        className="absolute inset-0 translate-x-[8px] translate-y-[8px] rounded-[1.15rem] border border-[var(--gold)]/20"
        aria-hidden
      />
      <article
        className={`relative flex h-full flex-col overflow-hidden rounded-[1.15rem] border ${
          gold
            ? "border-[var(--gold)]/55 bg-[var(--bg-2)]"
            : "border-[var(--line)] bg-[var(--bg-2)]"
        }`}
      >
        <div className={`h-1 ${gold ? "bg-[var(--gold)]" : "bg-[var(--gold)]/35"}`} />
        {children}
      </article>
    </div>
  );
}

function Pack({ offer }: { offer: ShopOffer }) {
  return (
    <PackShell gold={offer.featured}>
      <div className="flex flex-1 flex-col px-4 pb-3.5 pt-3">
        <p className="min-h-[1rem] text-[10px] uppercase tracking-wide text-[var(--gold)]">
          {offer.tag ? (
            <>
              {offer.id === "heat" ? <span aria-hidden>★ </span> : null}
              {offer.tag}
            </>
          ) : null}
        </p>
        <h2 className="mt-1 font-[family-name:var(--font-display)] text-2xl leading-none">
          {offer.name}
        </h2>
        <p className="mt-2.5 font-[family-name:var(--font-display)] text-xl leading-none text-[var(--ink)]">
          {formatSol(offer.sol)}
        </p>
        {offer.save ? (
          <p className="mt-1 text-xs text-[var(--gold)]">{formatSave(offer.save)}</p>
        ) : (
          <p className="invisible mt-1 text-xs" aria-hidden>
            Save
          </p>
        )}
        <Highlights items={offer.highlights} />
        <div className="mt-auto pt-3">
          <PaySolButton offer={offer} gold={offer.featured} compact />
        </div>
      </div>
    </PackShell>
  );
}

function PacksTrack() {
  const scroller = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;

    const onScroll = () => {
      const cards = [...el.children] as HTMLElement[];
      const mid = el.scrollLeft + el.clientWidth / 2;
      let best = 0;
      let nearest = Infinity;
      cards.forEach((card, index) => {
        const center = card.offsetLeft + card.offsetWidth / 2;
        const distance = Math.abs(center - mid);
        if (distance < nearest) {
          nearest = distance;
          best = index;
        }
      });
      setActive(best);
    };

    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  const goTo = (index: number) => {
    const el = scroller.current;
    const card = el?.children[index] as HTMLElement | undefined;
    if (!el || !card) return;
    const left = card.offsetLeft - (el.clientWidth - card.offsetWidth) / 2;
    el.scrollTo({ left: Math.max(0, left), behavior: "smooth" });
  };

  return (
    <div className="mt-5 lg:mt-4">
      <div
        ref={scroller}
        className="flex snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain pb-4 [scrollbar-width:none] [-ms-overflow-style:none] [touch-action:pan-x] [&::-webkit-scrollbar]:hidden lg:grid lg:grid-cols-3 lg:gap-4 lg:overflow-visible lg:pb-1"
      >
        {PACKS.map((pack) => (
          <div
            key={pack.id}
            className="w-[min(72vw,20rem)] shrink-0 snap-center lg:w-auto"
          >
            <Pack offer={pack} />
          </div>
        ))}
      </div>
      <div
        className="mt-1 flex items-center justify-center gap-2 lg:hidden"
        role="tablist"
        aria-label="Packs"
      >
        {PACKS.map((pack, index) => {
          const on = active === index;
          return (
            <button
              key={pack.id}
              type="button"
              role="tab"
              aria-label={pack.name}
              aria-selected={on}
              onClick={() => goTo(index)}
              className={`rounded-full transition-[width,background-color] ${
                on ? "h-1.5 w-5 bg-[var(--gold)]" : "h-1.5 w-1.5 bg-[var(--ink)]/30"
              }`}
            />
          );
        })}
      </div>
    </div>
  );
}

export function Shop() {
  return (
    <section className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:py-5">
      <h1 className="font-[family-name:var(--font-display)] text-4xl font-light leading-none text-[var(--ink)]">
        Packs.
      </h1>
      <PacksTrack />
      <h2 className="mt-6 font-[family-name:var(--font-display)] text-4xl font-light leading-none text-[var(--ink)] lg:mt-5">
        Premium.
      </h2>
      <div className="mt-4">
        <PackShell gold>
          <div className="flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5 sm:py-4">
            <div className="min-w-0 flex-1">
              {PREMIUM.tag ? (
                <p className="text-[10px] uppercase tracking-wide text-[var(--gold)]">{PREMIUM.tag}</p>
              ) : null}
              <p className="mt-1.5 font-[family-name:var(--font-display)] text-2xl leading-none sm:text-3xl">
                {formatSol(PREMIUM.sol)}
              </p>
              <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
                {PREMIUM.highlights.map((item) => (
                  <li key={item} className="flex gap-2 text-[13px] text-[var(--ink)]">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[var(--gold)]" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="w-full shrink-0 sm:w-44">
              <PaySolButton offer={PREMIUM} gold compact />
            </div>
          </div>
        </PackShell>
      </div>
    </section>
  );
}
