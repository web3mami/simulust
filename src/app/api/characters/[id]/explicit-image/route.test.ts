import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { CharacterDTO } from "@/lib/api-types";

// Nude art is served only to a viewer who may see explicit content, checked on
// the server for every request and every listing. Env is read at import, hence
// the late imports.
let mediaDir: string;
type Handler = (request: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
let GET: Handler;
let getOne: Handler;
let list: (request: Request) => Promise<Response>;
let getMediaFile: Handler;
let db: typeof import("@/server/db").db;
let schema: typeof import("@/server/db/schema");
let currentUser: typeof import("@/server/auth").currentUser;
let createMedia: typeof import("@/server/media").createMedia;
let storeMedia: typeof import("@/server/media").storeMedia;

const NUDE = new Uint8Array(1500).fill(9);

beforeAll(async () => {
  mediaDir = await mkdtemp(path.join(os.tmpdir(), "simulust-explicit-image-"));
  vi.stubEnv("MEDIA_DIR", mediaDir);
  vi.resetModules();
  GET = (await import("./route")).GET as unknown as Handler;
  getOne = (await import("../route")).GET as unknown as Handler;
  list = (await import("../../route")).GET as unknown as (request: Request) => Promise<Response>;
  getMediaFile = (await import("@/app/api/media/[id]/route")).GET as unknown as Handler;
  db = (await import("@/server/db")).db;
  schema = await import("@/server/db/schema");
  currentUser = (await import("@/server/auth")).currentUser;
  ({ createMedia, storeMedia } = await import("@/server/media"));
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await rm(mediaDir, { recursive: true, force: true });
});

const as = (handle: string | null, url = "http://localhost") =>
  new Request(url, { headers: handle ? { "x-dev-user": handle } : {} });

type Viewer = { adult?: boolean; hold?: boolean };

// A viewer in a given state: an adult by the date of birth given at sign-up (or
// an older account that never confirmed one), and an explicit hold. A confirmed
// adult with no hold sees everything; there's no switch to turn on.
async function viewer(handle: string, { adult = true, hold = false }: Viewer = {}) {
  const { eq } = await import("drizzle-orm");
  const user = (await currentUser(as(handle)))!;
  await (await db())
    .update(schema.users)
    .set({ ageAttestedAt: adult ? new Date() : null, explicitHoldAt: hold ? new Date() : null })
    .where(eq(schema.users.id, user.id));
  return user;
}

async function setStatus(mediaId: string, status: "ready" | "failed" | "blocked") {
  const { eq } = await import("drizzle-orm");
  await (await db()).update(schema.media).set({ status }).where(eq(schema.media.id, mediaId));
}

// Gives a character nude art the way the script and the portrait route do.
async function withArt(characterId: string, ownerId: string | null) {
  const { eq } = await import("drizzle-orm");
  const row = await createMedia({ userId: ownerId, characterId, kind: "image", purpose: "portrait" });
  const stored = await storeMedia(row, NUDE, "image/png", { explicit: true });
  await (await db())
    .update(schema.characters)
    .set({ explicitImageMediaId: stored.id, explicitImageUrl: `/api/characters/${characterId}/explicit-image` })
    .where(eq(schema.characters.id, characterId));
  return stored;
}

async function ownCharacter(owner: string, id: string) {
  await (await db()).insert(schema.characters).values({
    id,
    ownerId: owner,
    name: "Elena",
    age: 29,
    gender: "Woman",
    ethnicity: "Latina",
    body: "Curvy",
    role: "Girlfriend",
    heat: "Playful",
    line: "Elena is playful.",
    lane: "girls",
    hair: "Brunette",
    hairStyle: "Wavy",
    eyeColor: "Brown",
    breast: "Medium",
  });
}

function image(handle: string | null, id: string) {
  return GET(as(handle, `http://localhost/api/characters/${id}/explicit-image`), { params: Promise.resolve({ id }) });
}

async function listed(handle: string | null) {
  const { characters } = (await (await list(as(handle, "http://localhost/api/characters"))).json()) as {
    characters: CharacterDTO[];
  };
  return new Map(characters.map((person) => [person.id, person]));
}

describe("GET /api/characters/[id]/explicit-image", () => {
  // The first database call migrates a fresh in-memory database, which can take
  // a while when every test file is starting its own at once.
  beforeAll(async () => {
    await withArt("selene", null);
  }, 60_000);

  it("serves the art to a confirmed adult by default, privately", async () => {
    await viewer("xi-adult");
    const response = await image("xi-adult", "selene");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toMatch(/^private,/);
    expect(response.headers.get("vary")).toContain("Cookie");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(NUDE);
  });

  it("is a 404 for everyone else: signed out, unconfirmed or held", async () => {
    await viewer("xi-unverified", { adult: false });
    await viewer("xi-hold", { hold: true });
    expect((await image(null, "selene")).status).toBe(404);
    for (const handle of ["xi-unverified", "xi-hold"]) {
      expect((await image(handle, "selene")).status, handle).toBe(404);
    }
  });

  it("is a 404 for a character without art, or one that doesn't exist", async () => {
    await viewer("xi-none");
    expect((await image("xi-none", "andre")).status).toBe(404);
    expect((await image("xi-none", "nobody")).status).toBe(404);
    expect((await image("xi-none", "x".repeat(200))).status).toBe(404);
  });

  it("serves a user's own character's art to them alone", async () => {
    const owner = await viewer("xi-owner");
    await viewer("xi-other");
    await ownCharacter(owner.id, "xi-elena");
    await withArt("xi-elena", owner.id);
    expect((await image("xi-owner", "xi-elena")).status).toBe(200);
    expect((await image("xi-other", "xi-elena")).status).toBe(404);
  });

  it("stops serving the moment a hold is placed", async () => {
    await viewer("xi-flip");
    expect((await image("xi-flip", "selene")).status).toBe(200);
    await viewer("xi-flip", { hold: true });
    expect((await image("xi-flip", "selene")).status).toBe(404);
  });

  it("stops serving art that's been taken down or failed since", async () => {
    const stored = await withArt("ivory", null);
    await viewer("xi-down");
    expect((await image("xi-down", "ivory")).status).toBe(200);
    for (const status of ["blocked", "failed"] as const) {
      await setStatus(stored.id, status);
      expect((await image("xi-down", "ivory")).status, status).toBe(404);
    }
    await setStatus(stored.id, "ready");
  });

  it("never serves official nude art through /api/media", async () => {
    const stored = await withArt("dallas", null);
    await viewer("xi-media");
    const response = await getMediaFile(as("xi-media", `http://localhost/api/media/${stored.id}`), {
      params: Promise.resolve({ id: stored.id }),
    });
    expect(response.status).toBe(404);
  });
});

describe("character listings", () => {
  it("include explicitImage for every confirmed adult, and nobody else", async () => {
    await viewer("xl-adult");
    await viewer("xl-hold", { hold: true });
    await viewer("xl-unverified", { adult: false });

    const explicit = await listed("xl-adult");
    expect(explicit.get("selene")?.explicitImage).toMatch(/^\/api\/characters\/selene\/explicit-image\?v=[0-9a-f]{8}$/);
    expect(explicit.get("selene")?.image).toBe("/characters/selene.jpg");
    // No art yet: no field at all.
    expect(explicit.get("andre")).not.toHaveProperty("explicitImage");

    for (const handle of [null, "xl-hold", "xl-unverified"]) {
      const people = await listed(handle);
      expect(people.get("selene"), String(handle)).toBeDefined();
      for (const person of people.values()) expect(person, `${handle} ${person.id}`).not.toHaveProperty("explicitImage");
    }
  });

  it("decide per viewer on a single character too", async () => {
    await viewer("xo-adult");
    await viewer("xo-off", { hold: true });
    const one = async (handle: string | null) =>
      ((await (await getOne(as(handle), { params: Promise.resolve({ id: "selene" }) })).json()) as { character: CharacterDTO })
        .character;
    expect((await one("xo-adult")).explicitImage).toContain("/api/characters/selene/explicit-image");
    expect(await one("xo-off")).not.toHaveProperty("explicitImage");
    expect(await one(null)).not.toHaveProperty("explicitImage");
  });

  it("leave out art that's been taken down or failed, so cards fall back to the regular portrait", async () => {
    const stored = await withArt("nyla", null);
    await viewer("xl-down");
    const one = async () =>
      ((await (await getOne(as("xl-down"), { params: Promise.resolve({ id: "nyla" }) })).json()) as { character: CharacterDTO })
        .character;
    expect((await listed("xl-down")).get("nyla")?.explicitImage).toContain("/api/characters/nyla/explicit-image");
    for (const status of ["blocked", "failed"] as const) {
      await setStatus(stored.id, status);
      const listing = (await listed("xl-down")).get("nyla");
      expect(listing, status).not.toHaveProperty("explicitImage");
      expect(listing?.image).toBe("/characters/nyla.jpg");
      expect(await one(), status).not.toHaveProperty("explicitImage");
    }
    await setStatus(stored.id, "ready");
    expect((await listed("xl-down")).get("nyla")?.explicitImage).toContain("/api/characters/nyla/explicit-image");
  });

  it("leave out art whose file was made for another character", async () => {
    const { eq } = await import("drizzle-orm");
    const stored = await withArt("rosa", null);
    await viewer("xl-moved");
    await (await db()).update(schema.media).set({ characterId: "selene" }).where(eq(schema.media.id, stored.id));
    expect((await listed("xl-moved")).get("rosa")).not.toHaveProperty("explicitImage");
    expect((await image("xl-moved", "rosa")).status).toBe(404);
    await (await db()).update(schema.media).set({ characterId: "rosa" }).where(eq(schema.media.id, stored.id));
  });

  it("never point at a stored URL other than the checked route", async () => {
    const { eq } = await import("drizzle-orm");
    await viewer("xl-url");
    // A hand edit that points the column at a public file still lists the route.
    await (await db())
      .update(schema.characters)
      .set({ explicitImageUrl: "/characters/selene-nude.jpg" })
      .where(eq(schema.characters.id, "selene"));
    expect((await listed("xl-url")).get("selene")?.explicitImage).toMatch(/^\/api\/characters\/selene\/explicit-image\?v=/);
    await (await db())
      .update(schema.characters)
      .set({ explicitImageUrl: "/api/characters/selene/explicit-image" })
      .where(eq(schema.characters.id, "selene"));
  });
});
