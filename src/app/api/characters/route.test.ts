import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CharacterDTO } from "@/lib/api-types";

// The moderation classifier is faked over fetch so the fail-closed path runs.
// Env is read at import, hence the late imports.
let mediaDir: string;
let classifier: "ALLOW" | "BLOCK:minor" | "down" = "ALLOW";
let screened: string[] = [];

const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  if (url === "http://classifier.test/v1/chat/completions") {
    const body = JSON.parse(String(init?.body)) as { messages: { role: string; content: string }[] };
    screened.push(body.messages.find((message) => message.role === "user")!.content);
    if (classifier === "down") return new Response("upstream error", { status: 502 });
    return Response.json({ choices: [{ message: { content: classifier } }] });
  }
  throw new Error(`Unexpected fetch ${url}`);
});

type Mod = {
  POST: (request: Request) => Promise<Response>;
  createCharacterInput: typeof import("@/server/characters").createCharacterInput;
  db: typeof import("@/server/db").db;
  schema: typeof import("@/server/db/schema");
  currentUser: typeof import("@/server/auth").currentUser;
  createMedia: typeof import("@/server/media").createMedia;
  storeMedia: typeof import("@/server/media").storeMedia;
};
let mod: Mod;

beforeAll(async () => {
  mediaDir = await mkdtemp(path.join(os.tmpdir(), "simulust-characters-"));
  vi.stubEnv("MEDIA_DIR", mediaDir);
  vi.stubEnv("MODERATION_BASE_URL", "http://classifier.test/v1");
  vi.stubEnv("MODERATION_API_KEY", "classifier-key");
  vi.stubEnv("MODERATION_MODEL", "safeguard");
  vi.stubGlobal("fetch", fetchMock);
  vi.resetModules();
  const [route, characters, database, schema, auth, media] = await Promise.all([
    import("./route"),
    import("@/server/characters"),
    import("@/server/db"),
    import("@/server/db/schema"),
    import("@/server/auth"),
    import("@/server/media"),
  ]);
  mod = {
    POST: route.POST,
    createCharacterInput: characters.createCharacterInput,
    db: database.db,
    schema,
    currentUser: auth.currentUser,
    createMedia: media.createMedia,
    storeMedia: media.storeMedia,
  };
});

afterAll(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await rm(mediaDir, { recursive: true, force: true });
});

beforeEach(() => {
  classifier = "ALLOW";
  screened = [];
});

async function userFor(handle: string) {
  return (await mod.currentUser(new Request("http://localhost", { headers: { "x-dev-user": handle } })))!;
}

async function portraitFor(handle: string) {
  const user = await userFor(handle);
  const row = await mod.createMedia({ userId: user.id, kind: "image", purpose: "portrait" });
  return (await mod.storeMedia(row, new Uint8Array(2000).fill(7), "image/png")).id;
}

function post(handle: string | null, body: unknown) {
  return mod.POST(
    new Request("http://localhost/api/characters", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(handle ? { "x-dev-user": handle } : {}) },
      body: JSON.stringify(body),
    }),
  );
}

const adult = {
  name: "Aya",
  age: 24,
  gender: "Woman",
  style: "anime",
  ethnicity: "Asian",
  body: "Petite",
  hair: "Black",
  hairStyle: "Ponytail",
  eyeColor: "Brown",
  breast: "Small",
  role: "Girlfriend",
  personality: "Playful",
  occupation: "Designer",
  kinks: ["Teasing"],
  voice: "Voice 2",
};

async function charactersOf(handle: string) {
  const { eq } = await import("drizzle-orm");
  const user = await userFor(handle);
  return (await mod.db()).select().from(mod.schema.characters).where(eq(mod.schema.characters.ownerId, user.id));
}

describe("POST /api/characters", () => {
  it("asks for a login first", async () => {
    expect((await post(null, adult)).status).toBe(401);
  });

  it("creates an adult character from the creator's lists", async () => {
    const imageMediaId = await portraitFor("chars-a");
    const response = await post("chars-a", { ...adult, imageMediaId });
    expect(response.status).toBe(201);
    const { character } = (await response.json()) as { character: CharacterDTO };
    expect(character).toMatchObject({
      name: "Aya",
      age: 24,
      ethnicity: "Asian",
      body: "Petite",
      hairStyle: "Ponytail",
      breast: "Small",
      personality: "Playful",
      line: "Aya is playful, works as a designer, and likes teasing.",
      image: `/api/media/${imageMediaId}`,
    });
    expect(screened).toHaveLength(1);
    expect(screened[0]).toContain("Personality: Playful");
    expect(screened[0]).toContain("Relationship: Girlfriend");
  });

  it("rejects a minor-coded look and persona sent as free text", async () => {
    const imageMediaId = await portraitFor("chars-b");
    const response = await post("chars-b", {
      ...adult,
      name: "Yuki",
      age: 18,
      body: "Flat-chested tiny childish frame",
      hairStyle: "Pigtails with hair ribbons",
      role: "Little sister",
      personality: "Fifteen-ish and shy",
      occupation: "Middle schooler",
      kinks: [],
      imageMediaId,
    });
    expect(response.status).toBe(400);
    expect(await charactersOf("chars-b")).toEqual([]);
  });

  it("only takes a look from the lists", async () => {
    const imageMediaId = await portraitFor("chars-c");
    const offList = {
      style: "chibi",
      ethnicity: "Asian schoolgirl",
      body: "Tiny childish frame",
      hair: "Black with hair ribbons",
      hairStyle: "Pigtails",
      eyeColor: "Big innocent eyes",
      breast: "Flat",
    };
    for (const [field, value] of Object.entries(offList)) {
      const response = await post("chars-c", { ...adult, [field]: value, imageMediaId });
      expect(response.status, field).toBe(400);
      expect(((await response.json()) as { error: string }).error, field).toMatch(new RegExp(`^${field}: `));
    }
    // A body from the other list, and a woman without a bust size.
    expect((await post("chars-c", { ...adult, body: "Muscular", imageMediaId })).status).toBe(400);
    expect((await post("chars-c", { ...adult, breast: undefined, imageMediaId })).status).toBe(400);
    expect((await post("chars-c", { ...adult, age: 17, imageMediaId })).status).toBe(400);
    expect(await charactersOf("chars-c")).toEqual([]);
    expect(screened).toEqual([]);
  });

  it("takes the persona only from the creator's lists", async () => {
    const imageMediaId = await portraitFor("chars-d");
    const persona = { role: "Little sister", personality: "Fifteen-ish and shy", occupation: "Middle schooler" };
    for (const [field, value] of Object.entries(persona)) {
      expect((await post("chars-d", { ...adult, [field]: value, imageMediaId })).status, field).toBe(400);
    }
    expect((await post("chars-d", { ...adult, kinks: ["Age play"], imageMediaId })).status).toBe(400);
    expect((await post("chars-d", { ...adult, voice: "Childish", imageMediaId })).status).toBe(400);
    expect((await post("chars-d", { ...adult, name: "x".repeat(41), imageMediaId })).status).toBe(400);
    expect(await charactersOf("chars-d")).toEqual([]);
  });

  it("takes a name only in a given-name shape", async () => {
    const parsed = (name: string) => mod.createCharacterInput.safeParse({ ...adult, name, imageMediaId: crypto.randomUUID() });
    for (const name of ["Aya", "Elena Voss", "Zoë", "D'Angelo", "Mary-Jane O’Neil", "J. Park", "さくら", "Анна", "प्रिया", "x".repeat(30)]) {
      expect(parsed(name).success, name).toBe(true);
    }
    expect(parsed("  Elena   Voss ").data?.name).toBe("Elena Voss");
    const refused = [
      "Yuki (17)",
      "Yuki, 17",
      "Yuki u18",
      "Yuki (jr high)",
      "Yuki, still in diapers",
      "Yuki <18",
      "Yuki 17yo",
      "Yuki year 9",
      "Yuki [teen]",
      "Mia Rose Ann Lee",
      "-Mia",
      "x".repeat(31),
      "",
    ];
    for (const name of refused) expect(parsed(name).success, name).toBe(false);

    const imageMediaId = await portraitFor("chars-g");
    const response = await post("chars-g", { ...adult, name: "Yuki (17)", imageMediaId });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toMatch(/^name: /);
    expect(await charactersOf("chars-g")).toEqual([]);
    expect(screened).toEqual([]);
  });

  it("leaves minor-coded words in a well-formed name to the classifier", async () => {
    const imageMediaId = await portraitFor("chars-h");
    classifier = "BLOCK:minor";
    for (const name of ["Kid sister Yuki", "Yuki seventeen"]) {
      expect((await post("chars-h", { ...adult, name, imageMediaId })).status, name).toBe(422);
    }
    expect(await charactersOf("chars-h")).toEqual([]);
  });

  it("catches a minor-coded name however it's capitalised", async () => {
    const imageMediaId = await portraitFor("chars-g");
    expect((await post("chars-g", { ...adult, name: "child yuki", imageMediaId })).status).toBe(422);
    expect(await charactersOf("chars-g")).toEqual([]);
  });

  it("refuses a minor-coded name the classifier flags", async () => {
    const imageMediaId = await portraitFor("chars-e");
    classifier = "BLOCK:minor";
    const response = await post("chars-e", { ...adult, name: "Little Mia", imageMediaId });
    expect(response.status).toBe(422);
    expect(((await response.json()) as { code: string }).code).toBe("blocked_minor");
    expect(await charactersOf("chars-e")).toEqual([]);

    const { eq } = await import("drizzle-orm");
    const user = await userFor("chars-e");
    const events = await (await mod.db())
      .select()
      .from(mod.schema.moderationEvents)
      .where(eq(mod.schema.moderationEvents.userId, user.id));
    expect(events).toEqual([expect.objectContaining({ targetType: "character", category: "minor", action: "blocked" })]);
  });

  it("fails closed when the classifier can't answer", async () => {
    const imageMediaId = await portraitFor("chars-f");
    classifier = "down";
    const response = await post("chars-f", { ...adult, imageMediaId });
    expect(response.status).toBe(503);
    expect(((await response.json()) as { code: string }).code).toBe("moderation_unavailable");
    expect(await charactersOf("chars-f")).toEqual([]);
  });
});
