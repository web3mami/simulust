import { and, desc, eq, inArray } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { explicitAllowed, requireUser, requireVerifiedAdult } from "@/server/auth";
import { requireCharacter } from "@/server/characters";
import { balanceOf, chargeFor, refund } from "@/server/credits";
import { db } from "@/server/db";
import { media, messages, threads, type CharacterRow, type Media, type Message } from "@/server/db/schema";
import { HttpError, notFound, route } from "@/server/http";
import { moderateImage } from "@/server/image-moderation";
import { generateImage, ImageGenerationError, workerRefusalCategory } from "@/server/images";
import { complete } from "@/server/llm";
import { createMedia, failMedia, storeMedia, toMediaDTO } from "@/server/media";
import { rateLimit } from "@/server/ratelimit";
import { logModeration, moderateText, refusal, type ModerationContext } from "@/server/safety/moderation";
import { checkImagePrompt, checkText, IMAGE_REFUSAL, REFUSAL } from "@/server/safety/text";
import { discloseIfDue, toMessageDTO } from "@/server/threads";
import type { MessageDTO } from "@/lib/api-types";
import { appearanceText, buildImagePrompt, type ImageSubject } from "@/lib/portrait-prompt";
import { COSTS } from "@/lib/pricing";

// Hint check (15 s), scene (60 s), scene check (15 s), image worker (110 s) and
// image moderation (30 s) all have to fit, or the platform kills the request
// after charging.
export const maxDuration = 300;

const input = z.object({ hint: z.string().trim().max(300).optional() });

const NEUTRAL_SCENE = "relaxing at home in the evening, soft warm lamp light, looking into the camera with a slow smile";
const CAPTIONS = ["Thought you'd like this one.", "Just for you.", "Don't say I never send you anything.", "Thinking about you."];

function subjectOf(character: CharacterRow): ImageSubject {
  return {
    name: character.name,
    age: character.age,
    gender: character.gender,
    style: character.style,
    ethnicity: character.ethnicity,
    body: character.body,
    hair: character.hair,
    hairStyle: character.hairStyle,
    eyeColor: character.eyeColor,
    breast: character.breast,
  };
}

// One cheap model call turns the recent conversation into a photo scene and a
// caption. Its output gets the full text check and fails closed: anything
// blocked, or a classifier that can't answer, means the neutral scene and a
// stock caption rather than a failed paid request. A scene can also pick up
// words from the chat that are fine there but never in a photo ("after putting
// the kids to bed"); the model wrote those, not the user, so that scene is
// swapped for the neutral one without logging anything.
async function sceneAndCaption(
  character: CharacterRow,
  recent: Message[],
  hint: string | undefined,
  explicit: boolean,
  context: ModerationContext,
) {
  const transcript = recent
    .map((message) => `${message.role === "user" ? "Them" : character.name}: ${message.content.replace(/\s+/g, " ").slice(0, 400)}`)
    .join("\n");
  const system = [
    `You describe a photo that ${character.name}, a fictional adult aged ${character.age}, is sending in a private chat.`,
    `Reply with JSON only: {"scene": string, "caption": string}.`,
    `scene: one sentence under 35 words: where ${character.name} is, what they are wearing, pose, lighting and camera angle. Only ${character.name} is in the photo. No text, no other people, nothing about age or school.`,
    explicit
      ? "The user has opted into explicit content: nudity is fine if the conversation calls for it."
      : "Keep it tasteful: clothed or implied, no nudity.",
    `caption: a short message under 15 words that ${character.name} sends with the photo, in their own voice. No hashtags, no emojis.`,
  ].join("\n");
  const user = [`Recent conversation:\n${transcript || "(no messages yet)"}`, hint ? `They asked for: ${hint}` : null]
    .filter(Boolean)
    .join("\n\n");

  let scene = "";
  let caption = "";
  try {
    const reply = await complete(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      { tier: "utility", json: true, temperature: 0.7, maxTokens: 160 },
    );
    const parsed = JSON.parse(reply.match(/\{[\s\S]*\}/)?.[0] ?? "{}") as { scene?: unknown; caption?: unknown };
    scene = typeof parsed.scene === "string" ? parsed.scene.trim().slice(0, 300) : "";
    caption = typeof parsed.caption === "string" ? parsed.caption.trim().slice(0, 160) : "";
  } catch (error) {
    console.warn("Photo scene model call failed", error);
  }
  const image = checkImagePrompt(scene);
  if (!image.ok && image.category === "image") scene = "";
  const stock = CAPTIONS[Math.floor(Math.random() * CAPTIONS.length)];
  if (scene || caption) {
    const verdict = await moderateText([scene, caption].filter(Boolean).join("\n"), context, { failClosed: true });
    if (!verdict.ok) return { scene: NEUTRAL_SCENE, caption: stock };
  }
  return { scene: scene || NEUTRAL_SCENE, caption: caption || stock };
}

export const POST = route(async (request: NextRequest, ctx: RouteContext<"/api/threads/[id]/photo">) => {
  const { id } = await ctx.params;
  const user = await requireUser(request);
  requireVerifiedAdult(user);
  if (!z.uuid().safeParse(id).success) throw notFound("That chat is gone.");
  const { hint } = input.parse((await request.json().catch(() => null)) ?? {});

  const database = await db();
  const [thread] = await database
    .select()
    .from(threads)
    .where(and(eq(threads.id, id), eq(threads.userId, user.id)))
    .limit(1);
  if (!thread) throw notFound("That chat is gone.");
  const character = await requireCharacter(user.id, thread.characterId);

  await rateLimit(`photo:${user.id}`, 30, 3600);
  if (hint) {
    // Words that are fine in chat but never in a photo ("my kids", "high
    // school") get a plain refusal before anything is charged, unlogged: on
    // their own they say nothing about anyone. Paired with a sexual word (an age
    // under 18, a child or a family word near one), the hint is minor content and
    // is logged as a minor block with `matched`, like whatever checkText refuses
    // (moderateText logs that), so it reaches the admin queue and holds deletion.
    const context = { userId: user.id, targetType: "image_prompt" as const, targetId: thread.id };
    const image = checkImagePrompt(hint);
    if (!image.ok && image.category === "image") {
      if (image.minor) {
        await logModeration(context, "minor", "blocked", { matched: image.minor, excerpt: hint.slice(0, 280) });
        throw new HttpError(422, REFUSAL.minor, "blocked_minor");
      }
      throw new HttpError(422, IMAGE_REFUSAL, "blocked_image_prompt");
    }
    const verdict = await moderateText(hint, context, { failClosed: true });
    if (!verdict.ok) throw refusal(verdict);
  }
  // Only creator-list values from the stored look reach the prompt
  // (appearanceText drops anything else); the name and look are still screened
  // here as a backstop. The name ends a sentence of its own, so an age tacked
  // onto it ("Yuki, 17") reads as one.
  const subject = subjectOf(character);
  const looks = checkText(`${character.name}. ${appearanceText(subject)}`);
  if (!looks.ok) {
    await logModeration({ userId: user.id, targetType: "character", targetId: character.id }, looks.category, "blocked", {
      matched: looks.matched,
    });
    throw new HttpError(422, REFUSAL[looks.category], `blocked_${looks.category}`);
  }

  const explicit = explicitAllowed(user);
  const row = await createMedia({
    userId: user.id,
    characterId: character.id,
    threadId: thread.id,
    kind: "image",
    purpose: "chat",
    creditsSpent: COSTS.photo,
  });
  try {
    await chargeFor(user, "photo", row.id);
  } catch (error) {
    await failMedia(row.id, "failed", "Not enough credits.");
    throw error;
  }

  const fail = async (status: "failed" | "blocked", reason: string, details?: Record<string, unknown>) => {
    await failMedia(row.id, status, reason, details);
    await refund(user.id, COSTS.photo, row.id);
  };

  let caption: string;
  let image;
  try {
    const recent = (
      await database
        .select()
        .from(messages)
        .where(
          and(eq(messages.threadId, thread.id), inArray(messages.role, ["user", "assistant"]), eq(messages.flagged, false)),
        )
        .orderBy(desc(messages.createdAt))
        .limit(6)
    ).reverse();
    const written = await sceneAndCaption(character, recent, hint, explicit, {
      userId: user.id,
      targetType: "image_prompt",
      targetId: row.id,
      details: { source: "model_output" },
    });
    caption = written.caption;
    const { prompt, negativePrompt } = buildImagePrompt({ subject, scene: written.scene, explicit });
    await database.update(media).set({ prompt }).where(eq(media.id, row.id));
    image = await generateImage({
      prompt,
      negativePrompt,
      width: 896,
      height: 1152,
      loraId: character.loraId,
      style: character.style,
      label: character.name,
    });
  } catch (error) {
    console.error("Photo generation failed", error);
    const blocked = error instanceof ImageGenerationError && error.blocked;
    if (blocked) {
      const reason = (error as ImageGenerationError).reason ?? "";
      await logModeration({ userId: user.id, targetType: "image", targetId: row.id }, workerRefusalCategory(reason), "blocked", {
        reason: (reason || String((error as Error).message)).slice(0, 300),
      });
    }
    await fail(blocked ? "blocked" : "failed", blocked ? "Blocked by the image worker." : "Generation failed.");
    throw new HttpError(502, `${character.name}'s photo didn't come through. Your credits are back. Try again in a moment.`, "generation_failed");
  }

  const moderation = await moderateImage(image.bytes, image.mimeType, {
    userId: user.id,
    targetType: "image",
    targetId: row.id,
    allowExplicit: explicit,
  });
  if (!moderation.ok) {
    await fail(
      moderation.unavailable ? "failed" : "blocked",
      moderation.unavailable ? "Safety check unavailable." : `Blocked: ${moderation.categories.join(", ")}`,
      { provider: image.provider, categories: moderation.categories, result: moderation.raw },
    );
    if (moderation.unavailable) {
      throw new HttpError(503, "We couldn't safety-check that photo. Your credits are back. Try again in a moment.", "moderation_unavailable");
    }
    throw new HttpError(
      422,
      "That photo didn't pass our safety checks, so we didn't keep it. Your credits are back. Try asking for something different.",
      "image_blocked",
    );
  }

  let stored: Media;
  let message: Message;
  let notice: Message | null;
  try {
    stored = await storeMedia(row, image.bytes, image.mimeType, {
      provider: image.provider,
      seed: image.seed,
      style: character.style,
      explicit,
      categories: [],
      result: moderation.raw,
    });
    if (stored.status !== "ready") throw new Error(`Photo ${row.id} is ${stored.status}, not ready.`);
    const mediaId = stored.id;
    // A photo can be the first thing a character sends, so it carries the AI
    // disclosure the same way a reply does.
    notice = await discloseIfDue(thread, character.name);
    message = await database.transaction(async (tx) => {
      const [saved] = await tx
        .insert(messages)
        .values({ threadId: thread.id, role: "assistant", content: caption, mediaId, creditsSpent: COSTS.photo })
        .returning();
      await tx
        .update(threads)
        .set({ lastPreview: `Photo: ${caption}`.slice(0, 140), lastMessageAt: saved.createdAt })
        .where(eq(threads.id, thread.id));
      return saved;
    });
  } catch (error) {
    console.error("Saving the photo failed", error);
    await fail("failed", "The photo couldn't be saved.");
    throw new HttpError(502, `${character.name}'s photo didn't come through. Your credits are back. Try again in a moment.`, "generation_failed");
  }

  const dto: MessageDTO = {
    id: message.id,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt.toISOString(),
    media: toMediaDTO(stored),
  };
  return Response.json({ message: dto, notice: notice ? toMessageDTO(notice) : null, balance: await balanceOf(user.id) });
});
