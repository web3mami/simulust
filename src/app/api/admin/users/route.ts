import { desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { UNDERAGE_FINDING } from "@/server/auth";
import { db } from "@/server/db";
import { creditBalances, moderationEvents, users } from "@/server/db/schema";
import { HttpError, notFound, readJson, route } from "@/server/http";
import { clearAgeLock } from "@/server/veriff";
import { recordAdminAction, requireAdminUser } from "../_lib/server";
import type { AdminUserDTO } from "../_lib/types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function escapeLike(text: string) {
  return text.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

const columns = {
  id: users.id,
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
  createdAt: users.createdAt,
  lastSeenAt: users.lastSeenAt,
  balance: creditBalances.balance,
};

async function selectUsers(where?: SQL) {
  const database = await db();
  return database
    .select(columns)
    .from(users)
    .leftJoin(creditBalances, eq(creditBalances.userId, users.id))
    .where(where)
    .orderBy(desc(users.createdAt))
    .limit(50);
}

function toDTO(row: Awaited<ReturnType<typeof selectUsers>>[number]): AdminUserDTO {
  return {
    id: row.id,
    displayName: row.displayName,
    privyId: row.privyId,
    isAdmin: row.isAdmin,
    ageStatus: row.ageStatus,
    bannedAt: row.bannedAt?.toISOString() ?? null,
    ageLocked: Boolean(row.bannedAt && row.ageLocked),
    balance: row.balance ?? 0,
    createdAt: row.createdAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
  };
}

// ?q= matches a user id exactly, or part of a login id or display name.
// Without q, the newest accounts.
export const GET = route(async (request: Request) => {
  await requireAdminUser(request);
  const q = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 100);
  const where = !q
    ? undefined
    : UUID.test(q)
      ? eq(users.id, q.toLowerCase())
      : or(ilike(users.privyId, `%${escapeLike(q)}%`), ilike(users.displayName, `%${escapeLike(q)}%`));
  const rows = await selectUsers(where);
  return Response.json({ users: rows.map(toDTO) });
});

const ban = z.object({
  id: z.uuid(),
  banned: z.boolean(),
  reason: z.string().trim().max(500).default(""),
});

export const PATCH = route(async (request: Request) => {
  const admin = await requireAdminUser(request);
  const input = await readJson(request, ban);
  if (input.id === admin.id) throw new HttpError(400, "You can't ban yourself.", "invalid");
  const database = await db();
  const [target] = await database.select().from(users).where(eq(users.id, input.id)).limit(1);
  if (!target) throw notFound("That user doesn't exist.");
  if (target.isAdmin && input.banned) {
    throw new HttpError(400, "Remove this person from ADMIN_PRIVY_IDS before banning them.", "invalid");
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
