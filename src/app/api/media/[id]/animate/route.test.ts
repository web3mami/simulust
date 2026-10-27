import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { MediaDTO } from "@/lib/api-types";

// The real text screen, which a test can script for one call.
vi.mock("@/server/safety/text", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/safety/text")>();
  return { ...actual, checkImagePrompt: vi.fn(actual.checkImagePrompt) };
});

// Video without a GPU worker: the mock image provider gets a placeholder clip so
// the flow works offline; real images without a worker get a clear refusal.
let mediaDir: string;
type Handler = (request: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

beforeAll(async () => {
  mediaDir = await mkdtemp(path.join(os.tmpdir(), "simulust-animate-"));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(async () => {
  await rm(mediaDir, { recursive: true, force: true });
});

async function load(provider: "mock" | "pollinations") {
  vi.stubEnv("MEDIA_DIR", mediaDir);
  vi.stubEnv("IMAGE_PROVIDER", provider);
  vi.resetModules();
  return {
    animate: (await import("./route")).POST as unknown as Handler,
    status: (await import("../status/route")).GET as unknown as Handler,
    file: (await import("../route")).GET as unknown as Handler,
    db: (await import("@/server/db")).db,
    schema: await import("@/server/db/schema"),
    media: await import("@/server/media"),
    images: await import("@/server/images"),
    currentUser: (await import("@/server/auth")).currentUser,
    balanceOf: (await import("@/server/credits")).balanceOf,
    text: await import("@/server/safety/text"),
  };
}

async function setup(mod: Awaited<ReturnType<typeof load>>, handle: string) {
  const { eq } = await import("drizzle-orm");
  const user = (await mod.currentUser(new Request("http://localhost", { headers: { "x-dev-user": handle } })))!;
  await (await mod.db())
    .update(mod.schema.users)
    .set({ ageStatus: "approved", ageVerifiedAt: new Date() })
    .where(eq(mod.schema.users.id, user.id));
  await (await mod.db()).update(mod.schema.creditBalances).set({ balance: 100 }).where(eq(mod.schema.creditBalances.userId, user.id));
  const photo = await mod.media.createMedia({ userId: user.id, kind: "image", purpose: "chat" });
  const image = await mod.images.generateImage({ prompt: "test", negativePrompt: "", width: 512, height: 640, style: "realistic", label: "Mira" });
  await mod.media.storeMedia(photo, image.bytes, image.mimeType);
  return { user, photo };
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const as = (handle: string, url: string, init: RequestInit = {}) =>
  new Request(url, { ...init, headers: { "x-dev-user": handle, "Content-Type": "application/json" } });

describe("animate without a GPU worker", () => {
  it("plays a placeholder clip with the mock provider", async () => {
    const mod = await load("mock");
    const { user, photo } = await setup(mod, "animate-a");
    const started = await mod.animate(as("animate-a", "http://localhost/x", { method: "POST", body: "{}" }), params(photo.id));
    expect(started.status).toBe(202);
    const { media, balance } = (await started.json()) as { media: MediaDTO; balance: number };
    expect(media.status).toBe("pending");
    expect(balance).toBe(40);

    const { eq } = await import("drizzle-orm");
    await (await mod.db()).update(mod.schema.media).set({ createdAt: new Date(Date.now() - 10_000) }).where(eq(mod.schema.media.id, media.id));
    const polled = await mod.status(as("animate-a", "http://localhost/x"), params(media.id));
    const { media: ready } = (await polled.json()) as { media: MediaDTO };
    expect(ready.status).toBe("ready");

    const file = await mod.file(as("animate-a", "http://localhost/x"), params(media.id));
    expect(file.headers.get("content-type")).toBe("video/mp4");
    const bytes = new Uint8Array(await file.arrayBuffer());
    expect(new TextDecoder().decode(bytes.subarray(4, 8))).toBe("ftyp");
    expect(await mod.balanceOf(user.id)).toBe(40);
  });

  it("charges once when the same photo is animated twice at the same time", async () => {
    const mod = await load("mock");
    const { user, photo } = await setup(mod, "animate-c");
    const post = () => mod.animate(as("animate-c", "http://localhost/x", { method: "POST", body: "{}" }), params(photo.id));
    const [first, second] = await Promise.all([post(), post()]);
    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    const a = (await first.json()) as { media: MediaDTO };
    const b = (await second.json()) as { media: MediaDTO };
    expect(a.media.id).toBe(b.media.id);
    expect(await mod.balanceOf(user.id)).toBe(40);
  });

  it("says video needs the worker, without charging, for real images", async () => {
    const mod = await load("pollinations");
    const user = (await mod.currentUser(new Request("http://localhost", { headers: { "x-dev-user": "animate-b" } })))!;
    const { eq } = await import("drizzle-orm");
    const database = await mod.db();
    await database.update(mod.schema.users).set({ ageStatus: "approved", ageVerifiedAt: new Date() }).where(eq(mod.schema.users.id, user.id));
    const photo = await mod.media.createMedia({ userId: user.id, kind: "image", purpose: "chat" });
    await mod.media.storeMedia(photo, new Uint8Array(2000), "image/png");
    const before = await mod.balanceOf(user.id);

    const response = await mod.animate(as("animate-b", "http://localhost/x", { method: "POST", body: "{}" }), params(photo.id));
    expect(response.status).toBe(503);
    expect(((await response.json()) as { error: string }).error).toContain("GPU worker");
    expect(await mod.balanceOf(user.id)).toBe(before);
  });

  it("treats a prompt the worker refuses as a block, not an outage", async () => {
    vi.stubEnv("VIDEO_API_URL", "http://worker.test");
    vi.stubEnv("VIDEO_API_KEY", "video-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: "blocked", reason: "minor:teen" }, { status: 422 })),
    );
    try {
      const mod = await load("mock");
      const { eq } = await import("drizzle-orm");
      const user = (await mod.currentUser(new Request("http://localhost", { headers: { "x-dev-user": "animate-d" } })))!;
      const database = await mod.db();
      await database.update(mod.schema.users).set({ ageStatus: "approved", ageVerifiedAt: new Date() }).where(eq(mod.schema.users.id, user.id));
      await database.update(mod.schema.creditBalances).set({ balance: 100 }).where(eq(mod.schema.creditBalances.userId, user.id));
      const photo = await mod.media.createMedia({ userId: user.id, kind: "image", purpose: "chat" });
      await mod.media.storeMedia(photo, new Uint8Array(2000), "image/png");

      const response = await mod.animate(as("animate-d", "http://localhost/x", { method: "POST", body: "{}" }), params(photo.id));
      expect(response.status).toBe(422);
      expect(((await response.json()) as { code: string }).code).toBe("video_blocked");
      expect(await mod.balanceOf(user.id)).toBe(100);
      const videos = await database.select().from(mod.schema.media).where(eq(mod.schema.media.sourceMediaId, photo.id));
      expect(videos.map((row) => row.status)).toEqual(["blocked"]);
      const events = await database
        .select()
        .from(mod.schema.moderationEvents)
        .where(eq(mod.schema.moderationEvents.targetId, videos[0].id));
      expect(events.map((event) => event.category)).toEqual(["minor"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("motions with words that are fine in chat but never in a video", () => {
  it("refuses them before charging, without a moderation event", async () => {
    const worker = vi.fn(async () => Response.json({ error: "blocked", reason: "term:minor" }, { status: 422 }));
    vi.stubEnv("VIDEO_API_URL", "http://worker.test");
    vi.stubGlobal("fetch", worker);
    try {
      const mod = await load("mock");
      const { eq } = await import("drizzle-orm");
      const { user, photo } = await setup(mod, "animate-terms");
      for (const prompt of [
        "a minor tilt of the head",
        "laughs like a kid at christmas",
        "stretches into child's pose on a yoga mat",
        "wearing her old high school hoodie, stretching",
      ]) {
        const response = await mod.animate(
          as("animate-terms", "http://localhost/x", { method: "POST", body: JSON.stringify({ prompt }) }),
          params(photo.id),
        );
        expect(response.status, prompt).toBe(422);
        expect(((await response.json()) as { code: string }).code).toBe("blocked_image_prompt");
      }
      expect(worker).not.toHaveBeenCalled();
      expect(await mod.balanceOf(user.id)).toBe(100);
      const database = await mod.db();
      expect(await database.select().from(mod.schema.media).where(eq(mod.schema.media.sourceMediaId, photo.id))).toEqual([]);
      expect(await database.select().from(mod.schema.moderationEvents).where(eq(mod.schema.moderationEvents.userId, user.id))).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("logs a motion that pairs such a word with a sexual one as minor content, before charging", async () => {
    const worker = vi.fn(async () => Response.json({ error: "unexpected" }, { status: 500 }));
    vi.stubEnv("VIDEO_API_URL", "http://worker.test");
    vi.stubGlobal("fetch", worker);
    try {
      const mod = await load("mock");
      const { eq } = await import("drizzle-orm");
      const { user, photo } = await setup(mod, "animate-minor");
      // Stands in for a motion that puts a sexual word near an age under 18, a
      // child or a family word: checkText lets it through, checkImagePrompt marks it.
      vi.mocked(mod.text.checkImagePrompt).mockReturnValueOnce({ ok: false, category: "image", matched: "daughter", minor: "daughter" });
      const response = await mod.animate(
        as("animate-minor", "http://localhost/x", { method: "POST", body: JSON.stringify({ prompt: "turns toward the window" }) }),
        params(photo.id),
      );
      expect(response.status).toBe(422);
      expect(((await response.json()) as { code: string }).code).toBe("blocked_minor");
      expect(worker).not.toHaveBeenCalled();
      expect(await mod.balanceOf(user.id)).toBe(100);
      const database = await mod.db();
      const events = await database.select().from(mod.schema.moderationEvents).where(eq(mod.schema.moderationEvents.userId, user.id));
      expect(events.map((event) => [event.category, event.action, event.targetType, event.targetId, event.details])).toEqual([
        ["minor", "blocked", "video", photo.id, { matched: "daughter", excerpt: "turns toward the window" }],
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("files a worker's image-only word refusal as a worker refusal, not minor content", async () => {
    vi.stubEnv("VIDEO_API_URL", "http://worker.test");
    vi.stubEnv("VIDEO_API_KEY", "video-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: "blocked", reason: "term:kid" }, { status: 422 })),
    );
    try {
      const mod = await load("mock");
      const { eq } = await import("drizzle-orm");
      const user = (await mod.currentUser(new Request("http://localhost", { headers: { "x-dev-user": "animate-term" } })))!;
      const database = await mod.db();
      await database.update(mod.schema.users).set({ ageStatus: "approved", ageVerifiedAt: new Date() }).where(eq(mod.schema.users.id, user.id));
      await database.update(mod.schema.creditBalances).set({ balance: 100 }).where(eq(mod.schema.creditBalances.userId, user.id));
      const photo = await mod.media.createMedia({ userId: user.id, kind: "image", purpose: "chat" });
      await mod.media.storeMedia(photo, new Uint8Array(2000), "image/png");

      const response = await mod.animate(as("animate-term", "http://localhost/x", { method: "POST", body: "{}" }), params(photo.id));
      expect(response.status).toBe(422);
      expect(await mod.balanceOf(user.id)).toBe(100);
      const events = await database.select().from(mod.schema.moderationEvents).where(eq(mod.schema.moderationEvents.userId, user.id));
      expect(events.map((event) => event.category)).toEqual(["worker_refused"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
