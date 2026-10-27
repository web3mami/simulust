import type { Metadata } from "next";

// The page is a client component, so its tab title is set here.
export const metadata: Metadata = { title: "Settings · Simulust" };

export default function SettingsLayout({ children }: LayoutProps<"/settings">) {
  return children;
}
