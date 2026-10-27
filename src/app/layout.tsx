import type { Metadata, Viewport } from "next";
import { Outfit } from "next/font/google";
import { cookies } from "next/headers";
import { AgeGate } from "@/components/age-gate";
import { LaneProvider, ShellRoot } from "@/components/app-shell";
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

// Dark browser chrome on phones, and content may run under the notch (the
// shell pads itself with the safe-area insets).
export const viewport: Viewport = {
  themeColor: "#0d0d10",
  colorScheme: "dark",
  viewportFit: "cover",
  // The on-screen keyboard shrinks the page instead of covering the chat composer.
  interactiveWidget: "resizes-content",
};

// Runs while the HTML parses, before first paint: marks visitors who already
// passed the age check (so the app shows at once instead of a blank screen)
// and applies a folded sidebar (so it never flashes wide). Same keys as
// age-gate.tsx and app-shell.tsx.
const BOOT = `try{var k="simulust-age-ok",d=document.documentElement;if(localStorage.getItem(k)==="1"||sessionStorage.getItem(k)==="1")d.setAttribute("data-age-ok","");var c=location.pathname.indexOf("/date/")===0?localStorage.getItem("simulust-sidebar-chat")!=="0":localStorage.getItem("simulust-sidebar-collapsed")==="1";if(c)d.setAttribute("data-sidebar","collapsed")}catch(e){}`;

// Written by the lane switcher in app-shell.tsx, so the first render already
// shows the saved Girls / Anime / Guys lane.
const LANE_COOKIE = "simulust-lane";

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const lane = (await cookies()).get(LANE_COOKIE)?.value ?? null;
  return (
    // The boot script adds attributes to <html> before React hydrates.
    <html lang="en" className={`${sans.variable} h-full`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: BOOT }} />
      </head>
      <body className="min-h-full font-sans">
        <PrivyApp>
          <AgeGate>
            {/* Lanes sit above auth so the login modal can match its art to the lane. */}
            <LaneProvider initialLane={lane}>
              <AuthProvider>
                <ShellRoot>{children}</ShellRoot>
              </AuthProvider>
            </LaneProvider>
          </AgeGate>
        </PrivyApp>
      </body>
    </html>
  );
}
