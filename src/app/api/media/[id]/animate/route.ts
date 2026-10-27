import { and, desc, eq, inArray } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser, requireVerifiedAdult } from "@/server/auth";
import { findCharacterFor } from "@/server/characters";
import { balanceOf, chargeFor, refund } from "@/server/credits";
import { db } from "@/server/db";
import { media } from "@/server/db/schema";
import { HttpError, notFound, route } from "@/server/http";
import { failMedia, getMedia, toMediaDTO } from "@/server/media";
import { rateLimit } from "@/server/ratelimit";
import { logModeration, moderateText, refusal } from "@/server/safety/moderation";
import { checkImagePrompt, IMAGE_REFUSAL, REFUSAL } from "@/server/safety/text";
import { blockVideo, startVideoJob, VideoBlocked, videoMode, videoPrompt } from "@/server/video";
import { COSTS } from "@/lib/pricing";

// Prompt check (15 s), reading the photo (30 s) and submitting it (30 s).
export const maxDuration = 120;

const input = z.object({ prompt: z.string().trim().max(300).optional() });

// Turns one of the user's finished photos into a 5 second clip. Returns at once
// with a pending video; the client polls /api/media/[id]/status.
export const POST = route(async (request: NextRequest, ctx: RouteContext<"/api/media/[id]/animate">) => {
  const { id } = await ctx.params;
  const user = await requireUser(request);
  requireVerifiedAdult(user);
  if (!z.uuid().safeParse(id).success) throw notFound("That photo is gone.");
  // The body is optional; an empty one means "use the default motion".
  const { prompt } = input.parse((await request.json().catch(() => null)) ?? {});

  const source = await getMedia(id);
  if (!source || source.userId !== user.id) throw notFound("That photo is gone.");
  // A deleted or taken-down character's photos can't be turned into anything new.
  if (source.characterId && !(await findCharacterFor(user.id, source.characterId))) throw notFound("That photo is gone.");
  if (source.kind !== "image" || source.status !== "ready" || !source.storageKey) {
    throw new HttpError(422, "Only finished photos can be animated. Pick a photo that has loaded.", "not_animatable");
  }
  if (videoMode() === "off") {
    throw new HttpError(503, "Video needs the GPU worker, which isn't connected yet. Nothing was charged.", "video_unavailable");
  }

  await rateLimit(`video:${user.id}`, 10, 3600);
  if (prompt) {
    // The worker refuses words that are fine in chat but never in a video ("a
    // minor tilt of the head", "laughs like a kid"). Refused here instead, before
    // charging, and unlogged: on their own they say nothing about anyone. Paired
    // with a sexual word (an age under 18, a child or a family word near one), the
    // motion is minor content and is logged as a minor block with `matched`, like
    // whatever checkText refuses (moderateText logs that), so it reaches the
    // admin queue and holds deletion.
    const context = { userId: user.id, targetType: "video" as const, targetId: source.id };
    const image = checkImagePrompt(prompt);
    if (!image.ok && image.category === "image") {
      if (image.minor) {
        await logModeration(context, "minor", "blocked", { matched: image.minor, excerpt: prompt.slice(0, 280) });
        throw new HttpError(422, REFUSAL.minor, "blocked_minor");
      }
      throw new HttpError(422, IMAGE_REFUSAL, "blocked_image_prompt");
    }
    const verdict = await moderateText(prompt, context, { failClosed: true });
    if (!verdict.ok) throw refusal(verdict);
  }

  // Locking the photo makes repeat or concurrent taps queue up: the second one
  // finds the first one's video (same photo, same motion) instead of paying again.
  const motion = videoPrompt(prompt);
  const database = await db();
  const claim = await database.transaction(async (tx) => {
    await tx.select({ id: media.id }).from(media).where(eq(media.id, source.id)).for("update");
    const [current] = await tx
      .select()
      .from(media)
      .where(
        and(
          eq(media.sourceMediaId, source.id),
          eq(media.kind, "video"),
          eq(media.prompt, motion.prompt),
          inArray(media.status, ["pending", "ready"]),
        ),
      )
      .orderBy(desc(media.createdAt))
      .limit(1);
    if (current) return { row: current, created: false };
    const [row] = await tx
      .insert(media)
      .values({
        userId: user.id,
        characterId: source.characterId,
        threadId: source.threadId,
        kind: "video",
        purpose: "video",
        status: "pending",
        prompt: motion.prompt,
        sourceMediaId: source.id,
        creditsSpent: COSTS.video,
      })
      .returning();
    await chargeFor(user, "video", row.id, tx);
    return { row, created: true };
  });
  if (!claim.created) {
    return Response.json({ media: toMediaDTO(claim.row), balance: await balanceOf(user.id) }, { status: 202 });
  }

  let started;
  try {
    started = await startVideoJob(claim.row, source, motion);
  } catch (error) {
    if (error instanceof VideoBlocked) {
      // The worker's own prompt screen refused it: a moderation block, not an outage.
      await blockVideo(claim.row, error.reason);
      throw new HttpError(422, "That motion isn't allowed. Your credits are back.", "video_blocked");
    }
    console.error("Video submission failed", error);
    await failMedia(claim.row.id, "failed", "The video couldn't start. Your credits are back.");
    await refund(user.id, COSTS.video, claim.row.id);
    throw new HttpError(502, "We couldn't start that video. Your credits are back. Try again in a moment.", "video_failed");
  }

  return Response.json({ media: toMediaDTO(started), balance: await balanceOf(user.id) }, { status: 202 });
});
