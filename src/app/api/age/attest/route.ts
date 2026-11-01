import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireUser } from "@/server/auth";
import { birthDateVerdict, underageBirthDate } from "@/server/age";
import { db } from "@/server/db";
import { users } from "@/server/db/schema";
import { errorResponse, HttpError, readJson, route } from "@/server/http";
import { toMe } from "@/server/me";
import { rateLimit } from "@/server/ratelimit";
import { syncHeldCookie } from "@/server/sessions";

const body = z.object({
  birthDate: z.string().max(32),
  // The browser's local date (YYYY-MM-DD), so a birthday counts from local
  // midnight. Used only when it's a date some time zone is on right now.
  today: z.string().max(32).optional(),
  consent: z.literal(true, "Confirm you're an adult and want to see adult content."),
});

// The in-app age confirmation, for accounts made before sign-up asked for a
// date of birth, or whose confirmation an admin's review cleared: the user
// gives their date of birth again, and an adult's account records when they
// confirmed (and their consent to explicit content, if not already recorded).
// The date itself is never stored or logged. Someone who gives an under-18 date
// loses explicit content until an admin reviews the account, and their browser
// is marked as a held account's (so signing up again starts held too).
export const POST = route(async (request: Request) => {
  const user = await requireUser(request);
  await rateLimit(`age-attest:${user.id}`, 10, 60 * 60);
  const { birthDate, today } = await readJson(request, body);
  if (user.explicitHoldAt) {
    const paused = new HttpError(403, "Paused while we review this account.", "explicit_hold");
    return syncHeldCookie(request, errorResponse(paused), user);
  }

  // A typo (not a real date, or in the future) says nothing about age, so it's
  // refused without counting against anyone.
  const verdict = birthDateVerdict(birthDate, today);
  if (verdict === "invalid") throw new HttpError(400, "Enter a real date of birth.", "invalid_birth_date");
  if (verdict === "minor") {
    // Clears the earlier confirmation too, so a review that lifts the hold
    // still leaves them to confirm again.
    const held = await underageBirthDate(user.id, "age_attest");
    const refused = new HttpError(403, "Simulust is only for adults, so explicit content stays off on this account.", "under_18");
    return syncHeldCookie(request, errorResponse(refused), held ?? { ...user, explicitHoldAt: new Date() });
  }

  const now = new Date();
  const database = await db();
  const [updated] = await database
    .update(users)
    .set({
      ageAttestedAt: now,
      ...(user.settings.explicitConsentAt
        ? {}
        : { settings: { ...user.settings, explicitConsentAt: now.toISOString() } }),
    })
    .where(eq(users.id, user.id))
    .returning();
  return Response.json({ me: await toMe(updated ?? user) });
});
