import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { users } from "@/server/db/schema";
import { HttpError, readJson, route } from "@/server/http";
import { hashPassword, passwordProblem, verifyPassword } from "@/server/password";
import { rateLimit } from "@/server/ratelimit";
import { deleteUserSessions, sessionTokenHash } from "@/server/sessions";

const body = z.object({
  currentPassword: z.string().max(1024),
  newPassword: z.string().max(1024),
});

// Changing the password signs every other browser out; this one stays in.
export const POST = route(async (request: Request) => {
  const user = await requireUser(request);
  if (!user.passwordHash) throw new HttpError(409, "This account has no password to change.", "no_password");
  await rateLimit(`password-change:${user.id}`, 10, 60 * 60);
  const input = await readJson(request, body);

  // 403, not 401: the session is fine, only the password typed is wrong.
  if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
    throw new HttpError(403, "Your current password isn't right.", "wrong_password");
  }
  const passwordIssue = passwordProblem(input.newPassword, user.username ?? "");
  if (passwordIssue) throw new HttpError(400, passwordIssue, "weak_password");

  const database = await db();
  await database
    .update(users)
    .set({ passwordHash: await hashPassword(input.newPassword) })
    .where(eq(users.id, user.id));
  await deleteUserSessions(user.id, sessionTokenHash(request));
  return new Response(null, { status: 204 });
});
