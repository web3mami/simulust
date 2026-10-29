import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { CharacterDTO } from "@/lib/api-types";

// Runs on the offline mock SVG images. Generation and image moderation are the
// real functions wrapped, so a test can script one failure or block.
vi.mock("@/server/images", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/images")>();
  return { ...actual, generateImage: vi.fn(actual.generateImage) };
});
vi.mock("@/server/image-moderation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/image-moderation")>();
  return { ...actual, moderateImage: vi.fn(actual.moderateImage) };
});

let mediaDir: string;
type Handler = (request: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
type Portrait = { character: CharacterDTO; balance: number };
let POST: Handler;
let image: Handler;
let createCharacterRoute: (request: Request) => Promise<Response>;
let db: typeof import("@/server/db").db;
let schema: typeof import("@/server/db/schema");
let currentUser: typeof import("@/server/auth").currentUser;
let balanceOf: typeof import("@/server/credits").balanceOf;
let generateImage: typeof import("@/server/images").generateImage;
let ImageGenerationError: typeof import("@/server/images").ImageGenerationError;
let moderateImage: typeof import("@/server/image-moderation").moderateImage;

beforeAll(async () => {
  mediaDir = await mkdtemp(path.join(os.tmpdir(), "simulust-explicit-portrait-"));
  vi.stubEnv("MEDIA_DIR", mediaDir);
  vi.stubEnv("IMAGE_PROVIDER", "mock");
  vi.resetModules();
  POST = (await import("./route")).POST as unknown as Handler;
  image = (await import("../explicit-image/route")).GET as unknown as Handler;
  createCharacterRoute = (await import("../../route")).POST;
  db = (await import("@/server/db")).db;
  schema = await import("@/server/db/schema");
  currentUser = (await import("@/server/auth")).currentUser;
  balanceOf = (await import("@/server/credits")).balanceOf;
  ({ generateImage, ImageGenerationError } = await import("@/server/images"));
  ({ moderateImage } = await import("@/server/image-moderation"));
});

afterEach(() => {
  vi.mocked(generateImage).mockClear();
  vi.mocked(moderateImage).mockClear();
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await rm(mediaDir, { recursive: true, force: true });
});

const as = (handle: string, url = "http://localhost") => new Request(url, { headers: { "x-dev-user": handle } });

// An adult by the date of birth given at sign-up (or an older account that
// never confirmed one), and an explicit hold. Confirmed is all a nude portrait
// needs: there's no switch to turn on.
async function viewer(handle: string, { adult = true, hold = false } = {}) {
  const { eq } = await import("drizzle-orm");
  const user = (await currentUser(as(handle)))!;
  await (await db())
    .update(schema.users)
    .set({ ageAttestedAt: adult ? new Date() : null, explicitHoldAt: hold ? new Date() : null })
    .where(eq(schema.users.id, user.id));
  return user;
}

async function ownCharacter(ownerId: string, id: string, overrides: Partial<typeof schema.characters.$inferInsert> = {}) {
  await (await db()).insert(schema.characters).values({
    id,
    ownerId,
    name: "Elena",
    age: 29,
    gender: "Woman",
    ethnicity: "Latina",
    body: "Curvy",
    role: "Girlfriend",
    heat: "Playful",
    line: "Elena is playful.",
    lane: "girls",
    style: "realistic",
    hair: "Brunette",
    hairStyle: "Wavy",
    eyeColor: "Brown",
    breast: "Medium",
    ...overrides,
  });
}

async function characterRow(id: string) {
  const { eq } = await import("drizzle-orm");
  const [row] = await (await db()).select().from(schema.characters).where(eq(schema.characters.id, id));
  return row;
}

async function mediaOf(characterId: string) {
  const { eq } = await import("drizzle-orm");
  return (await db()).select().from(schema.media).where(eq(schema.media.characterId, characterId));
}

function call(handle: string, id: string) {
  return POST(new Request(`http://localhost/api/characters/${id}/explicit-portrait`, { method: "POST", headers: { "x-dev-user": handle } }), {
    params: Promise.resolve({ id }),
  });
}

async function code(response: Response) {
  return ((await response.json()) as { code: string }).code;
}

describe("POST /api/characters/[id]/explicit-portrait", () => {
  it("needs a login and a confirmed adult with no hold", async () => {
    const response = await POST(new Request("http://localhost/api/characters/x/explicit-portrait", { method: "POST" }), {
      params: Promise.resolve({ id: "x" }),
    });
    expect(response.status).toBe(401);

    const minor = await viewer("xp-unverified", { adult: false });
    await ownCharacter(minor.id, "xp-unverified-c");
    const unverified = await call("xp-unverified", "xp-unverified-c");
    expect(unverified.status).toBe(403);
    expect(await code(unverified)).toBe("age_verification_required");

    const held = await viewer("xp-held", { hold: true });
    await ownCharacter(held.id, "xp-held-c");
    const response2 = await call("xp-held", "xp-held-c");
    expect(response2.status).toBe(403);
    expect(await code(response2)).toBe("explicit_hold");
    expect(await balanceOf(held.id)).toBe(50);
    expect(await balanceOf(minor.id)).toBe(50);
    expect(generateImage).not.toHaveBeenCalled();
  });

  it("only draws the user's own character", async () => {
    const owner = await viewer("xp-owner");
    await viewer("xp-stranger");
    await ownCharacter(owner.id, "xp-owned");
    expect((await call("xp-stranger", "xp-owned")).status).toBe(404);
    // Official characters get their art from the script, not from users.
    expect((await call("xp-stranger", "mira")).status).toBe(404);
    expect((await call("xp-stranger", "nobody")).status).toBe(404);
    expect(generateImage).not.toHaveBeenCalled();
  });

  it("charges, draws one adult from the stored look and points the character at it", async () => {
    const user = await viewer("xp-ok");
    await ownCharacter(user.id, "xp-ok-c");
    const response = await call("xp-ok", "xp-ok-c");
    expect(response.status).toBe(200);
    const body = (await response.json()) as Portrait;
    expect(body.balance).toBe(50 - 8);
    expect(body.character.explicitImage).toMatch(/^\/api\/characters\/xp-ok-c\/explicit-image\?v=[0-9a-f]{8}$/);
    // Only through the character's checked route, never a raw media URL.
    expect(JSON.stringify(body)).not.toContain("/api/media/");

    const prompt = vi.mocked(generateImage).mock.calls[0][0];
    expect(prompt.prompt).toContain("adult, 29-year-old woman");
    expect(prompt.prompt).toContain("nude");
    expect(prompt.prompt).toContain("only one person in frame");
    expect(prompt.prompt).toContain("latina, brunette wavy hair, brown eyes, curvy, medium bust");
    for (const never of ["child", "teen", "underage", "young-looking", "celebrity"]) expect(prompt.negativePrompt).toContain(never);
    expect(prompt.negativePrompt).not.toContain("nudity");
    expect(vi.mocked(moderateImage).mock.calls[0][2]).toMatchObject({ targetType: "image", allowExplicit: true, userId: user.id });

    const row = await characterRow("xp-ok-c");
    const [media] = await mediaOf("xp-ok-c");
    expect(row.explicitImageMediaId).toBe(media.id);
    expect(row.explicitImageUrl).toBe("/api/characters/xp-ok-c/explicit-image");
    expect(media).toMatchObject({ userId: user.id, purpose: "portrait", kind: "image", status: "ready", creditsSpent: 8 });
    expect(media.moderation).toMatchObject({ explicit: true });

    const served = await image(as("xp-ok", "http://localhost/api/characters/xp-ok-c/explicit-image"), {
      params: Promise.resolve({ id: "xp-ok-c" }),
    });
    expect(served.status).toBe(200);
  });

  it("refunds a portrait that moderation blocks, and keeps nothing", async () => {
    const user = await viewer("xp-blocked");
    await ownCharacter(user.id, "xp-blocked-c");
    vi.mocked(moderateImage).mockResolvedValueOnce({ ok: false, categories: ["minor"], raw: {} });
    const response = await call("xp-blocked", "xp-blocked-c");
    expect(response.status).toBe(422);
    expect(await code(response)).toBe("image_blocked");
    expect(await balanceOf(user.id)).toBe(50);
    expect((await characterRow("xp-blocked-c")).explicitImageMediaId).toBeNull();
    const [media] = await mediaOf("xp-blocked-c");
    expect(media).toMatchObject({ status: "blocked", storageKey: null });
  });

  it("refunds when moderation can't run", async () => {
    const user = await viewer("xp-down");
    await ownCharacter(user.id, "xp-down-c");
    vi.mocked(moderateImage).mockResolvedValueOnce({ ok: false, categories: [], raw: {}, unavailable: true });
    const response = await call("xp-down", "xp-down-c");
    expect(response.status).toBe(503);
    expect(await code(response)).toBe("moderation_unavailable");
    expect(await balanceOf(user.id)).toBe(50);
    expect((await characterRow("xp-down-c")).explicitImageMediaId).toBeNull();
  });

  it("refunds a worker refusal and logs it", async () => {
    const { and, eq } = await import("drizzle-orm");
    const user = await viewer("xp-worker");
    await ownCharacter(user.id, "xp-worker-c");
    vi.mocked(generateImage).mockRejectedValueOnce(new ImageGenerationError("blocked", true, "minor:teen"));
    const response = await call("xp-worker", "xp-worker-c");
    expect(response.status).toBe(502);
    expect(await balanceOf(user.id)).toBe(50);
    const events = await (await db())
      .select()
      .from(schema.moderationEvents)
      .where(and(eq(schema.moderationEvents.userId, user.id), eq(schema.moderationEvents.category, "minor")));
    expect(events).toHaveLength(1);
    expect((await mediaOf("xp-worker-c"))[0].status).toBe("blocked");
  });

  it("refunds a generation failure", async () => {
    const user = await viewer("xp-fail");
    await ownCharacter(user.id, "xp-fail-c");
    vi.mocked(generateImage).mockRejectedValueOnce(new Error("GPU fell over"));
    const response = await call("xp-fail", "xp-fail-c");
    expect(response.status).toBe(502);
    expect(await code(response)).toBe("generation_failed");
    expect(await balanceOf(user.id)).toBe(50);
  });

  it("refunds when something unexpected throws mid-draw", async () => {
    const user = await viewer("xp-throw");
    await ownCharacter(user.id, "xp-throw-c");
    vi.mocked(moderateImage).mockRejectedValueOnce(new Error("socket hang up"));
    const response = await call("xp-throw", "xp-throw-c");
    expect(response.status).toBe(502);
    expect(await code(response)).toBe("generation_failed");
    expect(await balanceOf(user.id)).toBe(50);
    expect((await characterRow("xp-throw-c")).explicitImageMediaId).toBeNull();
    expect((await mediaOf("xp-throw-c"))[0]).toMatchObject({ status: "failed", storageKey: null });
  });

  it("asks for credits before drawing", async () => {
    const { eq } = await import("drizzle-orm");
    const user = await viewer("xp-broke");
    await ownCharacter(user.id, "xp-broke-c");
    await (await db()).update(schema.creditBalances).set({ balance: 3 }).where(eq(schema.creditBalances.userId, user.id));
    const response = await call("xp-broke", "xp-broke-c");
    expect(response.status).toBe(402);
    expect(generateImage).not.toHaveBeenCalled();
    expect((await mediaOf("xp-broke-c"))[0].status).toBe("failed");
  });

  it("refuses a minor-coded name on a stored character before charging", async () => {
    const user = await viewer("xp-minor");
    await ownCharacter(user.id, "xp-minor-c", { name: "Yuki, 17" });
    const response = await call("xp-minor", "xp-minor-c");
    expect(response.status).toBe(422);
    expect(await code(response)).toBe("blocked_minor");
    expect(await balanceOf(user.id)).toBe(50);
    expect(generateImage).not.toHaveBeenCalled();
    expect(await mediaOf("xp-minor-c")).toEqual([]);
  });

  it("never lets a nude portrait become a character's regular face", async () => {
    const user = await viewer("xp-face");
    await ownCharacter(user.id, "xp-face-c");
    expect((await call("xp-face", "xp-face-c")).status).toBe(200);
    const [nude] = await mediaOf("xp-face-c");
    const response = await createCharacterRoute(
      new Request("http://localhost/api/characters", {
        method: "POST",
        headers: { "x-dev-user": "xp-face", "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Aya",
          age: 24,
          gender: "Woman",
          style: "realistic",
          ethnicity: "Latina",
          body: "Curvy",
          hair: "Black",
          hairStyle: "Wavy",
          eyeColor: "Brown",
          breast: "Medium",
          role: "Girlfriend",
          personality: "Playful",
          occupation: "Designer",
          kinks: [],
          imageMediaId: nude.id,
        }),
      }),
    );
    expect(response.status).toBe(422);
    expect(await code(response)).toBe("portrait_explicit");
  });
});
