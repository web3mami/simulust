import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { CharacterRow } from "@/server/db/schema";
import { EXPLICIT_PORTRAIT_SCENES, explicitImagePath, explicitPortraitPrompt, isExplicitArt } from "@/server/characters";
import { checkImagePrompt } from "@/server/safety/text";
import { OTHER_PEOPLE_NEGATIVE } from "@/lib/portrait-prompt";

// The nude portrait's prompt has no free text: a fixed scene and the stored look.
const row = (overrides: Partial<CharacterRow>): CharacterRow =>
  ({
    id: "c",
    ownerId: null,
    name: "Ren",
    age: 26,
    gender: "Woman",
    ethnicity: "East Asian",
    body: "Petite",
    role: "Girlfriend",
    heat: "Bold",
    line: "",
    color: "#000",
    lane: "anime",
    style: "anime",
    tags: [],
    imageUrl: null,
    imageMediaId: null,
    explicitImageUrl: null,
    explicitImageMediaId: null,
    hair: null,
    hairStyle: null,
    eyeColor: null,
    breast: null,
    personality: null,
    occupation: null,
    kinks: [],
    voice: null,
    loraId: null,
    createdAt: new Date(),
    deletedAt: null,
    ...overrides,
  }) as CharacterRow;

describe("nude portrait prompts", () => {
  it("use only scenes that pass the image prompt screen", () => {
    for (const scene of EXPLICIT_PORTRAIT_SCENES) {
      expect(checkImagePrompt(scene), scene).toEqual({ ok: true });
      expect(scene).toMatch(/^nude, /);
    }
  });

  it("anchor an anime character as a grown adult, alone", () => {
    const { prompt, negativePrompt } = explicitPortraitPrompt(row({ age: 21 }), 0);
    expect(prompt).toMatch(/^1girl, solo, explicit, adult anime character/);
    // Petite anime figures get the stronger anchors and an older stated age.
    expect(prompt).toContain("adult woman, 25-year-old");
    expect(prompt).not.toContain("21-year-old");
    expect(prompt).toContain("clearly adult body");
    for (const never of ["loli", "shota", "child", "teen", "underage", "childlike proportions", "huge eyes"]) {
      expect(negativePrompt).toContain(never);
    }
  });

  it("draw a realistic man as one adult in frame", () => {
    const { prompt, negativePrompt } = explicitPortraitPrompt(
      row({ name: "Andre", age: 34, gender: "Man", style: "realistic", body: "Muscular", ethnicity: "Black" }),
      3,
    );
    expect(prompt).toContain("adult, 34-year-old man");
    expect(prompt).toContain("only one person in frame");
    expect(prompt).toContain(EXPLICIT_PORTRAIT_SCENES[3]);
    expect(negativePrompt).toContain("real person likeness");
  });

  it("keep anyone else out of the frame", () => {
    for (const gender of ["Woman", "Man"]) {
      for (const style of ["anime", "realistic"] as const) {
        const { prompt, negativePrompt } = explicitPortraitPrompt(row({ gender, style }), 2);
        expect(prompt).toMatch(/\bsolo\b|only one person in frame/);
        for (const term of OTHER_PEOPLE_NEGATIVE) expect(negativePrompt, term).toContain(term);
        // The worker refuses a negative prompt that names an adult.
        expect(negativePrompt).not.toMatch(/\b(?:woman|women|man|men|adult|mature|lady|ladies)\b/);
      }
    }
  });

  it("keep free text in the stored look out of the prompt", () => {
    const { prompt } = explicitPortraitPrompt(row({ body: "tiny childish frame", hair: "pigtails", ethnicity: "schoolgirl" }), 1);
    expect(prompt).not.toMatch(/childish|pigtails|schoolgirl/);
  });

  it("wrap any scene index onto the fixed list", () => {
    expect(explicitPortraitPrompt(row({}), 7).prompt).toContain(EXPLICIT_PORTRAIT_SCENES[3]);
    expect(explicitPortraitPrompt(row({}), -1).prompt).toContain(EXPLICIT_PORTRAIT_SCENES[1]);
  });
});

describe("explicit art helpers", () => {
  it("serve nude art only from the checked route", () => {
    expect(explicitImagePath("mira")).toBe("/api/characters/mira/explicit-image");
  });

  it("tell explicit media by its moderation record", () => {
    expect(isExplicitArt({ moderation: { explicit: true } })).toBe(true);
    expect(isExplicitArt({ moderation: { explicit: false } })).toBe(false);
    expect(isExplicitArt({ moderation: null })).toBe(false);
  });
});

// scripts/generate-explicit-art.ts runs on import, so it's run as a process.
// Every run here is refused (or a dry run on an in-memory database) before it
// could draw or store anything.
describe("the explicit art script", () => {
  const PIPELINE = {
    IMAGE_PROVIDER: "worker",
    IMAGE_API_URL: "http://worker.test",
    IMAGE_API_KEY: "worker-key",
    HIVE_API_KEY: "hive-visual",
    HIVE_DEMOGRAPHIC_API_KEY: "hive-age",
    HIVE_CELEBRITY_API_KEY: "hive-celebrity",
    S3_BUCKET: "art",
    S3_ACCESS_KEY_ID: "id",
    S3_SECRET_ACCESS_KEY: "secret",
  };
  const REAL_DB = "postgres://nobody@127.0.0.1:9/simulust";

  function run(env: Record<string, string>, args: string[] = ["--dry-run"]) {
    const base = Object.fromEntries(
      Object.entries(process.env).filter(([name]) => !/^(DATABASE_URL|IMAGE_|HIVE_|S3_|NODE_ENV$)/.test(name)),
    );
    const result = spawnSync(
      path.resolve("node_modules/.bin/tsx"),
      ["--conditions=react-server", "scripts/generate-explicit-art.ts", ...args],
      { env: { ...base, PGLITE_DIR: "memory://", ...env } as Record<string, string> as NodeJS.ProcessEnv, encoding: "utf8", timeout: 60_000 },
    );
    return { status: result.status, output: `${result.stdout}${result.stderr}` };
  }

  it("refuses the mock provider against a real database, whatever NODE_ENV says", () => {
    for (const nodeEnv of [{}, { NODE_ENV: "development" }] as Record<string, string>[]) {
      const { status, output } = run({ DATABASE_URL: REAL_DB, IMAGE_PROVIDER: "mock", ...nodeEnv });
      expect(status).toBe(1);
      expect(output).toContain("DATABASE_URL is set");
      for (const name of ["IMAGE_PROVIDER=worker", "IMAGE_API_URL", "HIVE_API_KEY", "HIVE_DEMOGRAPHIC_API_KEY", "HIVE_CELEBRITY_API_KEY", "S3_BUCKET"]) {
        expect(output, name).toContain(name);
      }
    }
  }, 60_000);

  it("needs every Hive key and the bucket with a real database, even with the worker", () => {
    for (const name of ["HIVE_DEMOGRAPHIC_API_KEY", "HIVE_CELEBRITY_API_KEY", "S3_SECRET_ACCESS_KEY"]) {
      const { status, output } = run({ DATABASE_URL: REAL_DB, ...PIPELINE, [name]: "" });
      expect(status, name).toBe(1);
      expect(output, name).toContain(name.startsWith("S3_") ? "S3_BUCKET / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY" : name);
    }
  }, 60_000);

  it("never uses pollinations, and won't mix --pglite with a real database", () => {
    const pollinations = run({ DATABASE_URL: REAL_DB, ...PIPELINE, IMAGE_PROVIDER: "pollinations" });
    expect(pollinations.status).toBe(1);
    expect(pollinations.output).toContain("pollinations");
    const mixed = run({ DATABASE_URL: REAL_DB, ...PIPELINE }, ["--dry-run", "--pglite"]);
    expect(mixed.status).toBe(1);
    expect(mixed.output).toContain("--pglite");
    const local = run({ IMAGE_PROVIDER: "mock" });
    expect(local.status).toBe(1);
    expect(local.output).toContain("pass --pglite");
  }, 60_000);

  it("allows the mock only on the embedded database with --pglite", () => {
    const { status, output } = run({ IMAGE_PROVIDER: "mock" }, ["--dry-run", "--pglite", "--limit", "1"]);
    expect(status, output).toBe(0);
    expect(output).toContain("prompt: ");
    expect(output).toContain("nude, ");
  }, 60_000);
});
