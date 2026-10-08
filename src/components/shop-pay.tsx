"use client";

import { useState } from "react";
import { useSession } from "@/components/auth-gate";
import { formatSol, type ShopOffer } from "@/lib/packs";

export function PaySolButton({
  offer,
  gold = false,
  compact = false,
}: {
  offer: ShopOffer;
  gold?: boolean;
  compact?: boolean;
}) {
  const { session, openLogin } = useSession();
  const [asked, setAsked] = useState(false);

  return (
    <div>
      <button
        type="button"
        className={`w-full rounded-full text-sm font-medium ${
          compact ? "px-4 py-2" : "px-5 py-3"
        } ${
          gold
            ? "bg-[var(--gold)] !text-[#12110F]"
            : "border border-white/20 text-[var(--ink)] hover:border-[var(--ink)]"
        }`}
        onClick={() => {
          if (!session) {
            openLogin();
            return;
          }
          setAsked(true);
        }}
      >
        Pay {formatSol(offer.sol)}
      </button>
      {asked ? (
        <p className="mt-3 text-center text-xs leading-5 text-[var(--muted)]">
          Solana checkout isn’t live yet. Pay in SOL lands next.
        </p>
      ) : null}
    </div>
  );
}

