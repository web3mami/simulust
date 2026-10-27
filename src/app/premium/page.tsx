import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { Shop } from "@/components/shop";

export const metadata: Metadata = {
  title: "Premium · Simulust",
  description: "Unlimited messages, credits for photos, voice and video, paid in USDC or SOL. No auto-renew.",
};

export default function PremiumPage() {
  return (
    <AppShell>
      <Shop focus="membership" />
    </AppShell>
  );
}
