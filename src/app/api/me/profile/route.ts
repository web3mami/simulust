import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { profiles, users } from "@/server/db/schema";
import { HttpError, readJson, route } from "@/server/http";
import { rateLimit } from "@/server/ratelimit";
import { moderateText, refusal, type ModerationVerdict } from "@/server/safety/moderation";
import { asName, type TextVerdict } from "@/server/safety/text";

// No profile photos: we don't accept uploads of real faces, so the profile
// shows an initial instead. profiles.photo_media_id stays unused.

const GENDERS = ["Woman", "Man", "Non-binary"] as const;
const LANES = ["Girls", "Anime", "Guys"] as const;

type ProfileDTO = {
  name: string;
  gender: (typeof GENDERS)[number];
  looking: (typeof LANES)[number][];
  bio: string;
  updatedAt: string;
};

function toProfileDTO(row: typeof profiles.$inferSelect): ProfileDTO {
  return {
    name: row.name,
    gender: GENDERS.find((gender) => gender === row.gender) ?? "Woman",
    looking: LANES.filter((lane) => row.looking.includes(lane)),
    bio: row.bio,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const GET = route(async (request: Request) => {
  const user = await requireUser(request);
  const database = await db();
  const [row] = await database.select().from(profiles).where(eq(profiles.userId, user.id)).limit(1);
  return Response.json({ profile: row ? toProfileDTO(row) : null });
});

const profileInput = z.object({
  name: z.string().trim().min(1, "Add your name.").max(40, "Keep your name to 40 characters or fewer."),
  gender: z.enum(GENDERS, "Pick Woman, Man or Non-binary."),
  // Stored in a fixed order without duplicates, whatever order they were tapped in.
  looking: z
    .array(z.enum(LANES, "Pick from Girls, Anime or Guys."))
    .max(LANES.length)
    .default([])
    .transform((picked) => LANES.filter((lane) => picked.includes(lane))),
  bio: z.string().trim().max(500, "Keep your bio to 500 characters or fewer.").default(""),
});

type Blocked = Exclude<TextVerdict, { ok: true }>;

const BIO_REFUSAL: Record<Blocked["category"], string> = {
  minor: "Your bio can't mention minors or anyone under 18. Edit it and save again.",
  real_person: "Your bio can't name public figures or mention other people's photos. Edit it and save again.",
  prohibited: "Your bio includes something that isn't allowed here. Edit it and save again.",
};

export const PUT = route(async (request: Request) => {
  const user = await requireUser(request);
  await rateLimit(`profile:${user.id}`, 20, 60);
  const input = await readJson(request, profileInput);

  // Characters read the name and bio, so both are screened like anything else
  // that reaches a prompt.
  const context = { userId: user.id, targetType: "profile" as const, targetId: user.id };
  const [name, bio] = await Promise.all([
    moderateText(asName(input.name), context, { failClosed: true }),
    input.bio ? moderateText(input.bio, context, { failClosed: true }) : Promise.resolve<ModerationVerdict>({ ok: true }),
  ]);
  for (const verdict of [name, bio]) if (!verdict.ok && "unavailable" in verdict) throw refusal(verdict);
  if (!name.ok && "category" in name) throw new HttpError(422, "That name isn't allowed here. Pick a different one.", `blocked_${name.category}`);
  if (!bio.ok && "category" in bio) throw new HttpError(422, BIO_REFUSAL[bio.category], `blocked_${bio.category}`);

  const database = await db();
  const values = { name: input.name, gender: input.gender, looking: input.looking, bio: input.bio, updatedAt: new Date() };
  const row = await database.transaction(async (tx) => {
    const [saved] = await tx
      .insert(profiles)
      .values({ userId: user.id, ...values })
      .onConflictDoUpdate({ target: profiles.userId, set: values })
      .returning();
    // Keep the account name in step, since chat and the header use it.
    await tx.update(users).set({ displayName: input.name }).where(eq(users.id, user.id));
    return saved;
  });
  return Response.json({ profile: toProfileDTO(row) });
});
