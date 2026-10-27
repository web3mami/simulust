import { currentUser, requireUser } from "@/server/auth";
import { createCharacter, createCharacterInput, listCharacters, toCharacterDTO } from "@/server/characters";
import { readJson, route } from "@/server/http";
import { rateLimit } from "@/server/ratelimit";

export const GET = route(async (request: Request) => {
  const user = await currentUser(request);
  const rows = await listCharacters(user?.id ?? null);
  return Response.json({ characters: rows.map(toCharacterDTO) });
});

export const POST = route(async (request: Request) => {
  const user = await requireUser(request);
  await rateLimit(`character:${user.id}`, 20, 3600);
  const input = await readJson(request, createCharacterInput);
  const row = await createCharacter(user, input);
  return Response.json({ character: toCharacterDTO(row) }, { status: 201 });
});
