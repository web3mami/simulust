import type { Metadata } from "next";
import { Outfit } from "next/font/google";
import { AgeGate } from "@/components/age-gate";
import { AuthProvider } from "@/components/auth-gate";
import { PrivyApp } from "@/components/privy-app";
import "./globals.css";

// One geometric sans for everything; headings are just heavier.
const sans = Outfit({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Simulust",
  description: "Meet an AI that actually remembers you.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${sans.variable} h-full`}>
      <body className="min-h-full font-sans">
        <PrivyApp>
          <AgeGate>
            <AuthProvider>{children}</AuthProvider>
          </AgeGate>
        </PrivyApp>
      </body>
    </html>
  );
}
