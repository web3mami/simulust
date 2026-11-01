import { route } from "@/server/http";
import { clearSessionCookie, deleteSession, readSession, sessionTokenHash, syncHeldCookie } from "@/server/sessions";

// Ends this browser's session, signed in or not. The account is read first, so
// a held one's browser keeps remembering it after signing out.
export const POST = route(async (request: Request) => {
  const session = await readSession(request);
  const tokenHash = session?.tokenHash ?? sessionTokenHash(request);
  if (tokenHash) await deleteSession(tokenHash);
  const response = clearSessionCookie(new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } }));
  return syncHeldCookie(request, response, session?.user ?? null);
});
