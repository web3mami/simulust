import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { CollectionResponse } from "./route";

let mediaDir: string;
let GET: (request: Request) => Promise<Response>;
let media: typeof import("@/server/media");
let currentUser: typeof import("@/server/auth").currentUser;
let db: typeof import("@/server/db").db;
let schema: typeof import("@/server/db/schema");

beforeAll(async () => {
  mediaDir = await mkdtemp(path.join(os.tmpdir(), "simulust-media-list-"));
  vi.stubEnv("MEDIA_DIR", mediaDir);
  vi.resetModules();
  GET = (await import("./route")).GET;
  media = await import("@/server/media");
  currentUser = (await import("@/server/auth")).currentUser;
  db = (await import("@/server/db")).db;
  schema = await import("@/server/db/schema");
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await rm(mediaDir, { recursive: true, force: true });
});

const BYTES = new Uint8Array(64).fill(3);
const T0 = Date.parse("2026-01-01T12:00:00.000Z");

async function userFor(handle: string) {
  return (await currentUser(new Request("http://localhost", { headers: { "x-dev-user": handle } })))!;
}

// A media row for the user, made `minutes` after T0 so the order is known.
async function make(
  handle: string,
  minutes: number,
  {
    kind = "image",
    purpose = kind === "video" ? "video" : "chat",
    state = "ready",
    characterId = "mira",
    sourceMediaId,
    explicit,
  }: {
    kind?: "image" | "video" | "audio";
    purpose?: "chat" | "video" | "voice" | "portrait" | "studio";
    state?: "ready" | "pending" | "blocked" | "failed";
    characterId?: string;
    // The photo a clip was animated from.
    sourceMediaId?: string;
    // Moderation let nudity through (what the photo and studio routes record).
    explicit?: boolean;
  } = {},
) {
  const user = await userFor(handle);
  const threadId = purpose === "studio" ? null : crypto.randomUUID();
  let row = await media.createMedia({ userId: user.id, characterId, threadId, kind, purpose, sourceMediaId });
  if (state !== "pending") {
    const mime = kind === "video" ? "video/mp4" : kind === "audio" ? "audio/mpeg" : "image/png";
    row = await media.storeMedia(row, BYTES, mime, explicit === undefined ? undefined : { explicit });
  }
  if (state === "blocked" || state === "failed") await media.failMedia(row.id, state, "Removed");
  const { eq } = await import("drizzle-orm");
  await (await db())
    .update(schema.media)
    .set({ createdAt: new Date(T0 + minutes * 60_000) })
    .where(eq(schema.media.id, row.id));
  return { id: row.id, threadId };
}

async function list(handle: string | null, query = "") {
  const response = await GET(
    new Request(`http://localhost/api/media${query}`, { headers: handle ? { "x-dev-user": handle } : {} }),
  );
  return { status: response.status, body: (await response.json()) as CollectionResponse & { error?: string } };
}

describe("GET /api/media", () => {
  it("asks for a login first", async () => {
    expect((await list(null)).status).toBe(401);
  });

  it("lists only the user's own ready photos and videos, newest first", async () => {
    const photo = await make("gallery-a", 1);
    const video = await make("gallery-a", 2, { kind: "video" });
    await make("gallery-a", 3, { state: "pending" });
    await make("gallery-a", 4, { state: "blocked" });
    await make("gallery-a", 5, { state: "failed" });
    await make("gallery-a", 6, { kind: "audio", purpose: "voice" });
    await make("gallery-a", 7, { purpose: "portrait" });
    await make("gallery-b", 8);

    const { status, body } = await list("gallery-a");
    expect(status).toBe(200);
    expect(body.hasMore).toBe(false);
    expect(body.media.map((item) => item.id)).toEqual([video.id, photo.id]);
    expect(body.media[0]).toEqual({
      id: video.id,
      kind: "video",
      status: "ready",
      url: `/api/media/${video.id}`,
      error: null,
      characterId: "mira",
      threadId: video.threadId,
      createdAt: new Date(T0 + 2 * 60_000).toISOString(),
      origin: "chat",
    });

    // Someone else sees none of it.
    const other = await list("gallery-b");
    expect(other.body.media.map((item) => item.id)).not.toContain(photo.id);
    expect(other.body.media).toHaveLength(1);
  });

  it("filters by kind", async () => {
    const photo = await make("gallery-c", 1);
    const video = await make("gallery-c", 2, { kind: "video" });
    expect((await list("gallery-c", "?kind=image")).body.media.map((item) => item.id)).toEqual([photo.id]);
    expect((await list("gallery-c", "?kind=video")).body.media.map((item) => item.id)).toEqual([video.id]);
  });

  it("filters by character", async () => {
    const mira = await make("gallery-f", 1);
    const yuki = await make("gallery-f", 2, { characterId: "yuki" });
    expect((await list("gallery-f", "?characterId=mira")).body.media.map((item) => item.id)).toEqual([mira.id]);
    expect((await list("gallery-f", "?characterId=yuki&kind=image")).body.media.map((item) => item.id)).toEqual([yuki.id]);
  });

  it("pages with a before cursor", async () => {
    const made = [];
    for (let minute = 1; minute <= 5; minute++) made.push(await make("gallery-d", minute));
    const newestFirst = made.reverse().map((item) => item.id);

    const first = await list("gallery-d", "?limit=2");
    expect(first.body.media.map((item) => item.id)).toEqual(newestFirst.slice(0, 2));
    expect(first.body.hasMore).toBe(true);

    const cursor = encodeURIComponent(first.body.media.at(-1)!.createdAt);
    const second = await list("gallery-d", `?limit=2&before=${cursor}`);
    // The boundary millisecond is included; the client drops ids it already has.
    const fresh = second.body.media.map((item) => item.id).filter((id) => !newestFirst.slice(0, 2).includes(id));
    expect(fresh).toEqual(newestFirst.slice(2, 3));
    expect(second.body.hasMore).toBe(true);

    const last = await list("gallery-d", `?limit=10&before=${encodeURIComponent(new Date(T0 + 2 * 60_000).toISOString())}`);
    expect(last.body.media.map((item) => item.id)).toEqual(newestFirst.slice(3));
    expect(last.body.hasMore).toBe(false);
  });

  it("lists studio keyframes and the clips made from them", async () => {
    const chatPhoto = await make("gallery-g", 1);
    const chatClip = await make("gallery-g", 2, { kind: "video", sourceMediaId: chatPhoto.id });
    const frame = await make("gallery-g", 3, { purpose: "studio" });
    const clip = await make("gallery-g", 4, { kind: "video", sourceMediaId: frame.id });
    // A keyframe that never finished isn't shown.
    await make("gallery-g", 5, { purpose: "studio", state: "failed" });

    const all = await list("gallery-g");
    expect(all.body.media.map((item) => [item.id, item.origin])).toEqual([
      [clip.id, "studio"],
      [frame.id, "studio"],
      [chatClip.id, "chat"],
      [chatPhoto.id, "chat"],
    ]);
    expect(all.body.media.find((item) => item.id === frame.id)).toMatchObject({ kind: "image", threadId: null });

    expect((await list("gallery-g", "?origin=studio")).body.media.map((item) => item.id)).toEqual([clip.id, frame.id]);
    expect((await list("gallery-g", "?origin=studio&kind=video")).body.media.map((item) => item.id)).toEqual([clip.id]);
    expect((await list("gallery-g", "?origin=chat")).body.media.map((item) => item.id)).toEqual([chatClip.id, chatPhoto.id]);
  });

  it("only lists nude media to someone who may see it now", async () => {
    const { eq } = await import("drizzle-orm");
    const tame = await make("gallery-h", 1, { explicit: false });
    const nude = await make("gallery-h", 2, { purpose: "studio", explicit: true });
    const nudeClip = await make("gallery-h", 3, { kind: "video", sourceMediaId: nude.id });
    const chatNude = await make("gallery-h", 4, { explicit: true });

    // An account without an age confirmation (an older or dev account): only
    // the tame photo.
    expect((await list("gallery-h")).body.media.map((item) => item.id)).toEqual([tame.id]);
    expect((await list("gallery-h", "?origin=studio")).body.media).toEqual([]);

    // A confirmed adult sees everything; there's no switch to turn on.
    const user = await userFor("gallery-h");
    const database = await db();
    await database.update(schema.users).set({ ageAttestedAt: new Date(), settings: {} }).where(eq(schema.users.id, user.id));
    expect((await list("gallery-h")).body.media.map((item) => item.id)).toEqual([chatNude.id, nudeClip.id, nude.id, tame.id]);

    // An explicit hold hides it again, with no trace of what's hidden.
    await database.update(schema.users).set({ explicitHoldAt: new Date() }).where(eq(schema.users.id, user.id));
    const held = await list("gallery-h");
    expect(held.body.media.map((item) => item.id)).toEqual([tame.id]);
    expect(held.body.hasMore).toBe(false);
  });

  it("rejects a bad query", async () => {
    expect((await list("gallery-e", "?limit=61")).status).toBe(400);
    expect((await list("gallery-e", "?limit=0")).status).toBe(400);
    expect((await list("gallery-e", "?kind=audio")).status).toBe(400);
    expect((await list("gallery-e", "?origin=portrait")).status).toBe(400);
    const bad = await list("gallery-e", "?before=yesterday");
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe("before: before must be an ISO date.");
  });
});
