import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { eventTargetType, resolveTarget } from "@/app/api/admin/_lib/server";
import { currentUser } from "@/server/auth";
import { db } from "@/server/db";
import { reports } from "@/server/db/schema";
import { clientIp, HttpError, readJson, route } from "@/server/http";
import { rateLimit } from "@/server/ratelimit";
import { logModeration } from "@/server/safety/moderation";
import { checkText, declaresMinorAge } from "@/server/safety/text";

// TAKE IT DOWN Act: valid removal requests must be handled within 48 hours.
const DUE_HOURS = 48;

const email = z
  .string()
  .trim()
  .max(254)
  .refine((value) => value === "" || z.email().safeParse(value).success, "Enter a valid email, or leave it blank.");

const body = z
  .object({
    kind: z.enum(["ncii", "csam", "real_person", "copyright", "other"]),
    target: z.string().trim().min(1, "Tell us where the content is.").max(1000),
    details: z.string().trim().max(5000).default(""),
    email: email.optional(),
  })
  .refine((input) => input.kind !== "ncii" || Boolean(input.email), {
    message: "Add an email so we can confirm the removal with you.",
    path: ["email"],
  });

async function limit(ip: string) {
  try {
    await rateLimit(`report:${ip}`, 5, 15 * 60);
    await rateLimit(`report-day:${ip}`, 30, 24 * 60 * 60);
  } catch (error) {
    if (error instanceof HttpError && error.status === 429) {
      throw new HttpError(429, "You've sent several reports in a short time. Wait 15 minutes and try again.", "rate_limited");
    }
    throw error;
  }
}

// Child words (with step-, grand- and god- compounds), school years, and an age
// under 18 next to an age word or a person ("aged 14", "14 years old", "she's
// fifteen", "looks about 12"). Broad on purpose: a false hit only makes a
// takedown keep files by default.
const CHILD = new RegExp(
  [
    String.raw`\b(?:step-?|grand-?|great-?grand-?|god-?)?(?:child|children|kids?|kiddos?|kiddies|daughters?|sons?)\b`,
    String.raw`\b(?:minors?|under-?aged?|teens?|teenagers?|pre-?teens?|tweens?|nieces?|nephews?)\b`,
    String.raw`\b(?:bab(?:y|ies)|infants?|toddlers?|newborns?|(?:pre-?)?pubescent)\b`,
    String.raw`\b(?:little|young) (?:girls?|boys?|sisters?|brothers?|ones?)\b`,
    String.raw`\bschool ?(?:girl|boy|kid)s?\b`,
    String.raw`\b(?:pre-?|nursery |primary |elementary |middle |grade |junior high |high )school(?:ers?)?\b|\bjunior high\b|\bkindergarten\b`,
    String.raw`\b(?:[1-9]|1[0-2])(?:st|nd|rd|th)[- ]?grade(?:rs?)?\b|\b(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth)[- ]grade(?:rs?)?\b`,
    String.raw`\b(?:grade|year) (?:[1-9]|1[0-2])\b`,
  ].join("|"),
  "i",
);
const UNDER_18 = String.raw`(?:[1-9]|1[0-7]|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen)`;
const YOUNG_AGE = new RegExp(
  [
    String.raw`\bage[ds]?\s+${UNDER_18}\b`,
    String.raw`\b${UNDER_18}\s?-?\s?(?:yo|y\/o|y\.o|(?:yrs?|years?)\s?-?\s?old)\b`,
    // First person is declaresMinorAge's.
    String.raw`\b(?:she|he|who)(?:'s| is| was| looks?(?: like)?)\s+(?:(?:only|just|about|around|maybe|barely|like)\s+)*${UNDER_18}\b`,
  ].join("|"),
  "i",
);

// What in a report's details says a child is involved, if anything.
function pointsToMinor(details: string): string | null {
  if (!details) return null;
  const verdict = checkText(details);
  if (!verdict.ok && verdict.category === "minor") return verdict.matched;
  if (declaresMinorAge(details)) return "stated age under 18";
  const text = details.replace(/[‘’ʼ]/g, "'").replace(/\s+/g, " ");
  return text.match(CHILD)?.[0] ?? text.match(YOUNG_AGE)?.[0] ?? null;
}

// Public: anyone can report, signed in or not, including people who are not
// users at all (someone whose likeness or images were misused).
export const POST = route(async (request: Request) => {
  await limit(clientIp(request));
  const input = await readJson(request, body);
  const reporter = await currentUser(request).catch(() => null);

  // The same person sending the same report again (a double submit, or a retry
  // after a slow response) gets the open one back instead of a second row.
  const database = await db();
  const [open] = await database
    .select({ id: reports.id, dueAt: reports.dueAt })
    .from(reports)
    .where(
      and(
        eq(reports.status, "open"),
        eq(reports.kind, input.kind),
        eq(reports.target, input.target),
        input.email ? eq(reports.reporterEmail, input.email) : isNull(reports.reporterEmail),
        reporter ? eq(reports.reporterUserId, reporter.id) : isNull(reports.reporterUserId),
      ),
    )
    .limit(1);
  if (open) return Response.json({ ok: true, dueAt: open.dueAt.toISOString() });

  const dueAt = new Date(Date.now() + DUE_HOURS * 60 * 60 * 1000);
  const [report] = await database
    .insert(reports)
    .values({
      reporterUserId: reporter?.id ?? null,
      reporterEmail: input.email || null,
      kind: input.kind,
      target: input.target,
      details: input.details,
      dueAt,
    })
    .returning({ id: reports.id });

  const resolved = await resolveTarget(input.target).catch(() => null);
  const targetType = eventTargetType(resolved);
  // Escalated rather than flagged: reports are worked from the reports queue,
  // and this event is the audit trail.
  await logModeration({ userId: reporter?.id ?? null, targetType, targetId: resolved?.id ?? null }, `report_${input.kind}`, "escalated", {
    reportId: report.id,
    target: input.target.slice(0, 300),
  });
  // A report that says a child is involved, whatever it was filed as, ties its
  // target to a minor, so a takedown keeps the files unless an admin chooses
  // otherwise. Not under the reporter's id: they aren't the subject.
  const minor = input.kind === "csam" ? null : pointsToMinor(input.details);
  if (resolved && minor) {
    await logModeration({ userId: null, targetType, targetId: resolved.id }, "minor", "escalated", {
      source: "report",
      reportId: report.id,
      matched: minor,
    });
  }

  return Response.json({ ok: true, dueAt: dueAt.toISOString() });
});

