import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { StudioFrameResponse } from "./route";

// Images are the offline mock SVGs; a test can script one generation or one
// moderation verdict.
vi.mock("@/server/images", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/images")>();
  return { ...actual, generateImage: vi.fn(actual.generateImage) };
});
vi.mock("@/server/image-moderation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/image-moderation")>();
  return { ...actual, moderateImage: vi.fn(actual.moderateImage) };
});

let mediaDir: string;
let POST: (request: Request) => Promise<Response>;
let db: typeof import("@/server/db").db;
let schema: typeof import("@/server/db/schema");
let currentUser: typeof import("@/server/auth").currentUser;
let balanceOf: typeof import("@/server/credits").balanceOf;
let generateImage: typeof import("@/server/images").generateImage;
let ImageGenerationError: typeof import("@/server/images").ImageGenerationError;
let moderateImage: typeof import("@/server/image-moderation").moderateImage;
let envModule: typeof import("@/server/env");

beforeAll(async () => {
  mediaDir = await mkdtemp(path.join(os.tmpdir(), "simulust-studio-"));
  vi.stubEnv("MEDIA_DIR", mediaDir);
  vi.stubEnv("IMAGE_PROVIDER", "mock");
  vi.resetModules();
  POST = (await import("./route")).POST;
  db = (await import("@/server/db")).db;
  schema = await import("@/server/db/schema");
  currentUser = (await import("@/server/auth")).currentUser;
  balanceOf = (await import("@/server/credits")).balanceOf;
  ({ generateImage, ImageGenerationError } = await import("@/server/images"));
  moderateImage = (await import("@/server/image-moderation")).moderateImage;
  envModule = await import("@/server/env");
});

afterEach(() => {
  envModule.features.remoteModeration = false;
  vi.unstubAllGlobals();
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await rm(mediaDir, { recursive: true, force: true });
});

// An adult by the age gate (a date of birth given at sign-up), or an account
// without an age confirmation, or one on an explicit hold. There's no explicit
// switch: a confirmed adult gets everything.
async function setup(handle: string, { adult = true, hold = false } = {}) {
  const { eq } = await import("drizzle-orm");
  const database = await db();
  const user = (await currentUser(new Request("http://localhost", { headers: { "x-dev-user": handle } })))!;
  await database
    .update(schema.users)
    .set({ ageAttestedAt: adult ? new Date() : null, explicitHoldAt: hold ? new Date() : null, settings: {} })
    .where(eq(schema.users.id, user.id));
  return user;
}

async function userRow(id: string) {
  const { eq } = await import("drizzle-orm");
  const [row] = await (await db()).select().from(schema.users).where(eq(schema.users.id, id));
  return row;
}

const SCENE = { characterId: "mira", setting: "bedroom", outfit: "lingerie", action: "tease" };

function call(handle: string, body: unknown) {
  return POST(
    new Request("http://localhost/api/studio/frame", {
      method: "POST",
      headers: { "x-dev-user": handle, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

async function rowsFor(userId: string) {
  const { eq } = await import("drizzle-orm");
  const database = await db();
  return database.select().from(schema.media).where(eq(schema.media.userId, userId));
}

async function eventsFor(userId: string) {
  const { eq } = await import("drizzle-orm");
  const database = await db();
  return database.select().from(schema.moderationEvents).where(eq(schema.moderationEvents.userId, userId));
}

// A stand-in for the remote text classifier.
function classifier(answer: () => string | Error) {
  Object.assign(envModule.env, { moderationBaseUrl: "http://classifier.test", moderationApiKey: "test", moderationModel: "test" });
  envModule.features.remoteModeration = true;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      const result = answer();
      if (result instanceof Error) throw result;
      return Response.json({ choices: [{ message: { content: result } }] });
    }),
  );
}

describe("POST /api/studio/frame", () => {
  it("asks for a login first", async () => {
    const response = await POST(
      new Request("http://localhost/api/studio/frame", { method: "POST", body: JSON.stringify(SCENE) }),
    );
    expect(response.status).toBe(401);
  });

  it("needs an adult by the age gate", async () => {
    const user = await setup("studio-minor-unknown", { adult: false });
    const response = await call("studio-minor-unknown", SCENE);
    expect(response.status).toBe(403);
    expect(((await response.json()) as { code: string }).code).toBe("age_verification_required");
    expect(await rowsFor(user.id)).toHaveLength(0);
  });

  it("is closed to an account on an explicit hold, before charging", async () => {
    const user = await setup("studio-hold", { hold: true });
    const before = await balanceOf(user.id);
    for (const scene of [SCENE, { ...SCENE, outfit: "nude" }]) {
      const response = await call("studio-hold", scene);
      expect(response.status).toBe(403);
      expect(((await response.json()) as { code: string }).code).toBe("explicit_hold");
    }
    expect(await balanceOf(user.id)).toBe(before);
    expect(await rowsFor(user.id)).toHaveLength(0);
  });

  it("gives every confirmed adult every outfit and motion, with no explicit switch", async () => {
    const user = await setup("studio-everything");
    const before = await balanceOf(user.id);
    for (const scene of [
      { ...SCENE, outfit: "nude" },
      { ...SCENE, outfit: "topless" },
      { ...SCENE, action: "undress" },
    ]) {
      const response = await call("studio-everything", scene);
      expect(response.status, JSON.stringify(scene)).toBe(200);
    }
    expect(await balanceOf(user.id)).toBe(before - 3 * 8);
    const rows = await rowsFor(user.id);
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(row.moderation).toMatchObject({ explicit: true });
  });

  it("only takes presets from the list", async () => {
    await setup("studio-presets");
    for (const scene of [
      { ...SCENE, setting: "classroom" },
      { ...SCENE, outfit: "school uniform" },
      { ...SCENE, action: "anything you like" },
      { ...SCENE, setting: undefined },
      { ...SCENE, details: "x".repeat(201) },
      { ...SCENE, characterId: "" },
    ]) {
      expect((await call("studio-presets", scene)).status).toBe(400);
    }
  });

  it("only uses characters the user can see", async () => {
    await setup("studio-owner");
    const { eq } = await import("drizzle-orm");
    const database = await db();
    const owner = (await currentUser(new Request("http://localhost", { headers: { "x-dev-user": "studio-owner" } })))!;
    const [mine] = await database
      .insert(schema.characters)
      .values({
        id: `studio-own-${crypto.randomUUID().slice(0, 8)}`,
        ownerId: owner.id,
        name: "Lena",
        age: 29,
        gender: "Woman",
        style: "realistic",
        ethnicity: "Caucasian",
        body: "Curvy",
        role: "Girlfriend",
        heat: "Warm",
        line: "Hi.",
        color: "#333",
        lane: "girls",
      })
      .returning();
    await setup("studio-stranger");
    expect((await call("studio-stranger", { ...SCENE, characterId: mine.id })).status).toBe(404);
    expect((await call("studio-stranger", { ...SCENE, characterId: "nobody-by-that-id" })).status).toBe(404);
    await database.delete(schema.characters).where(eq(schema.characters.id, mine.id));
  });

  it("refuses details the image screen blocks, before charging", async () => {
    const user = await setup("studio-details");
    const before = await balanceOf(user.id);
    const response = await call("studio-details", { ...SCENE, details: "hair in pigtails, a teddy bear on the bed" });
    expect(response.status).toBe(422);
    expect(((await response.json()) as { code: string }).code).toBe("blocked_image_prompt");

    // Minor content is logged for review.
    const minor = await call("studio-details", { ...SCENE, details: "a teen, naked" });
    expect(minor.status).toBe(422);
    expect(((await minor.json()) as { code: string }).code).toBe("blocked_minor");
    expect((await eventsFor(user.id)).map((event) => event.category)).toContain("minor");

    expect(await balanceOf(user.id)).toBe(before);
    expect(await rowsFor(user.id)).toHaveLength(0);
  });

  it("puts a self-declared minor on an explicit hold and logs it for review, before charging", async () => {
    const user = await setup("studio-self-minor");
    const before = await balanceOf(user.id);
    const response = await call("studio-self-minor", { ...SCENE, details: "I'm 16, red silk sheets" });
    expect(response.status).toBe(422);
    expect(((await response.json()) as { code: string }).code).toBe("blocked_minor");

    const events = await eventsFor(user.id);
    expect(events.map((event) => [event.category, event.action, event.targetType, event.targetId])).toEqual(
      expect.arrayContaining([
        ["minor", "blocked", "image_prompt", "mira"],
        ["self_declared_minor", "escalated", "image_prompt", "mira"],
      ]),
    );
    expect(events.find((event) => event.category === "minor")?.details).toMatchObject({
      matched: "self-declared age",
      excerpt: "I'm 16, red silk sheets",
      source: "studio",
    });
    // Explicit content is off at once, and the age confirmation with it.
    const row = await userRow(user.id);
    expect(row.explicitHoldAt).not.toBeNull();
    expect(row.ageAttestedAt).toBeNull();
    expect(await balanceOf(user.id)).toBe(before);
    expect(await rowsFor(user.id)).toHaveLength(0);

    // The studio is closed to the account until a person reviews it.
    expect((await call("studio-self-minor", SCENE)).status).toBe(403);
  });

  it("holds an unconfirmed account whose details say it's under 18, before the age check and without charging", async () => {
    const user = await setup("studio-self-minor-unconfirmed", { adult: false });
    const before = await balanceOf(user.id);
    // Even with a preset the list doesn't have: the claim is read first.
    for (const scene of [SCENE, { ...SCENE, setting: "nowhere" }]) {
      const response = await call("studio-self-minor-unconfirmed", { ...scene, details: "I'm 16, red silk sheets" });
      expect(response.status).toBe(422);
      expect(((await response.json()) as { code: string }).code).toBe("blocked_minor");
    }
    const row = await userRow(user.id);
    expect(row.explicitHoldAt).not.toBeNull();
    expect((await eventsFor(user.id)).map((event) => [event.category, event.action, event.targetId])).toEqual(
      expect.arrayContaining([
        ["minor", "blocked", "mira"],
        ["self_declared_minor", "escalated", "mira"],
      ]),
    );
    expect(await balanceOf(user.id)).toBe(before);
    expect(await rowsFor(user.id)).toHaveLength(0);

    // Confirming an age afterwards can't open the account, and the studio stays shut.
    const attest = (await import("@/app/api/age/attest/route")).POST;
    const confirmed = await attest(
      new Request("http://localhost/api/age/attest", {
        method: "POST",
        headers: { "x-dev-user": "studio-self-minor-unconfirmed", "Content-Type": "application/json" },
        body: JSON.stringify({ birthDate: "1990-01-01", consent: true }),
      }),
    );
    expect(confirmed.status).toBe(403);
    expect(((await confirmed.json()) as { code: string }).code).toBe("explicit_hold");
    expect(((await (await call("studio-self-minor-unconfirmed", SCENE)).json()) as { code: string }).code).toBe("explicit_hold");
    expect(await balanceOf(user.id)).toBe(before);
  });

  it("holds an account whose details say it's under 18 even when they're too long, or the character is missing", async () => {
    const user = await setup("studio-self-minor-oversized");
    const before = await balanceOf(user.id);
    const long = `I'm 16, red silk sheets ${"x".repeat(300)}`;
    for (const scene of [
      { ...SCENE, details: long },
      { setting: "bedroom", details: "I'm 16, red silk sheets" },
      { ...SCENE, characterId: 42, details: "I'm 16, red silk sheets" },
      // A list of strings in place of one says the same.
      { ...SCENE, details: ["I'm 16,", "red silk sheets"] },
    ]) {
      const response = await call("studio-self-minor-oversized", scene);
      expect(response.status, JSON.stringify(scene).slice(0, 60)).toBe(422);
      expect(((await response.json()) as { code: string }).code).toBe("blocked_minor");
    }
    const row = await userRow(user.id);
    expect(row.explicitHoldAt).not.toBeNull();
    const events = await eventsFor(user.id);
    expect(events.map((event) => [event.category, event.action, event.targetId])).toEqual(
      expect.arrayContaining([
        ["minor", "blocked", "mira"],
        ["minor", "blocked", null],
        ["self_declared_minor", "escalated", "mira"],
      ]),
    );
    expect(events.find((event) => event.category === "minor")?.details).toMatchObject({ excerpt: long.slice(0, 280) });
    expect(await balanceOf(user.id)).toBe(before);
    expect(await rowsFor(user.id)).toHaveLength(0);
  });

  it("refuses details that bring someone else into the scene", async () => {
    const user = await setup("studio-crowd");
    const before = await balanceOf(user.id);
    for (const details of [
      "with my boyfriend watching",
      "kissing another woman",
      "two girls together",
      "a threesome",
      "riding his cock",
      "doggy style on the bed",
      "a man's hand on her thigh",
      "his hands on her hips",
      // In the studio "you" is the viewer, so their body joins the scene.
      "your hands on her hips",
      "sitting on your lap",
    ]) {
      const response = await call("studio-crowd", { ...SCENE, details });
      expect(response.status, details).toBe(422);
      expect(((await response.json()) as { code: string }).code, details).toBe("studio_one_person");
    }
    expect(await balanceOf(user.id)).toBe(before);
    expect(await rowsFor(user.id)).toHaveLength(0);
    // Each logged as the classifier's refusals are, with what the word list
    // matched, so the admin queue doesn't depend on which caught it. Never minor.
    const events = await eventsFor(user.id);
    expect(events).toHaveLength(10);
    for (const event of events) {
      expect([event.category, event.action, event.targetType, event.targetId]).toEqual(["other_people", "blocked", "image_prompt", "mira"]);
      expect(event.details).toEqual({ source: "studio", matched: expect.any(String), excerpt: expect.any(String) });
    }
    expect(events.map((event) => (event.details as { excerpt: string }).excerpt)).toContain("sitting on your lap");
  });

  it("reads the character's own pronouns as theirs, and the other gender's as someone else", async () => {
    const user = await setup("studio-pronouns");
    const before = await balanceOf(user.id);
    // Mira is a woman, so "he" is a second person.
    const response = await call("studio-pronouns", { ...SCENE, details: "he watches from the doorway" });
    expect(response.status).toBe(422);
    expect(((await response.json()) as { code: string }).code).toBe("studio_one_person");
    expect(await balanceOf(user.id)).toBe(before);
    expect(await rowsFor(user.id)).toHaveLength(0);
  });

  it("refuses details the classifier sees someone else in, as the word list would, logged, before charging", async () => {
    const user = await setup("studio-classifier-others");
    const before = await balanceOf(user.id);
    // Something the word list lets through, which the classifier reads as a second person.
    const details = "legs wrapped around the one holding the camera";
    classifier(() => "BLOCK:other_people");
    const response = await call("studio-classifier-others", { ...SCENE, details });
    expect(response.status).toBe(422);
    const refused = (await response.json()) as { code: string; error: string };
    expect(refused.code).toBe("studio_one_person");
    expect(refused.error).toContain("Mira, alone");
    // Asked under the scene policy, which has the one-person rule.
    const sent = JSON.parse(String(vi.mocked(fetch).mock.calls.at(-1)![1]!.body)) as { messages: { content: string }[] };
    expect(sent.messages[0].content).toContain("- other_people:");
    expect((await eventsFor(user.id)).map((event) => [event.category, event.action, event.targetType, event.targetId, event.details])).toEqual([
      ["other_people", "blocked", "image_prompt", "mira", { source: "studio", matched: "classifier", excerpt: details }],
    ]);
    expect(await balanceOf(user.id)).toBe(before);
    expect(await rowsFor(user.id)).toHaveLength(0);
  });

  it("fails closed when the text classifier is down", async () => {
    const user = await setup("studio-classifier-down");
    const before = await balanceOf(user.id);
    classifier(() => new Error("classifier timed out"));
    const response = await call("studio-classifier-down", { ...SCENE, details: "rain on the window, red silk sheets" });
    expect(response.status).toBe(503);
    expect(((await response.json()) as { code: string }).code).toBe("moderation_unavailable");
    expect(await balanceOf(user.id)).toBe(before);
    expect(await rowsFor(user.id)).toHaveLength(0);
  });

  it("charges a photo, stores the keyframe and keeps nudity out of a scene that doesn't ask for it", async () => {
    const user = await setup("studio-ok");
    const before = await balanceOf(user.id);
    classifier(() => "ALLOW");
    const response = await call("studio-ok", { ...SCENE, details: "rain on the window, red silk sheets" });
    expect(response.status).toBe(200);
    const body = (await response.json()) as StudioFrameResponse;
    expect(body.media).toMatchObject({ kind: "image", status: "ready", url: `/api/media/${body.media.id}` });
    expect(body.balance).toBe(before - 8);
    expect(await balanceOf(user.id)).toBe(before - 8);

    const [row] = await rowsFor(user.id);
    expect(row).toMatchObject({ id: body.media.id, purpose: "studio", characterId: "mira", threadId: null, creditsSpent: 8 });
    expect(row.prompt).toContain("adult, 27-year-old woman");
    expect(row.prompt).toContain("alone, the only person in the scene");
    expect(row.prompt).toContain("softly lit bedroom");
    expect(row.prompt).toContain("lace lingerie");
    expect(row.prompt).toContain("rain on the window");
    expect(row.prompt).toContain("no nudity");
    // Nudity Hive finds is let through (she may drift out of the lingerie), so
    // the frame is marked explicit and hidden if the account is later held.
    expect(row.moderation).toMatchObject({
      explicit: true,
      style: "realistic",
      studio: { setting: "bedroom", outfit: "lingerie", action: "tease", details: true },
    });

    // Adult anchors, minor and other-people negatives go to the model.
    const request = vi.mocked(generateImage).mock.calls.at(-1)![0];
    expect(request.negativePrompt).toMatch(/child, teen, underage/);
    expect(request.negativePrompt).toContain("nude");
    expect(request.negativePrompt).toContain("multiple people");
    expect(request.negativePrompt).not.toMatch(/\b(?:woman|women|man|men|adult|mature)\b/);
    expect(vi.mocked(moderateImage).mock.calls.at(-1)![2]).toMatchObject({ allowExplicit: true, targetId: row.id });
  });

  it("makes a nude scene for any confirmed adult", async () => {
    const user = await setup("studio-explicit");
    const before = await balanceOf(user.id);
    const response = await call("studio-explicit", { ...SCENE, setting: "shower", outfit: "nude", action: "water" });
    expect(response.status).toBe(200);
    const body = (await response.json()) as StudioFrameResponse;
    expect(body.balance).toBe(before - 8);
    const [row] = await rowsFor(user.id);
    expect(row.prompt).toContain("fully nude");
    expect(row.prompt).toContain("nudity allowed");
    expect(row.prompt).toContain("alone");
    expect(row.moderation).toMatchObject({ explicit: true });
    const request = vi.mocked(generateImage).mock.calls.at(-1)![0];
    expect(request.negativePrompt).not.toMatch(/\bnude\b/);
    expect(request.negativePrompt).toMatch(/child, teen, underage/);
    expect(vi.mocked(moderateImage).mock.calls.at(-1)![2]).toMatchObject({ allowExplicit: true });
  });

  it("refunds when generation fails", async () => {
    const user = await setup("studio-gen-fail");
    const before = await balanceOf(user.id);
    vi.mocked(generateImage).mockRejectedValueOnce(new Error("worker down"));
    const response = await call("studio-gen-fail", SCENE);
    expect(response.status).toBe(502);
    expect(((await response.json()) as { error: string }).error).toContain("credits are back");
    expect(await balanceOf(user.id)).toBe(before);
    const [row] = await rowsFor(user.id);
    expect(row.status).toBe("failed");
  });

  it("refunds and logs when the worker refuses the image", async () => {
    const user = await setup("studio-worker-block");
    const before = await balanceOf(user.id);
    vi.mocked(generateImage).mockRejectedValueOnce(new ImageGenerationError("blocked", true, "apparent minor: loli"));
    const response = await call("studio-worker-block", SCENE);
    expect(response.status).toBe(502);
    expect(await balanceOf(user.id)).toBe(before);
    const [row] = await rowsFor(user.id);
    expect(row.status).toBe("blocked");
    expect((await eventsFor(user.id)).map((event) => [event.targetType, event.targetId])).toContainEqual(["image", row.id]);
  });

  it("refunds and keeps nothing when image moderation blocks the result", async () => {
    const user = await setup("studio-moderated");
    const before = await balanceOf(user.id);
    vi.mocked(moderateImage).mockResolvedValueOnce({ ok: false, categories: ["minor"], raw: { provider: "test" } });
    const response = await call("studio-moderated", SCENE);
    expect(response.status).toBe(422);
    expect(((await response.json()) as { code: string }).code).toBe("image_blocked");
    expect(await balanceOf(user.id)).toBe(before);
    const [row] = await rowsFor(user.id);
    expect(row).toMatchObject({ status: "blocked", storageKey: null });
  });

  it("refunds when the image check can't run", async () => {
    const user = await setup("studio-moderation-down");
    const before = await balanceOf(user.id);
    vi.mocked(moderateImage).mockResolvedValueOnce({ ok: false, categories: ["moderation_error"], raw: {}, unavailable: true });
    const response = await call("studio-moderation-down", SCENE);
    expect(response.status).toBe(503);
    expect(await balanceOf(user.id)).toBe(before);
    expect((await rowsFor(user.id))[0].status).toBe("failed");
  });

  it("charges nothing without enough credits", async () => {
    const user = await setup("studio-broke");
    const { eq } = await import("drizzle-orm");
    const database = await db();
    await database.update(schema.creditBalances).set({ balance: 3 }).where(eq(schema.creditBalances.userId, user.id));
    const response = await call("studio-broke", SCENE);
    expect(response.status).toBe(402);
    expect(((await response.json()) as { code: string }).code).toBe("insufficient_credits");
    expect(await balanceOf(user.id)).toBe(3);
    expect((await rowsFor(user.id))[0].status).toBe("failed");
  });
});
