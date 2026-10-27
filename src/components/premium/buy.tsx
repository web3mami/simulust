"use client";

import { useSession } from "@/components/auth-gate";
import { buttonClass, cx } from "@/components/ui";
import type { OrderDTO } from "@/lib/api-types";
import { formatUsd, type Product } from "@/lib/pricing";

// The pieces of the checkout the shop pages need before anyone presses Buy.
// They live apart from shop-pay.tsx so the wallet and QR code libraries only
// load once a checkout opens.

type ButtonVariant = Parameters<typeof buttonClass>[0];
type ButtonSize = Parameters<typeof buttonClass>[1];

export function BuyButton({
  product,
  label,
  variant = "secondary",
  size = "md",
  className,
  "aria-label": ariaLabel,
  onBuy,
}: {
  product: Product;
  label?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  "aria-label"?: string;
  onBuy: (product: Product) => void;
}) {
  const { session, openLogin } = useSession();
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      className={buttonClass(variant, size, cx("w-full", className))}
      onClick={() => (session ? onBuy(product) : openLogin())}
    >
      {label ?? `Buy for ${formatUsd(product.usdCents)}`}
    </button>
  );
}

// A payment arrived and waits on final checks (sanctions screening) before
// anything is added. The checkout may have closed meanwhile: the payment can
// have landed just before it did.
export function isHeld(order: OrderDTO) {
  return order.signature !== null && ["pending", "expired", "underpaid"].includes(order.status);
}
