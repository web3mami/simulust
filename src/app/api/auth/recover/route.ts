import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { underageBirthDate } from "@/server/age";
import { assertNotSuspended, touch } from "@/server/auth";
import { db } from "@/server/db";
import { users } from "@/server/db/schema";
import { clientIp, HttpError, readJson, route } from "@/server/http";
import { toMe } from "@/server/me";
import {
  hashPassword,
  newRecoveryCode,
  normalizeUsername,
  passwordProblem,
  recoveryCodeHash,
  recoveryCodeMatches,
  USERNAME,
} from "@/server/password";
import { rateLimit } from "@/server/ratelimit";
import {
  createSession,
  deleteSession,
  deleteUserSessions,
  deviceRefused,
  readSession,
  sessionTokenHash,
  setSessionCookie,
  syncHeldCookie,
} from "@/server/sessions";

const body = z.object({
  username: z.string().max(64),
  recoveryCode: z.string().max(64),
  newPassword: z.string().max(1024),
});

const invalidRecovery = () => new HttpError(401, "That username and recovery code don't match.", "invalid_recovery");

// A forgotten password, reset with the recovery code from sign-up. The code is
// used up: a new one comes back with the new password, and every other browser
// signed in to the account is signed out. One answer for every failure, so it
// never says which usernames exist.
export const POST = route(async (request: Request) => {
  const input = await readJson(request, body);
  const username = normalizeUsername(input.username);
  await rateLimit(`recover-ip:${clientIp(request)}`, 10, 60 * 60);
  await rateLimit(`recover-user:${username}`, 5, 60 * 60);

  // Judged on what was typed, never on the account, so it gives nothing away.
  const passwordIssue = passwordProblem(input.newPassword, username);
  if (passwordIssue) throw new HttpError(400, passwordIssue, "weak_password");

  const database = await db();
  const [user] = USERNAME.test(username)
    ? await database.select().from(users).where(eq(users.username, username)).limit(1)
    : [];
  const matches = recoveryCodeMatches(input.recoveryCode, user?.recoveryCodeHash ?? null);
  if (!user || !matches) {
    throw invalidRecovery();
  }
  await assertNotSuspended(user);
  // As at login: a device the age gate refused gets in, on hold.
  if (deviceRefused(request)) await underageBirthDate(user.id, "device_gate");

  const recoveryCode = newRecoveryCode();
  // Scrypt runs before taking the account's database lock.
  const passwordHash = await hashPassword(input.newPassword);
  // The session this browser already had (another account, say) ends too,
  // read first, as at login.
  const previous = await readSession(request);
  const previousToken = previous?.tokenHash ?? sessionTokenHash(request);
  const { updated, token } = await database.transaction(async (tx) => {
    // Comparing the stored code in the UPDATE consumes it once, even when
    // concurrent requests both passed the earlier check. A losing request
    // changes neither credentials nor sessions. Session failure rolls it all back.
    const [updated] = await tx
      .update(users)
      .set({ passwordHash, recoveryCodeHash: recoveryCodeHash(recoveryCode) })
      .where(and(eq(users.id, user.id), eq(users.recoveryCodeHash, user.recoveryCodeHash!)))
      .returning();
    if (!updated) throw invalidRecovery();
    await deleteUserSessions(user.id, undefined, tx);
    if (previousToken) await deleteSession(previousToken, tx);
    const token = await createSession(user.id, tx);
    return { updated, token };
  });
  const signedIn = await touch(updated, { force: true });

  const response = Response.json(
    { me: await toMe(signedIn), recoveryCode },
    { headers: { "Cache-Control": "no-store" } },
  );
  syncHeldCookie(request, setSessionCookie(response, token), signedIn);
  // As at login: a browser switching away from a held account keeps its mark.
  const switchedFrom = previous && previous.user.id !== user.id && previous.user.explicitHoldAt ? previous.user : null;
  return syncHeldCookie(request, response, switchedFrom);
});
