import { z } from "zod";
import { requireUser } from "@/server/auth";
import { readJson, route } from "@/server/http";
import { rateLimit } from "@/server/ratelimit";
import { getOrCreateThread, listThreads, toThreadDTO } from "@/server/threads";

export const GET = route(async (request: Request) => {
  const user = await requireUser(request);
  return Response.json({ threads: await listThreads(user) });
});

const open = z.object({ characterId: z.string().trim().min(1).max(64) });

export const POST = route(async (request: Request) => {
  const user = await requireUser(request);
  await rateLimit(`thread:${user.id}`, 60, 60);
  const { characterId } = await readJson(request, open);
  const { thread, character } = await getOrCreateThread(user, characterId);
  return Response.json({ thread: toThreadDTO(thread, character) });
});
