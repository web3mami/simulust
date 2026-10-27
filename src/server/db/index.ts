import "server-only";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { drizzle as drizzlePostgres, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { env } from "@/server/env";
import * as schema from "@/server/db/schema";

export type Db = PostgresJsDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const MIGRATIONS = path.join(process.cwd(), "drizzle");

type Holder = { promise?: Promise<Db> };
const holder = ((globalThis as { __simulustDb?: Holder }).__simulustDb ??= {});

// Production uses Postgres (Supabase) through DATABASE_URL and runs migrations
// as a deploy step (npm run db:migrate). AUTO_MIGRATE=1 does the same on first
// connection instead, for hosts without a deploy step. Migrations take no lock,
// so prefer the deploy step when several instances can boot at once.
// Local development without DATABASE_URL uses an embedded Postgres (PGlite, with
// pgvector) that migrates and seeds itself.
export function db(): Promise<Db> {
  holder.promise ??= open().catch((error) => {
    holder.promise = undefined;
    throw error;
  });
  return holder.promise;
}

async function open(): Promise<Db> {
  if (env.databaseUrl) {
    const { default: postgres } = await import("postgres");
    // prepare: false keeps it compatible with Supabase's transaction pooler.
    const client = postgres(env.databaseUrl, { prepare: false, max: 10 });
    const database = drizzlePostgres(client, { schema });
    if (process.env.AUTO_MIGRATE === "1") {
      const { migrate } = await import("drizzle-orm/postgres-js/migrator");
      await migrate(database, { migrationsFolder: MIGRATIONS });
      await seed(database);
    }
    return database;
  }

  const { PGlite } = await import("@electric-sql/pglite");
  const { vector } = await import("@electric-sql/pglite-pgvector");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const inMemory = env.pgliteDir.startsWith("memory://");
  const dataDir = inMemory ? env.pgliteDir : path.resolve(env.pgliteDir);
  // PGlite creates its own directory but not missing parents (.data on a fresh clone).
  if (!inMemory) await mkdir(path.dirname(dataDir), { recursive: true });
  const client = new PGlite(dataDir, { extensions: { vector } });
  const database = drizzle(client, { schema });
  await migrate(database, { migrationsFolder: MIGRATIONS });
  const typed = database as unknown as Db;
  await seed(typed);
  return typed;
}

async function seed(database: Db) {
  const { seedCharacters } = await import("@/server/db/seed");
  await seedCharacters(database);
}
