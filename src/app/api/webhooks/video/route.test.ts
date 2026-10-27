import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { MediaDTO } from "@/lib/api-types";

// The whole video path against a fake GPU worker and a fake Hive: animate ->
// worker job -> webhook (or polling) -> frame moderation -> stored or refunded.
let mediaDir: string;
let frameHasChild = false;
let pollResult: Record<string, unknown> = { status: "running" };
const submitted: Record<string, unknown>[] = [];
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, ...new Array(3000).fill(3)]);
const MP4 = Buffer.from(new Uint8Array(5000).fill(1)).toString("base64");
const FRAME = Buffer.from(new Uint8Array(1500).fill(2)).toString("base64");

const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  if (url === "http://worker.test/v1/videos" && init?.method === "POST") {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    submitted.push(body);
    return Response.json({ job_id: body.job_id, status: "queued" }, { status: 202 });
  }
  if (url.startsWith("http://worker.test/v1/videos/")) {
    const jobId = decodeURIComponent(url.split("/").pop()!);
    return Response.json({ job_id: jobId, ...pollResult });
  }
  if (url.startsWith("https://api.thehive.ai/")) {
    const child = frameHasChild ? 0.5 : 0.01;
    return Response.json({
      status: [
        {
          status: { code: "0", message: "SUCCESS" },
          response: { output: [{ time: 0, classes: [{ class: "yes_child_present", score: child }, { class: "general_nsfw", score: 0.9 }] }] },
        },
      ],
    });
  }
  throw new Error(`Unexpected fetch ${url}`);
});

type Handler = (request: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
let animate: Handler;
let status: Handler;
let webhook: (request: Request) => Promise<Response>;
let db: typeof import("@/server/db").db;
let schema: typeof import("@/server/db/schema");
let media: typeof import("@/server/media");
let currentUser: typeof import("@/server/auth").currentUser;
let balanceOf: typeof import("@/server/credits").balanceOf;

beforeAll(async () => {
  mediaDir = await mkdtemp(path.join(os.tmpdir(), "simulust-video-"));
  vi.stubEnv("MEDIA_DIR", mediaDir);
  vi.stubEnv("VIDEO_API_URL", "http://worker.test");
  vi.stubEnv("VIDEO_API_KEY", "video-key");
  vi.stubEnv("HIVE_API_KEY", "hive-key");
  vi.stubEnv("APP_URL", "https://app.test");
  vi.stubGlobal("fetch", fetchMock);
  vi.resetModules();
  animate = (await import("../../media/[id]/animate/route")).POST as unknown as Handler;
  status = (await import("../../media/[id]/status/route")).GET as unknown as Handler;
  webhook = (await import("./route")).POST;
  db = (await import("@/server/db")).db;
  schema = await import("@/server/db/schema");
  media = await import("@/server/media");
  currentUser = (await import("@/server/auth")).currentUser;
  balanceOf = (await import("@/server/credits")).balanceOf;
});

afterAll(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await rm(mediaDir, { recursive: true, force: true });
});

async function setup(handle: string, { verified = true, explicit = true, characterId = "mira" } = {}) {
  const { eq } = await import("drizzle-orm");
  const database = await db();
  const user = (await currentUser(new Request("http://localhost", { headers: { "x-dev-user": handle } })))!;
  await database
    .update(schema.users)
    .set({ ageStatus: verified ? "approved" : "none", ageVerifiedAt: verified ? new Date() : null, settings: { explicit } })
    .where(eq(schema.users.id, user.id));
  await database.update(schema.creditBalances).set({ balance: 200 }).where(eq(schema.creditBalances.userId, user.id));
  const photo = await media.createMedia({ userId: user.id, kind: "image", purpose: "chat", characterId });
  await media.storeMedia(photo, PNG, "image/png");
  return { user, photo };
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function start(handle: string, photoId: string, body: unknown = {}) {
  const response = await animate(
    new Request(`http://localhost/api/media/${photoId}/animate`, {
      method: "POST",
      headers: { "x-dev-user": handle, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    params(photoId),
  );
  return { response, body: (await response.json()) as { media: MediaDTO; balance: number; code?: string } };
}

function deliver(body: unknown, token = "video-key") {
  return webhook(
    new Request("https://app.test/api/webhooks/video", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

async function check(handle: string, id: string) {
  const response = await status(new Request(`http://localhost/api/media/${id}/status`, { headers: { "x-dev-user": handle } }), params(id));
  return ((await response.json()) as { media: MediaDTO }).media;
}

describe("video", () => {
  it("needs a verified adult", async () => {
    const { photo } = await setup("video-a", { verified: false });
    const { response } = await start("video-a", photo.id);
    expect(response.status).toBe(403);
  });

  it("only animates the user's own finished photos", async () => {
    const { photo } = await setup("video-b");
    await setup("video-b2");
    expect((await start("video-b2", photo.id)).response.status).toBe(404);
  });

  it("charges, submits to the worker, and stores the clip when the webhook passes moderation", async () => {
    const { user, photo } = await setup("video-c");
    const { response, body } = await start("video-c", photo.id, { prompt: "she laughs and brushes her hair back" });
    expect(response.status).toBe(202);
    expect(body.media).toMatchObject({ kind: "video", status: "pending", url: null });
    expect(body.balance).toBe(200 - 60);

    const job = submitted.at(-1)!;
    expect(job).toMatchObject({
      job_id: body.media.id,
      seconds: 5,
      style: "realistic",
      callback_url: "https://app.test/api/webhooks/video",
      image_mime_type: "image/png",
    });
    expect(Buffer.from(String(job.image), "base64")).toEqual(Buffer.from(PNG));
    expect(String(job.prompt)).toContain("she laughs");

    expect((await deliver({ job_id: body.media.id, status: "succeeded", video_base64: MP4, frames: [FRAME] }, "wrong")).status).toBe(401);
    const ok = await deliver({ job_id: body.media.id, status: "succeeded", video_base64: MP4, mime_type: "video/mp4", frames: [FRAME, FRAME] });
    expect(ok.status).toBe(200);

    const ready = await check("video-c", body.media.id);
    expect(ready).toMatchObject({ status: "ready", url: `/api/media/${body.media.id}` });
    expect(await balanceOf(user.id)).toBe(140);

    // A repeated delivery changes nothing.
    expect((await deliver({ job_id: body.media.id, status: "failed", error: "late" })).status).toBe(200);
    expect((await check("video-c", body.media.id)).status).toBe("ready");
    expect(await balanceOf(user.id)).toBe(140);
  });

  it("blocks and refunds when a frame fails moderation", async () => {
    const { user, photo } = await setup("video-d");
    const { body } = await start("video-d", photo.id);
    frameHasChild = true;
    try {
      await deliver({ job_id: body.media.id, status: "succeeded", video_base64: MP4, frames: [FRAME] });
    } finally {
      frameHasChild = false;
    }
    expect((await check("video-d", body.media.id)).status).toBe("blocked");
    expect(await balanceOf(user.id)).toBe(200);
  });

  it("blocks explicit frames for a user who hasn't opted in", async () => {
    const { user, photo } = await setup("video-e", { explicit: false });
    const { body } = await start("video-e", photo.id);
    await deliver({ job_id: body.media.id, status: "succeeded", video_base64: MP4, frames: [FRAME] });
    expect((await check("video-e", body.media.id)).status).toBe("blocked");
    expect(await balanceOf(user.id)).toBe(200);
  });

  it("blocks, logs and refunds an anime clip the worker's age check refused", async () => {
    const { and, eq } = await import("drizzle-orm");
    const { user, photo } = await setup("video-h", { characterId: "ren" });
    const { body } = await start("video-h", photo.id);
    expect(submitted.at(-1)).toMatchObject({ job_id: body.media.id, style: "anime" });

    const refused = await deliver({ job_id: body.media.id, status: "failed", error: "blocked: apparent minor: loli:0.91, child:0.40" });
    expect(await refused.json()).toMatchObject({ ok: true, status: "blocked" });
    expect((await check("video-h", body.media.id)).status).toBe("blocked");
    expect(await balanceOf(user.id)).toBe(200);

    const events = await (await db())
      .select()
      .from(schema.moderationEvents)
      .where(and(eq(schema.moderationEvents.targetType, "video"), eq(schema.moderationEvents.targetId, body.media.id)));
    expect(events).toMatchObject([
      { userId: user.id, category: "minor", action: "blocked", details: { reason: "apparent minor: loli:0.91, child:0.40" } },
    ]);
  });

  it("refunds a job the worker reports as failed", async () => {
    const { user, photo } = await setup("video-f");
    const { body } = await start("video-f", photo.id);
    await deliver({ job_id: body.media.id, status: "failed", error: "CUDA out of memory" });
    const failed = await check("video-f", body.media.id);
    expect(failed.status).toBe("failed");
    expect(failed.error).toContain("credits are back");
    expect(await balanceOf(user.id)).toBe(200);
  });

  it("polls the worker when the webhook is late", async () => {
    const { eq } = await import("drizzle-orm");
    const { photo } = await setup("video-g");
    const { body } = await start("video-g", photo.id);

    pollResult = { status: "succeeded", video_base64: MP4, frames: [FRAME] };
    // Not yet two minutes old: no poll.
    expect((await check("video-g", body.media.id)).status).toBe("pending");
    await (await db())
      .update(schema.media)
      .set({ createdAt: new Date(Date.now() - 3 * 60_000) })
      .where(eq(schema.media.id, body.media.id));
    expect((await check("video-g", body.media.id)).status).toBe("ready");
    pollResult = { status: "running" };
  });
});
