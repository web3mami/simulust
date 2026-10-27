import "server-only";
import { and, asc, desc, eq, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { characters, media, type CharacterRow, type User } from "@/server/db/schema";
import { HttpError, notFound } from "@/server/http";
import { moderateText, refusal } from "@/server/safety/moderation";
import { asName } from "@/server/safety/text";
import type { Character } from "@/lib/characters";
import {
  BREASTS,
  ETHNICITIES,
  EYE_COLORS,
  GIRL_BODIES,
  GUY_BODIES,
  HAIR_COLORS,
  HAIR_STYLES,
  JOBS,
  KINKS,
  MAX_AGE,
  MIN_AGE,
  oneOf,
  PERSONALITIES,
  ROLES,
  STYLES,
} from "@/lib/portrait-prompt";
import { VOICES } from "@/server/tts";

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
  };
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

// A given name: one to three words of letters (any script) with apostrophes,
// hyphens or periods inside, like "Zoë", "D'Angelo", "Mary-Jane" or "J. Park".
// No digits, brackets or commas, so "Yuki (17)" or "Yuki, 17" can't put an age
// in the chat prompt; minor-coded words are the classifier's to catch.
const GIVEN_NAME = /^\p{L}[\p{L}\p{M}'’.-]*(?: \p{L}[\p{L}\p{M}'’.-]*){0,2}$/u;

const givenName = z
  .string()
  .trim()
  .transform((value) => value.replace(/\s+/g, " "))
  .pipe(
    z
      .string()
      .min(1, "Add a name.")
      .max(30, "Keep the name to 30 characters or fewer.")
      .regex(GIVEN_NAME, "Use a first name, or first and last: letters only, up to three words."),
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
