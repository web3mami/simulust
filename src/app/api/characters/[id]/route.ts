import type { NextRequest } from "next/server";
import { currentUser, requireUser } from "@/server/auth";
import { characterDTO, deleteCharacter, requireCharacter } from "@/server/characters";
import { route } from "@/server/http";

export const GET = route(async (request: NextRequest, ctx: RouteContext<"/api/characters/[id]">) => {
  const { id } = await ctx.params;
  const user = await currentUser(request);
  const row = await requireCharacter(user?.id ?? null, id);
  return Response.json({ character: await characterDTO(row, user) });
});

export const DELETE = route(async (request: NextRequest, ctx: RouteContext<"/api/characters/[id]">) => {
  const { id } = await ctx.params;
  const user = await requireUser(request);
  await deleteCharacter(user, id);
  return Response.json({ ok: true });
});
