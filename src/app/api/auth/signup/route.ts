import { eq } from "drizzle-orm";
import { z } from "zod";
import { createAccount } from "@/server/auth";
import { birthDateVerdict, heldBrowserSignup } from "@/server/age";
import { db } from "@/server/db";
import { users } from "@/server/db/schema";
import { clientIp, HttpError, ipBucket, readJson, route } from "@/server/http";
import { toMe } from "@/server/me";
import { hashPassword, newRecoveryCode, passwordProblem, recoveryCodeHash, usernameProblem } from "@/server/password";
import { rateLimit } from "@/server/ratelimit";
import {
  createSession,
  deleteSession,
  deviceRefused,
  heldAccountOf,
  readSession,
  sessionTokenHash,
  setSessionCookie,
  syncHeldCookie,
} from "@/server/sessions";

const body = z.object({
  username: z.string().max(64),
  password: z.string().max(1024),
  birthDate: z.string().max(32),
  // The browser's local date (YYYY-MM-DD), so a birthday counts from local
  // midnight. Used only when it's a date some time zone is on right now.
  today: z.string().max(32).optional(),
  consent: z.literal(true, "Confirm you're 18 or over and want to see adult content."),
});

const taken = () => new HttpError(409, "That username is taken. Try another.", "username_taken");

// Every account gets the free daily messages, but only the first two made from
// one address in a day get the signup credits, so they can't be farmed by
// signing up over and over (or deleting and taking the same username back).
// Past that, the account starts with none and no ledger row.
const CREDITED_SIGNUPS_PER_DAY = 2;

async function earnsSignupCredits(ip: string) {
  try {
    await rateLimit(`signup-credits:${ip}`, CREDITED_SIGNUPS_PER_DAY, 24 * 60 * 60);
    return true;
  } catch (error) {
    if (error instanceof HttpError && error.status === 429) return false;
    throw error;
  }
}

// Sign-up is the age check: the date of birth is judged here, on the server,
// and an adult's account records only when they confirmed, never the date.
// Under 18, nothing is created or kept. The account starts signed in, with
// explicit content open (the whole site is uncensored), and gets a one-time
// recovery code, since there's no email to reset a password through.
//
// Two marks on the browser come first. A device whose age gate refused an
// under-18 date of birth gets no account at all, whatever date it gives now.
// A browser that remembers a held account (someone who said they're under 18)
// gets one already on hold, with a review naming the earlier account; so does
// one still signed in to a held account, mark or not.
export const POST = route(async (request: Request) => {
  if (deviceRefused(request)) {
    throw new HttpError(403, "Simulust is only for adults, so we can't make an account on this device.", "device_refused");
  }
  const input = await readJson(request, body);

  const verdict = birthDateVerdict(input.birthDate, input.today);
  if (verdict === "invalid") throw new HttpError(400, "Enter a real date of birth.", "invalid_birth_date");
  if (verdict === "minor") {
    throw new HttpError(403, "Simulust is only for adults, so we can't make an account for you.", "under_18");
  }

  const typed = input.username.trim();
  const usernameIssue = usernameProblem(typed);
  if (usernameIssue) throw new HttpError(400, usernameIssue, "invalid_username");
  const username = typed.toLowerCase();
  const passwordIssue = passwordProblem(input.password, username);
  if (passwordIssue) throw new HttpError(400, passwordIssue, "weak_password");

  // Every attempt that gets this far is counted, so names can't be probed in
  // bulk; only the accounts actually made count toward the tighter limit.
  // IPv6 counts by its /64, so stepping through one network's addresses
  // doesn't reset any of the three limits.
  const ip = ipBucket(clientIp(request));
  await rateLimit(`signup-attempt:${ip}`, 20, 60 * 60);
  const database = await db();
  const [existing] = await database.select({ id: users.id }).from(users).where(eq(users.username, username)).limit(1);
  if (existing) throw taken();
  await rateLimit(`signup:${ip}`, 5, 60 * 60);

  // The session is read before it ends below: a browser still signed in to a
  // held account is that account's, even if its mark was cleared. The mark's
  // own account comes first when both are there.
  const session = await readSession(request);
  const heldBefore = heldAccountOf(request) ?? (session?.user.explicitHoldAt ? session.user.id : null);
  const recoveryCode = newRecoveryCode();
  const now = new Date();
  const user = await createAccount(
    {
      privyId: `acct:${username}`,
      username,
      passwordHash: await hashPassword(input.password),
      recoveryCodeHash: recoveryCodeHash(recoveryCode),
      displayName: typed,
      // Held from the start, with no age confirmation, as if they'd said it here.
      ...(heldBefore ? { explicitHoldAt: now, ageAttestedAt: null } : { ageAttestedAt: now }),
      // The record of consent to explicit content (GDPR Art. 9), given with the tick.
      settings: { explicitConsentAt: now.toISOString() },
    },
    { signupCredits: await earnsSignupCredits(ip) },
  );
  // Someone took the name between the check and the insert.
  if (!user) throw taken();
  if (heldBefore) await heldBrowserSignup(user.id, heldBefore);
  // A session this browser already had (another account, say) ends here.
  const previous = session?.tokenHash ?? sessionTokenHash(request);
  if (previous) await deleteSession(previous);

  const response = Response.json(
    { me: await toMe(user), recoveryCode },
    { status: 201, headers: { "Cache-Control": "no-store" } },
  );
  return syncHeldCookie(request, setSessionCookie(response, await createSession(user.id)), user);
});
