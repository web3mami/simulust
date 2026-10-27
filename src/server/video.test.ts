import { rm } from "node:fs/promises";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";

vi.hoisted(() => {
  process.env.MEDIA_DIR = `${process.env.TMPDIR ?? "/tmp"}/simulust-video-test-${process.pid}`;
  process.env.VIDEO_API_URL = "http://worker.test";
  process.env.VIDEO_API_KEY = "video-key";
  process.env.APP_URL = "https://app.test";
});

import { currentUser } from "@/server/auth";
import { balanceOf, chargeFor } from "@/server/credits";
import { db } from "@/server/db";
import { creditBalances, media, moderationEvents } from "@/server/db/schema";
import { createMedia, getMedia, storeMedia } from "@/server/media";
import { readLocalObject } from "@/server/storage";
import { blockVideo, completeVideoJob, startVideoJob, videoPrompt, VideoBlocked } from "@/server/video";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, ...new Array(3000).fill(3)]);
const MP4 = Buffer.from(new Uint8Array(5000).fill(1)).toString("base64");
const FRAME = Buffer.from(new Uint8Array(1500).fill(2)).toString("base64");
let submitted: Record<string, unknown>[] = [];
let workerAnswer: () => Response = () => Response.json({ status: "queued" }, { status: 202 });
let polled: string[] = [];
let pollAnswer: (jobId: string) => Response = (jobId) => Response.json({ job_id: jobId, status: "running" });

async function user(handle: string) {
  return (await currentUser(new Request("http://localhost/api/me", { headers: { "x-dev-user": handle } })))!;
}

// A finished photo and a pending, paid-for video made from it.
async function videoOf(handle: string, photo: { characterId?: string; purpose?: "chat" | "portrait"; moderation?: Record<string, unknown> }) {
  const owner = await user(handle);
  await (await db()).update(creditBalances).set({ balance: 200 }).where(eq(creditBalances.userId, owner.id));
  const source = await createMedia({ userId: owner.id, kind: "image", purpose: photo.purpose ?? "chat", characterId: photo.characterId });
  const ready = await storeMedia(source, PNG, "image/png", photo.moderation);
  const row = await createMedia({ userId: owner.id, kind: "video", purpose: "video", sourceMediaId: source.id, creditsSpent: 60 });
  await chargeFor(owner, "video", row.id);
  return { owner, source: ready, row };
}

beforeAll(async () => {
  await db();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const job = /^http:\/\/worker\.test\/v1\/videos\/(.+)$/.exec(String(input));
      if (job && !init?.method) {
        polled.push(decodeURIComponent(job[1]));
        return pollAnswer(decodeURIComponent(job[1]));
      }
      if (String(input) !== "http://worker.test/v1/videos") throw new Error(`Unexpected fetch ${String(input)}`);
      submitted.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return workerAnswer();
    }),
  );
});

afterEach(() => {
  submitted = [];
  workerAnswer = () => Response.json({ status: "queued" }, { status: 202 });
  polled = [];
  pollAnswer = (jobId) => Response.json({ job_id: jobId, status: "running" });
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await rm(process.env.MEDIA_DIR!, { recursive: true, force: true });
});

describe("startVideoJob", () => {
  it("tells the worker the source's style", async () => {
    const cases = [
      { photo: { characterId: "mira" }, style: "realistic" },
      { photo: { characterId: "ren" }, style: "anime" },
      // A portrait not yet tied to a character: what the image recorded.
      { photo: { purpose: "portrait" as const, moderation: { style: "realistic" } }, style: "realistic" },
      { photo: { purpose: "portrait" as const, moderation: { style: "anime" } }, style: "anime" },
      // Nothing known.
      { photo: { purpose: "portrait" as const }, style: "anime" },
      // The character and the image disagree.
      { photo: { characterId: "mira", moderation: { style: "anime" } }, style: "anime" },
    ];
    for (const [index, { photo, style }] of cases.entries()) {
      const { source, row } = await videoOf(`video-style-${index}`, photo);
      await startVideoJob(row, source, videoPrompt());
      expect(submitted.at(-1), JSON.stringify(photo)).toMatchObject({ job_id: row.id, style });
    }
  });

  it("raises VideoBlocked when the worker refuses the prompt", async () => {
    const { source, row } = await videoOf("video-refused", { characterId: "mira" });
    workerAnswer = () => Response.json({ error: "blocked", reason: "minor:teen" }, { status: 422 });
    const error = await startVideoJob(row, source, videoPrompt("a teen dancing")).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(VideoBlocked);
    expect(error).toMatchObject({ reason: "minor:teen" });
  });

  it("keeps other 422s as plain failures with the worker's detail", async () => {
    const { source, row } = await videoOf("video-invalid", { characterId: "mira" });
    workerAnswer = () => Response.json({ detail: [{ type: "missing", loc: ["body", "style"] }] }, { status: 422 });
    const error = await startVideoJob(row, source, videoPrompt()).catch((failure: unknown) => failure);
    expect(error).not.toBeInstanceOf(VideoBlocked);
    expect((error as Error).message).toContain("Video worker 422");
    expect((error as Error).message).toContain("missing");
  });
});

describe("completeVideoJob", () => {
  // A paid-for video the worker has accepted.
  async function submittedVideo(handle: string) {
    const { owner, source, row } = await videoOf(handle, { characterId: "mira" });
    return { owner, row: await startVideoJob(row, source, videoPrompt()) };
  }

  it("fetches the clip when the callback leaves it out for size, then stores it", async () => {
    const { owner, row } = await submittedVideo("video-slim");
    pollAnswer = (jobId) =>
      Response.json({ job_id: jobId, status: "succeeded", video_base64: MP4, mime_type: "video/mp4", frames: [FRAME, FRAME] });

    const done = await completeVideoJob(row, { job_id: row.jobId!, status: "succeeded" });
    expect(polled).toEqual([row.jobId]);
    expect(done).toMatchObject({ status: "ready", mimeType: "video/mp4", moderation: { frames: 2 } });
    expect(await balanceOf(owner.id)).toBe(140);
  });

  it("fails and refunds when the fetched result still has no clip, without fetching again", async () => {
    const { owner, row } = await submittedVideo("video-slim-empty");
    pollAnswer = (jobId) => Response.json({ job_id: jobId, status: "succeeded" });

    const done = await completeVideoJob(row, { job_id: row.jobId!, status: "succeeded" });
    expect(polled).toHaveLength(1);
    expect(done).toMatchObject({ status: "failed", moderation: { reason: "worker_failed" } });
    expect(await balanceOf(owner.id)).toBe(200);
  });

  it("leaves the job pending when the fetch fails, so the worker's retry or the poll finishes it", async () => {
    const { owner, row } = await submittedVideo("video-slim-down");
    pollAnswer = () => new Response("bad gateway", { status: 502 });

    await expect(completeVideoJob(row, { job_id: row.jobId!, status: "succeeded" })).rejects.toThrow("Video worker 502");
    expect((await getMedia(row.id))?.status).toBe("pending");
    expect(await balanceOf(owner.id)).toBe(140);
  });

  it("doesn't fetch a result that carries its clip, or a failed one", async () => {
    const { row } = await submittedVideo("video-full");
    const done = await completeVideoJob(row, { job_id: row.jobId!, status: "succeeded", video_base64: MP4, frames: [FRAME] });
    expect(done.status).toBe("ready");
    const failed = await submittedVideo("video-failed");
    expect(await completeVideoJob(failed.row, { job_id: failed.row.jobId!, status: "failed", error: "OOM" })).toMatchObject({
      status: "failed",
    });
    expect(polled).toEqual([]);
  });
});

describe("blockVideo", () => {
  it("blocks the video, logs a moderation event under the worker's category, and refunds", async () => {
    const { owner, row } = await videoOf("video-block", { characterId: "ren" });
    expect(await balanceOf(owner.id)).toBe(140);

    const blocked = await blockVideo(row, "apparent minor: loli:0.91");
    expect(blocked).toMatchObject({ status: "blocked", moderation: { categories: ["minor"], reason: "apparent minor: loli:0.91" } });
    expect(await balanceOf(owner.id)).toBe(200);

    const events = await (await db())
      .select()
      .from(moderationEvents)
      .where(and(eq(moderationEvents.targetType, "video"), eq(moderationEvents.targetId, row.id)));
    expect(events).toMatchObject([{ userId: owner.id, category: "minor", action: "blocked" }]);
  });

  it("records what matched when the worker refuses a motion the user wrote, like our own text checks", async () => {
    const { owner, source } = await videoOf("video-block-written", { characterId: "ren" });
    const events = async (id: string) =>
      (await db()).select().from(moderationEvents).where(and(eq(moderationEvents.targetType, "video"), eq(moderationEvents.targetId, id)));

    const written = await createMedia({
      userId: owner.id,
      kind: "video",
      purpose: "video",
      sourceMediaId: source.id,
      prompt: videoPrompt("she is a teen, twirling").prompt,
    });
    await blockVideo(written, "minor:teen");
    expect(await events(written.id)).toMatchObject([
      { userId: owner.id, category: "minor", action: "blocked", details: { matched: "teen", excerpt: "she is a teen, twirling" } },
    ]);

    // The default motion isn't the user's words, and a refusal of our own
    // negative prompt says nothing about them either.
    const defaulted = await createMedia({ userId: owner.id, kind: "video", purpose: "video", sourceMediaId: source.id, prompt: videoPrompt().prompt });
    await blockVideo(defaulted, "minor:teen");
    const negative = await createMedia({ userId: owner.id, kind: "video", purpose: "video", sourceMediaId: source.id, prompt: videoPrompt("waves").prompt });
    await blockVideo(negative, "term:adult (negative prompt)");
    for (const id of [defaulted.id, negative.id]) {
      const [event] = await events(id);
      expect(event.details).not.toHaveProperty("matched");
    }
    // A refused prompt never touches the photo.
    expect((await getMedia(source.id))?.status).toBe("ready");
  });

  it("blocks the source photo and its other videos when the tagger refuses a render, keeping their files", async () => {
    const { owner, source, row } = await videoOf("video-block-source", { characterId: "ren", moderation: { hive: "ok" } });
    const earlier = await storeMedia(
      await createMedia({ userId: owner.id, kind: "video", purpose: "video", sourceMediaId: source.id }),
      new Uint8Array(5000),
      "video/mp4",
    );
    const submitted = await startVideoJob(row, source, videoPrompt());

    const done = await completeVideoJob(submitted, { job_id: submitted.jobId!, status: "failed", error: "blocked: apparent minor: loli:0.91" });
    expect(done).toMatchObject({ status: "blocked", moderation: { categories: ["minor"] } });
    expect(await balanceOf(owner.id)).toBe(200);

    const photo = await getMedia(source.id);
    expect(photo).toMatchObject({
      status: "blocked",
      moderation: { hive: "ok", workerFlag: { videoId: row.id, reason: "apparent minor: loli:0.91" } },
    });
    expect(await readLocalObject(source.storageKey!)).not.toBeNull();
    expect((await getMedia(earlier.id))?.status).toBe("blocked");
    expect(await readLocalObject(earlier.storageKey!)).not.toBeNull();

    const [flag] = await (await db())
      .select()
      .from(moderationEvents)
      .where(and(eq(moderationEvents.targetType, "image"), eq(moderationEvents.targetId, source.id)));
    expect(flag).toMatchObject({ userId: owner.id, category: "minor", action: "blocked", details: { source: "video_worker", videoId: row.id } });
  });

  it("blocks only the clip when the tagger refuses its rendered frames", async () => {
    const { owner, source, row } = await videoOf("video-block-frames", { characterId: "ren", moderation: { hive: "ok" } });
    const submitted = await startVideoJob(row, source, videoPrompt());

    const done = await completeVideoJob(submitted, {
      job_id: submitted.jobId!,
      status: "failed",
      error: "blocked: apparent minor (frames): loli:0.41",
    });
    expect(done).toMatchObject({ status: "blocked", moderation: { categories: ["minor"] } });
    expect(await balanceOf(owner.id)).toBe(200);
    expect((await getMedia(source.id))?.status).toBe("ready");
  });

  it("leaves a video that already finished alone, without refunding", async () => {
    const { owner, row } = await videoOf("video-block-late", { characterId: "ren" });
    await (await db()).update(media).set({ status: "ready" }).where(eq(media.id, row.id));
    expect(await blockVideo(row, "minor:teen")).toMatchObject({ status: "ready" });
    expect((await getMedia(row.id))?.status).toBe("ready");
    expect(await balanceOf(owner.id)).toBe(140);
  });
});
