import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/server/env";

// Sanctioned regions (OFAC) are blocked outright, plus any region listed in
// BLOCKED_COUNTRIES where we haven't met local age-verification rules yet.
// The country comes only from the header the platform in front of the app sets
// (GEO_COUNTRY_HEADER); a header the client could send itself is never read.
export function proxy(request: NextRequest) {
  const country = (request.headers.get(env.geoCountryHeader) ?? "").trim().toUpperCase();
  if (country && env.blockedCountries.includes(country)) {
    if (request.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Simulust isn't available in your region.", code: "region_blocked" }, { status: 451 });
    }
    return new NextResponse(
      "<!doctype html><title>Unavailable</title><body style=\"background:#12110F;color:#F3EEE6;font-family:sans-serif;padding:3rem\"><h1>Simulust isn't available in your region.</h1></body>",
      { status: 451, headers: { "content-type": "text/html; charset=utf-8" } },
    );
  }
  return NextResponse.next();
}

export const config = {
  // Webhooks come from payment and verification providers, not users.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/webhooks).*)"],
};
