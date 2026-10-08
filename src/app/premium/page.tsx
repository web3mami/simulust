"use client";

import { AppHeader, AppShell } from "@/components/app-shell";
import { Shop } from "@/components/shop";

export default function PremiumPage() {
  return (
    <AppShell>
      <AppHeader />
      <Shop />
    </AppShell>
  );
}
