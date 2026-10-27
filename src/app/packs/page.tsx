import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { Shop } from "@/components/shop";

export const metadata: Metadata = {
  title: "Credit packs · Simulust",
  description: "Credits for photos, voice notes and video, paid in USDC or SOL. Credits never expire.",
};

export default function PacksPage() {
  return (
    <AppShell>
      <Shop focus="packs" />
    </AppShell>
  );
}
