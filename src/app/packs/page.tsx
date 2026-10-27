"use client";

import { AppHeader, AppShell } from "@/components/app-shell";
import { Shop } from "@/components/shop";

export default function PacksPage() {
  return (
    <AppShell>
      <AppHeader />
      <Shop focus="packs" />
    </AppShell>
  );
}
