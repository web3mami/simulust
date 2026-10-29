import { eq } from "drizzle-orm";
import { z } from "zod";
import { underageBirthDate } from "@/server/age";
import { assertNotSuspended, touch } from "@/server/auth";
import { db } from "@/server/db";
import { users } from "@/server/db/schema";
import { clientIp, HttpError, readJson, route } from "@/server/http";
import { toMe } from "@/server/me";
import { DUMMY_PASSWORD_HASH, hashPassword, needsRehash, normalizeUsername, USERNAME, verifyPassword } from "@/server/password";
import { rateLimit } from "@/server/ratelimit";
import {
  createSession,
  deleteSession,
  deviceRefused,
  readSession,
  sessionTokenHash,
  setSessionCookie,
  syncHeldCookie,
} from "@/server/sessions";

const body = z.object({
  username: z.string().max(64),
  password: z.string().max(1024),
});

export const POST = route(async (request: Request) => {
  const input = await readJson(request, body);
  const username = normalizeUsername(input.username);
  // Per IP against spraying many accounts, per username against guessing one.
  await rateLimit(`login-ip:${clientIp(request)}`, 20, 15 * 60);
  await rateLimit(`login-user:${username}`, 10, 15 * 60);

  const database = await db();
  const [user] = USERNAME.test(username)
    ? await database.select().from(users).where(eq(users.username, username)).limit(1)
    : [];
  // One answer for a wrong password, a username nobody has, and an account
  // with no password (development handles), so the form never says which
  // usernames exist. A missing account still costs a full scrypt, so the
  // timing doesn't say either.
  const matches = await verifyPassword(input.password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
  if (!user?.passwordHash || !matches) {
    throw new HttpError(401, "That username and password don't match.", "invalid_credentials");
  }
  // Only someone with the password learns the account is suspended.
  await assertNotSuspended(user);
  // A device whose age gate refused an under-18 date of birth can still sign
  // in, but the account goes on the hold the gate's own call places.
  if (deviceRefused(request)) await underageBirthDate(user.id, "device_gate");

  if (needsRehash(user.passwordHash)) {
    await database
      .update(users)
      .set({ passwordHash: await hashPassword(input.password) })
      .where(eq(users.id, user.id));
  }
  const signedIn = await touch(user, { force: true });
  // A session this browser already had (another account, say) ends here. The
  // account is read first, as signing out reads it.
  const previous = await readSession(request);
  const previousToken = previous?.tokenHash ?? sessionTokenHash(request);
  if (previousToken) await deleteSession(previousToken);

  const response = Response.json({ me: await toMe(signedIn) }, { headers: { "Cache-Control": "no-store" } });
  // A held account's browser remembers it, so signing up again starts held.
  syncHeldCookie(request, setSessionCookie(response, await createSession(user.id)), signedIn);
  // So does a browser switching away from one: the earlier account's mark is
  // set last, so the account signing in can't clear it.
  const switchedFrom = previous && previous.user.id !== user.id && previous.user.explicitHoldAt ? previous.user : null;
  return syncHeldCookie(request, response, switchedFrom);
});
