import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/server/env";

// The visitor's "country-region" (ISO 3166-2, e.g. "US-TX"), or null when the
// platform didn't say. Vercel and Cloudflare send only the part after the dash
// ("TX"), so it's joined to the country; a full code is used as it is.
function regionOf(request: NextRequest, country: string) {
  const region = (request.headers.get(env.geoRegionHeader) ?? "").trim().toUpperCase();
  if (!region) return null;
  if (region.includes("-")) return region;
  return country ? `${country}-${region}` : null;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// The Solana Pay transaction request: wallets POST to it from their own origin
// (an app or extension), by design. It takes no auth and never reads cookies;
// the unguessable order id in the path is the only capability, so there's no
// session for a forged request to ride.
const SOLANA_PAY_TRANSACTION = /^\/api\/orders\/[^/]+\/transaction$/;

// A request that changes something (POST, PATCH, DELETE...) from a page on
// another site: a forged one riding the visitor's session cookie (CSRF). The
// browser always says where such a request comes from (Origin). Requests with
// no Origin (server-to-server: webhooks, the cron) aren't from a browser page
// and pass. Auth ignores the session cookie on these as well.
function crossSiteWrite(request: NextRequest) {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return false;
  const origin = request.headers.get("origin");
  if (origin === null) return false;
  let from: string;
  try {
    from = new URL(origin).host;
  } catch {
    return true;
  }
  const own = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? request.nextUrl.host)
    .split(",")[0]
    .trim();
  return from !== own && from !== new URL(env.appUrl).host;
}

// Sanctioned regions (OFAC) are blocked outright, plus any country listed in
// BLOCKED_COUNTRIES and any state or province in BLOCKED_REGIONS where we
// haven't met local age-verification rules. Country and region come only from
// the headers the platform in front of the app sets (GEO_COUNTRY_HEADER,
// GEO_REGION_HEADER); a header the client could send itself is never read.
export function proxy(request: NextRequest) {
  const country = (request.headers.get(env.geoCountryHeader) ?? "").trim().toUpperCase();
  const region = env.blockedRegions.length ? regionOf(request, country) : null;
  const blocked =
    (country && env.blockedCountries.includes(country)) || (region !== null && env.blockedRegions.includes(region));
  if (blocked) {
    if (request.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Simulust isn't available in your region.", code: "region_blocked" }, { status: 451 });
    }
    return new NextResponse(
      "<!doctype html><title>Unavailable</title><body style=\"background:#12110F;color:#F3EEE6;font-family:sans-serif;padding:3rem\"><h1>Simulust isn't available in your region.</h1></body>",
      { status: 451, headers: { "content-type": "text/html; charset=utf-8" } },
    );
  }
  const path = request.nextUrl.pathname;
  if (path.startsWith("/api/") && !SOLANA_PAY_TRANSACTION.test(path) && crossSiteWrite(request)) {
    return NextResponse.json({ error: "That request came from another site.", code: "cross_site" }, { status: 403 });
  }
  return NextResponse.next();
}

export const config = {
  // Webhooks come from payment and verification providers, not users.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/webhooks).*)"],
};
