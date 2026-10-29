// Draws nude art for the official characters that don't have it yet, through
// the same pipeline as the in-app nude portrait (src/server/characters.ts):
//   - one fictional adult, alone: the character's stored look in a fixed
//     sensual scene, built by buildImagePrompt({ explicit: true }) with its adult
//     anchors and minor negatives; no free text reaches the prompt;
//   - the name and look are screened first, the image worker runs its own
//     screens and tagger, and Hive image moderation (allowExplicit) checks the
//     result: anything blocked is dropped, never stored;
//   - a passing image is stored as a private media row (no owner, purpose
//     portrait) and the character points at it. It's served only through
//     /api/characters/<id>/explicit-image, which checks the viewer every time.
//     Nothing is written under /public.
//
// Usage:
//   npx tsx --conditions=react-server scripts/generate-explicit-art.ts [options]
//     --limit N        draw at most N characters this run
//     --character ID   only this character (repeat, or comma-separate, for more)
//     --redraw         also redraw characters that already have art
//     --dry-run        print the prompts, draw nothing
//     --pglite         allow the local embedded database (see below)
//
// Whenever DATABASE_URL is set, it's writing to a real database, so it needs
// the real pipeline with the app's own settings: IMAGE_PROVIDER=worker,
// IMAGE_API_URL and IMAGE_API_KEY (the GPU worker), HIVE_API_KEY,
// HIVE_DEMOGRAPHIC_API_KEY and HIVE_CELEBRITY_API_KEY (image moderation, apparent
// age, real people) and the S3_* bucket (S3_BUCKET, S3_ACCESS_KEY_ID,
// S3_SECRET_ACCESS_KEY). It refuses to run without every one of them. This
// doesn't go by NODE_ENV, which `npx tsx` never sets: a run against a real
// database is treated as production whatever it says.
//
// The mock image provider (placeholder art) is only allowed with --pglite: the
// embedded local database, used when DATABASE_URL isn't set. Only one process
// can open it at a time, so stop `next dev` first. Pollinations, a third party
// that ignores our safety prompts, is never allowed.
//
// Re-running is safe: characters that already have art are skipped, and one
// that fails a check is left without art for the next run.
// No top-level await: tsx compiles this as CommonJS (package.json has no "type").
import { and, asc, inArray, isNull } from "drizzle-orm";
import {
  drawExplicitPortrait,
  EXPLICIT_PORTRAIT_SCENES,
  explicitPortraitPrompt,
  screenLook,
} from "../src/server/characters";
import { db } from "../src/server/db";
import { characters } from "../src/server/db/schema";
import { env, features, isProduction } from "../src/server/env";
import { createMedia } from "../src/server/media";

type Options = { limit: number | null; ids: string[]; redraw: boolean; dryRun: boolean; pglite: boolean };

function parse(args: string[]): Options {
  const options: Options = { limit: null, ids: [], redraw: false, dryRun: false, pglite: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const value = () => {
      const next = args[++i];
      if (next === undefined || next.startsWith("--")) throw new Error(`${arg} needs a value.`);
      return next;
    };
    if (arg === "--limit") {
      const limit = Number(value());
      if (!Number.isInteger(limit) || limit < 1) throw new Error("--limit must be a whole number of 1 or more.");
      options.limit = limit;
    } else if (arg === "--character") {
      options.ids.push(...value().split(",").map((id) => id.trim()).filter(Boolean));
    } else if (arg === "--redraw") options.redraw = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--pglite") options.pglite = true;
    else throw new Error(`Unknown option ${arg}.`);
  }
  return options;
}

const setting = (name: string) => Boolean(process.env[name]?.trim());

// What a run against a real database is missing, by setting name. Each one
// stands between a prompt and a stored nude image: the worker's own screens,
// Hive's three checks (outside production the app lets an image through
// unmoderated when HIVE_API_KEY is missing, and skips the apparent-age and
// real-person checks without their keys), and private object storage.
function missingForRealDatabase(): string[] {
  const missing: string[] = [];
  if (env.imageProvider !== "worker") missing.push("IMAGE_PROVIDER=worker");
  if (!env.imageApiUrl) missing.push("IMAGE_API_URL");
  if (!env.imageApiKey) missing.push("IMAGE_API_KEY");
  for (const name of ["HIVE_API_KEY", "HIVE_DEMOGRAPHIC_API_KEY", "HIVE_CELEBRITY_API_KEY"]) {
    if (!setting(name)) missing.push(name);
  }
  if (!features.s3) missing.push("S3_BUCKET / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY");
  return missing;
}

// Why this can't run here, or null. Nude art is only drawn behind every check.
function refusal(options: Options): string | null {
  if (env.imageProvider === "pollinations") {
    return "IMAGE_PROVIDER=pollinations is a third party that ignores our safety prompts; use the worker (or mock with --pglite).";
  }
  if (env.databaseUrl) {
    if (options.pglite) return "--pglite is for the local embedded database, but DATABASE_URL is set. Unset it, or drop --pglite.";
    const missing = missingForRealDatabase();
    if (missing.length) {
      return `DATABASE_URL is set, so this needs the real image pipeline. Missing: ${missing.join(", ")}.`;
    }
    return null;
  }
  if (!options.pglite) {
    return "No DATABASE_URL: this would write to the local PGlite database. Stop `next dev`, then pass --pglite.";
  }
  if (isProduction) return "NODE_ENV=production needs a real database (DATABASE_URL), not --pglite.";
  return null;
}

// A steady scene per character, so a redraw keeps the same mood.
function sceneFor(id: string) {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % EXPLICIT_PORTRAIT_SCENES.length;
}

async function main(options: Options) {
  const database = await db();
  const rows = await database
    .select()
    .from(characters)
    .where(
      and(
        isNull(characters.ownerId),
        isNull(characters.deletedAt),
        options.redraw ? undefined : isNull(characters.explicitImageMediaId),
        options.ids.length ? inArray(characters.id, options.ids) : undefined,
      ),
    )
    .orderBy(asc(characters.createdAt), asc(characters.id))
    .limit(options.limit ?? 10_000);
  if (options.ids.length) {
    const found = new Set(rows.map((row) => row.id));
    const missing = options.ids.filter((id) => !found.has(id));
    if (missing.length) console.warn(`Skipped (not official, deleted, or already drawn): ${missing.join(", ")}`);
  }
  console.log(`${rows.length} character${rows.length === 1 ? "" : "s"} to draw with IMAGE_PROVIDER=${env.imageProvider}.`);

  const tally = { drawn: 0, refused: 0, failed: 0 };
  for (const character of rows) {
    try {
      await screenLook(character, null);
    } catch {
      console.warn(`${character.id}: the name or look failed the text screen; skipped and logged.`);
      tally.refused++;
      continue;
    }
    const prompt = explicitPortraitPrompt(character, sceneFor(character.id));
    if (options.dryRun) {
      console.log(`${character.id}:\n  prompt: ${prompt.prompt}\n  negative: ${prompt.negativePrompt}`);
      continue;
    }
    const row = await createMedia({
      userId: null,
      characterId: character.id,
      kind: "image",
      purpose: "portrait",
      prompt: prompt.prompt,
    });
    const outcome = await drawExplicitPortrait(character, row, prompt);
    if (outcome.ok) {
      tally.drawn++;
      console.log(`${character.id}: drawn (media ${outcome.media.id}).`);
    } else if (outcome.reason === "image_blocked" || outcome.reason === "worker_blocked") {
      tally.refused++;
      console.warn(`${character.id}: blocked by a safety check and not kept (${outcome.reason}).`);
    } else {
      tally.failed++;
      console.warn(`${character.id}: ${outcome.reason}; try again later.`);
    }
  }
  console.log(`Done: ${tally.drawn} drawn, ${tally.refused} refused, ${tally.failed} failed.`);
  return tally.failed > 0 ? 1 : 0;
}

let options: Options;
try {
  options = parse(process.argv.slice(2));
} catch (error) {
  console.error((error as Error).message);
  process.exit(2);
}
const refused = refusal(options);
if (refused) {
  console.error(refused);
  process.exit(1);
}
main(options)
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
