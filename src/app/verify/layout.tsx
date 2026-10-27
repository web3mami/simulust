import type { Metadata } from "next";

// The page is a client component, so its tab title is set here.
export const metadata: Metadata = { title: "Verify your age · Simulust" };

export default function VerifyLayout({ children }: LayoutProps<"/verify">) {
  return children;
}
