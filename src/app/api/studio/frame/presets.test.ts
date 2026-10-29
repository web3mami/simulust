import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { CharacterRow } from "@/server/db/schema";
import { checkImagePrompt, checkText } from "@/server/safety/text";
import { OTHER_PEOPLE_NEGATIVE, studioFrameInput, studioFramePrompt, studioScene } from "@/server/studio";
import { videoPrompt } from "@/server/video";
import { SEED_CHARACTERS } from "@/lib/characters";
import {
  showsNudity,
  STUDIO_ACTIONS,
  STUDIO_OUTFITS,
  STUDIO_SETTINGS,
  studioMotion,
  studioPerson,
  type StudioActionId,
  type StudioOutfitId,
  type StudioSettingId,
} from "@/lib/studio";
import { hasPython } from "@/test/python";

// Every scene the studio can build, so a preset that trips the image screen
// (here or on the worker) fails before it ships.

function character(overrides: Partial<CharacterRow>): CharacterRow {
  return {
    id: "test",
    ownerId: null,
    name: "Mira",
    age: 27,
    gender: "Woman",
    ethnicity: "Latina",
    body: "Curvy",
    role: "Girlfriend",
    heat: "Warm",
    line: "Hi.",
    color: "#333",
    lane: "girls",
    style: "realistic",
    tags: [],
    imageUrl: null,
    imageMediaId: null,
    explicitImageUrl: null,
    explicitImageMediaId: null,
    hair: "Brunette",
    hairStyle: "Wavy",
    eyeColor: "Brown",
    breast: "Medium",
    personality: null,
    occupation: null,
    kinks: [],
    voice: null,
    loraId: null,
    createdAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

const PEOPLE = [
  character({}),
  character({ name: "Kai", gender: "Man", body: "Athletic", breast: null, lane: "guys" }),
  character({ name: "Aiko", age: 21, style: "anime", ethnicity: "Asian", body: "Petite", breast: "Small", lane: "anime" }),
  character({ name: "Rowan", gender: "Non-binary", body: "Slim", breast: null }),
];

function combos() {
  const all: { setting: StudioSettingId; outfit: StudioOutfitId; action: StudioActionId }[] = [];
  for (const setting of STUDIO_SETTINGS) {
    for (const outfit of STUDIO_OUTFITS) {
      for (const action of STUDIO_ACTIONS) all.push({ setting: setting.id, outfit: outfit.id, action: action.id });
    }
  }
  return all;
}

describe("studio presets", () => {
  it("have unique ids and short labels", () => {
    for (const list of [STUDIO_SETTINGS, STUDIO_OUTFITS, STUDIO_ACTIONS]) {
      const ids = list.map((option) => option.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const option of list) expect(option.label.length).toBeLessThanOrEqual(20);
    }
  });

  it("pass the text and image screens one fragment at a time", () => {
    const fragments = [
      ...STUDIO_SETTINGS.flatMap((option) => [option.label, option.blurb, option.prompt]),
      ...STUDIO_OUTFITS.flatMap((option) => [option.label, option.blurb, ...Object.values(option.prompt)]),
      ...STUDIO_ACTIONS.flatMap((option) => [option.label, option.blurb, option.pose, option.motion]),
    ];
    for (const fragment of fragments) {
      expect(checkText(fragment), fragment).toEqual({ ok: true });
      expect(checkImagePrompt(fragment), fragment).toEqual({ ok: true });
    }
  });

  it("build scenes that pass the image screen for every character type", () => {
    for (const person of PEOPLE) {
      for (const choice of combos()) {
        const scene = studioScene(person, choice);
        expect(checkImagePrompt(scene), scene).toEqual({ ok: true });
        expect(scene.startsWith("alone, the only person in the scene")).toBe(true);
      }
    }
  });

  it("dress each character for who they are", () => {
    const lingerie = { setting: "bedroom", outfit: "lingerie", action: "tease" } as const;
    expect(studioScene(PEOPLE[0], lingerie)).toContain("lace lingerie");
    expect(studioScene(PEOPLE[1], lingerie)).toContain("boxer briefs");
    expect(studioPerson("Non-binary")).toBe("person");
  });

  it("keep adult anchors first and other people out", () => {
    for (const person of PEOPLE) {
      for (const explicit of [false, true]) {
        const { prompt, negativePrompt } = studioFramePrompt(person, { setting: "pool", outfit: "swimwear", action: "walk" }, explicit);
        expect(prompt).toMatch(/adult/);
        expect(prompt).toContain("alone");
        expect(negativePrompt).toMatch(/child, teen, underage/);
        for (const term of OTHER_PEOPLE_NEGATIVE) expect(negativePrompt).toContain(term);
        expect(negativePrompt.includes("nude")).toBe(!explicit);
      }
    }
    // Anime prompts carry the "solo" tag and the stronger anchors for a petite figure.
    const anime = studioFramePrompt(PEOPLE[2], { setting: "beach", outfit: "dressed", action: "glance" }, false).prompt;
    expect(anime).toMatch(/^1girl, solo/);
    expect(anime).toContain("25-year-old");
  });

  it("send motions the animate route accepts", () => {
    for (const action of STUDIO_ACTIONS) {
      const motion = studioMotion(action.id);
      // POST /api/media/[id]/animate takes up to 300 characters.
      expect(motion.length).toBeLessThanOrEqual(300);
      expect(motion.endsWith("alone")).toBe(true);
      expect(checkImagePrompt(motion), motion).toEqual({ ok: true });
      expect(checkImagePrompt(videoPrompt(motion).prompt)).toEqual({ ok: true });
    }
  });

  it("mark what shows nudity", () => {
    expect(STUDIO_OUTFITS.filter((outfit) => "nudity" in outfit && outfit.nudity).map((outfit) => outfit.id)).toEqual([
      "topless",
      "nude",
    ]);
    expect(STUDIO_ACTIONS.filter((action) => "nudity" in action && action.nudity).map((action) => action.id)).toEqual(["undress"]);
    expect(showsNudity({ outfit: "nude", action: "tease" })).toBe(true);
    expect(showsNudity({ outfit: "lingerie", action: "undress" })).toBe(true);
    expect(showsNudity({ outfit: "lingerie", action: "tease" })).toBe(false);
    expect(showsNudity({ outfit: "swimwear", action: "water" })).toBe(false);
  });

  it("validate input against the presets only", () => {
    const ok = studioFrameInput.parse({ characterId: "mira", setting: "hotel", outfit: "dressed", action: "kiss", details: "  " });
    expect(ok.details).toBeUndefined();
    expect(studioFrameInput.safeParse({ characterId: "mira", setting: "hotel", outfit: "dressed", action: "kiss", details: "x".repeat(200) }).success).toBe(true);
    expect(studioFrameInput.safeParse({ characterId: "mira", setting: "hotel", outfit: "dressed", action: "kiss", details: "x".repeat(201) }).success).toBe(false);
    expect(studioFrameInput.safeParse({ characterId: "mira", setting: "Hotel", outfit: "dressed", action: "kiss" }).success).toBe(false);
  });

  it("work for every official character", () => {
    for (const seed of SEED_CHARACTERS) {
      const person = character({ name: seed.name, age: seed.age, gender: seed.gender, body: seed.body, ethnicity: seed.ethnicity, style: seed.lane === "anime" ? "anime" : "realistic" });
      const scene = studioScene(person, { setting: "hotel", outfit: "nude", action: "caress" });
      expect(checkImagePrompt(scene), `${seed.id}: ${scene}`).toEqual({ ok: true });
    }
  });
});

// One person per scene (bringsOthers) is tested in src/server/studio.test.ts.

// The worker screens every prompt itself (workers/media/safety.py) and refuses
// negative prompts that name an adult; studio prompts must pass both.
const python = hasPython();
const WORKER_SCREEN = String.raw`
import importlib.util, json, sys, types
for name in ("numpy", "PIL", "PIL.Image"):
    sys.modules.setdefault(name, types.ModuleType(name))
sys.modules["PIL"].Image = sys.modules["PIL.Image"]
sys.modules["PIL.Image"].Image = object
sys.modules["numpy"].ndarray = object
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("worker_safety", sys.argv[1])
safety = importlib.util.module_from_spec(spec)
spec.loader.exec_module(safety)
items = json.loads(sys.stdin.read())
print(json.dumps([safety.screen_prompt(item["prompt"]) or safety.screen_negative(item["negative"]) for item in items]))
`;

describe.skipIf(!python)("studio prompts on the worker's screen", () => {
  // The worker's screen takes about a tenth of a second a prompt, so this runs
  // every setting, outfit and motion at least once per person (rather than every
  // combination), explicit or not.
  it("are accepted", { timeout: 120_000 }, () => {
    const rows = Math.max(STUDIO_SETTINGS.length, STUDIO_OUTFITS.length, STUDIO_ACTIONS.length);
    const items = PEOPLE.flatMap((person) =>
      Array.from({ length: rows }, (_, index) => ({
        setting: STUDIO_SETTINGS[index % STUDIO_SETTINGS.length].id,
        outfit: STUDIO_OUTFITS[index % STUDIO_OUTFITS.length].id,
        action: STUDIO_ACTIONS[index % STUDIO_ACTIONS.length].id,
      })).flatMap((choice) =>
        [false, true].map((explicit) => {
          const built = studioFramePrompt(person, choice, explicit);
          return { prompt: built.prompt, negative: built.negativePrompt };
        }),
      ),
    );
    for (const action of STUDIO_ACTIONS) {
      const motion = videoPrompt(studioMotion(action.id));
      items.push({ prompt: motion.prompt, negative: motion.negativePrompt });
    }
    const result = spawnSync("python3", ["-I", "-c", WORKER_SCREEN, path.resolve("workers/media/safety.py")], {
      input: JSON.stringify(items),
      encoding: "utf8",
      timeout: 110_000,
    });
    if (result.status !== 0) throw new Error(result.stderr);
    const refusals = (JSON.parse(result.stdout) as (string | null)[])
      .map((reason, index) => (reason ? `${reason}: ${items[index].prompt}` : null))
      .filter(Boolean);
    expect(refusals).toEqual([]);
  });
});
