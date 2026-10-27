import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { Home } from "@/components/home/home";

export const metadata: Metadata = {
  title: "Simulust · AI companions who remember you",
};

export default function HomePage() {
  return (
    <AppShell>
      <Home />
    </AppShell>
  );
}
