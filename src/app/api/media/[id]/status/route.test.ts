import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { MediaDTO } from "@/lib/api-types";
import { maxDuration } from "./route";

describe("media status route", () => {
  it("has time to finish a video a poll finds done", () => {
    // The worker poll (30 s), moderating six stills in two batches of three
    // (30 s each), and room to store the clip.
    expect(maxDuration).toBeGreaterThanOrEqual(30 + 2 * 30 + 20);
  });
});

type Handler = (request: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
let mediaDir: string;
let GET: Handler;
let media: typeof import("@/server/media");
let currentUser: typeof import("@/server/auth").currentUser;
let db: typeof import("@/server/db").db;
let schema: typeof import("@/server/db/schema");

beforeAll(async () => {
  mediaDir = await mkdtemp(path.join(os.tmpdir(), "simulust-media-status-"));
  vi.stubEnv("MEDIA_DIR", mediaDir);
  vi.resetModules();
  GET = (await import("./route")).GET as unknown as Handler;
  media = await import("@/server/media");
  currentUser = (await import("@/server/auth")).currentUser;
  db = (await import("@/server/db")).db;
  schema = await import("@/server/db/schema");
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await rm(mediaDir, { recursive: true, force: true });
});

const BYTES = new Uint8Array(64).fill(5);

async function status(handle: string | null, id: string) {
  const response = await GET(new Request(`http://localhost/api/media/${id}/status`, { headers: handle ? { "x-dev-user": handle } : {} }), {
    params: Promise.resolve({ id }),
  });
  return { status: response.status, media: ((await response.json()) as { media?: MediaDTO }).media };
}

describe("GET /api/media/[id]/status", () => {
  it("locks nude media for an owner who may not see it now, with no URL", async () => {
    const { eq } = await import("drizzle-orm");
    const user = (await currentUser(new Request("http://localhost", { headers: { "x-dev-user": "status-explicit" } })))!;
    const photo = await media.createMedia({ userId: user.id, kind: "image", purpose: "studio" });
    await media.storeMedia(photo, BYTES, "image/png", { explicit: true });
    const tame = await media.createMedia({ userId: user.id, kind: "image", purpose: "chat" });
    await media.storeMedia(tame, BYTES, "image/png", { explicit: false });
    const database = await db();
    const locked = { id: photo.id, kind: "image", status: "ready", url: null, error: null, locked: true };

    // Without an age confirmation.
    expect((await status("status-explicit", photo.id)).media).toEqual(locked);
    expect((await status("status-explicit", tame.id)).media).toMatchObject({ url: `/api/media/${tame.id}` });

    // A confirmed adult.
    await database.update(schema.users).set({ ageAttestedAt: new Date() }).where(eq(schema.users.id, user.id));
    expect((await status("status-explicit", photo.id)).media).toMatchObject({ status: "ready", url: `/api/media/${photo.id}` });

    // On an explicit hold.
    await database.update(schema.users).set({ explicitHoldAt: new Date() }).where(eq(schema.users.id, user.id));
    expect((await status("status-explicit", photo.id)).media).toEqual(locked);
    // Admins review everything.
    expect((await status("admin", photo.id)).media).toMatchObject({ url: `/api/media/${photo.id}` });
  });

  it("is a 404 for anyone else", async () => {
    const user = (await currentUser(new Request("http://localhost", { headers: { "x-dev-user": "status-owner" } })))!;
    const photo = await media.createMedia({ userId: user.id, kind: "image", purpose: "chat" });
    await media.storeMedia(photo, BYTES, "image/png");
    expect((await status("status-stranger", photo.id)).status).toBe(404);
    expect((await status(null, photo.id)).status).toBe(401);
  });
});
