import { isAgeVerified, requireUser } from "@/server/auth";
import { env, features } from "@/server/env";
import { HttpError, route } from "@/server/http";
import { rateLimit } from "@/server/ratelimit";
import { createSession } from "@/server/veriff";

export const POST = route(async (request: Request) => {
  const user = await requireUser(request);
  // A held account's explicit content waits on the review, which no ID check
  // can stand in for, so it never starts one (and costs nothing to ask).
  if (user.explicitHoldAt) throw new HttpError(403, "Paused while we review this account.", "explicit_hold");
  // With the default age gate, adults confirm a date of birth instead
  // (POST /api/age/attest); ID checks run only with AGE_VERIFICATION=id.
  if (env.ageVerification === "gate") {
    throw new HttpError(409, "Confirm your age with your date of birth instead.", "use_age_gate");
  }
  if (isAgeVerified(user)) throw new HttpError(409, "You're already verified.", "already_verified");
  if (!features.veriff) {
    throw new HttpError(
      503,
      env.allowDevAgeCheck
        ? "Veriff isn't configured here. Use the development buttons instead."
        : "Age verification isn't available right now. Try again later.",
      "age_unavailable",
    );
  }
  // Each Veriff session costs money, so starting over and over is capped.
  await rateLimit(`age-start:${user.id}`, 5, 24 * 60 * 60);
  const { url } = await createSession(user);
  return Response.json({ url });
});
