import type { NextRequest } from "next/server";
import { explicitAllowed, requireUser } from "@/server/auth";
import { HttpError, route } from "@/server/http";
import { loadMessages, requireThread, toThreadDTO } from "@/server/threads";

export const GET = route(async (request: NextRequest, ctx: RouteContext<"/api/threads/[id]">) => {
  const { id } = await ctx.params;
  const user = await requireUser(request);
  const { thread, character } = await requireThread(user, id);

  const raw = request.nextUrl.searchParams.get("before");
  const before = raw ? new Date(raw) : undefined;
  if (before && Number.isNaN(before.getTime())) {
    throw new HttpError(400, "before must be an ISO date.", "invalid");
  }

  const page = await loadMessages(thread.id, before, explicitAllowed(user));
  return Response.json({ thread: toThreadDTO(thread, character), ...page });
});
