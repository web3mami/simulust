import "server-only";
import { and, asc, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { explicitAllowed } from "@/server/auth";
import { db } from "@/server/db";
import { characters, media, type CharacterRow, type Media, type User } from "@/server/db/schema";
import { HttpError, notFound } from "@/server/http";
import { moderateImage } from "@/server/image-moderation";
import { generateImage, ImageGenerationError, workerRefusalCategory } from "@/server/images";
import { failMedia, getMedia, storeMedia } from "@/server/media";
import { logModeration, moderateText, refusal } from "@/server/safety/moderation";
import { asName, checkText, REFUSAL } from "@/server/safety/text";
import type { Character } from "@/lib/characters";
import {
  appearanceText,
  buildImagePrompt,
  BREASTS,
  ETHNICITIES,
  EYE_COLORS,
  GIRL_BODIES,
  GUY_BODIES,
  HAIR_COLORS,
  HAIR_STYLES,
  type ImagePrompt,
  type ImageSubject,
  JOBS,
  KINKS,
  MAX_AGE,
  MIN_AGE,
  oneOf,
  PERSONALITIES,
  ROLES,
  STYLES,
} from "@/lib/portrait-prompt";
import { GIVEN_NAME, NAME_MAX, NAME_MESSAGES, tidyName } from "@/lib/names";
import { VOICES } from "@/lib/voices";

// Nude art is only ever served from here, never from /public or /api/media: the
// route checks the viewer again on every request (see explicitArtFor).
export function explicitImagePath(characterId: string) {
  return `/api/characters/${encodeURIComponent(characterId)}/explicit-image`;
}

// The same for every viewer: never any nude art. Lists that go to a particular
// viewer go through characterDTOs instead, which adds it where they may see it.
export function toCharacterDTO(row: CharacterRow): Character {
  return {
    id: row.id,
    name: row.name,
    age: row.age,
    gender: row.gender,
    ethnicity: row.ethnicity,
    body: row.body,
    role: row.role,
    heat: row.heat,
    line: row.line,
    color: row.color,
    lane: row.lane,
    tags: row.tags,
    image: row.imageUrl ?? undefined,
    hair: row.hair ?? undefined,
    hairStyle: row.hairStyle ?? undefined,
    eyeColor: row.eyeColor ?? undefined,
    breast: row.breast ?? undefined,
    personality: row.personality ?? undefined,
    occupation: row.occupation ?? undefined,
    kinks: row.kinks,
    voice: row.voice ?? undefined,
    own: row.ownerId !== null,
  };
}

// The viewer is who asked, so explicitImage is decided per request, on the
// server: only a viewer who may see explicit content (signed in, a confirmed
// adult, no hold) gets the URL, and only while the art's file is still
// servable (not failed, blocked or taken down since it was drawn). Everyone
// else gets the regular art only. The ?v= changes when the art is redrawn, so
// a browser's cached copy isn't reused.
export async function characterDTOs(rows: CharacterRow[], viewer: User | null): Promise<Character[]> {
  const live = viewer && explicitAllowed(viewer) ? await liveExplicitArt(rows) : new Set<string>();
  return rows.map((row) => {
    const dto = toCharacterDTO(row);
    if (!live.has(row.id) || !row.explicitImageMediaId) return dto;
    return { ...dto, explicitImage: `${explicitImagePath(row.id)}?v=${row.explicitImageMediaId.slice(0, 8)}` };
  });
}

export async function characterDTO(row: CharacterRow, viewer: User | null): Promise<Character> {
  const [dto] = await characterDTOs([row], viewer);
  return dto;
}

const visibleTo = (userId: string | null) =>
  and(isNull(characters.deletedAt), userId ? or(isNull(characters.ownerId), eq(characters.ownerId, userId)) : isNull(characters.ownerId));

export async function listCharacters(userId: string | null) {
  const database = await db();
  return database
    .select()
    .from(characters)
    .where(visibleTo(userId))
    .orderBy(desc(characters.ownerId), asc(characters.createdAt));
}

export async function findCharacterFor(userId: string | null, id: string) {
  const database = await db();
  const [row] = await database
    .select()
    .from(characters)
    .where(and(eq(characters.id, id), visibleTo(userId)))
    .limit(1);
  return row ?? null;
}

export async function requireCharacter(userId: string | null, id: string) {
  const row = await findCharacterFor(userId, id);
  if (!row) throw notFound("That character is gone.");
  return row;
}

// See src/lib/names.ts for the rule and why.
const givenName = z
  .string()
  .transform(tidyName)
  .pipe(
    z
      .string()
      .min(1, NAME_MESSAGES.empty)
      .max(NAME_MAX, NAME_MESSAGES.long)
      .regex(GIVEN_NAME, NAME_MESSAGES.shape),
  );

// Everything except the name comes from the creator's fixed lists. The look
// goes into every image prompt, the same lists the portrait was drawn from,
// and the persona into the chat system prompt. The classifier still screens
// the whole character below.
export const createCharacterInput = z
  .object({
    name: givenName,
    age: z.number().int().min(MIN_AGE, "Characters must be 18 or older.").max(MAX_AGE),
    gender: z.enum(["Woman", "Man"]),
    style: z.enum(STYLES),
    ethnicity: z.enum(ETHNICITIES),
    body: z.union([z.enum(GIRL_BODIES), z.enum(GUY_BODIES)]),
    hair: z.enum(HAIR_COLORS),
    hairStyle: z.enum(HAIR_STYLES),
    eyeColor: z.enum(EYE_COLORS),
    breast: z.enum(BREASTS).optional(),
    // Free text here was a way to describe a minor to the chat model.
    role: z.enum(ROLES),
    personality: z.enum(PERSONALITIES),
    occupation: z.enum(JOBS),
    kinks: z.array(z.enum(KINKS)).max(3).default([]),
    voice: z.enum(VOICES.map((voice) => voice.label) as [string, ...string[]]).optional(),
    imageMediaId: z.uuid(),
  })
  .superRefine((input, ctx) => {
    if (!oneOf(input.gender === "Woman" ? GIRL_BODIES : GUY_BODIES, input.body)) {
      ctx.addIssue({ code: "custom", path: ["body"], message: "Pick a body type from the list." });
    }
    if (input.gender === "Woman" && !input.breast) {
      ctx.addIssue({ code: "custom", path: ["breast"], message: "Pick a bust size." });
    }
  });

export type CreateCharacterInput = z.infer<typeof createCharacterInput>;

export async function createCharacter(user: User, input: CreateCharacterInput) {
  const database = await db();
  // Labelled so the classifier reads each persona field in context with the look.
  const text = [
    // The period ends the name as a sentence, so "Yuki seventeen" reads as a stated age.
    `Name: ${asName(input.name)}.`,
    `Personality: ${input.personality}`,
    `Occupation: ${input.occupation}`,
    `Relationship: ${input.role}`,
    `Kinks: ${input.kinks.join(", ")}`,
    `Voice: ${input.voice ?? ""}`,
    `Look: ${[input.ethnicity, input.body, input.hair, input.hairStyle, input.eyeColor, input.breast ?? ""].join(", ")}`,
  ].join("\n");
  const verdict = await moderateText(text, { userId: user.id, targetType: "character" }, { failClosed: true });
  if (!verdict.ok) throw refusal(verdict);

  const [portrait] = await database
    .select()
    .from(media)
    .where(and(eq(media.id, input.imageMediaId), eq(media.userId, user.id), eq(media.purpose, "portrait")))
    .limit(1);
  if (!portrait || portrait.status !== "ready") {
    throw new HttpError(422, "Generate a portrait first.", "portrait_missing");
  }
  // A character's regular portrait is shown without the explicit check (it's
  // the art everyone else sees), so a nude portrait can never become one.
  if (isExplicitArt(portrait)) {
    throw new HttpError(422, "Pick the regular portrait for the character's face.", "portrait_explicit");
  }

  const lane = input.style === "anime" ? "anime" : input.gender === "Man" ? "guys" : "girls";
  const id = crypto.randomUUID();
  const kinks = input.kinks.length ? input.kinks.join(", ").toLowerCase() : "being direct";
  const [row] = await database
    .insert(characters)
    .values({
      id,
      ownerId: user.id,
      name: input.name,
      age: input.age,
      gender: input.gender,
      ethnicity: input.ethnicity,
      body: input.body,
      role: input.role,
      heat: input.personality,
      line: `${input.name} is ${input.personality.toLowerCase()}, works as a ${input.occupation.toLowerCase()}, and likes ${kinks}.`,
      lane,
      style: input.style,
      tags: [input.body, input.personality, input.hair, input.hairStyle, input.eyeColor],
      imageMediaId: portrait.id,
      imageUrl: `/api/media/${portrait.id}`,
      hair: input.hair,
      hairStyle: input.hairStyle,
      eyeColor: input.eyeColor,
      breast: input.gender === "Woman" ? (input.breast ?? null) : null,
      personality: input.personality,
      occupation: input.occupation,
      kinks: input.kinks,
      voice: input.voice ?? null,
    })
    .returning();
  await database.update(media).set({ characterId: id }).where(eq(media.id, portrait.id));
  return row;
}

export async function deleteCharacter(user: User, id: string) {
  const database = await db();
  const [row] = await database
    .update(characters)
    .set({ deletedAt: new Date() })
    .where(and(eq(characters.id, id), eq(characters.ownerId, user.id), isNull(characters.deletedAt)))
    .returning({ id: characters.id });
  if (!row) throw notFound();
}

// ---------------------------------------------------------------------------
// Nude art: one fictional adult character, alone, drawn from the stored look.

// Media made for explicit viewers only. Set on every nude portrait (and on chat
// photos drawn for a viewer allowed explicit content), in the moderation record.
export function isExplicitArt(row: Pick<Media, "moderation">) {
  return (row.moderation as { explicit?: unknown } | null)?.explicit === true;
}

type ArtFile = Pick<Media, "kind" | "status" | "storageKey" | "characterId" | "userId">;

// Whether a character's nude-art file can be shown: an image, still ready (a
// failed, blocked or taken-down row never is), with a file, and made for this
// character by its owner (null for official characters). The listings and the
// file route use the same test, so a card never points at art the route won't
// serve.
function servableArt(file: ArtFile, character: CharacterRow) {
  return (
    file.kind === "image" &&
    file.status === "ready" &&
    Boolean(file.storageKey) &&
    file.characterId === character.id &&
    file.userId === character.ownerId
  );
}

// The ids of the characters among these whose nude art is servable right now.
async function liveExplicitArt(rows: CharacterRow[]): Promise<Set<string>> {
  const linked = rows.filter((row) => row.explicitImageMediaId && row.explicitImageUrl);
  if (!linked.length) return new Set();
  const database = await db();
  const files = await database
    .select({
      id: media.id,
      kind: media.kind,
      status: media.status,
      storageKey: media.storageKey,
      characterId: media.characterId,
      userId: media.userId,
    })
    .from(media)
    .where(inArray(media.id, linked.map((row) => row.explicitImageMediaId!)));
  const byId = new Map(files.map((file) => [file.id, file]));
  return new Set(
    linked
      .filter((row) => {
        const file = byId.get(row.explicitImageMediaId!);
        return file !== undefined && servableArt(file, row);
      })
      .map((row) => row.id),
  );
}

// The nude portrait's file, if this viewer may see it: explicit content allowed,
// the character visible to them (an official one or their own) and its art
// servable. Anything else is null, which the route answers with a plain 404.
export async function explicitArtFor(viewer: User | null, id: string): Promise<Media | null> {
  if (!viewer || !explicitAllowed(viewer) || id.length > 64) return null;
  const character = await findCharacterFor(viewer.id, id);
  if (!character?.explicitImageMediaId || !character.explicitImageUrl) return null;
  const row = await getMedia(character.explicitImageMediaId);
  if (!row || !servableArt(row, character)) return null;
  return row;
}

// What an image prompt needs to know about a character. Only values from the
// creator's lists reach the prompt (appearanceText drops anything else).
export function imageSubjectOf(character: CharacterRow): ImageSubject {
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

// Fixed scenes, so no free text reaches a nude portrait's prompt. One person,
// a private adult setting, a portrait framing that fills a 3:4 card.
export const EXPLICIT_PORTRAIT_SCENES = [
  "nude, lying back on white linen sheets in soft morning light, one arm resting above the head, looking into the camera with a slow inviting smile",
  "nude, standing by a tall window at dusk, warm golden light across bare skin, glancing back over one shoulder at the camera",
  "nude, sitting on the edge of a velvet armchair in a dim hotel suite, candlelight, a confident half smile at the camera",
  "nude, stepping out of a steamy shower, water on bare skin, soft bathroom light, looking straight at the camera",
] as const;

// The nude portrait's prompt: the character's own look, adult anchors first and
// the minor and other-people negatives, from the same builder as every chat
// photo, so the portrait shows the character alone.
export function explicitPortraitPrompt(character: CharacterRow, scene: number): ImagePrompt {
  const where = EXPLICIT_PORTRAIT_SCENES[Math.abs(Math.trunc(scene)) % EXPLICIT_PORTRAIT_SCENES.length];
  return buildImagePrompt({ subject: imageSubjectOf(character), scene: where, explicit: true });
}

// The name and look are screened before anything is drawn. Every value comes
// from a list, so this only trips on an old row or a hand edit; it's logged
// like the photo route's check.
export async function screenLook(character: CharacterRow, userId: string | null) {
  const verdict = checkText(`${character.name}. ${appearanceText(imageSubjectOf(character))}`);
  if (verdict.ok) return;
  await logModeration({ userId, targetType: "character", targetId: character.id }, verdict.category, "blocked", {
    matched: verdict.matched,
  });
  throw new HttpError(422, REFUSAL[verdict.category], `blocked_${verdict.category}`);
}

export type ExplicitPortraitOutcome =
  | { ok: true; media: Media; character: CharacterRow }
  | {
      ok: false;
      reason: "worker_blocked" | "generation_failed" | "moderation_unavailable" | "image_blocked" | "save_failed" | "character_gone";
    };

// Draws, checks and stores a nude portrait into a pending media row the caller
// made (and charged for), then points the character at it. A failure marks the
// row failed or blocked and says why; giving credits back is the caller's job.
// Image moderation runs with allowExplicit: nudity passes, and everything else
// on the block list (minors, real people, gore) still blocks.
export async function drawExplicitPortrait(
  character: CharacterRow,
  row: Media,
  { prompt, negativePrompt }: ImagePrompt,
): Promise<ExplicitPortraitOutcome> {
  const userId = row.userId;
  let image;
  try {
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
    console.error("Nude portrait generation failed", error);
    const blocked = error instanceof ImageGenerationError && error.blocked;
    if (blocked) {
      const reason = (error as ImageGenerationError).reason ?? "";
      await logModeration({ userId, targetType: "image", targetId: row.id }, workerRefusalCategory(reason), "blocked", {
        reason: (reason || String((error as Error).message)).slice(0, 300),
      });
    }
    await failMedia(row.id, blocked ? "blocked" : "failed", blocked ? "Blocked by the image worker." : "Generation failed.");
    return { ok: false, reason: blocked ? "worker_blocked" : "generation_failed" };
  }

  const moderation = await moderateImage(image.bytes, image.mimeType, {
    userId,
    targetType: "image",
    targetId: row.id,
    allowExplicit: true,
  });
  if (!moderation.ok) {
    await failMedia(
      row.id,
      moderation.unavailable ? "failed" : "blocked",
      moderation.unavailable ? "Safety check unavailable." : `Blocked: ${moderation.categories.join(", ")}`,
      { provider: image.provider, categories: moderation.categories, result: moderation.raw },
    );
    return { ok: false, reason: moderation.unavailable ? "moderation_unavailable" : "image_blocked" };
  }

  let stored: Media;
  try {
    stored = await storeMedia(row, image.bytes, image.mimeType, {
      provider: image.provider,
      seed: image.seed,
      style: character.style,
      explicit: true,
      categories: [],
      result: moderation.raw,
    });
    if (stored.status !== "ready") throw new Error(`Nude portrait ${row.id} is ${stored.status}, not ready.`);
  } catch (error) {
    console.error("Saving the nude portrait failed", error);
    await failMedia(row.id, "failed", "The portrait couldn't be saved.");
    return { ok: false, reason: "save_failed" };
  }

  const database = await db();
  const [updated] = await database
    .update(characters)
    .set({ explicitImageMediaId: stored.id, explicitImageUrl: explicitImagePath(character.id) })
    .where(
      and(
        eq(characters.id, character.id),
        isNull(characters.deletedAt),
        character.ownerId ? eq(characters.ownerId, character.ownerId) : isNull(characters.ownerId),
      ),
    )
    .returning();
  if (!updated) {
    // Deleted while it was drawn: nothing points at the file, so it's let go.
    await failMedia(stored.id, "failed", "The character was deleted.");
    return { ok: false, reason: "character_gone" };
  }
  return { ok: true, media: stored, character: updated };
}
