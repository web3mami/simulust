import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { MessageDTO } from "@/lib/api-types";

// Runs on the offline stand-ins: mock SVG images and the dev LLM, which returns
// "{}" for JSON calls, so the neutral scene and a stock caption are used.
let mediaDir: string;
type Handler = (request: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
let POST: Handler;
let db: typeof import("@/server/db").db;
let schema: typeof import("@/server/db/schema");
let currentUser: typeof import("@/server/auth").currentUser;
let balanceOf: typeof import("@/server/credits").balanceOf;

beforeAll(async () => {
  mediaDir = await mkdtemp(path.join(os.tmpdir(), "simulust-photo-"));
  vi.stubEnv("MEDIA_DIR", mediaDir);
  vi.stubEnv("IMAGE_PROVIDER", "mock");
  vi.resetModules();
  POST = (await import("./route")).POST as unknown as Handler;
  db = (await import("@/server/db")).db;
  schema = await import("@/server/db/schema");
  currentUser = (await import("@/server/auth")).currentUser;
  balanceOf = (await import("@/server/credits")).balanceOf;
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await rm(mediaDir, { recursive: true, force: true });
});

const as = (handle: string) => new Request("http://localhost", { headers: { "x-dev-user": handle } });

async function setup(handle: string, { verified = true } = {}) {
  const { eq } = await import("drizzle-orm");
  const database = await db();
  const user = (await currentUser(as(handle)))!;
  if (verified) {
    await database.update(schema.users).set({ ageStatus: "approved", ageVerifiedAt: new Date() }).where(eq(schema.users.id, user.id));
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
  it("needs a verified adult", async () => {
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
    // Explicit stays off until the user turns it on.
    expect(row.prompt).toContain("no nudity");
    const [updated] = await database.select().from(schema.threads).where(eq(schema.threads.id, thread.id));
    expect(updated.lastPreview).toContain("Photo:");
  });

  it("refuses a blocked hint without charging", async () => {
    const { user, thread } = await setup("photo-d");
    const before = await balanceOf(user.id);
    const response = await call("photo-d", thread.id, { hint: "dress up in a school uniform" });
    expect(response.status).toBe(422);
    expect(await balanceOf(user.id)).toBe(before);
  });
});
