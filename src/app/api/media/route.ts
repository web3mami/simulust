import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { z } from "zod";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { media } from "@/server/db/schema";
import { route } from "@/server/http";
import { canView, toMediaDTO } from "@/server/media";
import type { MediaDTO } from "@/lib/api-types";

export type CollectionMediaDTO = MediaDTO & { characterId: string | null; threadId: string | null; createdAt: string };
export type CollectionResponse = { media: CollectionMediaDTO[]; hasMore: boolean };

// Photos and videos the user received in chats (not portrait drafts from the
// creator, not voice notes), for the collection gallery.
const PURPOSES = ["chat", "video"] as const;

const query = z.object({
  before: z.iso.datetime({ offset: true, error: "before must be an ISO date." }).optional(),
  limit: z.coerce.number().int().min(1).max(60).default(30),
  kind: z.enum(["image", "video"]).optional(),
});

// The signed-in user's own ready media, newest first. Paged by `before`, the
// createdAt of the oldest item the client has: timestamps are microsecond
// precision in the database but millisecond on the wire, so a page includes
// anything within that millisecond and the client drops ids it already has.
export const GET = route(async (request: Request) => {
  const user = await requireUser(request);
  const params = new URL(request.url).searchParams;
  const { before, limit, kind } = query.parse({
    before: params.get("before") ?? undefined,
    limit: params.get("limit") ?? undefined,
    kind: params.get("kind") ?? undefined,
  });

  const database = await db();
  const rows = await database
    .select()
    .from(media)
    .where(
      and(
        eq(media.userId, user.id),
        eq(media.status, "ready"),
        inArray(media.kind, kind ? [kind] : ["image", "video"]),
        inArray(media.purpose, PURPOSES),
        before ? lt(media.createdAt, new Date(new Date(before).getTime() + 1)) : undefined,
      ),
    )
    .orderBy(desc(media.createdAt), desc(media.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit).filter((row) => canView(user, row));
  const body: CollectionResponse = {
    media: page.map((row) => ({
      ...toMediaDTO(row),
      characterId: row.characterId,
      threadId: row.threadId,
      createdAt: row.createdAt.toISOString(),
    })),
    hasMore: rows.length > limit,
  };
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
});
