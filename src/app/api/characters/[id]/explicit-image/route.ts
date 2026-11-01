import type { NextRequest } from "next/server";
import { currentUser } from "@/server/auth";
import { explicitArtFor } from "@/server/characters";
import { notFound, route } from "@/server/http";
import { readLocalObject, signedUrl, usesS3 } from "@/server/storage";

// A character's nude art. The viewer is checked on every request, on the
// server: signed in, a confirmed adult, no hold, and the character visible to
// them (official, or their own) with its art still servable (not taken down).
// Anything else is a plain 404, so
// nobody can tell which characters have nude art. <img> tags authenticate with
// the session cookie, like /api/media.
const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  // Development placeholders are SVG; never let an image URL run script.
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  "Cross-Origin-Resource-Policy": "same-origin",
};

// Private and short: a hold placed on the account, a takedown, or signing out
// should stop it showing within a couple of minutes even from the viewer's own
// browser cache.
// It differs per login, so a shared cache must never answer for someone else.
const CACHE = { "Cache-Control": "private, max-age=120", Vary: "Cookie, Authorization" };

export const GET = route(async (request: NextRequest, ctx: RouteContext<"/api/characters/[id]/explicit-image">) => {
  const { id } = await ctx.params;
  const user = await currentUser(request);
  const row = await explicitArtFor(user, id);
  if (!row?.storageKey) throw notFound();

  if (usesS3()) {
    return new Response(null, {
      status: 302,
      headers: { Location: await signedUrl(row.storageKey, 300), ...CACHE },
    });
  }

  const object = await readLocalObject(row.storageKey);
  if (!object) throw notFound();
  return new Response(new Uint8Array(object.body), {
    headers: {
      ...SECURITY_HEADERS,
      ...CACHE,
      "Content-Type": row.mimeType ?? object.contentType,
      "Content-Length": String(object.body.byteLength),
    },
  });
});
