import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let mediaDir: string;
type Handler = (request: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
let GET: Handler;
let media: typeof import("@/server/media");
let currentUser: typeof import("@/server/auth").currentUser;
let db: typeof import("@/server/db").db;
let schema: typeof import("@/server/db/schema");

beforeAll(async () => {
  mediaDir = await mkdtemp(path.join(os.tmpdir(), "simulust-media-"));
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

const CLIP = new TextEncoder().encode("0123456789abcdefghij");

async function owned(handle: string) {
  const user = (await currentUser(new Request("http://localhost", { headers: { "x-dev-user": handle } })))!;
  const row = await media.createMedia({ userId: user.id, kind: "video", purpose: "video" });
  return { user, row };
}

function get(id: string, headers: Record<string, string> = {}) {
  return GET(new Request(`http://localhost/api/media/${id}`, { headers }), { params: Promise.resolve({ id }) });
}

describe("GET /api/media/[id]", () => {
  it("streams the owner's file privately", async () => {
    const { row } = await owned("media-a");
    await media.storeMedia(row, CLIP, "video/mp4");
    // The cookie is how <img>/<video> tags authenticate.
    const response = await get(row.id, { cookie: "simulust-dev-user=media-a" });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("video/mp4");
    expect(response.headers.get("cache-control")).toContain("private");
    expect(response.headers.get("vary")).toBe("Cookie, X-Dev-User");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(CLIP);
  });

  it("serves byte ranges for audio and video", async () => {
    const { row } = await owned("media-b");
    await media.storeMedia(row, CLIP, "video/mp4");
    const auth = { "x-dev-user": "media-b" };

    const first = await get(row.id, { ...auth, range: "bytes=0-3" });
    expect(first.status).toBe(206);
    expect(first.headers.get("content-range")).toBe("bytes 0-3/20");
    expect(first.headers.get("content-length")).toBe("4");
    expect(first.headers.get("vary")).toBe("Cookie, X-Dev-User");
    expect(await first.text()).toBe("0123");

    const open = await get(row.id, { ...auth, range: "bytes=16-" });
    expect(await open.text()).toBe("ghij");
    const suffix = await get(row.id, { ...auth, range: "bytes=-2" });
    expect(await suffix.text()).toBe("ij");

    const beyond = await get(row.id, { ...auth, range: "bytes=50-60" });
    expect(beyond.status).toBe(416);
    expect(beyond.headers.get("content-range")).toBe("bytes */20");
    expect(beyond.headers.get("vary")).toBe("Cookie, X-Dev-User");
  });

  it("partitions cached object-storage redirects by the viewer's credentials", async () => {
    const { row } = await owned("media-cache-redirect");
    await media.storeMedia(row, CLIP, "video/mp4");
    const storage = await import("@/server/storage");
    const usesS3 = vi.spyOn(storage, "usesS3").mockReturnValue(true);
    const signedUrl = vi.spyOn(storage, "signedUrl").mockResolvedValue("https://media.example.test/private-clip");
    try {
      const response = await get(row.id, { cookie: "simulust-dev-user=media-cache-redirect" });
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe("https://media.example.test/private-clip");
      expect(response.headers.get("cache-control")).toContain("private");
      expect(response.headers.get("vary")).toBe("Cookie, X-Dev-User");
      // A fresh request with another account still reaches the ownership check.
      expect((await get(row.id, { cookie: "simulust-dev-user=media-cache-other" })).status).toBe(404);
      expect(signedUrl).toHaveBeenCalledTimes(1);
    } finally {
      usesS3.mockRestore();
      signedUrl.mockRestore();
    }
  });

  it("is a 404 for everyone else and for anything not ready", async () => {
    const { row } = await owned("media-c");
    expect((await get(row.id, { "x-dev-user": "media-c" })).status).toBe(404);
    await media.storeMedia(row, CLIP, "video/mp4");
    expect((await get(row.id, { "x-dev-user": "someone-else" })).status).toBe(404);
    expect((await get(row.id)).status).toBe(404);
    expect((await get("not-a-uuid", { "x-dev-user": "media-c" })).status).toBe(404);
    await media.failMedia(row.id, "blocked", "Removed after report");
    expect((await get(row.id, { "x-dev-user": "media-c" })).status).toBe(404);
  });

  it("serves nude media only to an owner who may see it now", async () => {
    const { eq } = await import("drizzle-orm");
    const { user, row } = await owned("media-explicit");
    // A photo made with nudity allowed, and a clip animated from it.
    const photo = await media.createMedia({ userId: user.id, kind: "image", purpose: "studio" });
    await media.storeMedia(photo, CLIP, "image/png", { explicit: true });
    const clip = await media.createMedia({ userId: user.id, kind: "video", purpose: "video", sourceMediaId: photo.id });
    await media.storeMedia(clip, CLIP, "video/mp4");
    await media.storeMedia(row, CLIP, "video/mp4");
    const auth = { "x-dev-user": "media-explicit" };
    const database = await db();

    // Without an age confirmation: the tame clip only.
    expect((await get(row.id, auth)).status).toBe(200);
    expect((await get(photo.id, auth)).status).toBe(404);
    expect((await get(clip.id, auth)).status).toBe(404);

    // A confirmed adult gets everything.
    await database.update(schema.users).set({ ageAttestedAt: new Date() }).where(eq(schema.users.id, user.id));
    expect((await get(photo.id, auth)).status).toBe(200);
    expect((await get(clip.id, auth)).status).toBe(200);

    // On an explicit hold, the same 404 as anything else that isn't there.
    await database.update(schema.users).set({ explicitHoldAt: new Date() }).where(eq(schema.users.id, user.id));
    expect((await get(photo.id, auth)).status).toBe(404);
    expect((await get(clip.id, auth)).status).toBe(404);
    expect((await get(row.id, auth)).status).toBe(200);
    // Admins still review it.
    expect((await get(photo.id, { "x-dev-user": "admin" })).status).toBe(200);
  });

  it("lets admins see media for review", async () => {
    const { row } = await owned("media-d");
    await media.storeMedia(row, CLIP, "video/mp4");
    expect((await get(row.id, { "x-dev-user": "admin" })).status).toBe(200);
  });
});
