import { requireUser } from "@/server/auth";
import { features } from "@/server/env";
import { notFound, route } from "@/server/http";
import { walletToken } from "@/server/wallet-token";

// The short-lived JWT the browser hands Privy (getExternalJwt), so the signed-in
// account gets its embedded Solana wallet. Without Privy there's no wallet.
export const GET = route(async (request: Request) => {
  const user = await requireUser(request);
  if (!features.privy) throw notFound("Wallets aren't set up here.");
  return Response.json({ token: await walletToken(user.id) }, { headers: { "Cache-Control": "no-store" } });
});
