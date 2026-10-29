import type { Metadata } from "next";

// The page is a client component, so its title lives here.
export const metadata: Metadata = { title: "Video Studio · Simulust" };

export default function StudioLayout({ children }: LayoutProps<"/studio">) {
  return children;
}
