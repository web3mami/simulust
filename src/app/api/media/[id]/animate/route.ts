import { and, desc, eq, inArray } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { selfDeclaredMinor } from "@/server/age";
import { explicitAllowed, requireUser, requireVerifiedAdult } from "@/server/auth";
import { findCharacterFor } from "@/server/characters";
import { balanceOf, chargeFor, refund } from "@/server/credits";
import { db } from "@/server/db";
import { media } from "@/server/db/schema";
import { HttpError, notFound, route } from "@/server/http";
import { failMedia, getMedia, isExplicitMedia, toMediaDTO } from "@/server/media";
import { rateLimit } from "@/server/ratelimit";
import { logModeration, moderateText, refusal, saidText } from "@/server/safety/moderation";
import { checkImagePrompt, declaresMinorAge, IMAGE_REFUSAL, REFUSAL } from "@/server/safety/text";
import { OTHER_PEOPLE_NEGATIVE, soloMotionPrompt, studioBringsOthers } from "@/server/studio";
import { blockVideo, startVideoJob, VideoBlocked, videoMode, videoPrompt } from "@/server/video";
import { COSTS } from "@/lib/pricing";

// Prompt check (15 s), reading the photo (30 s) and submitting it (30 s).
export const maxDuration = 120;

const input = z.object({ prompt: z.string().trim().max(300).optional() });
// What the request says, read before the strict parse for the under-18 check:
// a motion over the limit, next to a malformed field, or sent as a list of
// strings, still says what it says.
const lenient = z.looseObject({ prompt: saidText });

// Turns one of the user's finished photos into a 5 second clip. Returns at once
// with a pending video; the client polls /api/media/[id]/status. Video is for
// confirmed adults only (signed in, age confirmed, no explicit hold).
export const POST = route(async (request: NextRequest, ctx: RouteContext<"/api/media/[id]/animate">) => {
  const { id } = await ctx.params;
  const user = await requireUser(request);
  // The body is optional; an empty one means "use the default motion".
  const body: unknown = (await request.json().catch(() => null)) ?? {};

  // Looked up before the age check but only refused after it, so the hold
  // below can name the photo without someone else's id reaching the log.
  const found = z.uuid().safeParse(id).success ? await getMedia(id) : null;
  const source = found && found.userId === user.id ? found : null;

  // Saying you're under 18 in a motion does what it does in chat: explicit
  // content goes off and a person reviews the account. Checked before the age
  // check, so an account that never confirmed its age is held too (confirming
  // later can't open it), before the strict parse, so a motion too long to take
  // still holds it (only the start of a huge one is read), and before anything
  // is charged.
  const said = lenient.safeParse(body).data?.prompt?.slice(0, 20_000);
  if (said && declaresMinorAge(said)) {
    const targetId = source?.id ?? null;
    await logModeration({ userId: user.id, targetType: "video", targetId }, "minor", "blocked", {
      matched: "self-declared age",
      excerpt: said.slice(0, 280),
    });
    await selfDeclaredMinor(user.id, { targetType: "video", targetId, excerpt: said });
    throw new HttpError(422, REFUSAL.minor, "blocked_minor");
  }
  const { prompt } = input.parse(body);
  requireVerifiedAdult(user);

  if (!source) throw notFound("That photo is gone.");
  // A deleted or taken-down character's photos can't be turned into anything new.
  const character = source.characterId ? await findCharacterFor(user.id, source.characterId) : null;
  if (source.characterId && !character) throw notFound("That photo is gone.");
  // A photo the file route wouldn't show this viewer can't be animated either:
  // the same 404, before anything is charged. requireVerifiedAdult covers it
  // today; this keeps it true if the two checks ever part.
  if (!explicitAllowed(user) && (await isExplicitMedia(source))) throw notFound("That photo is gone.");
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
    const othersRefused = () =>
      new HttpError(422, "Clips only ever show the person in the photo, alone. Leave other people out of the motion. Nothing was charged.", "video_one_person");
    const image = checkImagePrompt(prompt);
    if (!image.ok && image.category === "image") {
      if (image.minor) {
        await logModeration(context, "minor", "blocked", { matched: image.minor, excerpt: prompt.slice(0, 280) });
        throw new HttpError(422, REFUSAL.minor, "blocked_minor");
      }
      throw new HttpError(422, IMAGE_REFUSAL, "blocked_image_prompt");
    }
    // The scene policy adds the one-person rule to the classifier, as a
    // backstop to the word list below. Either one's refusal is logged as
    // other_people (moderateText doesn't log it), with what matched, so the
    // admin queue shows it whichever caught it; it's never minor content.
    const othersLogged = async (matched: string) => {
      await logModeration(context, "other_people", "blocked", { matched, excerpt: prompt.slice(0, 280) });
      return othersRefused();
    };
    const verdict = await moderateText(prompt, context, { failClosed: true, policy: "scene" });
    if (!verdict.ok) {
      if ("category" in verdict && verdict.category === "other_people") throw await othersLogged("classifier");
      throw refusal(verdict);
    }
    // The clip stars the one person in the photo; nobody walks in. Checked
    // after the safety screens, so what they'd log is logged first. The
    // character's gender says whose pronouns are theirs ("she" in a clip of a
    // man is someone else), and "you" is the viewer, as in the studio: "your
    // hands on her hips" is them joining the clip.
    const others = studioBringsOthers(prompt, character?.gender);
    if (others) throw await othersLogged(others);
  }

  // A written motion ends in the one-person anchor, as the default motion
  // already does (src/server/video.ts), and every clip's negative prompt
  // carries the other-people negatives, so the model keeps to the one person
  // the screen above let through.
  const video = videoPrompt(soloMotionPrompt(prompt));
  const motion = { prompt: video.prompt, negativePrompt: [video.negativePrompt, ...OTHER_PEOPLE_NEGATIVE].join(", ") };
  // Locking the photo makes repeat or concurrent taps queue up: the second one
  // finds the first one's video (same photo, same motion) instead of paying again.
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
