import type { Metadata } from "next";

// The page is a client component, so its tab title is set here.
export const metadata: Metadata = { title: "Memories · Simulust" };

export default function MemoriesLayout({ children }: LayoutProps<"/memories/[characterId]">) {
  return children;
}
