import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { MessageDTO } from "@/lib/api-types";
import { hasPython } from "@/test/python";

// The scene model is scripted per test; images are the offline mock SVGs.
vi.mock("@/server/llm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/llm")>();
  return { ...actual, complete: vi.fn(actual.complete) };
});

// The real text screen, which a test can script for one call.
vi.mock("@/server/safety/text", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/safety/text")>();
  return { ...actual, checkImagePrompt: vi.fn(actual.checkImagePrompt) };
});

let mediaDir: string;
type Handler = (request: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
type PhotoResponse = { message: MessageDTO; notice: MessageDTO | null; balance: number };
let POST: Handler;
let db: typeof import("@/server/db").db;
let schema: typeof import("@/server/db/schema");
let currentUser: typeof import("@/server/auth").currentUser;
let complete: typeof import("@/server/llm").complete;
let checkImagePrompt: typeof import("@/server/safety/text").checkImagePrompt;
let envModule: typeof import("@/server/env");

beforeAll(async () => {
  mediaDir = await mkdtemp(path.join(os.tmpdir(), "simulust-photo-safety-"));
  vi.stubEnv("MEDIA_DIR", mediaDir);
  vi.stubEnv("IMAGE_PROVIDER", "mock");
  vi.resetModules();
  POST = (await import("./route")).POST as unknown as Handler;
  db = (await import("@/server/db")).db;
  schema = await import("@/server/db/schema");
  currentUser = (await import("@/server/auth")).currentUser;
  complete = (await import("@/server/llm")).complete;
  checkImagePrompt = (await import("@/server/safety/text")).checkImagePrompt;
  envModule = await import("@/server/env");
});

afterEach(() => {
  envModule.features.remoteModeration = false;
  Object.assign(envModule.env, { imageProvider: "mock", imageApiUrl: undefined });
  vi.unstubAllGlobals();
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await rm(mediaDir, { recursive: true, force: true });
});

// A stand-in for the remote text classifier; `answer` decides each text it's
// sent, and sees the policy it was asked about.
function classifier(answer: (text: string, policy: string) => string | Error) {
  Object.assign(envModule.env, { moderationBaseUrl: "http://classifier.test", moderationApiKey: "test", moderationModel: "test" });
  envModule.features.remoteModeration = true;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const [system, text] = (JSON.parse(String(init.body)) as { messages: { content: string }[] }).messages.map((message) => message.content);
      const result = answer(text, system);
      if (result instanceof Error) throw result;
      return Response.json({ choices: [{ message: { content: result } }] });
    }),
  );
}

function writes(scene: string, caption: string) {
  vi.mocked(complete).mockResolvedValueOnce(JSON.stringify({ scene, caption }));
}

// A confirmed adult: ID-checked, or (`attested`) an adult by the date of birth
// given at sign-up. Either way every photo is uncensored; there's no switch.
async function setup(handle: string, { attested = false } = {}) {
  const { eq } = await import("drizzle-orm");
  const database = await db();
  const user = (await currentUser(new Request("http://localhost", { headers: { "x-dev-user": handle } })))!;
  await database
    .update(schema.users)
    .set(attested ? { ageAttestedAt: new Date() } : { ageStatus: "approved", ageVerifiedAt: new Date() })
    .where(eq(schema.users.id, user.id));
  const [thread] = await database.insert(schema.threads).values({ userId: user.id, characterId: "mira" }).returning();
  return { user, thread };
}

function call(handle: string, threadId: string, body: unknown = {}) {
  return POST(
    new Request(`http://localhost/api/threads/${threadId}/photo`, {
      method: "POST",
      headers: { "x-dev-user": handle, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: threadId }) },
  );
}

async function photo(handle: string, threadId: string) {
  const response = await call(handle, threadId);
  expect(response.status).toBe(200);
  return (await response.json()) as PhotoResponse;
}

async function promptOf(body: PhotoResponse) {
  const { eq } = await import("drizzle-orm");
  const database = await db();
  const [row] = await database.select().from(schema.media).where(eq(schema.media.id, body.message.media!.id));
  return row.prompt ?? "";
}

async function eventsFor(userId: string) {
  const { eq } = await import("drizzle-orm");
  const database = await db();
  return database.select().from(schema.moderationEvents).where(eq(schema.moderationEvents.userId, userId));
}

const SCENE = "on a rooftop terrace at golden hour, linen sundress, leaning on the railing, shot from a low angle";
const CAPTION = "Wish you were up here with me.";

describe("photo scene and caption screening", () => {
  it("uses what the model wrote when the classifier allows it", async () => {
    const { thread } = await setup("photo-scene-ok");
    classifier(() => "ALLOW");
    writes(SCENE, CAPTION);
    const body = await photo("photo-scene-ok", thread.id);
    expect(await promptOf(body)).toContain("rooftop terrace");
    expect(body.message.content).toBe(CAPTION);
  });

  it("falls back to the neutral scene and a stock caption when the classifier can't check them", async () => {
    const { user, thread } = await setup("photo-scene-down");
    classifier(() => new Error("classifier timed out"));
    writes(SCENE, CAPTION);
    const body = await photo("photo-scene-down", thread.id);
    const prompt = await promptOf(body);
    expect(prompt).toContain("relaxing at home");
    expect(prompt).not.toContain("rooftop");
    expect(body.message.content).not.toBe(CAPTION);
    // One for the scene and one for the caption, each checked on its own.
    expect((await eventsFor(user.id)).map((event) => [event.category, event.targetType, event.targetId])).toEqual([
      ["classifier_error", "image_prompt", body.message.media!.id],
      ["classifier_error", "image_prompt", body.message.media!.id],
    ]);
  });

  it("falls back to the neutral scene when the classifier blocks it, keeping a caption it allows", async () => {
    const { user, thread } = await setup("photo-scene-block");
    classifier((text) => (text.includes("rooftop") ? "BLOCK:minor" : "ALLOW"));
    writes(SCENE, CAPTION);
    const body = await photo("photo-scene-block", thread.id);
    expect(await promptOf(body)).toContain("relaxing at home");
    expect(body.message.content).toBe(CAPTION);
    const events = await eventsFor(user.id);
    expect(events.map((event) => [event.category, event.action])).toEqual([["minor", "blocked"]]);
    expect(events[0].details).toMatchObject({ source: "model_output", matched: "classifier", excerpt: SCENE });
  });

  it("drops the scene with a caption the classifier blocks, for a stock one", async () => {
    const { user, thread } = await setup("photo-caption-block");
    classifier((text, policy) => (!policy.includes("- other_people:") && text.includes(CAPTION) ? "BLOCK:real_person" : "ALLOW"));
    writes(SCENE, CAPTION);
    const body = await photo("photo-caption-block", thread.id);
    expect(await promptOf(body)).toContain("relaxing at home");
    expect(await promptOf(body)).not.toContain("rooftop");
    expect(body.message.content).not.toBe(CAPTION);
    expect((await eventsFor(user.id)).map((event) => [event.category, event.action])).toEqual([["real_person", "blocked"]]);
  });

  it("keeps the scene when only the caption couldn't be checked", async () => {
    const { user, thread } = await setup("photo-caption-down");
    classifier((_text, policy) => (policy.includes("- other_people:") ? "ALLOW" : new Error("classifier timed out")));
    writes(SCENE, CAPTION);
    const body = await photo("photo-caption-down", thread.id);
    expect(await promptOf(body)).toContain("rooftop terrace");
    expect(body.message.content).not.toBe(CAPTION);
    expect((await eventsFor(user.id)).map((event) => [event.category, event.action])).toEqual([["classifier_error", "flagged"]]);
  });

  // OPC-11: a line that's harmless alone can make a nude photo minor content.
  it("reads the caption with its scene, and drops both when together they're minor content", async () => {
    const { user, thread } = await setup("photo-caption-context");
    const scene = "lying nude across the bed in warm light, looking at the camera";
    const caption = "Don't tell my mom, I'm supposed to be grounded";
    const asked: { text: string; scene: boolean }[] = [];
    classifier((text, policy) => {
      asked.push({ text, scene: policy.includes("- other_people:") });
      return text.includes("lying nude") && text.includes("grounded") ? "BLOCK:minor" : "ALLOW";
    });
    writes(scene, caption);
    const body = await photo("photo-caption-context", thread.id);
    const prompt = await promptOf(body);
    expect(prompt).toContain("relaxing at home");
    expect(prompt).not.toContain("lying nude");
    expect(body.message.content).not.toBe(caption);
    // The scene alone, under the scene policy, then the caption with it under the content policy.
    expect(asked.map((request) => request.scene)).toEqual([true, false]);
    expect(asked[0].text).not.toContain("grounded");
    expect(asked[1].text).toContain(`Photo: ${scene}\nCaption: ${caption}`);
    const events = await eventsFor(user.id);
    expect(events.map((event) => [event.category, event.action, event.targetType, event.targetId])).toEqual([
      ["minor", "blocked", "image_prompt", body.message.media!.id],
    ]);
    expect(events[0].details).toMatchObject({ source: "model_output", matched: "classifier", excerpt: caption });
    expect(events[0].details).toHaveProperty("classified", `Photo: ${scene}\nCaption: ${caption}`);
  });

  it("reads the caption with our scene when the model's gave way", async () => {
    const { thread } = await setup("photo-caption-our-scene");
    const asked: string[] = [];
    classifier((text) => {
      asked.push(text);
      return text.includes("rooftop") ? "BLOCK:minor" : "ALLOW";
    });
    writes(SCENE, CAPTION);
    const body = await photo("photo-caption-our-scene", thread.id);
    expect(body.message.content).toBe(CAPTION);
    expect(asked[1]).toContain("Photo: relaxing at home");
    expect(asked[1]).not.toContain("rooftop");
  });

  it("asks the scene writer to name the character, never 'a woman'", async () => {
    const { thread } = await setup("photo-scene-self");
    writes(SCENE, CAPTION);
    await photo("photo-scene-self", thread.id);
    const [system] = vi.mocked(complete).mock.calls.at(-1)![0];
    expect(system.content).toContain('refer to Mira only by name or pronoun, never as "a woman", "a man", "a girl", "a guy"');
  });

  // OPC-11: the caption isn't in the picture, so the one-person rule isn't asked of it.
  it("keeps a good scene when the caption invites the viewer in", async () => {
    const { user, thread } = await setup("photo-caption-viewer");
    const asked: { text: string; scene: boolean }[] = [];
    // A classifier that would read the caption as someone else in the picture, if asked.
    classifier((text, policy) => {
      const scene = policy.includes("- other_people:");
      asked.push({ text, scene });
      return scene && /join me|wish you were/i.test(text) ? "BLOCK:other_people" : "ALLOW";
    });
    const caption = "Wish you were here. Come join me?";
    writes(SCENE, caption);
    const body = await photo("photo-caption-viewer", thread.id);
    expect(await promptOf(body)).toContain("rooftop terrace");
    expect(body.message.content).toBe(caption);
    expect(asked).toHaveLength(2);
    expect(asked.find((request) => request.text.includes("rooftop"))?.scene).toBe(true);
    expect(asked.find((request) => request.text.includes(caption))?.scene).toBe(false);
    expect(await eventsFor(user.id)).toEqual([]);
  });

  // The scene is screened as the model wrote it, before the quiet drops: "girl"
  // would take it out as someone else in the picture and lose the minor block.
  it("logs minor content in the model's scene as a minor block, and falls back without it", async () => {
    const { user, thread } = await setup("photo-scene-minor");
    const scene = "a 15 year old girl posing nude on the bed";
    writes(scene, CAPTION);
    const body = await photo("photo-scene-minor", thread.id);
    const prompt = await promptOf(body);
    expect(prompt).toContain("relaxing at home");
    expect(prompt).not.toMatch(/15 year|girl posing/);
    const events = await eventsFor(user.id);
    expect(events.map((event) => [event.category, event.action, event.targetType, event.targetId])).toEqual([
      ["minor", "blocked", "image_prompt", body.message.media!.id],
    ]);
    expect(events[0].details).toMatchObject({ source: "model_output", excerpt: scene });
    expect(events[0].details).toHaveProperty("matched");
  });

  it("logs a picture-only word next to a sexual one in the model's scene as minor content", async () => {
    const { user, thread } = await setup("photo-scene-image-minor");
    // Stands in for a scene that puts a sexual word near a child or family word.
    vi.mocked(checkImagePrompt).mockReturnValueOnce({ ok: false, category: "image", matched: "9yrs", minor: "9yrs" });
    writes("by the lake at dusk", CAPTION);
    const body = await photo("photo-scene-image-minor", thread.id);
    expect(await promptOf(body)).toContain("relaxing at home");
    expect(body.message.content).toBe(CAPTION);
    expect((await eventsFor(user.id)).map((event) => [event.category, event.action, event.details])).toEqual([
      ["minor", "blocked", { source: "model_output", matched: "9yrs", excerpt: "by the lake at dusk" }],
    ]);
  });

  // OPC-5: the scene is third person, so "you" is whoever gets the photo.
  it("reads the model's scene as the studio does, with the viewer as someone else", async () => {
    const { user, thread } = await setup("photo-scene-viewer");
    writes("lying across your lap on the sofa, warm lamp light", CAPTION);
    const crossed = await photo("photo-scene-viewer", thread.id);
    expect(await promptOf(crossed)).toContain("relaxing at home");
    expect(await promptOf(crossed)).not.toContain("your lap");
    expect(crossed.message.content).toBe(CAPTION);
    // Posing for them stays the model's scene.
    writes("sitting on the edge of your bed in lace lingerie, looking into the camera", CAPTION);
    const posed = await photo("photo-scene-viewer", thread.id);
    expect(await promptOf(posed)).toContain("edge of your bed in lace lingerie");
    expect(await eventsFor(user.id)).toEqual([]);
  });

  it("gives way to our scene for who the character is when the classifier sees someone else in it, unlogged", async () => {
    const { eq } = await import("drizzle-orm");
    const { user } = await setup("photo-scene-others");
    // Jonah is a man: the lingerie quick action is boxer briefs for him.
    const [thread] = await (await db()).insert(schema.threads).values({ userId: user.id, characterId: "jonah" }).returning();
    const policies: string[] = [];
    classifier((text, policy) => {
      policies.push(policy);
      return text.includes("rooftop") ? "BLOCK:other_people" : "ALLOW";
    });
    writes(SCENE, CAPTION);
    const response = await call("photo-scene-others", thread.id, { hint: "in lingerie on the bed, warm lamp light" });
    expect(response.status).toBe(200);
    const body = (await response.json()) as PhotoResponse;
    const prompt = await promptOf(body);
    expect(prompt).toContain("fitted black boxer briefs");
    expect(prompt).not.toContain("rooftop");
    // The caption was checked on its own, and stands.
    expect(body.message.content).toBe(CAPTION);
    // The hint and the scene were both asked about under the scene policy, the
    // caption under the content policy.
    expect(policies).toHaveLength(3);
    expect(policies.filter((policy) => policy.includes("- other_people:"))).toHaveLength(2);
    expect(await eventsFor(user.id)).toEqual([]);
    const [row] = await (await db()).select().from(schema.media).where(eq(schema.media.id, body.message.media!.id));
    expect(row.status).toBe("ready");
  });

  it("falls back when the blocklist catches the scene, keeping a caption it allows", async () => {
    const { user, thread } = await setup("photo-scene-blocklist");
    writes("sitting at a desk in a school uniform", CAPTION);
    const body = await photo("photo-scene-blocklist", thread.id);
    expect(await promptOf(body)).toContain("relaxing at home");
    expect(body.message.content).toBe(CAPTION);
    const events = await eventsFor(user.id);
    expect(events.map((event) => [event.category, event.action])).toEqual([["minor", "blocked"]]);
    expect(events[0].details).toMatchObject({ source: "model_output" });
  });
});

describe("nudity in the scene", () => {
  async function hinted(handle: string, threadId: string, hint: string) {
    const response = await call(handle, threadId, { hint });
    expect(response.status, hint).toBe(200);
    return (await response.json()) as PhotoResponse;
  }

  it("keeps nudity the model wrote for a confirmed adult, once screened", async () => {
    const { thread } = await setup("photo-scene-nude-default");
    const screened: string[] = [];
    classifier((text) => {
      screened.push(text);
      return "ALLOW";
    });
    writes("lying nude across the bed in warm light, looking at the camera", CAPTION);
    const prompt = await promptOf(await photo("photo-scene-nude-default", thread.id));
    expect(prompt).toContain("lying nude across the bed");
    expect(prompt).toContain("nudity allowed");
    expect(screened.some((text) => text.includes("lying nude across the bed"))).toBe(true);
  });

  it("still drops a nude scene the classifier blocks", async () => {
    const { thread } = await setup("photo-scene-nude-screened");
    classifier((text) => (text.includes("lying nude") ? "BLOCK:minor" : "ALLOW"));
    writes("lying nude across the bed in warm light, looking at the camera", CAPTION);
    const prompt = await promptOf(await photo("photo-scene-nude-screened", thread.id));
    expect(prompt).toContain("relaxing at home");
    expect(prompt).not.toContain("lying nude");
  });

  it("keeps what the model wrote for a confirmed adult's nude request", async () => {
    const { thread } = await setup("photo-scene-nude-kept", { attested: true });
    classifier(() => "ALLOW");
    writes("naked on a sunlit balcony, wrapped in nothing but morning light, smiling over one shoulder", CAPTION);
    const body = await hinted("photo-scene-nude-kept", thread.id, "a nude photo, a sensual pose in soft bedroom light");
    expect(await promptOf(body)).toContain("sunlit balcony");
    expect(body.message.content).toBe(CAPTION);
  });

  it("gives way to our scene when the model came back clothed for a nude request", async () => {
    const { thread } = await setup("photo-scene-nude-clothed", { attested: true });
    classifier(() => "ALLOW");
    writes("in a cosy knit sweater on the sofa, holding a mug of tea", CAPTION);
    const prompt = await promptOf(await hinted("photo-scene-nude-clothed", thread.id, "topless, a teasing look over one shoulder"));
    expect(prompt).toContain("topless in a softly lit bedroom");
    expect(prompt).not.toContain("sweater");
  });

  it("keeps a clothed scene when the user explicitly declines nudity", async () => {
    const { eq } = await import("drizzle-orm");
    const { thread } = await setup("photo-scene-covered-kept");
    const hint = "No nudity, please; a cozy sweater";
    const screened: string[] = [];
    classifier((text) => {
      screened.push(text);
      return "ALLOW";
    });
    writes("in a cosy knit sweater on the sofa, holding a mug of tea", CAPTION);
    const body = await hinted("photo-scene-covered-kept", thread.id, hint);
    const prompt = await promptOf(body);
    expect(prompt).toContain("cosy knit sweater");
    expect(prompt).toContain("no nudity");
    expect(prompt).not.toContain("nudity allowed");
    // The clothing preference never rewrites what the safety classifier reads.
    expect(screened.some((text) => text.includes(hint))).toBe(true);
    const database = await db();
    const [stored] = await database.select().from(schema.media).where(eq(schema.media.id, body.message.media!.id));
    expect(stored.moderation?.explicit).toBe(false);
  });

  it.each([
    "",
    "lying nude across the bed in warm light, looking at the camera",
    "lying nude across the bed, not showing breasts, looking at the camera",
  ])(
    "keeps the fallback covered when the user declines nudity and the model returns %j",
    async (scene) => {
      const handle = scene.includes("not showing") ? "photo-scene-covered-mixed" : scene ? "photo-scene-covered-rejected" : "photo-scene-covered-empty";
      const { thread } = await setup(handle);
      classifier(() => "ALLOW");
      writes(scene, CAPTION);
      const prompt = await promptOf(await hinted(handle, thread.id, "In the shower without any nudity"));
      expect(prompt).toContain("behind fogged glass");
      expect(prompt).toContain("no nudity");
      expect(prompt).not.toContain("lying nude");
      expect(prompt).not.toContain("nude in a steamy");
      expect(prompt).not.toContain("nudity allowed");
    },
  );

  it("uses our scene for a quick action when the classifier blocks what the model wrote", async () => {
    const { thread } = await setup("photo-scene-nude-blocked", { attested: true });
    classifier((text) => (text.includes("rooftop") ? "BLOCK:minor" : "ALLOW"));
    writes(SCENE, CAPTION);
    const body = await hinted("photo-scene-nude-blocked", thread.id, "in lace lingerie on the bed, warm lamp light");
    const prompt = await promptOf(body);
    expect(prompt).toContain("sheer black lace lingerie");
    expect(prompt).not.toContain("rooftop");
    // The caption was checked on its own, and stands.
    expect(body.message.content).toBe(CAPTION);
  });
});

describe("photo AI disclosure", () => {
  it("adds the disclosure before a photo that opens a thread, then not again", async () => {
    const { eq } = await import("drizzle-orm");
    const { thread } = await setup("photo-disclose");
    const first = await photo("photo-disclose", thread.id);
    expect(first.notice?.role).toBe("notice");
    expect(first.notice?.content).toContain("is an AI character");
    expect(new Date(first.notice!.createdAt).getTime()).toBeLessThanOrEqual(new Date(first.message.createdAt).getTime());

    const database = await db();
    const [row] = await database.select().from(schema.threads).where(eq(schema.threads.id, thread.id));
    expect(row.disclosedAt).not.toBeNull();
    const second = await photo("photo-disclose", thread.id);
    expect(second.notice).toBeNull();
  });
});

describe("words that are fine in chat but never in a photo", () => {
  it("refuses such a hint before charging, and logs nothing against the user", async () => {
    const { eq } = await import("drizzle-orm");
    const { user, thread } = await setup("photo-hint-kids");
    const { balanceOf } = await import("@/server/credits");
    const before = await balanceOf(user.id);
    for (const hint of ["relaxing after putting the kids to bed", "in my old high school hoodie", "a minor change of outfit"]) {
      const response = await call("photo-hint-kids", thread.id, { hint });
      expect(response.status, hint).toBe(422);
      expect(((await response.json()) as { code: string }).code).toBe("blocked_image_prompt");
    }
    expect(await balanceOf(user.id)).toBe(before);
    expect(await eventsFor(user.id)).toEqual([]);
    const database = await db();
    expect(await database.select().from(schema.media).where(eq(schema.media.threadId, thread.id))).toEqual([]);
  });

  it("logs a hint that pairs such a word with a sexual one as minor content, before charging, and holds deletion", async () => {
    const { user, thread } = await setup("photo-hint-minor");
    const { balanceOf } = await import("@/server/credits");
    const before = await balanceOf(user.id);
    // Stands in for a hint that puts a sexual word near an age under 18, a child
    // or a family word: checkText lets it through, checkImagePrompt marks it.
    vi.mocked(checkImagePrompt).mockReturnValueOnce({ ok: false, category: "image", matched: "9yrs", minor: "9yrs" });
    const response = await call("photo-hint-minor", thread.id, { hint: "by the lake at dusk" });
    expect(response.status).toBe(422);
    expect(((await response.json()) as { code: string }).code).toBe("blocked_minor");
    expect(await balanceOf(user.id)).toBe(before);
    expect(
      (await eventsFor(user.id)).map((event) => [event.category, event.action, event.targetType, event.targetId, event.details]),
    ).toEqual([["minor", "blocked", "image_prompt", thread.id, { matched: "9yrs", excerpt: "by the lake at dusk" }]]);

    const { DELETE } = await import("@/app/api/me/account/route");
    const deletion = await DELETE(
      new Request("http://localhost/api/me/account", {
        method: "DELETE",
        headers: { "x-dev-user": "photo-hint-minor", "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "DELETE" }),
      }),
    );
    expect(deletion.status).toBe(409);
    expect(((await deletion.json()) as { code: string }).code).toBe("deletion_on_hold");
  });

  it("logs such a hint as minor content when it also names someone else, before charging", async () => {
    const { user, thread } = await setup("photo-hint-minor-others");
    const { balanceOf } = await import("@/server/credits");
    const before = await balanceOf(user.id);
    vi.mocked(checkImagePrompt).mockReturnValueOnce({ ok: false, category: "image", matched: "9yrs", minor: "9yrs" });
    const response = await call("photo-hint-minor-others", thread.id, { hint: "by the lake at dusk with my boyfriend" });
    expect(response.status).toBe(422);
    expect(((await response.json()) as { code: string }).code).toBe("blocked_minor");
    expect(await balanceOf(user.id)).toBe(before);
    expect(
      (await eventsFor(user.id)).map((event) => [event.category, event.action, event.targetType, event.targetId, event.details]),
    ).toEqual([["minor", "blocked", "image_prompt", thread.id, { matched: "9yrs", excerpt: "by the lake at dusk with my boyfriend" }]]);
  });

  it("refuses a hint the classifier sees someone else in, as the word list would, logged, before charging", async () => {
    const { eq } = await import("drizzle-orm");
    const { user, thread } = await setup("photo-hint-classifier-others");
    const { balanceOf } = await import("@/server/credits");
    const before = await balanceOf(user.id);
    // Something the word list lets through, which the classifier reads as a second person.
    const hint = "legs wrapped around the one holding the camera";
    classifier((_text, policy) => (policy.includes("- other_people:") ? "BLOCK:other_people" : "ALLOW"));
    const response = await call("photo-hint-classifier-others", thread.id, { hint });
    expect(response.status).toBe(422);
    const refused = (await response.json()) as { code: string; error: string };
    expect(refused.code).toBe("others_in_photo");
    expect(refused.error).toContain("Mira, alone");
    expect(await balanceOf(user.id)).toBe(before);
    expect(await (await db()).select().from(schema.media).where(eq(schema.media.threadId, thread.id))).toEqual([]);
    expect(
      (await eventsFor(user.id)).map((event) => [event.category, event.action, event.targetType, event.targetId, event.details]),
    ).toEqual([["other_people", "blocked", "image_prompt", thread.id, { matched: "classifier", excerpt: hint }]]);
  });

  it("logs school wear next to a picture-only undressing word as minor content, before charging", async () => {
    const { user, thread } = await setup("photo-hint-cheer");
    const { balanceOf } = await import("@/server/credits");
    const before = await balanceOf(user.id);
    const hint = "in her old high school cheer uniform, topless";
    const response = await call("photo-hint-cheer", thread.id, { hint });
    expect(response.status).toBe(422);
    expect(((await response.json()) as { code: string }).code).toBe("blocked_minor");
    expect(await balanceOf(user.id)).toBe(before);
    const events = await eventsFor(user.id);
    expect(events.map((event) => [event.category, event.action, event.targetType, event.targetId])).toEqual([
      ["minor", "blocked", "image_prompt", thread.id],
    ]);
    expect(events[0].details).toMatchObject({ excerpt: hint });
    expect(events[0].details).toHaveProperty("matched");
  });

  it("marks only picture-only refusals that pair the word with a sexual one", async () => {
    const actual = await vi.importActual<typeof import("@/server/safety/text")>("@/server/safety/text");
    for (const hint of ["a minor tilt of the head", "relaxing after putting the kids to bed", "two 9-year-olds at the park"]) {
      const verdict = actual.checkImagePrompt(hint);
      expect(verdict, hint).toMatchObject({ ok: false, category: "image" });
      expect(verdict, hint).not.toHaveProperty("minor");
    }
  });

  it("still logs a hint checkText refuses as minor content", async () => {
    const { user, thread } = await setup("photo-hint-teen");
    const response = await call("photo-hint-teen", thread.id, { hint: "dressed as a teen" });
    expect(((await response.json()) as { code: string }).code).toBe("blocked_minor");
    expect((await eventsFor(user.id)).map((event) => [event.category, event.action])).toEqual([["minor", "blocked"]]);
  });

  it("swaps a scene that picked them up for the neutral one, quietly", async () => {
    const { user, thread } = await setup("photo-scene-kids");
    const seen: string[] = [];
    classifier((text) => {
      seen.push(text);
      return "ALLOW";
    });
    writes("relaxing on the couch after putting the kids to bed, soft lamp light, smiling at the camera", CAPTION);
    const body = await photo("photo-scene-kids", thread.id);
    const prompt = await promptOf(body);
    expect(prompt).toContain("relaxing at home");
    expect(prompt).not.toContain("kids");
    expect(body.message.content).toBe(CAPTION);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain(CAPTION);
    expect(seen[0]).not.toContain("kids");
    expect(await eventsFor(user.id)).toEqual([]);
  });

  it("refuses a character whose name carries an age", async () => {
    const { eq } = await import("drizzle-orm");
    const { user, thread } = await setup("photo-name-age");
    const database = await db();
    for (const [index, name] of ["Yuki, 17", "Yuki (17)", "Yuki seventeen", "Kid sister Yuki"].entries()) {
      const id = `photo-name-age-${index}`;
      await database.insert(schema.characters).values({
        id,
        ownerId: user.id,
        name,
        age: 21,
        gender: "Woman",
        ethnicity: "Asian",
        body: "Petite",
        role: "Girlfriend",
        heat: "Sweet",
        line: "",
        lane: "girls",
      });
      await database.update(schema.threads).set({ characterId: id }).where(eq(schema.threads.id, thread.id));
      const response = await call("photo-name-age", thread.id);
      expect(response.status, name).toBe(422);
      expect(((await response.json()) as { code: string }).code, name).toBe("blocked_minor");
    }
  });
});

// The real worker screen (workers/media/safety.py), when Python is here.
const python = hasPython();
const WORKER_SCREEN = String.raw`
import importlib.util, sys, types
for name in ("numpy", "PIL", "PIL.Image"):
    sys.modules.setdefault(name, types.ModuleType(name))
sys.modules["PIL"].Image = sys.modules["PIL.Image"]
sys.modules["PIL.Image"].Image = object
sys.modules["numpy"].ndarray = object
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("worker_safety", sys.argv[1])
safety = importlib.util.module_from_spec(spec)
spec.loader.exec_module(safety)
print(safety.screen_prompt(sys.stdin.read()) or "")
`;

// Serves /v1/images the way the worker would, screening each prompt with `screen`.
function worker(screen: (prompt: string) => string) {
  Object.assign(envModule.env, { imageProvider: "worker", imageApiUrl: "http://worker.test" });
  const prompts: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const { prompt } = JSON.parse(String(init.body)) as { prompt: string };
      prompts.push(prompt);
      const reason = screen(prompt);
      if (reason) return Response.json({ error: "blocked", reason }, { status: 422 });
      return new Response(new Uint8Array(4000), { headers: { "content-type": "image/png" } });
    }),
  );
  return prompts;
}

describe("photos through the worker's prompt screen", () => {
  it.skipIf(!python)("gets a scene that mentioned the kids past the real worker", async () => {
    const { user, thread } = await setup("photo-worker-kids");
    const prompts = worker((prompt) => {
      const result = spawnSync("python3", ["-I", "-c", WORKER_SCREEN, path.resolve("workers/media/safety.py")], {
        input: prompt,
        encoding: "utf8",
      });
      if (result.status !== 0) throw new Error(result.stderr);
      return result.stdout.trim();
    });
    writes("relaxing on the couch after putting the kids to bed, soft lamp light, smiling at the camera", CAPTION);
    const body = await photo("photo-worker-kids", thread.id);
    expect(body.message.media).toMatchObject({ status: "ready" });
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).not.toContain("kids");
    expect(await eventsFor(user.id)).toEqual([]);
  });

  it.skipIf(!python)("gets every explicit quick action past the real worker", async () => {
    const { EXPLICIT_PHOTO_IDEAS } = await import("@/components/chat/format");
    const { user, thread } = await setup("photo-worker-explicit", { attested: true });
    const reasons: string[] = [];
    const prompts = worker((prompt) => {
      const result = spawnSync("python3", ["-I", "-c", WORKER_SCREEN, path.resolve("workers/media/safety.py")], {
        input: prompt,
        encoding: "utf8",
      });
      if (result.status !== 0) throw new Error(result.stderr);
      if (result.stdout.trim()) reasons.push(result.stdout.trim());
      return result.stdout.trim();
    });
    for (const idea of EXPLICIT_PHOTO_IDEAS) {
      const response = await call("photo-worker-explicit", thread.id, { hint: idea.hint });
      expect(response.status, idea.label).toBe(200);
    }
    expect(reasons).toEqual([]);
    expect(prompts).toHaveLength(EXPLICIT_PHOTO_IDEAS.length);
    expect(await eventsFor(user.id)).toEqual([]);
  });

  it("files the worker seeing a second person under the one-person rule, not minor content", async () => {
    const { user, thread } = await setup("photo-worker-people");
    worker(() => "people:2girls:0.80");
    const response = await call("photo-worker-people", thread.id);
    expect(response.status).toBe(502);
    expect((await eventsFor(user.id)).map((event) => [event.category, event.action, event.details])).toEqual([
      ["one_person", "blocked", { reason: "people:2girls:0.80" }],
    ]);
  });

  it("files a worker's image-only word refusal as a worker refusal, not minor content", async () => {
    const { user, thread } = await setup("photo-worker-term");
    worker(() => "term:kids");
    const response = await call("photo-worker-term", thread.id);
    expect(response.status).toBe(502);
    expect((await eventsFor(user.id)).map((event) => [event.category, event.action])).toEqual([["worker_refused", "blocked"]]);
  });
});
