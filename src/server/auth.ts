import "server-only";
import { createHash } from "node:crypto";
import { createRemoteJWKSet, importSPKI, jwtVerify, type JWTVerifyGetKey, type CryptoKey } from "jose";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/server/db";
import { creditBalances, creditLedger, deletedIdentities, moderationEvents, users, type User } from "@/server/db/schema";
import { env, features } from "@/server/env";
import { forbidden, HttpError, unauthorized } from "@/server/http";
import { FREE } from "@/lib/pricing";

export const DEV_USER_COOKIE = "simulust-dev-user";
const PRIVY_COOKIE = "privy-token";

let privyKey: Promise<CryptoKey | JWTVerifyGetKey> | undefined;

function verificationKey() {
  privyKey ??= env.privyVerificationKey
    ? importSPKI(env.privyVerificationKey.replace(/\\n/g, "\n"), "ES256")
    : Promise.resolve(
        createRemoteJWKSet(new URL(`https://auth.privy.io/api/v1/apps/${env.privyAppId}/jwks.json`)),
      );
  return privyKey;
}

function cookie(request: Request, name: string) {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

// Who is calling: a verified Privy user id (did:privy:...), or in local
// development without Privy, a dev handle from a cookie or header.
async function identify(request: Request): Promise<string | null> {
  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  const token = bearer ?? cookie(request, PRIVY_COOKIE);

  if (token && features.privy) {
    try {
      const key = await verificationKey();
      const { payload } = await jwtVerify(token, key as CryptoKey, {
        issuer: "privy.io",
        audience: env.privyAppId,
        algorithms: ["ES256"],
      });
      return typeof payload.sub === "string" ? payload.sub : null;
    } catch {
      return null;
    }
  }

  if (env.allowDevAuth) {
    const handle = request.headers.get("x-dev-user") ?? cookie(request, DEV_USER_COOKIE);
    if (handle && /^[a-z0-9_-]{1,32}$/i.test(handle)) return `dev:${handle.toLowerCase()}`;
  }
  return null;
}

export function identityHash(privyId: string) {
  return createHash("sha256").update(privyId).digest("hex");
}

async function loadOrCreate(privyId: string): Promise<User> {
  const database = await db();
  const isAdmin = env.adminPrivyIds.includes(privyId) || (env.allowDevAuth && privyId === "dev:admin");

  const [existing] = await database.select().from(users).where(eq(users.privyId, privyId)).limit(1);
  if (existing) {
    const stale = Date.now() - existing.lastSeenAt.getTime() > 5 * 60_000;
    if (stale || existing.isAdmin !== isAdmin) {
      const [updated] = await database
        .update(users)
        .set({ lastSeenAt: new Date(), isAdmin })
        .where(eq(users.id, existing.id))
        .returning();
      return updated ?? existing;
    }
    return existing;
  }

  return database.transaction(async (tx) => {
    const [created] = await tx
      .insert(users)
      .values({ privyId, isAdmin })
      .onConflictDoNothing({ target: users.privyId })
      .returning();
    if (!created) {
      const [raced] = await tx.select().from(users).where(eq(users.privyId, privyId)).limit(1);
      if (!raced) throw new Error("User insert raced and vanished.");
      return raced;
    }
    const [returning] = await tx
      .select({ hash: deletedIdentities.privyIdHash })
      .from(deletedIdentities)
      .where(eq(deletedIdentities.privyIdHash, identityHash(privyId)))
      .limit(1);
    const bonus = returning ? 0 : FREE.signupCredits;
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

export async function currentUser(request: Request): Promise<User | null> {
  const privyId = await identify(request);
  if (!privyId) return null;
  const user = await loadOrCreate(privyId);
  if (user.bannedAt) throw await suspension(user);
  return user;
}

export async function requireUser(request: Request): Promise<User> {
  const user = await currentUser(request);
  if (!user) throw unauthorized();
  return user;
}

export function isAgeVerified(user: User) {
  return user.ageStatus === "approved" && user.ageVerifiedAt !== null;
}

// Anything explicit (explicit chat mode, photos, voice notes, video) needs a
// completed age check. Text chat without explicit content does not.
export function requireVerifiedAdult(user: User) {
  if (!isAgeVerified(user)) {
    throw new HttpError(403, "Verify your age to unlock this.", "age_verification_required");
  }
}

export function explicitAllowed(user: User) {
  return isAgeVerified(user) && user.settings.explicit === true;
}

export function requireAdmin(user: User) {
  if (!user.isAdmin) throw forbidden();
}

export function isMember(user: User, now = new Date()) {
  return user.memberUntil !== null && user.memberUntil > now;
}
