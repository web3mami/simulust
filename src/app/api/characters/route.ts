import { currentUser, requireUser } from "@/server/auth";
import { characterDTO, characterDTOs, createCharacter, createCharacterInput, listCharacters } from "@/server/characters";
import { readJson, route } from "@/server/http";
import { rateLimit } from "@/server/ratelimit";

export const GET = route(async (request: Request) => {
  const user = await currentUser(request);
  const rows = await listCharacters(user?.id ?? null);
  // Per viewer: nude art only for someone who may see explicit content, and
  // only while the art is still servable.
  return Response.json({ characters: await characterDTOs(rows, user) });
});

export const POST = route(async (request: Request) => {
  const user = await requireUser(request);
  await rateLimit(`character:${user.id}`, 20, 3600);
  const input = await readJson(request, createCharacterInput);
  const row = await createCharacter(user, input);
  return Response.json({ character: await characterDTO(row, user) }, { status: 201 });
});
