import { eq } from "drizzle-orm";
import { z } from "zod";
import { currentUser, requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { users } from "@/server/db/schema";
import { HttpError, readJson, route } from "@/server/http";
import { publicFeatures, toMe } from "@/server/me";
import { rateLimit } from "@/server/ratelimit";
import { moderateText, refusal } from "@/server/safety/moderation";
import { syncHeldCookie } from "@/server/sessions";
import { asName } from "@/server/safety/text";
import type { MeResponse } from "@/lib/api-types";

// The app asks this on every load, so it's where a held account's browser is
// marked (and unmarked once a review lifts the hold): see syncHeldCookie.
export const GET = route(async (request: Request) => {
  const user = await currentUser(request);
  const body: MeResponse = { me: user ? await toMe(user) : null, features: publicFeatures() };
  return syncHeldCookie(request, Response.json(body), user);
});

// Unknown fields are refused rather than ignored: there's no explicit switch
// (every confirmed adult gets explicit content), and a client still sending
// one should find out.
const patch = z.strictObject({
  displayName: z.string().trim().min(1).max(40).optional(),
  // A Solana address (base58, 32 to 44 characters), or null to forget it.
  walletAddress: z.string().trim().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/).nullable().optional(),
  settings: z.strictObject({ unpromptedMedia: z.boolean().optional() }).optional(),
});

export const PATCH = route(async (request: Request) => {
  const user = await requireUser(request);
  const input = await readJson(request, patch);
  // Screened like the profile name: the app shows it, and it's user-written
  // text an attacker could aim at a prompt.
  if (input.displayName && input.displayName !== user.displayName) {
    await rateLimit(`display-name:${user.id}`, 20, 60);
    const context = { userId: user.id, targetType: "profile" as const, targetId: user.id };
    const verdict = await moderateText(asName(input.displayName), context, { failClosed: true });
    if (!verdict.ok && "unavailable" in verdict) throw refusal(verdict);
    if (!verdict.ok) throw new HttpError(422, "Pick a different name.", "blocked_name");
  }
  const database = await db();
  const [updated] = await database
    .update(users)
    .set({
      ...(input.displayName ? { displayName: input.displayName } : {}),
      ...(input.walletAddress !== undefined ? { walletAddress: input.walletAddress } : {}),
      ...(input.settings ? { settings: { ...user.settings, ...input.settings } } : {}),
    })
    .where(eq(users.id, user.id))
    .returning();
  return Response.json({ me: await toMe(updated ?? user) });
});
