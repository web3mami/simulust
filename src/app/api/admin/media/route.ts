import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/server/db";
import { media, users } from "@/server/db/schema";
import { route } from "@/server/http";
import { requireAdminUser } from "../_lib/server";
import type { AdminMediaDTO } from "../_lib/types";

const STATUSES = ["pending", "ready", "failed", "blocked"] as const;
type Status = (typeof STATUSES)[number];

// Recent generated images and videos with their moderation results.
// ?status=blocked narrows to one status.
export const GET = route(async (request: Request) => {
  await requireAdminUser(request);
  const wanted = new URL(request.url).searchParams.get("status");
  const status = STATUSES.includes(wanted as Status) ? (wanted as Status) : null;
  const database = await db();
  const rows = await database
    .select({ item: media, userName: users.displayName })
    .from(media)
    .leftJoin(users, eq(media.userId, users.id))
    .where(and(inArray(media.kind, ["image", "video"]), status ? eq(media.status, status) : undefined))
    .orderBy(desc(media.createdAt))
    .limit(60);
  const items: AdminMediaDTO[] = rows.map(({ item, userName }) => ({
    id: item.id,
    userId: item.userId,
    userName,
    characterId: item.characterId,
    kind: item.kind,
    purpose: item.purpose,
    status: item.status,
    prompt: item.prompt ? item.prompt.slice(0, 500) : null,
    moderation: item.moderation ?? null,
    error: item.error,
    url: `/api/media/${item.id}`,
    createdAt: item.createdAt.toISOString(),
  }));
  return Response.json({ media: items });
});
