import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/server/auth";
import { route } from "@/server/http";
import { forgetAll, listMemories, toMemoryDTO } from "@/server/memory";
import { rateLimit } from "@/server/ratelimit";

const query = z.object({ characterId: z.string().trim().min(1, "Pick a character.").max(64) });

function characterIdOf(request: NextRequest) {
  return query.parse({ characterId: request.nextUrl.searchParams.get("characterId") ?? "" }).characterId;
}

export const GET = route(async (request: NextRequest) => {
  const user = await requireUser(request);
  const rows = await listMemories(user.id, characterIdOf(request));
  return Response.json({ memories: rows.map(toMemoryDTO) });
});

// "Forget everything": every memory plus the rolling summary for this character.
export const DELETE = route(async (request: NextRequest) => {
  const user = await requireUser(request);
  await rateLimit(`memory:${user.id}`, 60, 60);
  const deleted = await forgetAll(user.id, characterIdOf(request));
  return Response.json({ ok: true, deleted });
});
