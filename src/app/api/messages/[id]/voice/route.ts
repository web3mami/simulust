import { and, desc, eq, inArray } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser, requireVerifiedAdult } from "@/server/auth";
import { balanceOf, chargeFor, refund } from "@/server/credits";
import { db } from "@/server/db";
import { characters, media, messages, threads, type Media } from "@/server/db/schema";
import { features } from "@/server/env";
import { HttpError, notFound, route } from "@/server/http";
import { failAbandoned, failMedia, storeMedia, toMediaDTO } from "@/server/media";
import { rateLimit } from "@/server/ratelimit";
import { moderateText, refusal } from "@/server/safety/moderation";
import { cleanForSpeech, synthesize, voiceFor } from "@/server/tts";
import { COSTS } from "@/lib/pricing";

// Moderation (15 s) and synthesis (60 s) have to fit, or the platform kills the
// request after charging.
export const maxDuration = 120;

// A voice note points back at its message through media.prompt, so asking for
// the same message twice returns the first clip instead of charging again.
const voiceKey = (messageId: string) => `voice:message:${messageId}`;

async function reply(row: Media, userId: string) {
  return Response.json({ media: toMediaDTO(row), balance: await balanceOf(userId) });
}

export const POST = route(async (request: NextRequest, ctx: RouteContext<"/api/messages/[id]/voice">) => {
  const { id } = await ctx.params;
  const user = await requireUser(request);
  requireVerifiedAdult(user);
  if (!z.uuid().safeParse(id).success) throw notFound("That message is gone.");

  const database = await db();
  const [found] = await database
    .select({
      message: messages,
      characterId: threads.characterId,
      gender: characters.gender,
      voice: characters.voice,
      characterDeletedAt: characters.deletedAt,
    })
    .from(messages)
    .innerJoin(threads, eq(messages.threadId, threads.id))
    .leftJoin(characters, eq(threads.characterId, characters.id))
    .where(and(eq(messages.id, id), eq(threads.userId, user.id)))
    .limit(1);
  // A deleted (or taken down) character's chat is gone for every other route too.
  if (!found || found.characterDeletedAt) throw notFound("That message is gone.");
  const { message } = found;
  if (message.role !== "assistant") {
    throw new HttpError(422, "Only your character's replies can be turned into voice notes.", "not_assistant");
  }

  const voiceNotes = and(eq(media.userId, user.id), eq(media.purpose, "voice"), eq(media.prompt, voiceKey(id)));
  const [existing] = await database
    .select()
    .from(media)
    .where(and(voiceNotes, inArray(media.status, ["pending", "ready"])))
    .orderBy(desc(media.createdAt))
    .limit(1);
  if (existing) {
    // A clip abandoned mid-synthesis (timeout, crash, deploy) is failed and
    // refunded so it can be made again; anything else is returned as it is.
    const current = await failAbandoned(existing);
    if (current.status !== "failed") return reply(current, user.id);
  }

  if (!features.tts) {
    throw new HttpError(503, "Voice notes aren't available right now. Try again later.", "tts_unavailable");
  }
  if (message.flagged) {
    throw new HttpError(422, "This reply can't be turned into a voice note.", "flagged");
  }
  const text = cleanForSpeech(message.content);
  if (!text) throw new HttpError(422, "This reply has nothing to say out loud.", "nothing_to_say");

  // Limited before the check, so repeat taps can't fill the moderation queue.
  await rateLimit(`voice:${user.id}`, 20, 60);

  // The reply came from our model, but it's checked again before it gets a voice.
  const verdict = await moderateText(text, { userId: user.id, targetType: "message", targetId: id }, { failClosed: true });
  if (!verdict.ok) throw refusal(verdict);

  // Locking the message row makes concurrent taps on the same message queue up:
  // the second one finds the first one's clip instead of paying twice.
  const claim = await database.transaction(async (tx) => {
    await tx.select({ id: messages.id }).from(messages).where(eq(messages.id, id)).for("update");
    const [current] = await tx
      .select()
      .from(media)
      .where(and(voiceNotes, inArray(media.status, ["pending", "ready"])))
      .limit(1);
    if (current) return { row: current, created: false };
    const [row] = await tx
      .insert(media)
      .values({
        userId: user.id,
        characterId: found.characterId,
        threadId: message.threadId,
        kind: "audio",
        purpose: "voice",
        status: "pending",
        prompt: voiceKey(id),
        creditsSpent: COSTS.voiceNote,
      })
      .returning();
    await chargeFor(user, "voiceNote", row.id, tx);
    return { row, created: true };
  });
  if (!claim.created) return reply(claim.row, user.id);

  const voice = voiceFor({ voice: found.voice, gender: found.gender, id: found.characterId });
  try {
    const audio = await synthesize(text, voice);
    const ready = await storeMedia(claim.row, audio, "audio/mpeg", { text: "allowed", voice });
    return reply(ready, user.id);
  } catch (error) {
    console.error("Voice note failed", error);
    const settled = await Promise.allSettled([
      failMedia(claim.row.id, "failed", "The voice note didn't come through."),
      refund(user.id, claim.row.creditsSpent, claim.row.id),
    ]);
    for (const result of settled) {
      if (result.status === "rejected") console.error("Voice note cleanup failed", result.reason);
    }
    throw new HttpError(502, "The voice note didn't come through, and your credits are back. Try again.", "tts_failed");
  }
});
