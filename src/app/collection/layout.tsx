import type { Metadata } from "next";

// The page is a client component, so its title lives here.
export const metadata: Metadata = { title: "My collection · Simulust" };

export default function CollectionLayout({ children }: LayoutProps<"/collection">) {
  return children;
}
