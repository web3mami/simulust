import { isAgeVerified, requireUser } from "@/server/auth";
import { env, features } from "@/server/env";
import { HttpError, route } from "@/server/http";
import { rateLimit } from "@/server/ratelimit";
import { createSession } from "@/server/veriff";

export const POST = route(async (request: Request) => {
  const user = await requireUser(request);
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
