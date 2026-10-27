import { and, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import { UNDERAGE_FINDING } from "@/server/auth";
import { db } from "@/server/db";
import { moderationEvents, users } from "@/server/db/schema";
import { readJson, route } from "@/server/http";
import { requireAdminUser } from "../_lib/server";
import type { AdminModerationEventDTO, AdminReviewResult } from "../_lib/types";

// Events that need a person to look at them, unreviewed, in this order: age
// checks that read an under-18 birth date, people saying they're under 18, then
// blocks and flags. Report events are escalated too, but they're worked from
// the reports queue. Each group is capped on its own, so a flood of one kind
// (someone repeating "I'm 16") can't push another out of view.
const GROUPS = [
  and(eq(moderationEvents.action, "escalated"), eq(moderationEvents.category, UNDERAGE_FINDING)),
  and(eq(moderationEvents.action, "escalated"), eq(moderationEvents.category, "self_declared_minor")),
  inArray(moderationEvents.action, ["blocked", "flagged"]),
];
const PER_GROUP = 100;

export const GET = route(async (request: Request) => {
  await requireAdminUser(request);
  const database = await db();
  const groups = await Promise.all(
    GROUPS.map((group) =>
      database
        .select({ event: moderationEvents, userName: users.displayName })
        .from(moderationEvents)
        .leftJoin(users, eq(moderationEvents.userId, users.id))
        .where(and(group, isNull(moderationEvents.reviewedAt)))
        .orderBy(desc(moderationEvents.createdAt))
        .limit(PER_GROUP),
    ),
  );
  const events: AdminModerationEventDTO[] = groups.flat().map(({ event, userName }) => ({
    id: event.id,
    userId: event.userId,
    userName,
    targetType: event.targetType,
    targetId: event.targetId,
    category: event.category,
    action: event.action,
    details: event.details ?? null,
    reviewedAt: event.reviewedAt?.toISOString() ?? null,
    createdAt: event.createdAt.toISOString(),
  }));
  return Response.json({ events });
});

const reviewed = z.object({ ids: z.array(z.number().int().positive()).min(1).max(200) });

export const PATCH = route(async (request: Request) => {
  await requireAdminUser(request);
  const { ids } = await readJson(request, reviewed);
  const database = await db();
  // An age-check finding is closed by unbanning the user, which also resets
  // their age status. Reviewing it here would leave the account banned with
  // the age lock turned into an ordinary suspension.
  const rows = await database
    .update(moderationEvents)
    .set({ reviewedAt: new Date() })
    .where(and(inArray(moderationEvents.id, ids), isNull(moderationEvents.reviewedAt), ne(moderationEvents.category, UNDERAGE_FINDING)))
    .returning({ id: moderationEvents.id });
  const locks = await database
    .select({ id: moderationEvents.id })
    .from(moderationEvents)
    .where(and(inArray(moderationEvents.id, ids), eq(moderationEvents.category, UNDERAGE_FINDING)));
  const result: AdminReviewResult = {
    ok: true,
    reviewed: rows.length,
    skipped: locks.map((lock) => lock.id),
    ...(locks.length ? { note: "Age-check locks weren't marked reviewed. Unban the user in the Users tab to close one." } : {}),
  };
  return Response.json(result);
});
