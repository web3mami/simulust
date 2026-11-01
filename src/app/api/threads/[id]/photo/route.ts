import { and, desc, eq, inArray } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { selfDeclaredMinor } from "@/server/age";
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
import { logModeration, moderateText, refusal, saidText, type ModerationContext } from "@/server/safety/moderation";
import { checkImagePrompt, checkText, declaresMinorAge, IMAGE_REFUSAL, REFUSAL } from "@/server/safety/text";
import { bringsOthers, studioBringsOthers } from "@/server/studio";
import { discloseIfDue, toMessageDTO } from "@/server/threads";
import type { MessageDTO } from "@/lib/api-types";
import { appearanceText, buildImagePrompt, type ImageSubject } from "@/lib/portrait-prompt";
import { COSTS } from "@/lib/pricing";
import { describesNudity, presetScene, wantsClothed, wantsNudity } from "./scenes";

// Hint check (15 s), scene (60 s), scene check (15 s), then the caption check
// with it (15 s), image worker (110 s) and image moderation (30 s) all have to
// fit, or the platform kills the request after charging.
export const maxDuration = 300;

const input = z.object({ hint: z.string().trim().max(300).optional() });
// What the request says, read before the strict parse for the under-18 check:
// a hint over the limit, next to a malformed field, or sent as a list of
// strings, still says what it says.
const lenient = z.looseObject({ hint: saidText });

const NEUTRAL_SCENE = "relaxing at home in the evening, soft warm lamp light, looking into the camera with a slow smile";
const CAPTIONS = ["Thought you'd like this one.", "Just for you.", "Don't say I never send you anything.", "Thinking about you."];
// For a photo that shows more than usual, when the model gave no caption.
const INTIMATE_CAPTIONS = ["Only for your eyes.", "You asked so nicely.", "Don't keep me waiting for a reply.", "All yours tonight."];

const pick = (list: string[]) => list[Math.floor(Math.random() * list.length)];

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
// caption. Both get the full text check and fail closed: a scene that's
// blocked, or a classifier that can't answer, means the neutral scene, and a
// caption likewise means a stock one, rather than a failed paid request. The
// scene is checked first, under the scene policy. The caption isn't in the
// picture, so it's checked under the content policy, which has no one-person
// rule ("wish you were here" is fine), but read with the scene that goes out
// with it: a line that's harmless alone ("don't tell my mom, I'm supposed to be
// grounded") can make a nude photo minor content. A violation there (logged
// like any other) takes the scene down with the caption. When the hint is one
// of the quick actions (lingerie, the shower, nude), our own scene for it
// stands in for the neutral one, so the request is still honoured.
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
    // "a woman leaning on the railing" reads as someone besides the character.
    `In the scene, refer to ${character.name} only by name or pronoun, never as "a woman", "a man", "a girl", "a guy" or the like.`,
    explicit
      ? `The user is a confirmed adult and everything here is uncensored: nudity is fine, and sensual, confident poses are welcome. If they asked for something specific (nude, topless, lingerie, the shower), show that, with ${character.name} alone in the picture and no sex acts with anyone.`
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
  // Worded for who the character is: a man is shirtless, in briefs.
  const preset = presetScene(hint, explicit, character.gender);
  const fallback = preset ?? NEUTRAL_SCENE;
  const kept = scene ? await screenScene(scene, character, hint, explicit, context) : "";
  const verdict = caption
    ? await moderateText(caption, context, { failClosed: true, classifierText: `Photo: ${kept || fallback}\nCaption: ${caption}` })
    : null;
  const stock = pick(explicit && preset ? INTIMATE_CAPTIONS : CAPTIONS);
  // An outage only costs the caption: the scene was checked on its own.
  if (verdict && !verdict.ok && "category" in verdict) return { scene: fallback, caption: stock };
  return { scene: kept || fallback, caption: verdict?.ok ? caption : stock };
}

// The model's scene, or "" when it has to give way to ours. A scene can pick up
// words from the chat that are fine there but never in a photo ("after putting
// the kids to bed"); the model wrote those, not the user, so it goes without
// logging anything, unless they sit next to a sexual word, which is minor
// content. Otherwise the scene is screened as written, before the quiet drops
// below, so minor content in it is logged as a minor block (marked as model
// output) whatever else it says; anything the screen refuses goes. Then a scene
// with anyone else in it goes, unlogged: the word list reads it as the studio
// does, a third-person scene where "you" is whoever gets the photo ("lying
// across your lap"). So does one that came back clothed when nudity was asked
// for. (Should a viewer who may not see explicit content ever get this far,
// nudity in the scene is dropped the same way.)
async function screenScene(
  scene: string,
  character: CharacterRow,
  hint: string | undefined,
  explicit: boolean,
  context: ModerationContext,
) {
  const image = checkImagePrompt(scene);
  if (!image.ok && image.category === "image") {
    if (image.minor) await logModeration(context, "minor", "blocked", { matched: image.minor, excerpt: scene.slice(0, 280) });
    return "";
  }
  const verdict = await moderateText(scene, context, { failClosed: true, policy: "scene" });
  if (!verdict.ok) return "";
  if (studioBringsOthers(scene, character.gender)) return "";
  if (!explicit && describesNudity(scene)) return "";
  if (explicit && wantsNudity(hint) && !describesNudity(scene)) return "";
  return scene;
}

export const POST = route(async (request: NextRequest, ctx: RouteContext<"/api/threads/[id]/photo">) => {
  const { id } = await ctx.params;
  const user = await requireUser(request);
  // No body asks for a photo with no hint. One that isn't JSON is refused
  // rather than read as none: what it said would go unread, under-18 check
  // and all, and a photo nobody asked for would be charged.
  const raw = await request.text();
  let body: unknown = {};
  try {
    if (raw.trim()) body = (JSON.parse(raw) as unknown) ?? {};
  } catch {
    throw new HttpError(400, "Send a JSON body.", "invalid");
  }

  // Looked up before the age check but only refused after it, so the hold
  // below can name the chat without a stranger's thread id reaching the log.
  const database = await db();
  const [thread] = z.uuid().safeParse(id).success
    ? await database
        .select()
        .from(threads)
        .where(and(eq(threads.id, id), eq(threads.userId, user.id)))
        .limit(1)
    : [];

  // Saying you're under 18 in a photo request does what it does in chat:
  // explicit content goes off and a person reviews the account. Checked before
  // the age check, so an account that never confirmed its age is held too
  // (confirming later can't open it), before the strict parse, so a hint too
  // long to take still holds it (only the start of a huge one is read), and
  // before anything is charged.
  const said = lenient.safeParse(body).data?.hint?.slice(0, 20_000);
  if (said && declaresMinorAge(said)) {
    const targetId = thread?.id ?? null;
    await logModeration({ userId: user.id, targetType: "image_prompt", targetId }, "minor", "blocked", {
      matched: "self-declared age",
      excerpt: said.slice(0, 280),
    });
    await selfDeclaredMinor(user.id, { targetType: "image_prompt", targetId, excerpt: said });
    throw new HttpError(422, REFUSAL.minor, "blocked_minor");
  }
  const { hint } = input.parse(body);
  requireVerifiedAdult(user);
  if (!thread) throw notFound("That chat is gone.");
  const character = await requireCharacter(user.id, thread.characterId);

  await rateLimit(`photo:${user.id}`, 30, 3600);
  // Confirmed adults may request explicit photos, but an explicit preference
  // for clothes keeps both the prompt and the image screen clothed.
  const explicit = explicitAllowed(user) && !wantsClothed(hint);
  if (hint) {
    // Words that are fine in chat but never in a photo ("my kids", "high
    // school") get a plain refusal before anything is charged, unlogged: on
    // their own they say nothing about anyone. Paired with a sexual word (an age
    // under 18, a child or a family word near one), the hint is minor content and
    // is logged as a minor block with `matched`, like whatever checkText refuses
    // (moderateText logs that), so it reaches the admin queue and holds deletion.
    const context = { userId: user.id, targetType: "image_prompt" as const, targetId: thread.id };
    const othersRefused = () =>
      new HttpError(422, `Photos only ever show ${character.name}, alone. Ask for one with just them in it. Nothing was charged.`, "others_in_photo");
    const image = checkImagePrompt(hint);
    if (!image.ok && image.category === "image") {
      if (image.minor) {
        await logModeration(context, "minor", "blocked", { matched: image.minor, excerpt: hint.slice(0, 280) });
        throw new HttpError(422, REFUSAL.minor, "blocked_minor");
      }
      throw new HttpError(422, IMAGE_REFUSAL, "blocked_image_prompt");
    }
    // The scene policy adds the one-person rule to the classifier, as a
    // backstop to the word list below. Either one's refusal is logged as
    // other_people (moderateText doesn't log it), with what matched, so the
    // admin queue shows it whichever caught it; it's never minor content.
    const othersLogged = async (matched: string) => {
      await logModeration(context, "other_people", "blocked", { matched, excerpt: hint.slice(0, 280) });
      return othersRefused();
    };
    const verdict = await moderateText(hint, context, { failClosed: true, policy: "scene" });
    if (!verdict.ok) {
      if ("category" in verdict && verdict.category === "other_people") throw await othersLogged("classifier");
      throw refusal(verdict);
    }
    // Checked after the safety screens, so what they'd log is logged first: a
    // minor hint that also names someone else is a minor block, not this.
    const others = bringsOthers(hint, character.gender);
    if (others) throw await othersLogged(others);
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
    // The builder's negatives already carry the other-people terms.
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
