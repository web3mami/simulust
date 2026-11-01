import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { explicitAllowed, requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { media } from "@/server/db/schema";
import { route } from "@/server/http";
import { canView, toMediaDTO } from "@/server/media";
import type { MediaDTO } from "@/lib/api-types";

export type CollectionMediaDTO = MediaDTO & {
  characterId: string | null;
  threadId: string | null;
  createdAt: string;
  // Where it was made: in a chat, or in the Video Studio (a keyframe, or a clip
  // animated from one).
  origin: "chat" | "studio";
};
export type CollectionResponse = { media: CollectionMediaDTO[]; hasMore: boolean };

// Photos and videos the user received in chats, and the keyframes they made in
// the Video Studio (not portrait drafts from the creator, not voice notes), for
// the collection gallery. Clips are "video" whatever they were made from.
const PURPOSES = ["chat", "video", "studio"] as const;

const query = z.object({
  before: z.iso.datetime({ offset: true, error: "before must be an ISO date." }).optional(),
  limit: z.coerce.number().int().min(1).max(60).default(30),
  kind: z.enum(["image", "video"]).optional(),
  // One character's media: the chat's photo gallery, the collection's filter.
  characterId: z.string().trim().min(1).max(64).optional(),
  // Only what was made in chats, or only in the studio (keyframes and the
  // clips animated from them).
  origin: z.enum(["chat", "studio"]).optional(),
});

// The photo a clip was animated from.
const source = alias(media, "source");

// Media that may hold nudity: made with explicit allowed through moderation, or
// a clip of such a photo. Hidden from anyone who can't see explicit content now
// (an explicit hold, or an older account that never confirmed its age), even
// though it's their own. They simply don't get it: no locked tiles, no count.
const explicitRow = sql`coalesce(${media.moderation}->>'explicit', 'false') = 'true'`;
const explicitSource = sql`coalesce(${source.moderation}->>'explicit', 'false') = 'true'`;
// Never null (a photo has no source row), so "not" works on it.
const fromStudio = sql`(${media.purpose} = 'studio' or coalesce(${source.purpose}, '') = 'studio')`;

// The signed-in user's own ready media, newest first. Paged by `before`, the
// createdAt of the oldest item the client has: timestamps are microsecond
// precision in the database but millisecond on the wire, so a page includes
// anything within that millisecond and the client drops ids it already has.
export const GET = route(async (request: Request) => {
  const user = await requireUser(request);
  const params = new URL(request.url).searchParams;
  const { before, limit, kind, characterId, origin } = query.parse({
    before: params.get("before") ?? undefined,
    limit: params.get("limit") ?? undefined,
    kind: params.get("kind") ?? undefined,
    characterId: params.get("characterId") ?? undefined,
    origin: params.get("origin") ?? undefined,
  });

  const database = await db();
  const rows = await database
    .select({ row: media, sourcePurpose: source.purpose })
    .from(media)
    .leftJoin(source, eq(source.id, media.sourceMediaId))
    .where(
      and(
        eq(media.userId, user.id),
        eq(media.status, "ready"),
        inArray(media.kind, kind ? [kind] : ["image", "video"]),
        inArray(media.purpose, PURPOSES),
        characterId ? eq(media.characterId, characterId) : undefined,
        origin === "studio" ? fromStudio : undefined,
        origin === "chat" ? sql`not (${fromStudio})` : undefined,
        explicitAllowed(user) ? undefined : sql`not (${explicitRow}) and not (${explicitSource})`,
        before ? lt(media.createdAt, new Date(new Date(before).getTime() + 1)) : undefined,
      ),
    )
    .orderBy(desc(media.createdAt), desc(media.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit).filter(({ row }) => canView(user, row));
  const body: CollectionResponse = {
    media: page.map(({ row, sourcePurpose }) => ({
      ...toMediaDTO(row),
      characterId: row.characterId,
      threadId: row.threadId,
      createdAt: row.createdAt.toISOString(),
      origin: row.purpose === "studio" || sourcePurpose === "studio" ? "studio" : "chat",
    })),
    hasMore: rows.length > limit,
  };
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
});
