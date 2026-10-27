import { and, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { legalHoldUntil } from "@/server/media";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { characters, deletedIdentities, media, moderationEvents, orders, reports, users } from "@/server/db/schema";
import { identityHash } from "@/server/auth";
import { HttpError, readJson, route } from "@/server/http";
import { rateLimit } from "@/server/ratelimit";
import { deleteObject } from "@/server/storage";

const body = z.object({
  confirm: z.literal("DELETE", { error: "Type DELETE to confirm." }),
});

// How far back a minor-related event keeps the account from self-deletion.
const MINOR_LOOKBACK_MS = 90 * 24 * 60 * 60 * 1000;

// Where a user writes a request for an image, a video or a character.
const PROMPT_TARGETS = ["image_prompt", "video", "character"] as const;

// Ids the way resolveTarget finds them in a report's target. Every media item
// and user character id is a UUID.
const UUIDS = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

// Whether a safety case may still need the account's content, counting only
// evidence about what the user made, and only until an admin has reviewed it:
// an open report against their media or characters, a CSAM report on them, a
// block of a prompt they wrote for an image, a video or a character for
// sexualizing a minor, or a stored photo of theirs the video worker's tagger
// said looks like a minor (blockVideo in server/video). Chat blocks don't count
// (someone who says they're 13 must still be able to leave), nor do verdicts on
// our own model's text or on media that was never stored.
async function underReview(userId: string, now: Date) {
  const database = await db();
  const theirs = or(
    inArray(moderationEvents.targetId, database.select({ id: sql<string>`${media.id}::text` }).from(media).where(eq(media.userId, userId))),
    inArray(moderationEvents.targetId, database.select({ id: characters.id }).from(characters).where(eq(characters.ownerId, userId))),
  );
  const [event] = await database
    .select({ id: moderationEvents.id })
    .from(moderationEvents)
    .where(
      and(
        isNull(moderationEvents.reviewedAt),
        gt(moderationEvents.createdAt, new Date(now.getTime() - MINOR_LOOKBACK_MS)),
        or(
          and(
            eq(moderationEvents.userId, userId),
            eq(moderationEvents.category, "minor"),
            eq(moderationEvents.action, "blocked"),
            or(
              and(
                inArray(moderationEvents.targetType, PROMPT_TARGETS),
                // Our text checks, and the video worker's screen of a motion the
                // user wrote, record what matched; verdicts on generated media don't.
                sql`${moderationEvents.details}->>'matched' is not null`,
                sql`coalesce(${moderationEvents.details}->>'source', '') not in ('model_output', 'memory', 'summary')`,
              ),
              and(eq(moderationEvents.targetType, "image"), sql`${moderationEvents.details}->>'source' = 'video_worker'`),
            ),
          ),
          and(eq(moderationEvents.category, "report_csam"), theirs),
        ),
      ),
    )
    .limit(1);
  if (event) return true;

  // An open report naming one of their media items or characters, in one query
  // however many reports are open.
  const [report] = await database
    .select({ id: reports.id })
    .from(reports)
    .where(
      and(
        eq(reports.status, "open"),
        sql`exists (
          select 1 from regexp_matches(lower(${reports.target}), ${UUIDS}, 'g') as found(id)
          where found.id[1]::uuid in (select ${media.id} from ${media} where ${media.userId} = ${userId})
            or found.id[1] in (select ${characters.id} from ${characters} where ${characters.ownerId} = ${userId})
        )`,
      ),
    )
    .limit(1);
  return report !== undefined;
}

// Deletes the account and everything that cascades from it: profile,
// characters, chats, memories, media, credits and age-check outcomes. Orders
// are kept, unlinked from the account, because payment records are needed for
// tax; open checkouts expire so they can't be paid with no one to credit.
// Stored files go first, so a failure leaves the account intact to retry
// rather than orphaning files nobody can find again.
export const DELETE = route(async (request: Request) => {
  const user = await requireUser(request);
  await readJson(request, body);
  await rateLimit(`account-delete:${user.id}`, 5, 60 * 60);
  const database = await db();

  const rows = await database
    .select({ id: media.id, storageKey: media.storageKey, moderation: media.moderation })
    .from(media)
    .where(eq(media.userId, user.id));
  const now = new Date();
  const held = rows.some((row) => {
    const until = legalHoldUntil(row.moderation);
    return until !== null && until > now;
  });
  // Deleting would destroy evidence (the files, and the rows saying whose they
  // were), so support deletes these accounts by hand once the case is closed.
  // The message doesn't say which check matched: telling someone their content
  // is part of a child-safety case could tip them off.
  if (held || (await underReview(user.id, now))) {
    const support = process.env.NEXT_PUBLIC_SUPPORT_EMAIL;
    throw new HttpError(
      409,
      `We can't delete this account right now: some of its content is under review, and we have to keep it until the review is finished. ${support ? `Email ${support}` : "Contact support"} to ask about deleting it.`,
      "deletion_on_hold",
    );
  }

  const keys = rows.filter((row) => row.storageKey).map((row) => row.storageKey!);
  for (let i = 0; i < keys.length; i += 20) {
    const results = await Promise.allSettled(keys.slice(i, i + 20).map((key) => deleteObject(key)));
    const failed = results.filter((result) => result.status === "rejected");
    if (failed.length) {
      console.error("Account deletion: failed to delete stored files", user.id, failed[0]);
      throw new HttpError(502, "We couldn't delete all your files. Try again in a few minutes.", "storage_error");
    }
  }

  await database.transaction(async (tx) => {
    await tx.insert(deletedIdentities).values({ privyIdHash: identityHash(user.privyId) }).onConflictDoNothing();
    // A checkout whose payment was already seen stays pending, so reconcile
    // still records it for a refund by hand.
    await tx
      .update(orders)
      .set({ status: "expired", error: "Account deleted before payment." })
      .where(and(eq(orders.userId, user.id), eq(orders.status, "pending"), isNull(orders.signature)));
    await tx.delete(users).where(eq(users.id, user.id));
  });
  return Response.json({ ok: true });
});
