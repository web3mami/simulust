import { z } from "zod";
import { selfDeclaredMinor } from "@/server/age";
import { explicitAllowed, requireUser, requireVerifiedAdult } from "@/server/auth";
import { findCharacterFor, requireCharacter } from "@/server/characters";
import { balanceOf, chargeFor, refund } from "@/server/credits";
import type { Media } from "@/server/db/schema";
import { HttpError, readJson, route } from "@/server/http";
import { moderateImage } from "@/server/image-moderation";
import { generateImage, ImageGenerationError, workerRefusalCategory } from "@/server/images";
import { createMedia, failMedia, storeMedia, toMediaDTO } from "@/server/media";
import { rateLimit } from "@/server/ratelimit";
import { logModeration, moderateText, refusal, saidText } from "@/server/safety/moderation";
import { checkImagePrompt, checkText, declaresMinorAge, IMAGE_REFUSAL, REFUSAL } from "@/server/safety/text";
import { studioBringsOthers, studioFrameInput, studioFramePrompt, subjectOf } from "@/server/studio";
import type { MediaDTO } from "@/lib/api-types";
import { appearanceText } from "@/lib/portrait-prompt";
import { COSTS } from "@/lib/pricing";
import { showsNudity } from "@/lib/studio";

// Details check (15 s), image worker (110 s) and image moderation (30 s) all
// have to fit, or the platform kills the request after charging.
export const maxDuration = 300;

export type StudioFrameResponse = { media: MediaDTO; balance: number };

// The details and character as sent, for the under-18 check before the strict
// parse: no length limit, nothing else needs to be right, and details sent as
// a list of strings are read as one text.
const lenient = z.looseObject({
  characterId: z.unknown().optional(),
  details: saidText,
});

// The Video Studio's keyframe: one character, alone, in a scene made from the
// presets. Charged as a photo; the clip is made from it afterwards by
// POST /api/media/[id]/animate, which charges the video.
//
// The studio is for confirmed adults (requireVerifiedAdult: signed in, age
// confirmed, no explicit hold), and every one of them gets every outfit and
// motion: there's no explicit switch.
export const POST = route(async (request: Request) => {
  const user = await requireUser(request);
  const body = await readJson(request, z.unknown());

  // Saying you're under 18 in the details does what it does in chat: explicit
  // content goes off and a person reviews the account. Read before the age
  // check, so an account that never confirmed its age is held too (confirming
  // later can't open it), and before anything is parsed strictly or charged:
  // details too long to take, or a missing or malformed preset or character,
  // still hold it (only the start of huge details is read).
  const sent = lenient.safeParse(body).data;
  const details = sent?.details?.slice(0, 20_000);
  if (details && declaresMinorAge(details)) {
    const characterId = studioFrameInput.shape.characterId.safeParse(sent?.characterId).data;
    const targetId = characterId ? ((await findCharacterFor(user.id, characterId))?.id ?? null) : null;
    await logModeration({ userId: user.id, targetType: "image_prompt", targetId, details: { source: "studio" } }, "minor", "blocked", {
      matched: "self-declared age",
      excerpt: details.slice(0, 280),
    });
    await selfDeclaredMinor(user.id, { targetType: "image_prompt", targetId, excerpt: details });
    throw new HttpError(422, REFUSAL.minor, "blocked_minor");
  }
  requireVerifiedAdult(user);
  const input = studioFrameInput.parse(body);
  // The same check as requireVerifiedAdult today; kept by name so nudity is
  // only ever allowed through for someone explicitAllowed says may see it.
  const allowExplicit = explicitAllowed(user);

  const character = await requireCharacter(user.id, input.characterId);
  await rateLimit(`studio:${user.id}`, 30, 3600);

  if (input.details) {
    // As the chat photo's hint: words that are fine in chat but never in a
    // picture get a plain refusal, unlogged; next to a sexual word they are
    // minor content, logged as such so it reaches the admin queue. Then the
    // classifier, which fails closed: no check, no picture.
    const context = { userId: user.id, targetType: "image_prompt" as const, targetId: character.id, details: { source: "studio" } };
    const othersRefused = () =>
      new HttpError(
        422,
        `Studio scenes are just ${character.name}, alone. Leave other people out of the details and try again.`,
        "studio_one_person",
      );
    const image = checkImagePrompt(input.details);
    if (!image.ok && image.category === "image") {
      if (image.minor) {
        await logModeration(context, "minor", "blocked", { matched: image.minor, excerpt: input.details.slice(0, 280) });
        throw new HttpError(422, REFUSAL.minor, "blocked_minor");
      }
      throw new HttpError(422, IMAGE_REFUSAL, "blocked_image_prompt");
    }
    // The scene policy adds the one-person rule to the classifier, as a
    // backstop to the word list below. Either one's refusal is logged as
    // other_people (moderateText doesn't log it), with what matched, so the
    // admin queue shows it whichever caught it; it's never minor content.
    const excerpt = input.details.slice(0, 280);
    const othersLogged = async (matched: string) => {
      await logModeration(context, "other_people", "blocked", { matched, excerpt });
      return othersRefused();
    };
    const verdict = await moderateText(input.details, context, { failClosed: true, policy: "scene" });
    if (!verdict.ok) {
      if ("category" in verdict && verdict.category === "other_people") throw await othersLogged("classifier");
      throw refusal(verdict);
    }
    // Checked after the safety screens, so what they'd log is logged first.
    const others = studioBringsOthers(input.details, character.gender);
    if (others) throw await othersLogged(others);
  }

  // Only creator-list values from the stored look reach the prompt
  // (appearanceText drops anything else); the name and look are still screened
  // as a backstop, as the chat photo does.
  const subject = subjectOf(character);
  const looks = checkText(`${character.name}. ${appearanceText(subject)}`);
  if (!looks.ok) {
    await logModeration({ userId: user.id, targetType: "character", targetId: character.id }, looks.category, "blocked", {
      matched: looks.matched,
    });
    throw new HttpError(422, REFUSAL[looks.category], `blocked_${looks.category}`);
  }

  // Nudity in the prompt only when the scene asks for it; a lingerie scene keeps
  // the nudity negatives.
  const explicit = allowExplicit && showsNudity(input);
  const { prompt, negativePrompt } = studioFramePrompt(character, input, explicit);
  const row = await createMedia({
    userId: user.id,
    characterId: character.id,
    threadId: null,
    kind: "image",
    purpose: "studio",
    prompt,
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

  let image;
  try {
    image = await generateImage({
      prompt,
      negativePrompt,
      width: 896,
      height: 1152,
      loraId: character.loraId,
      style: character.style,
      label: `${character.name} · studio`,
    });
  } catch (error) {
    console.error("Studio frame generation failed", error);
    const blocked = error instanceof ImageGenerationError && error.blocked;
    if (blocked) {
      const reason = (error as ImageGenerationError).reason ?? "";
      await logModeration({ userId: user.id, targetType: "image", targetId: row.id }, workerRefusalCategory(reason), "blocked", {
        reason: (reason || String((error as Error).message)).slice(0, 300),
        source: "studio",
      });
    }
    await fail(blocked ? "blocked" : "failed", blocked ? "Blocked by the image worker." : "Generation failed.");
    throw new HttpError(502, "That scene didn't come through. Your credits are back. Try again in a moment.", "generation_failed");
  }

  // Nude results pass only for someone who may see them (the scene asked for
  // nudity or not); everything else Hive blocks stays blocked.
  const moderation = await moderateImage(image.bytes, image.mimeType, {
    userId: user.id,
    targetType: "image",
    targetId: row.id,
    allowExplicit,
  });
  if (!moderation.ok) {
    await fail(
      moderation.unavailable ? "failed" : "blocked",
      moderation.unavailable ? "Safety check unavailable." : `Blocked: ${moderation.categories.join(", ")}`,
      { provider: image.provider, categories: moderation.categories, result: moderation.raw },
    );
    if (moderation.unavailable) {
      throw new HttpError(503, "We couldn't safety-check that scene. Your credits are back. Try again in a moment.", "moderation_unavailable");
    }
    throw new HttpError(
      422,
      "That scene didn't pass our safety checks, so we didn't keep it. Your credits are back. Try a different setup.",
      "image_blocked",
    );
  }

  let stored: Media;
  try {
    stored = await storeMedia(row, image.bytes, image.mimeType, {
      provider: image.provider,
      seed: image.seed,
      style: character.style,
      // Whether nudity was allowed through, so lists and the file route can
      // keep it from the account if it's later put on an explicit hold.
      explicit: allowExplicit,
      studio: { setting: input.setting, outfit: input.outfit, action: input.action, details: Boolean(input.details) },
      categories: [],
      result: moderation.raw,
    });
    if (stored.status !== "ready") throw new Error(`Studio frame ${row.id} is ${stored.status}, not ready.`);
  } catch (error) {
    console.error("Saving the studio frame failed", error);
    await fail("failed", "The scene couldn't be saved.");
    throw new HttpError(502, "That scene didn't come through. Your credits are back. Try again in a moment.", "generation_failed");
  }

  const result: StudioFrameResponse = { media: toMediaDTO(stored), balance: await balanceOf(user.id) };
  return Response.json(result);
});
