import { sql } from "drizzle-orm";
import type { Db } from "@/server/db";
import { characters } from "@/server/db/schema";
import { SEED_CHARACTERS } from "@/lib/characters";

// Official characters live in the database so chats, memories and media can
// reference them. Re-running is safe: existing rows are updated in place.
export async function seedCharacters(database: Db) {
  const rows = SEED_CHARACTERS.map((person) => ({
    id: person.id,
    ownerId: null,
    name: person.name,
    age: Math.max(18, person.age),
    gender: person.gender,
    ethnicity: person.ethnicity,
    body: person.body,
    role: person.role,
    heat: person.heat,
    line: person.line,
    color: person.color,
    lane: person.lane,
    style: person.lane === "anime" ? ("anime" as const) : ("realistic" as const),
    tags: person.tags ?? [],
    imageUrl: person.image ?? null,
    hair: person.hair ?? null,
    hairStyle: person.hairStyle ?? null,
    eyeColor: person.eyeColor ?? null,
    breast: person.breast ?? null,
    personality: person.personality ?? null,
    occupation: person.occupation ?? null,
    kinks: person.kinks ?? [],
    voice: person.voice ?? null,
  }));
  if (!rows.length) return;
  await database
    .insert(characters)
    .values(rows)
    .onConflictDoUpdate({
      target: characters.id,
      set: {
        name: sql`excluded.name`,
        age: sql`excluded.age`,
        gender: sql`excluded.gender`,
        ethnicity: sql`excluded.ethnicity`,
        body: sql`excluded.body`,
        role: sql`excluded.role`,
        heat: sql`excluded.heat`,
        line: sql`excluded.line`,
        color: sql`excluded.color`,
        lane: sql`excluded.lane`,
        style: sql`excluded.style`,
        tags: sql`excluded.tags`,
        imageUrl: sql`excluded.image_url`,
      },
    });
}
