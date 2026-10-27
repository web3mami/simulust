import { explicitAllowed, requireUser } from "@/server/auth";
import { chargeFor, refund } from "@/server/credits";
import { HttpError, route } from "@/server/http";
import { moderateImage } from "@/server/image-moderation";
import { generateImage, ImageGenerationError, workerRefusalCategory } from "@/server/images";
import type { Media } from "@/server/db/schema";
import { createMedia, failMedia, storeMedia, toMediaDTO } from "@/server/media";
import { rateLimit } from "@/server/ratelimit";
import { logModeration } from "@/server/safety/moderation";
import { checkText, REFUSAL } from "@/server/safety/text";
import { portraitPrompt, portraitRequest } from "@/lib/portrait-prompt";
import { COSTS } from "@/lib/pricing";

// Image worker (110 s) and moderation (30 s) have to fit, or the platform kills
// the request after charging.
export const maxDuration = 300;

// Creator portraits. They are clothed and tasteful, so anyone logged in can make
// a character before verifying their age; explicit photos come later in chat.
export const POST = route(async (request: Request) => {
  const user = await requireUser(request);
  await rateLimit(`portrait:${user.id}`, 20, 3600);

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const choice = portraitRequest(body);
  if (!choice) throw new HttpError(400, "Some choices are missing. Go back and pick every option.", "invalid");
  // The name never reaches the model; it only labels development placeholder images.
  const label = typeof body?.name === "string" && body.name.trim() ? body.name.trim().slice(0, 40) : "Your character";

  const { prompt, negativePrompt } = portraitPrompt(choice, { suggestive: explicitAllowed(user) });
  // Every choice comes from a fixed list, so this only trips if a list changes.
  const verdict = checkText(prompt);
  if (!verdict.ok) {
    await logModeration({ userId: user.id, targetType: "image_prompt" }, verdict.category, "blocked", { matched: verdict.matched });
    throw new HttpError(422, REFUSAL[verdict.category], `blocked_${verdict.category}`);
  }

  const row = await createMedia({
    userId: user.id,
    kind: "image",
    purpose: "portrait",
    prompt,
    creditsSpent: COSTS.portrait,
  });
  try {
    await chargeFor(user, "portrait", row.id);
  } catch (error) {
    await failMedia(row.id, "failed", "Not enough credits.");
    throw error;
  }

  let image;
  try {
    image = await generateImage({
      prompt,
      negativePrompt,
      width: 896,
      height: 1152,
      style: choice.style,
      label,
    });
  } catch (error) {
    console.error("Portrait generation failed", error);
    const blocked = error instanceof ImageGenerationError && error.blocked;
    if (blocked) {
      const reason = (error as ImageGenerationError).reason ?? "";
      await logModeration({ userId: user.id, targetType: "image", targetId: row.id }, workerRefusalCategory(reason), "blocked", {
        reason: (reason || String((error as Error).message)).slice(0, 300),
      });
    }
    await failMedia(row.id, blocked ? "blocked" : "failed", blocked ? "Blocked by the image worker." : "Generation failed.");
    await refund(user.id, COSTS.portrait, row.id);
    throw new HttpError(
      502,
      "We couldn't draw that portrait. Your credits are back. Try again in a moment.",
      blocked ? "blocked" : "generation_failed",
    );
  }

  const moderation = await moderateImage(image.bytes, image.mimeType, {
    userId: user.id,
    targetType: "image",
    targetId: row.id,
    allowExplicit: false,
  });
  if (!moderation.ok) {
    await failMedia(
      row.id,
      moderation.unavailable ? "failed" : "blocked",
      moderation.unavailable ? "Safety check unavailable." : `Blocked: ${moderation.categories.join(", ")}`,
      { provider: image.provider, categories: moderation.categories, result: moderation.raw },
    );
    await refund(user.id, COSTS.portrait, row.id);
    if (moderation.unavailable) {
      throw new HttpError(503, "We couldn't safety-check that portrait. Your credits are back. Try again in a moment.", "moderation_unavailable");
    }
    throw new HttpError(
      422,
      "That portrait didn't pass our safety checks, so we didn't keep it. Your credits are back. Try again or change a few options.",
      "image_blocked",
    );
  }

  let stored: Media;
  try {
    stored = await storeMedia(row, image.bytes, image.mimeType, {
      provider: image.provider,
      seed: image.seed,
      // Videos made from a portrait that isn't tied to a character yet read
      // the style from here, for the worker's drawn-face age check.
      style: choice.style,
      categories: [],
      result: moderation.raw,
    });
    if (stored.status !== "ready") throw new Error(`Portrait ${row.id} is ${stored.status}, not ready.`);
  } catch (error) {
    console.error("Saving the portrait failed", error);
    await failMedia(row.id, "failed", "The portrait couldn't be saved.");
    await refund(user.id, COSTS.portrait, row.id);
    throw new HttpError(502, "We couldn't save that portrait. Your credits are back. Try again in a moment.", "generation_failed");
  }
  return Response.json({ media: toMediaDTO(stored) });
});
