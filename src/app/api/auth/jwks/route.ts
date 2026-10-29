import { features } from "@/server/env";
import { notFound, route } from "@/server/http";
import { walletJwks } from "@/server/wallet-token";

// The public key Privy checks wallet tokens with. Set this URL
// ({APP_URL}/api/auth/jwks) as the JWKS endpoint of the Privy app's JWT-based
// authentication.
export const GET = route(async () => {
  if (!features.privy) throw notFound();
  return Response.json(await walletJwks(), { headers: { "Cache-Control": "public, max-age=300" } });
});
