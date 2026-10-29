import { currentUser } from "@/server/auth";
import { underageBirthDate } from "@/server/age";
import { route } from "@/server/http";
import { rateLimit } from "@/server/ratelimit";
import { syncHeldCookie } from "@/server/sessions";

// The age gate in front of the site calls this when someone gives a date of
// birth under 18. The device remembers the refusal on its own; signed out,
// there's nothing more to do. Signed in, the account goes on an explicit hold
// for an admin to review, logged with no date, and the browser is marked as a
// held account's, so signing up again starts held too. The body ({ today? })
// isn't read: the device already judged the date, and never sends it. Always 204.
export const POST = route(async (request: Request) => {
  const user = await currentUser(request);
  if (!user) return new Response(null, { status: 204 });
  // The hold is placed by the first call, so a capped repeat loses nothing.
  await rateLimit(`age-refused:${user.id}`, 20, 60 * 60);
  const held = await underageBirthDate(user.id, "device_gate");
  return syncHeldCookie(request, new Response(null, { status: 204 }), held ?? { ...user, explicitHoldAt: new Date() });
});
