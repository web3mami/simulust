import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { lockUser } from "@/server/credits";
import { db } from "@/server/db";
import { moderationEvents, users } from "@/server/db/schema";

// With no ID check, what a user says about their own age is the strongest
// signal there is. Someone who says they're under 18 loses explicit content
// (isAgeVerified turns false) until an admin reviews the account. Their age
// confirmation is cleared too, so lifting the hold still leaves them to
// confirm their age again. Returns the account as it now stands.
export async function placeExplicitHold(userId: string) {
  const database = await db();
  const [held] = await database
    .update(users)
    .set({ explicitHoldAt: sql`coalesce(${users.explicitHoldAt}, now())`, ageAttestedAt: null })
    .where(eq(users.id, userId))
    .returning();
  return held;
}

type Where = {
  targetType: "message" | "image_prompt" | "video" | "profile";
  targetId: string | null;
  details: Record<string, unknown>;
};

// One open review per account and category, with repeats counted on it, so one
// account can't bury the rest of the queue.
async function escalateOnce(userId: string, category: string, where: Where) {
  const database = await db();
  await database.transaction(async (tx) => {
    await lockUser(tx, userId);
    const [open] = await tx
      .select({ id: moderationEvents.id, details: moderationEvents.details })
      .from(moderationEvents)
      .where(
        and(
          eq(moderationEvents.userId, userId),
          eq(moderationEvents.category, category),
          eq(moderationEvents.action, "escalated"),
          isNull(moderationEvents.reviewedAt),
        ),
      )
      .limit(1);
    if (open) {
      const repeats = Number(open.details?.repeats ?? 0) + 1;
      await tx
        .update(moderationEvents)
        .set({ details: { ...open.details, repeats, lastAt: new Date().toISOString() } })
        .where(eq(moderationEvents.id, open.id));
      return;
    }
    await tx.insert(moderationEvents).values({
      userId,
      targetType: where.targetType,
      targetId: where.targetId,
      category,
      action: "escalated",
      details: where.details,
    });
  });
}

// Someone said they're under 18 (in chat, a photo request or a studio prompt):
// explicit content goes off at once, and a person reviews the account. Never
// throws: the caller refuses either way.
export async function selfDeclaredMinor(
  userId: string,
  where: { targetType: "message" | "image_prompt" | "video"; targetId: string | null; excerpt: string },
) {
  try {
    await placeExplicitHold(userId);
  } catch (error) {
    console.error("Failed to place an explicit hold on a self-declared minor", error);
  }
  try {
    await escalateOnce(userId, "self_declared_minor", {
      targetType: where.targetType,
      targetId: where.targetId,
      details: { excerpt: where.excerpt.slice(0, 280) },
    });
  } catch (error) {
    console.error("Failed to escalate a self-declared minor", error);
  }
}

const UNDER_18_DATE_NOTE = {
  age_attest: "Gave a date of birth under 18 when confirming their age.",
  device_gate: "Gave the age gate a date of birth under 18 on this account's device.",
};

// A signed-in account gave a date of birth under 18 (confirming their age, or
// at the age gate in front of the site, before or after signing in). The same
// hold as above, logged as "attested_minor" without the date: only that it was
// under 18. Returns the account as it now stands.
export async function underageBirthDate(userId: string, source: keyof typeof UNDER_18_DATE_NOTE) {
  const held = await placeExplicitHold(userId);
  await escalateOnce(userId, "attested_minor", {
    targetType: "profile",
    targetId: userId,
    details: {
      source,
      note: `${UNDER_18_DATE_NOTE[source]} Explicit content is on hold until an admin reviews the account.`,
    },
  });
  return held;
}

// A new account signed up from a browser that remembers an earlier held
// account (the "simulust-held" cookie): the same person, as far as we can
// tell, starting over to get around the hold. Sign-up makes the account
// already held; this logs the review, naming the earlier account so an admin
// can look at both. Never throws: the account is held either way.
export async function heldBrowserSignup(userId: string, earlierAccountId: string) {
  try {
    await escalateOnce(userId, "self_declared_minor", {
      targetType: "profile",
      targetId: userId,
      details: {
        source: "held_browser",
        earlierAccountId,
        note: "Signed up from a browser an account on an explicit hold used. Explicit content is on hold until an admin reviews both accounts.",
      },
    });
  } catch (error) {
    console.error("Failed to escalate a sign-up from a held browser", error);
  }
}

export async function clearExplicitHold(userId: string) {
  const database = await db();
  const [row] = await database
    .update(users)
    .set({ explicitHoldAt: null })
    .where(eq(users.id, userId))
    .returning({ id: users.id });
  return Boolean(row);
}

const DAY_MS = 24 * 60 * 60 * 1000;

// A "YYYY-MM-DD" calendar date as midnight UTC, or null when it isn't a real one.
function calendarDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  const real = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return real ? { year, month, day, time: date.getTime() } : null;
}

const HOUR_MS = 60 * 60 * 1000;

// The UTC calendar date of a moment, as midnight UTC.
function dateOf(time: number) {
  return Math.floor(time / DAY_MS) * DAY_MS;
}

// Today where the user is: the browser's local date when it's a date some
// time zone is actually on right now (from UTC-12, where it's the date at
// now - 12h, to UTC+14, the date at now + 14h), else the server's UTC date.
// Without it, someone east of UTC on their 18th birthday would be refused
// until UTC midnight caught up; anything wider would let a browser claim a
// birthday no one has reached yet.
function localToday(today: string | undefined, now: Date) {
  const utc = dateOf(now.getTime());
  const given = today ? calendarDate(today) : null;
  if (!given) return utc;
  const westmost = dateOf(now.getTime() - 12 * HOUR_MS);
  const eastmost = dateOf(now.getTime() + 14 * HOUR_MS);
  return given.time >= westmost && given.time <= eastmost ? given.time : utc;
}

// The age gate's date of birth, judged on the user's own today: "invalid" for
// a typo (not a real date, before 1900 or in the future), which says nothing
// about age; "minor" under 18; "adult" from the 18th birthday on (a 29 February
// birthday turns 18 on 1 March). Only the outcome is ever stored, never the date.
export function birthDateVerdict(birthDate: string, today?: string, now = new Date()): "adult" | "minor" | "invalid" {
  const born = calendarDate(birthDate);
  const on = localToday(today, now);
  if (!born || born.year < 1900 || born.time > on) return "invalid";
  return Date.UTC(born.year + 18, born.month - 1, born.day) <= on ? "adult" : "minor";
}

export function isAdultBirthDate(birthDate: string, today?: string, now = new Date()) {
  return birthDateVerdict(birthDate, today, now) === "adult";
}
