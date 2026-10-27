import type { Metadata } from "next";

// The page is a client component, so its tab title is set here.
export const metadata: Metadata = { title: "Profile · Simulust" };

export default function ProfileLayout({ children }: LayoutProps<"/profile">) {
  return children;
}
