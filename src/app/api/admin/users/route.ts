import { and, desc, eq, ilike, inArray, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { UNDERAGE_FINDING } from "@/server/auth";
import { clearExplicitHold } from "@/server/age";
import { db } from "@/server/db";
import { creditBalances, moderationEvents, users } from "@/server/db/schema";
import { HttpError, notFound, readJson, route } from "@/server/http";
import { clearAgeLock } from "@/server/veriff";
import { recordAdminAction, requireAdminUser } from "../_lib/server";
import type { AdminUserDTO } from "../_lib/types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// What puts an account on an explicit hold: saying they're under 18 in chat,
// or giving an under-18 date of birth when confirming their age. Clearing the
// hold is the review of these.
const HOLD_FINDINGS = ["self_declared_minor", "attested_minor"];

function escapeLike(text: string) {
  return text.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

const columns = {
  id: users.id,
  username: users.username,
  displayName: users.displayName,
  privyId: users.privyId,
  isAdmin: users.isAdmin,
  ageStatus: users.ageStatus,
  bannedAt: users.bannedAt,
  // The same open finding that makes auth answer age_locked.
  ageLocked: sql<boolean>`exists (
    select 1 from ${moderationEvents}
    where ${moderationEvents.userId} = ${users.id}
      and ${moderationEvents.category} = ${UNDERAGE_FINDING}
      and ${moderationEvents.action} = 'escalated'
      and ${moderationEvents.reviewedAt} is null
  )`,
  ageAttestedAt: users.ageAttestedAt,
  explicitHoldAt: users.explicitHoldAt,
  createdAt: users.createdAt,
  lastSeenAt: users.lastSeenAt,
  balance: creditBalances.balance,
};

async function selectUsers(where?: SQL, { holdsFirst = false } = {}) {
  const database = await db();
  return database
    .select(columns)
    .from(users)
    .leftJoin(creditBalances, eq(creditBalances.userId, users.id))
    .where(where)
    .orderBy(holdsFirst ? desc(users.explicitHoldAt) : desc(users.createdAt))
    .limit(50);
}

function toDTO(row: Awaited<ReturnType<typeof selectUsers>>[number]): AdminUserDTO {
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    privyId: row.privyId,
    isAdmin: row.isAdmin,
    ageStatus: row.ageStatus,
    bannedAt: row.bannedAt?.toISOString() ?? null,
    ageLocked: Boolean(row.bannedAt && row.ageLocked),
    ageAttestedAt: row.ageAttestedAt?.toISOString() ?? null,
    explicitHoldAt: row.explicitHoldAt?.toISOString() ?? null,
    balance: row.balance ?? 0,
    createdAt: row.createdAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
  };
}

// ?q= matches a user id exactly, or part of a username, login id or display name.
// ?hold=1 lists accounts on an explicit hold, the newest hold first.
// Without either, the newest accounts.
export const GET = route(async (request: Request) => {
  await requireAdminUser(request);
  const params = new URL(request.url).searchParams;
  const q = (params.get("q") ?? "").trim().slice(0, 100);
  const held = params.get("hold") === "1";
  const search = !q
    ? undefined
    : UUID.test(q)
      ? eq(users.id, q.toLowerCase())
      : or(
          ilike(users.username, `%${escapeLike(q)}%`),
          ilike(users.privyId, `%${escapeLike(q)}%`),
          ilike(users.displayName, `%${escapeLike(q)}%`),
        );
  const rows = await selectUsers(and(search, held ? isNotNull(users.explicitHoldAt) : undefined), { holdsFirst: held });
  return Response.json({ users: rows.map(toDTO) });
});

const ban = z.object({
  id: z.uuid(),
  banned: z.boolean(),
  reason: z.string().trim().max(500).default(""),
});

// Lifting an explicit hold after reviewing why it was placed.
const hold = z.object({
  id: z.uuid(),
  explicitHold: z.literal(false),
  reason: z.string().trim().max(500).default(""),
});

const change = z.union([hold, ban]);

export const PATCH = route(async (request: Request) => {
  const admin = await requireAdminUser(request);
  const input = await readJson(request, change);
  const database = await db();
  const [target] = await database.select().from(users).where(eq(users.id, input.id)).limit(1);
  if (!target) throw notFound("That user doesn't exist.");

  if ("explicitHold" in input) {
    // Someone else reviews an admin's own hold.
    if (input.id === admin.id) throw new HttpError(400, "Another admin has to review your account.", "invalid");
    if (!target.explicitHoldAt) throw new HttpError(409, "This account isn't on an explicit hold.", "not_on_hold");
    await clearExplicitHold(target.id);
    // The findings behind the hold are what the admin just reviewed.
    const reviewed = await database
      .update(moderationEvents)
      .set({ reviewedAt: new Date() })
      .where(
        and(
          eq(moderationEvents.userId, target.id),
          eq(moderationEvents.action, "escalated"),
          inArray(moderationEvents.category, HOLD_FINDINGS),
          isNull(moderationEvents.reviewedAt),
        ),
      )
      .returning({ id: moderationEvents.id });
    await recordAdminAction(admin, "profile", target.id, target.id, "explicit_hold_cleared", {
      reason: input.reason,
      heldSince: target.explicitHoldAt.toISOString(),
      findingsReviewed: reviewed.map((event) => event.id),
    });
    const [row] = await selectUsers(eq(users.id, target.id));
    return Response.json({ user: toDTO(row) });
  }

  if (input.id === admin.id) throw new HttpError(400, "You can't ban yourself.", "invalid");
  if (target.isAdmin && input.banned) {
    throw new HttpError(400, "Remove this person from ADMIN_USER_IDS before banning them.", "invalid");
  }
  const ageLockCleared = await database.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ bannedAt: input.banned ? new Date() : null })
      .where(eq(users.id, input.id));
    // Lifting the ban is the review of any underage finding behind it. The
    // user starts unverified and has to pass a new age check.
    return input.banned ? false : clearAgeLock(tx, input.id);
  });
  await recordAdminAction(admin, "profile", target.id, target.id, input.banned ? "ban" : "unban", {
    reason: input.reason,
    ...(ageLockCleared ? { ageLockCleared } : {}),
  });

  const [row] = await selectUsers(eq(users.id, input.id));
  return Response.json({ user: toDTO(row) });
});
