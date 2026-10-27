import { eq } from "drizzle-orm";
import { z } from "zod";
import { currentUser, isAgeVerified, requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { users } from "@/server/db/schema";
import { HttpError, readJson, route } from "@/server/http";
import { publicFeatures, toMe } from "@/server/me";
import { rateLimit } from "@/server/ratelimit";
import { moderateText, refusal } from "@/server/safety/moderation";
import { asName } from "@/server/safety/text";
import type { MeResponse } from "@/lib/api-types";

export const GET = route(async (request: Request) => {
  const user = await currentUser(request);
  const body: MeResponse = { me: user ? await toMe(user) : null, features: publicFeatures() };
  return Response.json(body);
});

const patch = z.object({
  displayName: z.string().trim().min(1).max(40).optional(),
  walletAddress: z.string().trim().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/).nullable().optional(),
  settings: z
    .object({
      explicit: z.boolean().optional(),
      unpromptedMedia: z.boolean().optional(),
    })
    .optional(),
});

export const PATCH = route(async (request: Request) => {
  const user = await requireUser(request);
  const input = await readJson(request, patch);
  if (input.settings?.explicit && !isAgeVerified(user)) {
    throw new HttpError(403, "Verify your age to turn on explicit content.", "age_verification_required");
  }
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
      ...(input.settings
        ? {
            settings: {
              ...user.settings,
              ...input.settings,
              ...(input.settings.explicit && !user.settings.explicitConsentAt
                ? { explicitConsentAt: new Date().toISOString() }
                : {}),
            },
          }
        : {}),
    })
    .where(eq(users.id, user.id))
    .returning();
  return Response.json({ me: await toMe(updated ?? user) });
});
