// Deploy step: apply SQL migrations in ./drizzle to DATABASE_URL, then seed the
// official characters. Run with: npm run db:migrate
// No top-level await: tsx compiles this as CommonJS (package.json has no "type").
import path from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "../src/server/db/schema";
import { seedCharacters } from "../src/server/db/seed";
import type { Db } from "../src/server/db";

async function main(url: string) {
  const client = postgres(url, { prepare: false, max: 1 });
  try {
    const database = drizzle(client, { schema });
    await migrate(database, { migrationsFolder: path.join(process.cwd(), "drizzle") });
    await seedCharacters(database as unknown as Db);
  } finally {
    await client.end();
  }
  console.log("Migrated and seeded.");
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Local dev uses embedded PGlite and migrates itself on boot.");
  process.exit(1);
}

main(url).catch((error) => {
  console.error(error);
  process.exit(1);
});
