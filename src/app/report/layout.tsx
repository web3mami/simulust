import type { Metadata } from "next";

// The page is a client component, so its tab title is set here.
export const metadata: Metadata = { title: "Report content · Simulust" };

export default function ReportLayout({ children }: LayoutProps<"/report">) {
  return children;
}
