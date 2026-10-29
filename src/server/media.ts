import "server-only";
import { and, eq, inArray, lt, ne } from "drizzle-orm";
import { refund } from "@/server/credits";
import { db } from "@/server/db";
import { media, type Media, type User } from "@/server/db/schema";
import { deleteObject, putObject } from "@/server/storage";
import type { MediaDTO } from "@/lib/api-types";

type NewMedia = Pick<typeof media.$inferInsert, "userId" | "characterId" | "threadId" | "kind" | "purpose" | "prompt" | "sourceMediaId" | "creditsSpent">;

const EXTENSION: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/ogg": "ogg",
  "video/mp4": "mp4",
  "video/webm": "webm",
};

// Images and voice notes are made inside one request, and no route runs longer
// than five minutes, so one still pending after this was abandoned (timeout,
// crash, deploy). Videos have their own clock in video.ts.
export const ABANDONED_AFTER_MS = 6 * 60_000;

export async function createMedia(values: NewMedia): Promise<Media> {
  const database = await db();
  const [row] = await database.insert(media).values({ ...values, status: "pending" }).returning();
  return row;
}

// Federal law (18 USC 2258A(h), as amended by the REPORT Act) requires keeping
// the contents of a CyberTipline report for one year, so a CSAM takedown blocks
// the row but keeps its file until this date.
export function legalHoldUntil(moderation: Record<string, unknown> | null | undefined): Date | null {
  const takedown = moderation?.takedown as { legalHoldUntil?: string } | undefined;
  if (!takedown?.legalHoldUntil) return null;
  const until = new Date(takedown.legalHoldUntil);
  return Number.isNaN(until.getTime()) ? null : until;
}

// Stores the bytes and marks the row ready. Call only after moderation passed.
// Only a pending row becomes ready: one that was taken down or given up on while
// it was being made stays as it is, and its file isn't kept unless a takedown
// put it under legal hold.
export async function storeMedia(row: Media, bytes: Uint8Array, mimeType: string, moderation?: Record<string, unknown>) {
  const ext = EXTENSION[mimeType] ?? "bin";
  const key = `${row.kind}/${row.userId ?? "system"}/${row.id}.${ext}`;
  await putObject(key, bytes, mimeType);
  const database = await db();
  const [updated] = await database
    .update(media)
    .set({ status: "ready", storageKey: key, mimeType, moderation: moderation ?? row.moderation, updatedAt: new Date() })
    .where(and(eq(media.id, row.id), eq(media.status, "pending")))
    .returning();
  if (updated) return updated;

  const current = await getMedia(row.id);
  if (current && legalHoldUntil(current.moderation)) {
    const [held] = await database
      .update(media)
      .set({ storageKey: key, mimeType, updatedAt: new Date() })
      .where(eq(media.id, row.id))
      .returning();
    return held ?? current;
  }
  if (current?.storageKey !== key) await deleteObject(key);
  return current ?? row;
}

// A blocked row stays blocked, so a late failure can't overwrite a takedown.
// With pendingOnly, only a row still being made is failed: a give-up that loses
// a race with the job finishing leaves the finished row alone. Returns the
// updated row, or undefined when nothing changed.
export async function failMedia(
  id: string,
  status: "failed" | "blocked",
  error: string,
  moderation?: Record<string, unknown>,
  options: { pendingOnly?: boolean } = {},
) {
  const database = await db();
  const guard = options.pendingOnly ? eq(media.status, "pending") : status === "failed" ? ne(media.status, "blocked") : undefined;
  const [updated] = await database
    .update(media)
    .set({ status, error, ...(moderation ? { moderation } : {}), updatedAt: new Date() })
    .where(and(eq(media.id, id), guard))
    .returning();
  return updated;
}

// Fails an abandoned image or voice note and gives its credits back. The refund
// is keyed on the media id, so the route's own refund and this one can't both pay.
export async function failAbandoned(row: Media): Promise<Media> {
  if (row.kind === "video" || row.status !== "pending") return row;
  if (Date.now() - row.createdAt.getTime() < ABANDONED_AFTER_MS) return row;
  const failed = await failMedia(row.id, "failed", "This didn't come through. Your credits are back.", undefined, {
    pendingOnly: true,
  });
  if (!failed) return (await getMedia(row.id)) ?? row;
  if (row.userId && row.creditsSpent > 0) await refund(row.userId, row.creditsSpent, row.id);
  return failed;
}

// For the cron: every abandoned image and voice note, oldest first.
export async function abandonedMedia(limit = 100) {
  const database = await db();
  return database
    .select()
    .from(media)
    .where(
      and(
        eq(media.status, "pending"),
        inArray(media.kind, ["image", "audio"]),
        lt(media.createdAt, new Date(Date.now() - ABANDONED_AFTER_MS)),
      ),
    )
    .orderBy(media.createdAt)
    .limit(limit);
}

export async function getMedia(id: string) {
  const database = await db();
  const [row] = await database.select().from(media).where(eq(media.id, id)).limit(1);
  return row ?? null;
}

// Media is private to the user it was made for. Admins can see everything for review.
export function canView(user: User | null, row: Media) {
  if (!user) return false;
  return row.userId === user.id || user.isAdmin;
}

export function mediaUrl(id: string) {
  return `/api/media/${id}`;
}

// Media that may hold nudity: made while explicit content was allowed (the
// photo routes and finished clips record moderation.explicit), or a clip of
// such a photo. Only viewers allowed explicit content right now may see it,
// even their own: not an account on an explicit hold, nor one that never
// confirmed its age.
export function isExplicit(row: Media, source?: Media | null) {
  return row.moderation?.explicit === true || source?.moderation?.explicit === true;
}

export async function isExplicitMedia(row: Media) {
  if (row.moderation?.explicit === true) return true;
  if (!row.sourceMediaId) return false;
  return isExplicit(row, await getMedia(row.sourceMediaId));
}

// What a viewer without explicit access gets for explicit media: no URL.
export function lockedMediaDTO(row: Media): MediaDTO {
  return { id: row.id, kind: row.kind, status: row.status, url: null, error: null, locked: true };
}

export function toMediaDTO(row: Media): MediaDTO {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    url: row.status === "ready" ? mediaUrl(row.id) : null,
    error: row.status === "blocked" ? "This couldn't be created." : row.error,
  };
}
