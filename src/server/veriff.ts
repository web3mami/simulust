import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { and, desc, eq, gt, isNull, ne, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { UNDERAGE_FINDING } from "@/server/auth";
import { lockUser } from "@/server/credits";
import { db, type Tx } from "@/server/db";
import { ageChecks, moderationEvents, users, type User } from "@/server/db/schema";
import { env, features } from "@/server/env";
import { HttpError } from "@/server/http";
import { logModeration } from "@/server/safety/moderation";
import type { AgeStatus } from "@/lib/api-types";

// Veriff hosted age verification (document + liveness). We keep only the
// outcome: no document images, names or dates of birth are ever stored.
// API: https://devdocs.veriff.com/apidocs/v1sessions
// Webhooks: https://devdocs.veriff.com/docs/decision-webhook

type CheckStatus = (typeof ageChecks.$inferSelect)["status"];

// Once a session reaches one of these, later webhooks for it are ignored.
// Veriff delivers at least once and possibly out of order.
const FINAL: CheckStatus[] = ["approved", "declined", "expired"];

const sessionResponse = z.object({
  status: z.literal("success"),
  verification: z.object({ id: z.string().min(1), url: z.url() }),
});

export async function createSession(user: User): Promise<{ url: string; sessionId: string }> {
  if (!features.veriff) {
    throw new HttpError(503, "Age verification isn't available right now. Try again later.", "age_unavailable");
  }
  const response = await fetch(`${env.veriffBaseUrl.replace(/\/$/, "")}/v1/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-AUTH-CLIENT": env.veriffApiKey! },
    body: JSON.stringify({
      verification: {
        callback: `${env.appUrl.replace(/\/$/, "")}/verify?from=veriff`,
        vendorData: user.id,
        endUserId: user.id,
      },
    }),
    signal: AbortSignal.timeout(15_000),
  }).catch((error) => {
    console.error("Veriff session request failed", error);
    return null;
  });
  if (!response?.ok) {
    if (response) console.error("Veriff session error", response.status, (await response.text().catch(() => "")).slice(0, 500));
    throw new HttpError(502, "We couldn't start age verification. Try again in a minute.", "age_provider_error");
  }
  const parsed = sessionResponse.safeParse(await response.json().catch(() => null));
  if (!parsed.success) {
    console.error("Unexpected Veriff session response", parsed.error.issues[0]);
    throw new HttpError(502, "We couldn't start age verification. Try again in a minute.", "age_provider_error");
  }

  const { id, url } = parsed.data.verification;
  const database = await db();
  await database.transaction(async (tx) => {
    await tx.insert(ageChecks).values({ userId: user.id, provider: "veriff", sessionId: id, status: "created" });
    await tx
      .update(users)
      .set({ ageStatus: "pending" })
      .where(and(eq(users.id, user.id), ne(users.ageStatus, "approved")));
  });
  return { url, sessionId: id };
}

// Veriff signs the raw request body with the integration's shared secret:
// X-HMAC-SIGNATURE = hex(HMAC-SHA256(secret, rawBody)). Compare against the
// exact bytes received, never re-serialized JSON.
export function verifySignature(rawBody: string, headers: Headers, secret = env.veriffSharedSecret): boolean {
  if (!secret) return false;
  const given = headers.get("x-hmac-signature")?.trim().toLowerCase();
  if (!given || !/^[0-9a-f]{64}$/.test(given)) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  return timingSafeEqual(Buffer.from(given, "hex"), expected);
}

const decisionPayload = z.object({
  verification: z
    .object({
      id: z.string().min(1),
      status: z.string(),
      vendorData: z.string().nullish(),
      decisionTime: z.string().nullish(),
      // Read loosely: an odd value here mustn't make the whole decision unreadable.
      reasonCode: z.unknown().optional(),
      person: z.object({ dateOfBirth: z.string().nullish() }).nullish(),
    })
    .nullable(),
});

// Veriff's age-validation rule declines with one of these: the person is under
// 13, 14, 16 or 18. The codes for higher limits (534-536: under 20, 21 or 25)
// don't say the person is a minor.
// https://devdocs.veriff.com/v1/docs/granular-reason-codes
const UNDER_18_REASONS = [530, 531, 532, 533];

// Progress events (started, submitted) carry no decision.
const eventPayload = z.object({
  id: z.string().min(1),
  action: z.string(),
  vendorData: z.string().nullish(),
});

function mapStatus(status: string): CheckStatus | null {
  switch (status) {
    case "approved":
      return "approved";
    case "declined":
      return "declined";
    case "resubmission_requested":
      return "resubmission";
    case "expired":
    case "abandoned":
      return "expired";
    case "review":
    case "submitted":
      return "submitted";
    default:
      return null;
  }
}

// Age in whole years on a given date, from a YYYY-MM-DD birth date. Null when
// the date can't be read.
export function ageOn(dateOfBirth: string, on: Date): number | null {
  const match = dateOfBirth.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  let age = on.getUTCFullYear() - year;
  const beforeBirthday = on.getUTCMonth() + 1 < month || (on.getUTCMonth() + 1 === month && on.getUTCDate() < day);
  if (beforeBirthday) age -= 1;
  return age >= 0 && age < 150 ? age : null;
}

export type DecisionResult = {
  applied: boolean;
  status?: CheckStatus;
  reason?: "unknown_status" | "unknown_session" | "user_mismatch" | "already_final" | "ignored";
};

// What a decision showed when it didn't show an adult: a minor, or an approval
// without a birth date to check.
type Finding = "underage" | "unproven";

export async function handleDecision(payload: unknown): Promise<DecisionResult> {
  const decision = decisionPayload.safeParse(payload);
  if (decision.success && decision.data.verification) {
    const verification = decision.data.verification;
    let next = mapStatus(verification.status);
    if (!next) return { applied: false, reason: "unknown_status" };

    // Any decision can show a minor: Veriff's own age rule declines an under-18
    // document and still sends its birth date. Whatever the status, that locks
    // the account. An approval means the document and the face are genuine, not
    // that the person is 18: only a birth date we can read proves that.
    const dateOfBirth = verification.person?.dateOfBirth;
    const decided = verification.decisionTime ? new Date(verification.decisionTime) : new Date();
    const age = dateOfBirth ? ageOn(dateOfBirth, Number.isNaN(decided.getTime()) ? new Date() : decided) : null;
    const reasonCode = Number(verification.reasonCode);
    let finding: Finding | null = null;
    if ((age !== null && age < 18) || UNDER_18_REASONS.includes(reasonCode)) finding = "underage";
    else if (next === "approved" && age === null) finding = "unproven";
    if (finding) next = "declined";
    return applyStatus(verification.id, next, verification.vendorData ?? null, finding, {
      decision: verification.status,
      reasonCode: Number.isFinite(reasonCode) && reasonCode > 0 ? reasonCode : null,
    });
  }

  const event = eventPayload.safeParse(payload);
  if (event.success && event.data.action === "submitted") {
    return applyStatus(event.data.id, "submitted", event.data.vendorData ?? null, null);
  }
  return { applied: false, reason: "ignored" };
}

async function applyStatus(
  sessionId: string,
  next: CheckStatus,
  vendorData: string | null,
  finding: Finding | null,
  evidence: Record<string, unknown> = {},
): Promise<DecisionResult> {
  const database = await db();
  const [check] = await database
    .select()
    .from(ageChecks)
    .where(and(eq(ageChecks.sessionId, sessionId), eq(ageChecks.provider, "veriff")))
    .limit(1);
  if (!check) return { applied: false, reason: "unknown_session" };
  if (vendorData && vendorData !== check.userId) {
    console.warn("Veriff webhook vendorData does not match the session owner", { sessionId });
    return { applied: false, reason: "user_mismatch" };
  }
  // A minor still counts after the session is final: decisions can arrive out
  // of order, and the one showing the minor may be the late one.
  if (FINAL.includes(check.status) && finding !== "underage") {
    return { applied: false, status: check.status, reason: "already_final" };
  }

  const status = await database.transaction(async (tx) => {
    // Decisions for two sessions of the same user apply one at a time, so an
    // approval can't read the user's findings just before an underage one lands.
    await lockUser(tx, check.userId);
    // Conditional on the session not being final yet, so two deliveries of the
    // same decision racing each other only apply once.
    const [row] = await tx
      .update(ageChecks)
      .set({ status: next, decidedAt: FINAL.includes(next) ? new Date() : null })
      .where(and(eq(ageChecks.id, check.id), notInArray(ageChecks.status, FINAL)))
      .returning({ id: ageChecks.id });
    // A final session keeps its status, and locks the account once at most.
    if (!row && (finding !== "underage" || (await lockedBy(tx, check.userId, sessionId)))) return null;
    // A minor's account is locked, not just left unverified. The lock is
    // written with the decision, so it can't be lost to a failed log.
    if (finding === "underage") {
      await lockForAgeReview(tx, check.userId, {
        sessionId,
        ...evidence,
        note: "Veriff's decision showed a birth date under 18, or Veriff declined the person as under 18. The account is locked until an admin reviews it.",
      });
    } else {
      await syncUser(tx, check.userId);
    }
    return row ? next : check.status;
  });
  if (!status) return { applied: false, reason: "already_final" };

  if (finding === "unproven") {
    // A run of these means the integration isn't sending birth dates in
    // decisions (see SETUP.md), which declines everyone.
    await logModeration({ userId: check.userId, targetType: "profile", targetId: check.userId }, "age_check_no_dob", "flagged", {
      sessionId,
      note: "Veriff approved the session without a readable birth date, so adulthood isn't proven. Declined automatically.",
    });
  }
  return { applied: true, status };
}

// Whether this session has already locked the user, so a redelivered decision
// doesn't open a second finding, or reopen one an admin has closed.
async function lockedBy(tx: Tx, userId: string, sessionId: string) {
  const [found] = await tx
    .select({ id: moderationEvents.id })
    .from(moderationEvents)
    .where(
      and(
        eq(moderationEvents.userId, userId),
        eq(moderationEvents.category, UNDERAGE_FINDING),
        sql`${moderationEvents.details}->>'sessionId' = ${sessionId}`,
      ),
    )
    .limit(1);
  return Boolean(found);
}

// The user's age status follows their checks: one approval is enough, and
// otherwise the most recent session decides. An open underage finding beats
// every check, approvals included. Once an admin has reviewed it, only checks
// started after the review count, so the user has to verify again.
async function syncUser(tx: Tx, userId: string) {
  const findings = await tx
    .select({ reviewedAt: moderationEvents.reviewedAt })
    .from(moderationEvents)
    .where(
      and(
        eq(moderationEvents.action, "escalated"),
        eq(moderationEvents.userId, userId),
        eq(moderationEvents.category, UNDERAGE_FINDING),
      ),
    );
  const open = findings.some((finding) => finding.reviewedAt === null);
  const reviewed = findings.flatMap((finding) => (finding.reviewedAt ? [finding.reviewedAt.getTime()] : []));
  const since = reviewed.length ? new Date(Math.max(...reviewed)) : null;

  const checks = open
    ? []
    : await tx
        .select({ status: ageChecks.status })
        .from(ageChecks)
        .where(and(eq(ageChecks.userId, userId), since ? gt(ageChecks.createdAt, since) : undefined))
        .orderBy(desc(ageChecks.createdAt));
  let status: AgeStatus = open ? "declined" : "none";
  if (checks.some((check) => check.status === "approved")) status = "approved";
  else if (checks[0]?.status === "declined") status = "declined";
  else if (checks[0] && checks[0].status !== "expired") status = "pending";

  await tx
    .update(users)
    .set({
      ageStatus: status,
      ageVerifiedAt: status === "approved" ? sql`coalesce(${users.ageVerifiedAt}, now())` : null,
    })
    .where(eq(users.id, userId));
}

// Locks an account that belongs to a minor: bans it and opens an underage
// finding, which keeps any age check from counting until an admin reviews it.
export async function lockForAgeReview(tx: Tx, userId: string, details: Record<string, unknown>) {
  await lockUser(tx, userId);
  await tx.insert(moderationEvents).values({
    userId,
    targetType: "profile",
    targetId: userId,
    category: UNDERAGE_FINDING,
    action: "escalated",
    details,
  });
  await tx
    .update(users)
    .set({ bannedAt: sql`coalesce(${users.bannedAt}, now())` })
    .where(eq(users.id, userId));
  await syncUser(tx, userId);
}

// Lifting a ban is how an admin closes an underage finding after reviewing
// it. The user's status is then worked out from checks started after the
// review, of which there are none yet, so they have to verify again. Returns
// whether a finding was open.
export async function clearAgeLock(tx: Tx, userId: string): Promise<boolean> {
  await lockUser(tx, userId);
  const cleared = await tx
    .update(moderationEvents)
    .set({ reviewedAt: sql`now()` })
    .where(
      and(
        eq(moderationEvents.action, "escalated"),
        isNull(moderationEvents.reviewedAt),
        eq(moderationEvents.userId, userId),
        eq(moderationEvents.category, UNDERAGE_FINDING),
      ),
    )
    .returning({ id: moderationEvents.id });
  if (!cleared.length) return false;
  await syncUser(tx, userId);
  return true;
}

// Local development only: record an outcome without calling Veriff.
export async function recordDevCheck(user: User, outcome: "approved" | "declined"): Promise<User> {
  if (!env.allowDevAgeCheck) throw new HttpError(404, "Not found.", "not_found");
  const database = await db();
  return database.transaction(async (tx) => {
    await tx.insert(ageChecks).values({
      userId: user.id,
      provider: "dev",
      sessionId: `dev-${crypto.randomUUID()}`,
      status: outcome,
      decidedAt: new Date(),
    });
    const [updated] = await tx
      .update(users)
      .set(
        outcome === "approved"
          ? { ageStatus: "approved", ageVerifiedAt: new Date() }
          : { ageStatus: "declined", ageVerifiedAt: null },
      )
      .where(eq(users.id, user.id))
      .returning();
    return updated ?? user;
  });
}
