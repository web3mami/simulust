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

describe("who can animate what", () => {
  it("is closed to an account on an explicit hold, before charging", async () => {
    const mod = await load("mock");
    const { eq } = await import("drizzle-orm");
    const { user, photo } = await setup(mod, "animate-held");
    await (await mod.db()).update(mod.schema.users).set({ explicitHoldAt: new Date() }).where(eq(mod.schema.users.id, user.id));
    const response = await mod.animate(as("animate-held", "http://localhost/x", { method: "POST", body: "{}" }), params(photo.id));
    expect(response.status).toBe(403);
    expect(((await response.json()) as { code: string }).code).toBe("explicit_hold");
    expect(await mod.balanceOf(user.id)).toBe(100);
    expect(await (await mod.db()).select().from(mod.schema.media).where(eq(mod.schema.media.sourceMediaId, photo.id))).toEqual([]);
  });

  it("won't animate a photo the viewer may not see, before charging", async () => {
    // A viewer explicitAllowed turns away. requireVerifiedAdult turns away the
    // same people today, so the check is switched off on its own here.
    vi.doMock("@/server/auth", async (importOriginal) => ({
      ...(await importOriginal<typeof import("@/server/auth")>()),
      explicitAllowed: () => false,
    }));
    let mod: Awaited<ReturnType<typeof load>>;
    try {
      mod = await load("mock");
    } finally {
      vi.doUnmock("@/server/auth");
    }
    const { eq } = await import("drizzle-orm");
    const user = (await mod.currentUser(new Request("http://localhost", { headers: { "x-dev-user": "animate-hidden" } })))!;
    const database = await mod.db();
    await database.update(mod.schema.users).set({ ageAttestedAt: new Date() }).where(eq(mod.schema.users.id, user.id));
    await database.update(mod.schema.creditBalances).set({ balance: 100 }).where(eq(mod.schema.creditBalances.userId, user.id));
    // A nude photo (made with nudity allowed through moderation).
    const photo = await mod.media.createMedia({ userId: user.id, kind: "image", purpose: "studio" });
    await mod.media.storeMedia(photo, new Uint8Array(2000), "image/png", { explicit: true });

    // The file route's 404, and nothing charged.
    const response = await mod.animate(as("animate-hidden", "http://localhost/x", { method: "POST", body: "{}" }), params(photo.id));
    expect(response.status).toBe(404);
    expect(await mod.balanceOf(user.id)).toBe(100);
    expect(await database.select().from(mod.schema.media).where(eq(mod.schema.media.sourceMediaId, photo.id))).toEqual([]);

    // With the real check, a confirmed adult animates it.
    const real = await load("mock");
    const allowed = await real.animate(as("animate-hidden", "http://localhost/x", { method: "POST", body: "{}" }), params(photo.id));
    expect(allowed.status).toBe(202);
    expect(await real.balanceOf(user.id)).toBe(40);
  });

  it("puts a self-declared minor on an explicit hold and logs it for review, before charging", async () => {
    const worker = vi.fn(async () => Response.json({ error: "unexpected" }, { status: 500 }));
    vi.stubEnv("VIDEO_API_URL", "http://worker.test");
    vi.stubGlobal("fetch", worker);
    try {
      const mod = await load("mock");
      const { eq } = await import("drizzle-orm");
      const { user, photo } = await setup(mod, "animate-self-minor");
      const response = await mod.animate(
        as("animate-self-minor", "http://localhost/x", { method: "POST", body: JSON.stringify({ prompt: "I'm 15, she waves" }) }),
        params(photo.id),
      );
      expect(response.status).toBe(422);
      expect(((await response.json()) as { code: string }).code).toBe("blocked_minor");
      expect(worker).not.toHaveBeenCalled();
      expect(await mod.balanceOf(user.id)).toBe(100);
      const database = await mod.db();
      const [row] = await database.select().from(mod.schema.users).where(eq(mod.schema.users.id, user.id));
      expect(row.explicitHoldAt).not.toBeNull();
      const events = await database.select().from(mod.schema.moderationEvents).where(eq(mod.schema.moderationEvents.userId, user.id));
      expect(events.map((event) => [event.category, event.action, event.targetType, event.targetId])).toEqual(
        expect.arrayContaining([
          ["minor", "blocked", "video", photo.id],
          ["self_declared_minor", "escalated", "video", photo.id],
        ]),
      );
      expect(await database.select().from(mod.schema.media).where(eq(mod.schema.media.sourceMediaId, photo.id))).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("holds an unconfirmed account whose motion says it's under 18, before the age check and without charging", async () => {
    const worker = vi.fn(async () => Response.json({ error: "unexpected" }, { status: 500 }));
    vi.stubEnv("VIDEO_API_URL", "http://worker.test");
    vi.stubGlobal("fetch", worker);
    try {
      const mod = await load("mock");
      const { eq } = await import("drizzle-orm");
      const { user, photo } = await setup(mod, "animate-self-minor-unconfirmed");
      const database = await mod.db();
      await database
        .update(mod.schema.users)
        .set({ ageStatus: "none", ageVerifiedAt: null, ageAttestedAt: null })
        .where(eq(mod.schema.users.id, user.id));
      const send = (id: string, prompt: string) =>
        mod.animate(
          as("animate-self-minor-unconfirmed", "http://localhost/x", { method: "POST", body: JSON.stringify({ prompt }) }),
          params(id),
        );

      const response = await send(photo.id, "I'm 15, she waves");
      expect(response.status).toBe(422);
      expect(((await response.json()) as { code: string }).code).toBe("blocked_minor");
      // A photo that isn't there (or isn't theirs) still holds the account.
      const missing = await send("00000000-0000-4000-8000-000000000000", "I'm 15, she waves");
      expect(((await missing.json()) as { code: string }).code).toBe("blocked_minor");

      const [row] = await database.select().from(mod.schema.users).where(eq(mod.schema.users.id, user.id));
      expect(row.explicitHoldAt).not.toBeNull();
      const events = await database.select().from(mod.schema.moderationEvents).where(eq(mod.schema.moderationEvents.userId, user.id));
      expect(events.map((event) => [event.category, event.action, event.targetType, event.targetId])).toEqual(
        expect.arrayContaining([
          ["minor", "blocked", "video", photo.id],
          ["self_declared_minor", "escalated", "video", photo.id],
          ["minor", "blocked", "video", null],
        ]),
      );
      expect(worker).not.toHaveBeenCalled();
      expect(await mod.balanceOf(user.id)).toBe(100);
      expect(await database.select().from(mod.schema.media).where(eq(mod.schema.media.sourceMediaId, photo.id))).toEqual([]);

      // Confirming an age afterwards can't open the account, and video stays shut.
      const attest = (await import("@/app/api/age/attest/route")).POST;
      const confirmed = await attest(
        as("animate-self-minor-unconfirmed", "http://localhost/api/age/attest", {
          method: "POST",
          body: JSON.stringify({ birthDate: "1990-01-01", consent: true }),
        }),
      );
      expect(confirmed.status).toBe(403);
      expect(((await confirmed.json()) as { code: string }).code).toBe("explicit_hold");
      const later = await mod.animate(as("animate-self-minor-unconfirmed", "http://localhost/x", { method: "POST", body: "{}" }), params(photo.id));
      expect(((await later.json()) as { code: string }).code).toBe("explicit_hold");
      expect(await mod.balanceOf(user.id)).toBe(100);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("holds an account whose motion says it's under 18 even when the request is too long or malformed to take", async () => {
    const worker = vi.fn(async () => Response.json({ error: "unexpected" }, { status: 500 }));
    vi.stubEnv("VIDEO_API_URL", "http://worker.test");
    vi.stubGlobal("fetch", worker);
    try {
      const mod = await load("mock");
      const { eq } = await import("drizzle-orm");
      const { user, photo } = await setup(mod, "animate-self-minor-oversized");
      const long = `I'm 15, she waves ${"x".repeat(400)}`;
      // A list of strings in place of one says the same.
      for (const body of [{ prompt: long }, { prompt: "I'm 15, she waves", extra: [1, 2] }, { prompt: ["I'm 15,", "she waves"] }]) {
        const response = await mod.animate(
          as("animate-self-minor-oversized", "http://localhost/x", { method: "POST", body: JSON.stringify(body) }),
          params(photo.id),
        );
        expect(response.status).toBe(422);
        expect(((await response.json()) as { code: string }).code).toBe("blocked_minor");
      }
      expect(worker).not.toHaveBeenCalled();
      expect(await mod.balanceOf(user.id)).toBe(100);
      const database = await mod.db();
      const [row] = await database.select().from(mod.schema.users).where(eq(mod.schema.users.id, user.id));
      expect(row.explicitHoldAt).not.toBeNull();
      const events = await database.select().from(mod.schema.moderationEvents).where(eq(mod.schema.moderationEvents.userId, user.id));
      expect(events.map((event) => [event.category, event.action, event.targetType, event.targetId])).toEqual(
        expect.arrayContaining([
          ["minor", "blocked", "video", photo.id],
          ["self_declared_minor", "escalated", "video", photo.id],
        ]),
      );
      expect(events.find((event) => event.category === "minor")?.details).toMatchObject({ excerpt: long.slice(0, 280) });
      expect(await database.select().from(mod.schema.media).where(eq(mod.schema.media.sourceMediaId, photo.id))).toEqual([]);

      // A motion over the limit that says nothing about age is still turned away.
      const plain = await mod.animate(
        as("animate-self-minor-oversized", "http://localhost/x", { method: "POST", body: JSON.stringify({ prompt: "x".repeat(301) }) }),
        params(photo.id),
      );
      expect(plain.status).toBe(400);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("refuses a motion that brings someone else into the clip, before charging", async () => {
    const worker = vi.fn(async () => Response.json({ error: "unexpected" }, { status: 500 }));
    vi.stubEnv("VIDEO_API_URL", "http://worker.test");
    vi.stubGlobal("fetch", worker);
    try {
      const mod = await load("mock");
      const { eq } = await import("drizzle-orm");
      const { user, photo } = await setup(mod, "animate-others");
      // "you" is the viewer, as in the studio: their body in the clip is them joining it.
      for (const prompt of [
        "a man walks in and kisses her",
        "she rides him slowly",
        "riding you",
        "a blowjob",
        "your hands slide over her hips",
        "she pulls your fingers to her lips",
      ]) {
        const response = await mod.animate(
          as("animate-others", "http://localhost/x", { method: "POST", body: JSON.stringify({ prompt }) }),
          params(photo.id),
        );
        expect(response.status, prompt).toBe(422);
        expect(((await response.json()) as { code: string }).code, prompt).toBe("video_one_person");
      }
      expect(worker).not.toHaveBeenCalled();
      expect(await mod.balanceOf(user.id)).toBe(100);
      const database = await mod.db();
      expect(await database.select().from(mod.schema.media).where(eq(mod.schema.media.sourceMediaId, photo.id))).toEqual([]);
      // Each logged as the classifier's refusals are, with what the word list
      // matched, so the admin queue doesn't depend on which caught it. Never minor.
      const events = await database.select().from(mod.schema.moderationEvents).where(eq(mod.schema.moderationEvents.userId, user.id));
      expect(events).toHaveLength(6);
      for (const event of events) {
        expect([event.category, event.action, event.targetType, event.targetId]).toEqual(["other_people", "blocked", "video", photo.id]);
        expect(event.details).toEqual({ matched: expect.any(String), excerpt: expect.any(String) });
      }
      expect(events.map((event) => (event.details as { excerpt: string }).excerpt)).toContain("riding you");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("one person in every clip", () => {
  async function photoOf(mod: Awaited<ReturnType<typeof load>>, handle: string, characterId: string) {
    const { eq } = await import("drizzle-orm");
    const { user } = await setup(mod, handle);
    // Enough for two clips.
    await (await mod.db()).update(mod.schema.creditBalances).set({ balance: 200 }).where(eq(mod.schema.creditBalances.userId, user.id));
    const photo = await mod.media.createMedia({ userId: user.id, characterId, kind: "image", purpose: "chat" });
    await mod.media.storeMedia(photo, new Uint8Array(2000), "image/png");
    const [row] = await (await mod.db()).select().from(mod.schema.media).where(eq(mod.schema.media.id, photo.id));
    return { user, photo: row };
  }

  it("sends the worker the one-person anchor and the other-people negatives", async () => {
    const sent: { prompt: string; negative_prompt: string }[] = [];
    vi.stubEnv("VIDEO_API_URL", "http://worker.test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        sent.push(JSON.parse(String(init?.body)));
        return Response.json({ job_id: `job-${sent.length}`, status: "queued" }, { status: 202 });
      }),
    );
    try {
      const mod = await load("mock");
      const { photo } = await photoOf(mod, "animate-solo", "mira");
      const post = (body: unknown) =>
        mod.animate(as("animate-solo", "http://localhost/x", { method: "POST", body: JSON.stringify(body) }), params(photo.id));

      expect((await post({ prompt: "she turns toward the window" })).status).toBe(202);
      expect(sent[0].prompt).toContain("she turns toward the window, alone, the only person in the scene");
      expect(sent[0].negative_prompt).toContain("multiple people");
      expect(sent[0].negative_prompt).toContain("underage");

      // The default motion ends in the same anchor, said once, with the same negatives.
      expect((await post({})).status).toBe(202);
      expect(sent[1].prompt).toContain("a slight turn of the head, alone, the only person in the scene.");
      expect(sent[1].prompt.split("the only person").length).toBe(2);
      expect(sent[1].negative_prompt).toContain("multiple people");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("refuses a motion the classifier sees someone else in, as the word list would, logged, before charging", async () => {
    const policies: string[] = [];
    const worker = vi.fn(async () => Response.json({ error: "unexpected" }, { status: 500 }));
    vi.stubEnv("VIDEO_API_URL", "http://worker.test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (!String(url).startsWith("http://classifier.test")) return worker();
        policies.push((JSON.parse(String(init?.body)) as { messages: { content: string }[] }).messages[0].content);
        return Response.json({ choices: [{ message: { content: "BLOCK:other_people" } }] });
      }),
    );
    const mod = await load("mock");
    const { env, features } = await import("@/server/env");
    const saved = { ...env };
    Object.assign(env, { moderationBaseUrl: "http://classifier.test", moderationApiKey: "test", moderationModel: "test" });
    features.remoteModeration = true;
    try {
      const { eq } = await import("drizzle-orm");
      const { user, photo } = await photoOf(mod, "animate-classifier-others", "mira");
      // Something the word list lets through, which the classifier reads as a second person.
      const prompt = "legs wrapped around the one holding the camera";
      const response = await mod.animate(
        as("animate-classifier-others", "http://localhost/x", { method: "POST", body: JSON.stringify({ prompt }) }),
        params(photo.id),
      );
      expect(response.status).toBe(422);
      expect(((await response.json()) as { code: string }).code).toBe("video_one_person");
      expect(policies).toHaveLength(1);
      expect(policies[0]).toContain("- other_people:");
      expect(worker).not.toHaveBeenCalled();
      expect(await mod.balanceOf(user.id)).toBe(200);
      const database = await mod.db();
      expect(await database.select().from(mod.schema.media).where(eq(mod.schema.media.sourceMediaId, photo.id))).toEqual([]);
      const events = await database.select().from(mod.schema.moderationEvents).where(eq(mod.schema.moderationEvents.userId, user.id));
      expect(events.map((event) => [event.category, event.action, event.targetType, event.targetId, event.details])).toEqual([
        ["other_people", "blocked", "video", photo.id, { matched: "classifier", excerpt: prompt }],
      ]);
    } finally {
      Object.assign(env, saved);
      features.remoteModeration = false;
      vi.unstubAllGlobals();
    }
  });

  it("reads the character's own pronouns as theirs, and the other gender's as someone else", async () => {
    const worker = vi.fn(async () => Response.json({ error: "unexpected" }, { status: 500 }));
    vi.stubEnv("VIDEO_API_URL", "http://worker.test");
    vi.stubGlobal("fetch", worker);
    try {
      const mod = await load("mock");
      const { user, photo } = await photoOf(mod, "animate-pronouns", "mira");
      // Mira is a woman, so "he" is a second person.
      const response = await mod.animate(
        as("animate-pronouns", "http://localhost/x", { method: "POST", body: JSON.stringify({ prompt: "he leans in slowly" }) }),
        params(photo.id),
      );
      expect(response.status).toBe(422);
      expect(((await response.json()) as { code: string }).code).toBe("video_one_person");
      expect(worker).not.toHaveBeenCalled();
      expect(await mod.balanceOf(user.id)).toBe(200);
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
