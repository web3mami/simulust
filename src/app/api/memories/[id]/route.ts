import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/server/auth";
import { HttpError, notFound, readJson, route } from "@/server/http";
import {
  countPinned,
  deleteMemory,
  editMemory,
  findMemory,
  MAX_MEMORY_LENGTH,
  PINNED_CAP,
  toMemoryDTO,
} from "@/server/memory";
import { rateLimit } from "@/server/ratelimit";
import { moderateText, refusal } from "@/server/safety/moderation";

const uuid = z.uuid();

const patch = z
  .object({
    content: z
      .string()
      .trim()
      .min(1, "A memory can't be empty. Delete it instead.")
      .max(MAX_MEMORY_LENGTH, `Keep it under ${MAX_MEMORY_LENGTH} characters.`)
      .optional(),
    pinned: z.boolean().optional(),
  })
  .refine((value) => value.content !== undefined || value.pinned !== undefined, "Send content or pinned.");

async function owned(userId: string, id: string) {
  const row = uuid.safeParse(id).success ? await findMemory(userId, id) : null;
  if (!row) throw notFound("That memory is already gone.");
  return row;
}

export const PATCH = route(async (request: NextRequest, ctx: RouteContext<"/api/memories/[id]">) => {
  const { id } = await ctx.params;
  const user = await requireUser(request);
  await rateLimit(`memory:${user.id}`, 60, 60);
  const input = await readJson(request, patch);
  const row = await owned(user.id, id);

  // Memories go into the chat prompt, so edits are moderated like messages.
  if (input.content !== undefined && input.content !== row.content) {
    const verdict = await moderateText(
      input.content,
      { userId: user.id, targetType: "message", targetId: row.id },
      { failClosed: true },
    );
    if (!verdict.ok) throw refusal(verdict);
  }
  if (input.pinned === true && !row.pinned && (await countPinned(user.id, row.characterId)) >= PINNED_CAP) {
    throw new HttpError(422, `You can pin up to ${PINNED_CAP} memories. Unpin one first.`, "pin_limit");
  }

  const updated = await editMemory(row, input);
  if (!updated) throw notFound("That memory is already gone.");
  return Response.json({ memory: toMemoryDTO(updated) });
});

export const DELETE = route(async (request: NextRequest, ctx: RouteContext<"/api/memories/[id]">) => {
  const { id } = await ctx.params;
  const user = await requireUser(request);
  await rateLimit(`memory:${user.id}`, 60, 60);
  await owned(user.id, id);
  await deleteMemory(user.id, id);
  return Response.json({ ok: true });
});
