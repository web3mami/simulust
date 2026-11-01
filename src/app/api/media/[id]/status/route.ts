import type { NextRequest } from "next/server";
import { z } from "zod";
import { explicitAllowed, requireUser } from "@/server/auth";
import { notFound, route } from "@/server/http";
import { canView, failAbandoned, getMedia, isExplicitMedia, lockedMediaDTO, toMediaDTO } from "@/server/media";
import { refreshVideo } from "@/server/video";

// A poll can finish a video here: the worker poll (30 s), then moderating its
// six stills in two batches of three (30 s each) and storing the clip.
export const maxDuration = 120;

// Clients poll this while a video renders or a voice note records. It also
// nudges stuck work along (refreshVideo, failAbandoned), so a lost webhook or a
// killed request never leaves something pending, and charged, forever.
export const GET = route(async (request: NextRequest, ctx: RouteContext<"/api/media/[id]/status">) => {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) throw notFound();
  const user = await requireUser(request);
  const row = await getMedia(id);
  if (!row || !canView(user, row)) throw notFound();
  const current = row.userId !== user.id ? row : row.kind === "video" ? await refreshVideo(row) : await failAbandoned(row);
  const locked = !user.isAdmin && !explicitAllowed(user) && (await isExplicitMedia(current));
  return Response.json({ media: locked ? lockedMediaDTO(current) : toMediaDTO(current) }, { headers: { "Cache-Control": "no-store" } });
});
