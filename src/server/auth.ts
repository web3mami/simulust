import "server-only";
import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/server/db";
import { creditBalances, creditLedger, deletedIdentities, moderationEvents, users, type User } from "@/server/db/schema";
import { env } from "@/server/env";
import { forbidden, HttpError, unauthorized } from "@/server/http";
import { readCookie, readSession } from "@/server/sessions";
import { FREE } from "@/lib/pricing";

export const DEV_USER_COOKIE = "simulust-dev-user";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Whether the browser's cookies may sign this request in. A request that
// changes something and names another site as its Origin is a forged one
// (CSRF), so it runs signed out. The proxy refuses these too; this holds even
// where the proxy doesn't run. No Origin (same-origin GETs, server-to-server,
// older browsers) is left to SameSite=Lax.
function cookiesCount(request: Request) {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return true;
  const origin = request.headers.get("origin");
  if (origin === null) return true;
  let from: string;
  try {
    from = new URL(origin).host;
  } catch {
    return false;
  }
  const own = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? new URL(request.url).host)
    .split(",")[0]
    .trim();
  return from === own || from === new URL(env.appUrl).host;
}

type Caller = { user: User } | { identity: string };

// Who is calling: the account behind the session cookie, or in local
// development, a dev handle from the x-dev-user header or the dev cookie.
async function identify(request: Request): Promise<Caller | null> {
  const trusted = cookiesCount(request);
  if (trusted) {
    const session = await readSession(request);
    if (session) return { user: session.user };
  }
  if (env.allowDevAuth) {
    const handle = request.headers.get("x-dev-user") ?? (trusted ? readCookie(request, DEV_USER_COOKIE) : undefined);
    if (handle && /^[a-z0-9_-]{1,32}$/i.test(handle)) return { identity: `dev:${handle.toLowerCase()}` };
  }
  return null;
}

export function identityHash(privyId: string) {
  return createHash("sha256").update(privyId).digest("hex");
}

// Admins are named by account id (ADMIN_USER_IDS), never by username, so nobody
// can sign up into it. "dev:admin" is an admin in local development.
function adminFor(user: Pick<User, "id" | "privyId">) {
  return env.adminUserIds.includes(user.id) || (env.allowDevAuth && user.privyId === "dev:admin");
}

// Keeps lastSeenAt roughly current, and admin rights in step with the env.
// Logins pass force, to record the sign-in itself.
export async function touch(user: User, { force = false } = {}): Promise<User> {
  const isAdmin = adminFor(user);
  const stale = Date.now() - user.lastSeenAt.getTime() > 5 * 60_000;
  if (!force && !stale && user.isAdmin === isAdmin) return user;
  const database = await db();
  const [updated] = await database
    .update(users)
    .set({ lastSeenAt: new Date(), isAdmin })
    .where(eq(users.id, user.id))
    .returning();
  return updated ?? user;
}

type NewAccount = Omit<typeof users.$inferInsert, "id" | "isAdmin" | "createdAt" | "lastSeenAt">;

// A new account with its credit balance and the signup credits, unless the
// caller says it hasn't earned them (sign-up caps them per address) or this
// login was deleted before (deletedIdentities). Usernames skip that last rule:
// a freed username can go to anyone, so it says nothing about who's back, and
// the per-address cap is what stops farming there. null when the login id or
// the username is already taken; nothing is created then.
export async function createAccount(
  values: NewAccount,
  { signupCredits = true }: { signupCredits?: boolean } = {},
): Promise<User | null> {
  const database = await db();
  return database.transaction(async (tx) => {
    const [created] = await tx
      .insert(users)
      .values({ ...values, isAdmin: env.allowDevAuth && values.privyId === "dev:admin" })
      .onConflictDoNothing()
      .returning();
    if (!created) return null;
    const [returning] = values.privyId.startsWith("acct:")
      ? []
      : await tx
          .select({ hash: deletedIdentities.privyIdHash })
          .from(deletedIdentities)
          .where(eq(deletedIdentities.privyIdHash, identityHash(values.privyId)))
          .limit(1);
    const bonus = signupCredits && !returning ? FREE.signupCredits : 0;
    await tx.insert(creditBalances).values({ userId: created.id, balance: bonus });
    if (bonus) {
      await tx.insert(creditLedger).values({
        userId: created.id,
        delta: bonus,
        balanceAfter: bonus,
        reason: "signup",
        refType: "user",
        refId: created.id,
      });
    }
    return created;
  });
}

// Development identities are made on first sight. Username accounts are made
// only by sign-up (POST /api/auth/signup).
async function loadOrCreate(privyId: string): Promise<User> {
  const database = await db();
  const [existing] = await database.select().from(users).where(eq(users.privyId, privyId)).limit(1);
  if (existing) return touch(existing);
  const created = await createAccount({ privyId });
  if (created) return created;
  const [raced] = await database.select().from(users).where(eq(users.privyId, privyId)).limit(1);
  if (!raced) throw new Error("User insert raced and vanished.");
  return raced;
}

// An age check that shows a minor (an under-18 birth date, or Veriff's own
// under-18 decline) bans the account and logs this escalated finding
// (lockForAgeReview in veriff.ts). While it's open no age check counts; lifting
// the ban is the admin's review that closes it, never the safety queue.
export const UNDERAGE_FINDING = "age_check_underage";

// Banned accounts get a 403 on everything. An open underage finding gets its
// own code, so the app can say it's an age review, not a policy ban.
async function suspension(user: User) {
  const database = await db();
  const [finding] = await database
    .select({ id: moderationEvents.id })
    .from(moderationEvents)
    .where(
      and(
        eq(moderationEvents.action, "escalated"),
        isNull(moderationEvents.reviewedAt),
        eq(moderationEvents.userId, user.id),
        eq(moderationEvents.category, UNDERAGE_FINDING),
      ),
    )
    .limit(1);
  return finding
    ? new HttpError(403, "This account is locked while we review an age check.", "age_locked")
    : forbidden("This account has been suspended.");
}

// Throws the 403 a banned account gets everywhere. Login and recovery call it
// once the password or code is right, so it says nothing to anyone else.
export async function assertNotSuspended(user: User) {
  if (user.bannedAt) throw await suspension(user);
}

export async function currentUser(request: Request): Promise<User | null> {
  const caller = await identify(request);
  if (!caller) return null;
  const user = "user" in caller ? await touch(caller.user) : await loadOrCreate(caller.identity);
  await assertNotSuspended(user);
  return user;
}

export async function requireUser(request: Request): Promise<User> {
  const user = await currentUser(request);
  if (!user) throw unauthorized();
  return user;
}

// Whether this account counts as an adult for explicit content. With the
// default age gate, a date of birth of 18 or over given to the app is enough;
// with AGE_VERIFICATION=id only a completed ID check is. Either way an
// explicit hold (the user said they're under 18) switches it off until review.
export function isAgeVerified(user: User) {
  if (user.explicitHoldAt) return false;
  const idChecked = user.ageStatus === "approved" && user.ageVerifiedAt !== null;
  return env.ageVerification === "id" ? idChecked : idChecked || user.ageAttestedAt !== null;
}

// Anything explicit (chat, photos, voice notes, video) needs the age check
// above. A held account gets its own code: confirming an age can't unlock it,
// only the review can, so the app never offers to.
export function requireVerifiedAdult(user: User) {
  if (user.explicitHoldAt) {
    throw new HttpError(403, "Paused while we review this account.", "explicit_hold");
  }
  if (!isAgeVerified(user)) {
    throw new HttpError(403, "Verify your age to unlock this.", "age_verification_required");
  }
}

// The whole site is uncensored: there's no explicit switch. Every adult who
// confirmed their age (at sign-up) gets explicit content, unless an explicit
// hold is open. Kept as its own name so call sites say what they check.
export function explicitAllowed(user: User) {
  return isAgeVerified(user);
}

export function requireAdmin(user: User) {
  if (!user.isAdmin) throw forbidden();
}

export function isMember(user: User, now = new Date()) {
  return user.memberUntil !== null && user.memberUntil > now;
}
