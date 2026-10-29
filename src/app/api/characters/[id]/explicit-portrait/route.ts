import type { NextRequest } from "next/server";
import { explicitAllowed, requireUser, requireVerifiedAdult } from "@/server/auth";
import {
  characterDTO,
  drawExplicitPortrait,
  EXPLICIT_PORTRAIT_SCENES,
  explicitPortraitPrompt,
  findCharacterFor,
  screenLook,
  type ExplicitPortraitOutcome,
} from "@/server/characters";
import { balanceOf, chargeFor, refund } from "@/server/credits";
import { HttpError, notFound, route } from "@/server/http";
import { createMedia, failMedia } from "@/server/media";
import { rateLimit } from "@/server/ratelimit";
import { COSTS } from "@/lib/pricing";

// Image worker (110 s) and moderation (30 s) have to fit, or the platform kills
// the request after charging.
export const maxDuration = 300;

function failure(outcome: Exclude<ExplicitPortraitOutcome, { ok: true }>, name: string) {
  switch (outcome.reason) {
    case "moderation_unavailable":
      return new HttpError(503, "We couldn't safety-check that portrait. Your credits are back. Try again in a moment.", "moderation_unavailable");
    case "image_blocked":
      return new HttpError(
        422,
        "That portrait didn't pass our safety checks, so we didn't keep it. Your credits are back. Try again.",
        "image_blocked",
      );
    case "character_gone":
      return notFound("That character is gone. Your credits are back.");
    default:
      return new HttpError(
        502,
        `${name}'s portrait didn't come through. Your credits are back. Try again in a moment.`,
        outcome.reason === "worker_blocked" ? "blocked" : "generation_failed",
      );
  }
}

// A nude portrait of the user's own character, for any confirmed adult (the
// whole site is uncensored; a held or unconfirmed account gets the age error
// before anything is charged). No free text: the prompt is the character's stored look (creator
// list values only) in one of a few fixed scenes, with the adult anchors and
// minor negatives every image gets. Charged like a portrait and refunded on any
// failure, including a moderation block.
export const POST = route(async (request: NextRequest, ctx: RouteContext<"/api/characters/[id]/explicit-portrait">) => {
  const { id } = await ctx.params;
  const user = await requireUser(request);
  requireVerifiedAdult(user);
  // The same rule as above today; checked by name so this route never draws
  // nude art for anyone the explicit-image route wouldn't show it to.
  if (!explicitAllowed(user)) {
    throw new HttpError(403, "Confirm your age to make a nude portrait.", "age_verification_required");
  }
  const character = id.length <= 64 ? await findCharacterFor(user.id, id) : null;
  // Official characters have their own art; this is only for the user's own.
  if (!character || character.ownerId !== user.id) throw notFound("That character is gone.");

  await rateLimit(`explicit-portrait:${user.id}`, 20, 3600);
  await screenLook(character, user.id);

  const prompt = explicitPortraitPrompt(character, Math.floor(Math.random() * EXPLICIT_PORTRAIT_SCENES.length));
  const row = await createMedia({
    userId: user.id,
    characterId: character.id,
    kind: "image",
    purpose: "portrait",
    prompt: prompt.prompt,
    creditsSpent: COSTS.portrait,
  });
  try {
    await chargeFor(user, "portrait", row.id);
  } catch (error) {
    await failMedia(row.id, "failed", "Not enough credits.");
    throw error;
  }

  let outcome: ExplicitPortraitOutcome;
  try {
    outcome = await drawExplicitPortrait(character, row, prompt);
  } catch (error) {
    // Anything unexpected (a database hiccup, say) still gives the credits back.
    console.error("Nude portrait failed", error);
    await failMedia(row.id, "failed", "Generation failed.").catch(() => undefined);
    outcome = { ok: false, reason: "generation_failed" };
  }
  if (!outcome.ok) {
    await refund(user.id, COSTS.portrait, row.id);
    throw failure(outcome, character.name);
  }
  // The art is only ever linked through the character (its explicit-image
  // route re-checks the viewer), never as a plain /api/media URL.
  return Response.json({ character: await characterDTO(outcome.character, user), balance: await balanceOf(user.id) });
});
