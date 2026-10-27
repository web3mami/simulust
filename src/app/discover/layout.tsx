import type { Metadata } from "next";

// The page is a client component, so its title lives here.
export const metadata: Metadata = {
  title: "Discover AI characters · Simulust",
  description: "Browse AI girlfriends, anime characters and AI boyfriends. Every character is a fictional adult.",
};

export default function DiscoverLayout({ children }: LayoutProps<"/discover">) {
  return children;
}
