import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { MessageDTO } from "@/lib/api-types";

// Runs on the offline stand-ins: mock SVG images and the dev LLM, which returns
// "{}" for JSON calls, so the neutral scene and a stock caption are used. The
// image call is watched, to see what reaches the model.
vi.mock("@/server/images", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/images")>();
  return { ...actual, generateImage: vi.fn(actual.generateImage) };
});

let mediaDir: string;
type Handler = (request: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
let POST: Handler;
let db: typeof import("@/server/db").db;
let schema: typeof import("@/server/db/schema");
let currentUser: typeof import("@/server/auth").currentUser;
let explicitAllowed: typeof import("@/server/auth").explicitAllowed;
let balanceOf: typeof import("@/server/credits").balanceOf;
let generateImage: typeof import("@/server/images").generateImage;

beforeAll(async () => {
  mediaDir = await mkdtemp(path.join(os.tmpdir(), "simulust-photo-"));
  vi.stubEnv("MEDIA_DIR", mediaDir);
  vi.stubEnv("IMAGE_PROVIDER", "mock");
  vi.resetModules();
  POST = (await import("./route")).POST as unknown as Handler;
  db = (await import("@/server/db")).db;
  schema = await import("@/server/db/schema");
  ({ currentUser, explicitAllowed } = await import("@/server/auth"));
  balanceOf = (await import("@/server/credits")).balanceOf;
  generateImage = (await import("@/server/images")).generateImage;
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await rm(mediaDir, { recursive: true, force: true });
});

const as = (handle: string) => new Request("http://localhost", { headers: { "x-dev-user": handle } });

// A user in a given state: ID-checked (`verified`), an adult by the date of
// birth given at sign-up (`attested`), or neither (an older or dev account that
// hasn't confirmed its age). Either confirmation is all explicit photos need:
// there's no switch to turn on.
async function setup(handle: string, { verified = true, attested = false } = {}) {
  const { eq } = await import("drizzle-orm");
  const database = await db();
  const user = (await currentUser(as(handle)))!;
  if (verified) {
    await database.update(schema.users).set({ ageStatus: "approved", ageVerifiedAt: new Date() }).where(eq(schema.users.id, user.id));
  }
  if (attested) {
    await database.update(schema.users).set({ ageAttestedAt: new Date() }).where(eq(schema.users.id, user.id));
  }
  const [thread] = await database.insert(schema.threads).values({ userId: user.id, characterId: "mira" }).returning();
  await database.insert(schema.messages).values([
    { threadId: thread.id, role: "user", content: "What are you up to tonight?" },
    { threadId: thread.id, role: "assistant", content: "Just got home. Kicking my shoes off." },
  ]);
  return { user, thread };
}

function call(handle: string, threadId: string, body?: unknown) {
  return POST(
    new Request(`http://localhost/api/threads/${threadId}/photo`, {
      method: "POST",
      headers: { "x-dev-user": handle, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: threadId }) },
  );
}

describe("POST /api/threads/[id]/photo", () => {
  it("needs a confirmed adult", async () => {
    const { thread } = await setup("photo-a", { verified: false });
    const response = await call("photo-a", thread.id, {});
    expect(response.status).toBe(403);
    expect(((await response.json()) as { code: string }).code).toBe("age_verification_required");
  });

  it("only works on the user's own thread", async () => {
    const { thread } = await setup("photo-b");
    await setup("photo-b2");
    expect((await call("photo-b2", thread.id, {})).status).toBe(404);
  });

  it("charges, stores the photo and adds it to the chat", async () => {
    const { eq } = await import("drizzle-orm");
    const { user, thread } = await setup("photo-c");
    const before = await balanceOf(user.id);

    const response = await call("photo-c", thread.id);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { message: MessageDTO; balance: number };
    expect(body.message.role).toBe("assistant");
    expect(body.message.content.length).toBeGreaterThan(0);
    expect(body.message.media).toMatchObject({ kind: "image", status: "ready" });
    expect(body.balance).toBe(before - 8);

    const database = await db();
    const [stored] = await database.select().from(schema.messages).where(eq(schema.messages.id, body.message.id));
    expect(stored.mediaId).toBe(body.message.media!.id);
    const [row] = await database.select().from(schema.media).where(eq(schema.media.id, body.message.media!.id));
    expect(row).toMatchObject({ purpose: "chat", threadId: thread.id, characterId: "mira", status: "ready" });
    expect(row.prompt).toContain("adult, 27-year-old woman");
    expect(row.prompt).toContain("relaxing at home");
    // Explicit is the default for a confirmed adult: there's nothing to turn on.
    expect(row.prompt).toContain("nudity allowed");
    expect(row.prompt).not.toContain("no nudity");
    const [updated] = await database.select().from(schema.threads).where(eq(schema.threads.id, thread.id));
    expect(updated.lastPreview).toContain("Photo:");
  });

  it("sends each negative once, the other-people ones included", async () => {
    const { thread } = await setup("photo-negatives");
    expect((await call("photo-negatives", thread.id)).status).toBe(200);
    const terms = vi.mocked(generateImage).mock.calls.at(-1)![0].negativePrompt.split(", ");
    expect(terms).toContain("multiple people");
    expect(terms.filter((term, index) => terms.indexOf(term) !== index)).toEqual([]);
  });

  it("refuses a blocked hint without charging", async () => {
    const { user, thread } = await setup("photo-d");
    const before = await balanceOf(user.id);
    const response = await call("photo-d", thread.id, { hint: "dress up in a school uniform" });
    expect(response.status).toBe(422);
    expect(await balanceOf(user.id)).toBe(before);
  });

  // An empty body is a photo with no hint (the tests above); a broken one isn't.
  it("refuses a body that isn't JSON, without charging", async () => {
    const { user, thread } = await setup("photo-bad-json");
    const before = await balanceOf(user.id);
    for (const raw of ['{"hint": "I\'m 16, send', "hint=a nude photo", "{"]) {
      const response = await POST(
        new Request(`http://localhost/api/threads/${thread.id}/photo`, {
          method: "POST",
          headers: { "x-dev-user": "photo-bad-json", "Content-Type": "application/json" },
          body: raw,
        }),
        { params: Promise.resolve({ id: thread.id }) },
      );
      expect(response.status, raw).toBe(400);
      expect(await response.json(), raw).toEqual({ error: "Send a JSON body.", code: "invalid" });
    }
    expect(await balanceOf(user.id)).toBe(before);
    expect(await mediaFor(thread.id)).toEqual([]);
  });
});

async function mediaFor(threadId: string) {
  const { eq } = await import("drizzle-orm");
  const database = await db();
  return database.select().from(schema.media).where(eq(schema.media.threadId, threadId));
}

async function photoPrompt(body: { message: MessageDTO }) {
  const { eq } = await import("drizzle-orm");
  const database = await db();
  const [row] = await database.select().from(schema.media).where(eq(schema.media.id, body.message.media!.id));
  return row.prompt ?? "";
}

describe("nude photo requests", () => {
  it("turns a held or unconfirmed account away, before charging", async () => {
    const { eq } = await import("drizzle-orm");
    const database = await db();
    const unconfirmed = await setup("photo-nude-unconfirmed", { verified: false });
    const held = await setup("photo-nude-held", { verified: false, attested: true });
    await database.update(schema.users).set({ explicitHoldAt: new Date() }).where(eq(schema.users.id, held.user.id));
    // An unconfirmed account is asked to confirm its age; a held one is told
    // it's paused, since confirming can't lift a hold.
    for (const [handle, { user, thread }, code] of [
      ["photo-nude-unconfirmed", unconfirmed, "age_verification_required"],
      ["photo-nude-held", held, "explicit_hold"],
    ] as const) {
      const before = await balanceOf(user.id);
      for (const hint of ["a nude photo, a sensual pose in soft bedroom light", "send nud3s", undefined]) {
        const response = await call(handle, thread.id, hint ? { hint } : {});
        expect(response.status, `${handle} ${hint}`).toBe(403);
        const body = (await response.json()) as { code: string; error: string };
        expect(body.code).toBe(code);
        expect(body.error).not.toMatch(/Settings|explicit mode/);
      }
      expect(await balanceOf(user.id)).toBe(before);
      expect(await mediaFor(thread.id)).toEqual([]);
    }
  });

  it("never answers explicit_off: a confirmed adult's nude request is simply honoured", async () => {
    const { thread } = await setup("photo-nude-default");
    const response = await call("photo-nude-default", thread.id, { hint: "send nud3s" });
    expect(response.status).toBe(200);
    expect(await photoPrompt((await response.json()) as { message: MessageDTO })).toContain("nudity allowed");
  });

  it("gives lingerie and the shower their uncensored scenes to any confirmed adult", async () => {
    const { user, thread } = await setup("photo-nude-presets");
    const before = await balanceOf(user.id);
    const lingerie = await call("photo-nude-presets", thread.id, { hint: "in lace lingerie on the bed, warm lamp light" });
    expect(lingerie.status).toBe(200);
    const lingeriePrompt = await photoPrompt((await lingerie.json()) as { message: MessageDTO });
    expect(lingeriePrompt).toContain("sheer black lace lingerie");
    expect(lingeriePrompt).toContain("nudity allowed");
    const shower = await call("photo-nude-presets", thread.id, { hint: "in the shower" });
    expect(shower.status).toBe(200);
    expect(await photoPrompt((await shower.json()) as { message: MessageDTO })).toContain("nude in a steamy glass shower");
    expect(await balanceOf(user.id)).toBe(before - 16);
  });

  it("honours them for an adult confirmed at sign-up, still screened, charged 8 and built on the adult prompt", async () => {
    const { user, thread } = await setup("photo-nude-on", { verified: false, attested: true });
    const before = await balanceOf(user.id);

    const response = await call("photo-nude-on", thread.id, { hint: "a nude photo, a sensual pose in soft bedroom light" });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { message: MessageDTO; balance: number };
    expect(body.message.media).toMatchObject({ kind: "image", status: "ready" });
    expect(body.balance).toBe(before - 8);
    const prompt = await photoPrompt(body);
    expect(prompt).toContain("adult, 27-year-old woman");
    expect(prompt).toContain("fully nude");
    expect(prompt).toContain("nudity allowed");
    expect(prompt).not.toContain("no nudity");

    const topless = await call("photo-nude-on", thread.id, { hint: "topless, a teasing look over one shoulder" });
    expect(topless.status).toBe(200);
    expect(await photoPrompt((await topless.json()) as { message: MessageDTO })).toContain("topless");

    const shower = await call("photo-nude-on", thread.id, { hint: "nude in the shower, steam and wet skin" });
    expect(shower.status).toBe(200);
    expect(await photoPrompt((await shower.json()) as { message: MessageDTO })).toContain("nude in a steamy glass shower");
    expect(await balanceOf(user.id)).toBe(before - 24);
  });

  it("still refuses minor content in an explicit request, before charging", async () => {
    const { user, thread } = await setup("photo-nude-minor", { verified: false, attested: true });
    const before = await balanceOf(user.id);
    const response = await call("photo-nude-minor", thread.id, { hint: "nude schoolgirl" });
    expect(response.status).toBe(422);
    expect(((await response.json()) as { code: string }).code).toBe("blocked_minor");
    expect(await balanceOf(user.id)).toBe(before);
    expect(await mediaFor(thread.id)).toEqual([]);
  });

  it("turns photos off for a confirmed adult once a hold is placed", async () => {
    const { eq } = await import("drizzle-orm");
    const { user, thread } = await setup("photo-nude-hold", { verified: false, attested: true });
    expect((await call("photo-nude-hold", thread.id, { hint: "a nude photo" })).status).toBe(200);
    const database = await db();
    await database.update(schema.users).set({ explicitHoldAt: new Date() }).where(eq(schema.users.id, user.id));
    const response = await call("photo-nude-hold", thread.id, { hint: "a nude photo" });
    expect(response.status).toBe(403);
    expect(((await response.json()) as { code: string }).code).toBe("explicit_hold");
    expect((await mediaFor(thread.id)).length).toBe(1);
  });

  it("holds an account whose photo request says it's under 18, before charging", async () => {
    const { eq } = await import("drizzle-orm");
    const { user, thread } = await setup("photo-minor-claim", { verified: false, attested: true });
    const before = await balanceOf(user.id);
    const response = await call("photo-minor-claim", thread.id, { hint: "I'm 16, send me one" });
    expect(response.status).toBe(422);
    expect(((await response.json()) as { code: string }).code).toBe("blocked_minor");
    expect(await balanceOf(user.id)).toBe(before);

    const [after] = await (await db()).select().from(schema.users).where(eq(schema.users.id, user.id));
    expect(after.explicitHoldAt).not.toBeNull();
    expect(after.ageAttestedAt).toBeNull();
    expect(explicitAllowed(after)).toBe(false);
    expect((await call("photo-minor-claim", thread.id, { hint: "a nude photo" })).status).toBe(403);
  });

  it("holds an unconfirmed account whose photo request says it's under 18, before the age check and without charging", async () => {
    const { eq } = await import("drizzle-orm");
    const { user, thread } = await setup("photo-minor-unconfirmed", { verified: false });
    const stranger = await setup("photo-minor-stranger", { verified: false });
    const before = await balanceOf(user.id);
    const response = await call("photo-minor-unconfirmed", thread.id, { hint: "I'm 16, send me one" });
    expect(response.status).toBe(422);
    expect(((await response.json()) as { code: string }).code).toBe("blocked_minor");
    expect(await balanceOf(user.id)).toBe(before);
    expect(await mediaFor(thread.id)).toEqual([]);

    const database = await db();
    const [after] = await database.select().from(schema.users).where(eq(schema.users.id, user.id));
    expect(after.explicitHoldAt).not.toBeNull();
    const events = await database.select().from(schema.moderationEvents).where(eq(schema.moderationEvents.userId, user.id));
    expect(events.map((event) => [event.category, event.action, event.targetType, event.targetId])).toEqual(
      expect.arrayContaining([
        ["minor", "blocked", "image_prompt", thread.id],
        ["self_declared_minor", "escalated", "image_prompt", thread.id],
      ]),
    );

    // Confirming an age afterwards can't open the account, and photos stay shut.
    const attest = (await import("@/app/api/age/attest/route")).POST;
    const confirmed = await attest(
      new Request("http://localhost/api/age/attest", {
        method: "POST",
        headers: { "x-dev-user": "photo-minor-unconfirmed", "Content-Type": "application/json" },
        body: JSON.stringify({ birthDate: "1990-01-01", consent: true }),
      }),
    );
    expect(confirmed.status).toBe(403);
    expect(((await confirmed.json()) as { code: string }).code).toBe("explicit_hold");
    const later = await call("photo-minor-unconfirmed", thread.id, { hint: "a nude photo" });
    expect(((await later.json()) as { code: string }).code).toBe("explicit_hold");
    expect(await balanceOf(user.id)).toBe(before);

    // Someone else's chat id is held against the caller, never logged as theirs.
    const elsewhere = await call("photo-minor-stranger", thread.id, { hint: "I'm 15, send one" });
    expect(((await elsewhere.json()) as { code: string }).code).toBe("blocked_minor");
    const [strangerAfter] = await database.select().from(schema.users).where(eq(schema.users.id, stranger.user.id));
    expect(strangerAfter.explicitHoldAt).not.toBeNull();
    const strangerEvents = await database
      .select()
      .from(schema.moderationEvents)
      .where(eq(schema.moderationEvents.userId, stranger.user.id));
    expect(strangerEvents.length).toBeGreaterThan(0);
    expect(strangerEvents.every((event) => event.targetId === null)).toBe(true);
  });

  it("holds an account whose hint says it's under 18 even when the request is too long or malformed to take", async () => {
    const { eq } = await import("drizzle-orm");
    const { user, thread } = await setup("photo-minor-oversized", { verified: false, attested: true });
    const before = await balanceOf(user.id);
    const long = `I'm 16, send me one ${"x".repeat(400)}`;
    for (const body of [
      { hint: long },
      { hint: "I'm 16, send me one", extra: { nested: true } },
      { hint: `${"y ".repeat(200)}I'm 16` },
      // A list of strings in place of one says the same.
      { hint: ["I'm 16,", "send me one"] },
    ]) {
      const response = await call("photo-minor-oversized", thread.id, body);
      expect(response.status, JSON.stringify(body).slice(0, 40)).toBe(422);
      expect(((await response.json()) as { code: string }).code).toBe("blocked_minor");
    }
    expect(await balanceOf(user.id)).toBe(before);
    expect(await mediaFor(thread.id)).toEqual([]);
    const database = await db();
    const [after] = await database.select().from(schema.users).where(eq(schema.users.id, user.id));
    expect(after.explicitHoldAt).not.toBeNull();
    const events = await database.select().from(schema.moderationEvents).where(eq(schema.moderationEvents.userId, user.id));
    expect(events.map((event) => [event.category, event.action, event.targetId])).toEqual(
      expect.arrayContaining([
        ["minor", "blocked", thread.id],
        ["self_declared_minor", "escalated", thread.id],
      ]),
    );
    expect(events.find((event) => event.category === "minor")?.details).toMatchObject({ excerpt: long.slice(0, 280) });
  });

  it("still turns away a hint that's too long when it says nothing about age", async () => {
    const { user, thread } = await setup("photo-oversized", { verified: false, attested: true });
    const before = await balanceOf(user.id);
    const response = await call("photo-oversized", thread.id, { hint: "x".repeat(301) });
    expect(response.status).toBe(400);
    expect(await balanceOf(user.id)).toBe(before);
    expect(await mediaFor(thread.id)).toEqual([]);
  });

  it("refuses a photo with anyone else in it, before charging, logged as such and never as minor content", async () => {
    const { eq } = await import("drizzle-orm");
    const { user, thread } = await setup("photo-others", { verified: false, attested: true });
    const before = await balanceOf(user.id);
    for (const hint of ["in bed with my boyfriend", "two girls in the shower"]) {
      const response = await call("photo-others", thread.id, { hint });
      expect(response.status, hint).toBe(422);
      expect(((await response.json()) as { code: string }).code).toBe("others_in_photo");
    }
    expect(await balanceOf(user.id)).toBe(before);
    expect(await mediaFor(thread.id)).toEqual([]);
    // As the classifier's refusals are, so the admin queue doesn't depend on which caught it.
    const events = await (await db()).select().from(schema.moderationEvents).where(eq(schema.moderationEvents.userId, user.id));
    expect(events.map((event) => [event.category, event.action, event.targetType, event.targetId, event.details])).toEqual([
      ["other_people", "blocked", "image_prompt", thread.id, { matched: expect.any(String), excerpt: "in bed with my boyfriend" }],
      ["other_people", "blocked", "image_prompt", thread.id, { matched: expect.any(String), excerpt: "two girls in the shower" }],
    ]);
    // What the word list matched, out of the hint.
    for (const event of events) {
      const { matched, excerpt } = event.details as { matched: string; excerpt: string };
      expect(matched.length).toBeGreaterThan(0);
      expect(excerpt.toLowerCase()).toContain(matched.toLowerCase());
    }
    // It doesn't hold the account's deletion, as a minor block would.
    const { DELETE } = await import("@/app/api/me/account/route");
    const deletion = await DELETE(
      new Request("http://localhost/api/me/account", {
        method: "DELETE",
        headers: { "x-dev-user": "photo-others", "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "DELETE" }),
      }),
    );
    expect(deletion.status).toBe(200);
  });

  it("logs a minor hint that also names someone else as minor content, before charging", async () => {
    const { eq } = await import("drizzle-orm");
    const { user, thread } = await setup("photo-others-minor", { verified: false, attested: true });
    const before = await balanceOf(user.id);
    const response = await call("photo-others-minor", thread.id, { hint: "nude schoolgirl in bed with her boyfriend" });
    expect(response.status).toBe(422);
    expect(((await response.json()) as { code: string }).code).toBe("blocked_minor");
    expect(await balanceOf(user.id)).toBe(before);
    expect(await mediaFor(thread.id)).toEqual([]);
    const events = await (await db()).select().from(schema.moderationEvents).where(eq(schema.moderationEvents.userId, user.id));
    expect(events.map((event) => [event.category, event.action, event.targetType, event.targetId])).toEqual([
      ["minor", "blocked", "image_prompt", thread.id],
    ]);
  });

  it("reads the character's own pronouns as theirs, and the other gender's as someone else", async () => {
    const { user, thread } = await setup("photo-pronouns", { verified: false, attested: true });
    const before = await balanceOf(user.id);
    // Mira is a woman, so "he" is a second person.
    const refused = await call("photo-pronouns", thread.id, { hint: "he smiles at the camera" });
    expect(refused.status).toBe(422);
    expect(((await refused.json()) as { code: string }).code).toBe("others_in_photo");
    expect(await balanceOf(user.id)).toBe(before);
    expect(await mediaFor(thread.id)).toEqual([]);

    // Jonah is a man, so his own hands are just his.
    const [his] = await (await db()).insert(schema.threads).values({ userId: user.id, characterId: "jonah" }).returning();
    const allowed = await call("photo-pronouns", his.id, { hint: "his hands behind his head, a lazy smile" });
    expect(allowed.status).toBe(200);
  });

  it("locks explicit photos in the chat and the file after a hold is placed", async () => {
    const { eq } = await import("drizzle-orm");
    const { user, thread } = await setup("photo-lock", { verified: false, attested: true });
    const made = await call("photo-lock", thread.id, { hint: "a nude photo" });
    expect(made.status).toBe(200);
    const photo = ((await made.json()) as { message: MessageDTO }).message.media!;

    const threadGET = (await import("../route")).GET as unknown as Handler;
    const mediaGET = (await import("@/app/api/media/[id]/route")).GET as unknown as Handler;
    const { NextRequest } = await import("next/server");
    const history = async () => {
      const request = new NextRequest(`http://localhost/api/threads/${thread.id}`, { headers: { "x-dev-user": "photo-lock" } });
      const response = await threadGET(request, { params: Promise.resolve({ id: thread.id }) });
      const body = (await response.json()) as { messages: MessageDTO[] };
      return body.messages.find((message) => message.media?.id === photo.id)!.media!;
    };
    const file = async () => (await mediaGET(as("photo-lock"), { params: Promise.resolve({ id: photo.id }) })).status;

    expect((await history()).url).toBe(`/api/media/${photo.id}`);
    expect(await file()).toBe(200);

    const database = await db();
    await database.update(schema.users).set({ explicitHoldAt: new Date() }).where(eq(schema.users.id, user.id));
    expect(await history()).toMatchObject({ id: photo.id, url: null, locked: true });
    expect(await file()).toBe(404);
  });
});
