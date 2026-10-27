import type { Metadata } from "next";

// The page is a client component, so its tab title is set here.
export const metadata: Metadata = { title: "Trust & safety · Simulust" };

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return children;
}
