import "server-only";
import { and, eq, inArray, isNull, notInArray, or, sql } from "drizzle-orm";
import { requireAdmin, requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { characters, media, moderationEvents, type Media, type User } from "@/server/db/schema";
import { failMedia, legalHoldUntil } from "@/server/media";
import { deleteObject } from "@/server/storage";

export { legalHoldUntil } from "@/server/media";
import type { ReportKind, ReportTarget } from "./types";

export async function requireAdminUser(request: Request): Promise<User> {
  const user = await requireUser(request);
  requireAdmin(user);
  return user;
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const UUIDS = new RegExp(UUID.source, "gi");
const EXACT_UUID = new RegExp(`^${UUID.source}$`, "i");

// The first of these ids that exists, in the order given, in one query.
const firstOf = <T extends { id: string }>(ids: string[], rows: T[]) =>
  ids.map((id) => rows.find((row) => row.id === id)).find((row) => row !== undefined);

async function characterTarget(...ids: string[]): Promise<ReportTarget | null> {
  if (!ids.length) return null;
  const database = await db();
  const rows = await database
    .select({ id: characters.id, name: characters.name, ownerId: characters.ownerId, deletedAt: characters.deletedAt })
    .from(characters)
    .where(inArray(characters.id, ids));
  const row = firstOf(ids, rows);
  return row ? { type: "character", id: row.id, name: row.name, ownerId: row.ownerId, deleted: row.deletedAt !== null } : null;
}

async function mediaTarget(...ids: string[]): Promise<ReportTarget | null> {
  if (!ids.length) return null;
  const database = await db();
  const rows = await database
    .select({ id: media.id, kind: media.kind, status: media.status, userId: media.userId })
    .from(media)
    .where(inArray(media.id, ids));
  const row = firstOf(ids, rows);
  return row ? { type: "media", id: row.id, kind: row.kind, status: row.status, ownerId: row.userId } : null;
}

function decoded(segment: string) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

// Reports name their target however the reporter could: a page URL
// (/date/<character>, /api/media/<id>), a file's storage URL
// (.../image/<userId>/<mediaId>.jpg), a bare media id or a character id.
export async function resolveTarget(raw: string): Promise<ReportTarget | null> {
  const text = raw.trim();
  let path = text;
  try {
    path = new URL(text).pathname;
  } catch {
    // Not an absolute URL: treat it as a path or an id.
  }

  const characterPath = path.match(/\/(?:date|memories)\/([^/?#\s]+)/);
  if (characterPath) {
    const found = await characterTarget(decoded(characterPath[1]));
    if (found) return found;
  }

  // The last id is the most specific one: a storage key names the owner, then
  // the item.
  const uuids = [...new Set((path.match(UUIDS) ?? text.match(UUIDS) ?? []).map((id) => id.toLowerCase()))].reverse().slice(0, 10);
  const found = (await mediaTarget(...uuids)) ?? (await characterTarget(...uuids));
  if (found) return found;

  if (/^[a-z0-9_-]{1,64}$/i.test(text)) return characterTarget(text);
  return null;
}

// Moderation categories that tie content to a child: the text and image
// classifiers' "minor" verdicts, and reports filed (or reclassified) as CSAM.
const MINOR_CATEGORIES = ["minor", "report_csam"];

const targetKey = (target: { type: string; id: string }) => `${target.type}:${target.id}`;

type Scope = { type: "media" | "character"; id: string; official: boolean };

const isOfficial = (target: ReportTarget) => target.type === "character" && target.ownerId === null;

// Which targets have been tied to a minor, counting everything a takedown would
// cover: a media item and the videos made from it, or a user's character and all
// of its media. Unless inherit is false, a media item also counts as tied when
// the photo it was made from or its character is, since taking those down would
// cover it too.
//
// An official character's media belongs to everyone who chats with it, so a hit
// on one item flags only that item, never the character. A hit on the character
// itself (a child-abuse report, or a report saying a child is involved) ties
// every user's media of it, so it counts only until the admin clears that report
// (clearCsamSignals). Everything else counts for good. Keys are "media:<id>" and
// "character:<id>".
async function minorSignals(targets: ReportTarget[], { inherit = true } = {}): Promise<Set<string>> {
  const flagged = new Set<string>();
  if (!targets.length) return flagged;
  const database = await db();
  const scopes: Scope[] = targets.map((target) => ({ type: target.type, id: target.id, official: isOfficial(target) }));

  const mediaTargets = targets.filter((target) => target.type === "media").map((target) => target.id);
  const parents =
    inherit && mediaTargets.length
      ? await database
          .select({ id: media.id, sourceMediaId: media.sourceMediaId, characterId: media.characterId, characterOwner: characters.ownerId })
          .from(media)
          .leftJoin(characters, eq(characters.id, media.characterId))
          .where(inArray(media.id, mediaTargets))
      : [];
  for (const parent of parents) {
    if (parent.sourceMediaId) scopes.push({ type: "media", id: parent.sourceMediaId, official: false });
    if (parent.characterId) scopes.push({ type: "character", id: parent.characterId, official: parent.characterOwner === null });
  }

  const mediaIds = scopes.filter((item) => item.type === "media").map((item) => item.id);
  const characterIds = scopes.filter((item) => item.type === "character" && !item.official).map((item) => item.id);
  const officialIds = scopes.filter((item) => item.type === "character" && item.official).map((item) => item.id);
  const scope = or(
    mediaIds.length ? inArray(media.sourceMediaId, mediaIds) : undefined,
    characterIds.length ? inArray(media.characterId, characterIds) : undefined,
  );
  const covered = scope ? database.select({ id: sql<string>`${media.id}::text` }).from(media).where(scope) : null;
  const hits = await database
    .selectDistinct({ id: moderationEvents.targetId })
    .from(moderationEvents)
    .where(
      and(
        inArray(moderationEvents.category, MINOR_CATEGORIES),
        or(
          inArray(moderationEvents.targetId, [...new Set(scopes.map((item) => item.id))]),
          covered ? inArray(moderationEvents.targetId, covered) : undefined,
        ),
        officialIds.length ? or(notInArray(moderationEvents.targetId, officialIds), isNull(moderationEvents.reviewedAt)) : undefined,
      ),
    );
  const ids = new Set(hits.map((hit) => hit.id));
  for (const item of scopes) if (ids.has(item.id)) flagged.add(targetKey(item));

  // A hit on a media item also counts for the item or user's character it was made from.
  const mediaHits = [...ids].filter((id): id is string => id !== null && EXACT_UUID.test(id));
  if (mediaHits.length) {
    const rows = await database
      .select({ sourceMediaId: media.sourceMediaId, characterId: media.characterId, characterOwner: characters.ownerId })
      .from(media)
      .leftJoin(characters, eq(characters.id, media.characterId))
      .where(inArray(media.id, mediaHits));
    for (const row of rows) {
      if (row.sourceMediaId) flagged.add(`media:${row.sourceMediaId}`);
      if (row.characterId && row.characterOwner) flagged.add(`character:${row.characterId}`);
    }
  }

  // And what's tied to a media item's photo or character carries down to it.
  for (const parent of parents) {
    const fromSource = parent.sourceMediaId !== null && flagged.has(`media:${parent.sourceMediaId}`);
    const fromCharacter = parent.characterId !== null && flagged.has(`character:${parent.characterId}`);
    if (fromSource || fromCharacter) flagged.add(`media:${parent.id}`);
  }
  return flagged;
}

export type PreserveDefault = {
  minorFlagged: boolean;
  preserve: boolean;
  // What keeping the files covers (see AdminReportDTO.preserveScope).
  scope: "all" | "flagged";
};

// Whether a takedown keeps the files by default: always for child-abuse reports,
// and for anything moderation has tied to a minor whatever the report was filed
// as. The admin can still choose otherwise. For an official character the same
// test decides whether keeping can cover every user's media of it at all.
export async function preserveDefaults(items: { kind: ReportKind; target: ReportTarget | null }[]): Promise<PreserveDefault[]> {
  const flagged = await minorSignals(items.flatMap((item) => (item.target ? [item.target] : [])));
  return items.map((item) => {
    const minorFlagged = item.target !== null && flagged.has(targetKey(item.target));
    const preserve = item.kind === "csam" || minorFlagged;
    return { minorFlagged, preserve, scope: item.target && isOfficial(item.target) && !preserve ? "flagged" : "all" };
  });
}

// The moderation event target type for a report's target.
export function eventTargetType(target: ReportTarget | null) {
  if (!target) return "report" as const;
  return target.type === "character" ? ("character" as const) : target.kind;
}

// CSAM is blocked but its file is kept under a legal hold for a year instead of
// being deleted (see legalHoldUntil in server/media).
const LEGAL_HOLD_DAYS = 365;

type TakedownContext = { reportId: string; adminId: string; preserve: boolean; kind: ReportKind };

// What a takedown did with the media it covered: items kept under legal hold,
// and items blocked without one, whose files (if any) were deleted.
export type TakedownOutcome = { held: number; deleted: number };

const tally = (into: TakedownOutcome, from: TakedownOutcome) => {
  into.held += from.held;
  into.deleted += from.deleted;
};

// Takes down the item and everything made from it (videos animated from a photo
// are copies of it), each with the same legal hold.
async function takeDownMedia(row: Media, context: TakedownContext, done = new Set<string>()): Promise<TakedownOutcome> {
  const outcome = { held: 0, deleted: 0 };
  if (done.has(row.id)) return outcome;
  done.add(row.id);
  if (await blockMedia(row, context)) outcome.held++;
  else outcome.deleted++;
  const database = await db();
  const copies = await database.select().from(media).where(eq(media.sourceMediaId, row.id));
  for (const copy of copies) tally(outcome, await takeDownMedia(copy, context, done));
  return outcome;
}

// Returns whether the file is kept under a legal hold.
async function blockMedia(row: Media, context: TakedownContext) {
  // A hold from an earlier CSAM takedown outlives any later, ordinary one.
  const earlier = legalHoldUntil(row.moderation);
  const fresh = context.preserve ? new Date(Date.now() + LEGAL_HOLD_DAYS * 24 * 60 * 60 * 1000) : null;
  const until = earlier && earlier > new Date() && (!fresh || earlier > fresh) ? earlier : fresh;
  const takedown = {
    reportId: context.reportId,
    by: context.adminId,
    at: new Date().toISOString(),
    ...(until ? { legalHoldUntil: until.toISOString() } : {}),
  };
  await failMedia(row.id, "blocked", "Removed after report", { ...(row.moderation ?? {}), takedown });
  if (!until && row.storageKey) await deleteObject(row.storageKey);
  await audit(row.kind, row.id, row.userId, context, {
    storageKey: row.storageKey,
    deleted: !until,
    legalHoldUntil: until?.toISOString() ?? null,
  });
  return until !== null;
}

// An already-reviewed moderation event, so every takedown leaves a record
// without landing in the review queue.
async function audit(
  targetType: "image" | "audio" | "video" | "character" | "profile",
  targetId: string,
  userId: string | null,
  context: { reportId?: string; adminId: string },
  details: Record<string, unknown>,
  category = "takedown",
) {
  const database = await db();
  await database.insert(moderationEvents).values({
    userId,
    targetType,
    targetId,
    category,
    action: "blocked",
    details: { ...details, reportId: context.reportId ?? null, adminId: context.adminId },
    reviewedAt: new Date(),
  });
}

export async function recordAdminAction(
  admin: User,
  targetType: "profile",
  targetId: string,
  userId: string | null,
  category: string,
  details: Record<string, unknown>,
) {
  await audit(targetType, targetId, userId, { adminId: admin.id }, details, category);
}

// What happened to the files, in words for the report's resolution.
function filesNote({ held, deleted }: TakedownOutcome) {
  if (!deleted) return `${held === 1 ? "file" : "files"} kept under legal hold for one year`;
  if (!held) return deleted === 1 ? "file deleted" : "files deleted";
  return `${held} kept under legal hold for one year, ${deleted} deleted`;
}

// Removes what a report points at. Returns a short note for the report's
// resolution and what was kept and deleted.
export async function takeDown(
  target: ReportTarget,
  context: TakedownContext,
): Promise<TakedownOutcome & { note: string }> {
  const database = await db();
  if (target.type === "media") {
    const [row] = await database.select().from(media).where(eq(media.id, target.id)).limit(1);
    if (!row) return { note: `Media ${target.id} was already gone.`, held: 0, deleted: 0 };
    const outcome = await takeDownMedia(row, context);
    const count = outcome.held + outcome.deleted;
    const copies = count > 1 ? ` and ${count - 1} item${count === 2 ? "" : "s"} made from it` : "";
    return { ...outcome, note: `${outcome.held ? "Blocked" : "Removed"} ${row.kind} ${row.id}${copies}; ${filesNote(outcome)}.` };
  }

  const [character] = await database
    .update(characters)
    .set({ deletedAt: new Date() })
    .where(and(eq(characters.id, target.id), isNull(characters.deletedAt)))
    .returning();
  const [row] = character
    ? [character]
    : await database.select().from(characters).where(eq(characters.id, target.id)).limit(1);
  if (!row) return { note: `Character ${target.id} was already gone.`, held: 0, deleted: 0 };

  // Everything made of the character goes too: its portrait, every chat photo,
  // video and voice note, so none of it can be reached by URL, exported or
  // animated. Rows already blocked are taken down again only under a legal
  // hold, which they need even if they were blocked earlier.
  const owned = await database
    .select()
    .from(media)
    .where(or(eq(media.characterId, row.id), row.imageMediaId ? eq(media.id, row.imageMediaId) : undefined));
  // An official character's media belongs to everyone who chats with it. Items
  // tied to a minor themselves are evidence, and they're kept whatever the
  // report asked. The rest are kept only when keeping was asked for and a
  // child-abuse report or a minor signal names the character itself: one user's
  // flagged photo mustn't keep every other user from deleting their account
  // for a year.
  const official = row.ownerId === null;
  const tied = official
    ? await minorSignals(
        owned.map((item): ReportTarget => ({ type: "media", id: item.id, kind: item.kind, status: item.status, ownerId: item.userId })),
        { inherit: false },
      )
    : null;
  const whole =
    official && context.preserve && (context.kind === "csam" || (await minorSignals([target])).has(targetKey(target)));
  const holds = (item: Media) => (tied ? whole || tied.has(`media:${item.id}`) : context.preserve);
  // Held items go first, so the videos made from them are held with them.
  const queue = [...owned.filter(holds), ...owned.filter((item) => !holds(item) && item.status !== "blocked")];
  const done = new Set<string>();
  const outcome = { held: 0, deleted: 0 };
  for (const item of queue) tally(outcome, await takeDownMedia(item, { ...context, preserve: holds(item) }, done));
  const removed = outcome.held + outcome.deleted;
  await audit("character", row.id, row.ownerId, context, {
    name: row.name,
    official,
    mediaRemoved: removed,
    mediaHeld: outcome.held,
    mediaDeleted: outcome.deleted,
  });
  // Official characters ship their portrait as a static file, which the app
  // can't delete; it has to come out of the deploy.
  const staticImage = row.imageUrl && !row.imageUrl.startsWith("/api/media/") ? ` Also remove ${row.imageUrl} from the deploy.` : "";
  const items = removed ? ` and ${removed} media item${removed === 1 ? "" : "s"}: ${filesNote(outcome)}` : "";
  return { ...outcome, note: `Removed character ${row.name} (${row.id})${items}.${staticImage}` };
}

// A CSAM report an admin has cleared (dismissed, or taken down with its files
// deleted) no longer holds up its owner's account deletion. Its report-details
// signal goes with it, so it no longer ties every user's media of an official
// character (see minorSignals).
export async function clearCsamSignals(reportId: string) {
  const database = await db();
  await database
    .update(moderationEvents)
    .set({ reviewedAt: new Date() })
    .where(
      and(
        or(
          eq(moderationEvents.category, "report_csam"),
          and(eq(moderationEvents.category, "minor"), sql`${moderationEvents.details}->>'source' = 'report'`),
        ),
        isNull(moderationEvents.reviewedAt),
        sql`${moderationEvents.details}->>'reportId' = ${reportId}`,
      ),
    );
}
