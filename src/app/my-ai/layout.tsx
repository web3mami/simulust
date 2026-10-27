import type { Metadata } from "next";

// The page is a client component, so its title lives here.
export const metadata: Metadata = { title: "My AI · Simulust" };

export default function MyAILayout({ children }: LayoutProps<"/my-ai">) {
  return children;
}
