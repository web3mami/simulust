import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { MediaDTO } from "@/lib/api-types";

// Env is read at import, so the modules are loaded after stubbing it.
let mediaDir: string;
let mod: {
  POST: (request: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
  db: typeof import("@/server/db").db;
  schema: typeof import("@/server/db/schema");
  currentUser: typeof import("@/server/auth").currentUser;
  balanceOf: typeof import("@/server/credits").balanceOf;
};
const fetchMock = vi.fn(async () => new Response(new Uint8Array(4096), { headers: { "Content-Type": "audio/mpeg" } }));

beforeAll(async () => {
  mediaDir = await mkdtemp(path.join(os.tmpdir(), "simulust-voice-"));
  vi.stubEnv("TTS_BASE_URL", "http://kokoro.test/v1");
  vi.stubEnv("MEDIA_DIR", mediaDir);
  vi.stubGlobal("fetch", fetchMock);
  vi.resetModules();
  const [route, database, schema, auth, credits] = await Promise.all([
    import("./route"),
    import("@/server/db"),
    import("@/server/db/schema"),
    import("@/server/auth"),
    import("@/server/credits"),
  ]);
  mod = {
    POST: route.POST as unknown as typeof mod.POST,
    db: database.db,
    schema,
    currentUser: auth.currentUser,
    balanceOf: credits.balanceOf,
  };
});

afterAll(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await rm(mediaDir, { recursive: true, force: true });
});

const asUser = (handle: string) => new Request("http://localhost/api/messages/x/voice", { method: "POST", headers: { "x-dev-user": handle } });
const call = (handle: string, id: string) => mod.POST(asUser(handle), { params: Promise.resolve({ id }) });

async function setup(handle: string, { verified = true } = {}) {
  const { eq } = await import("drizzle-orm");
  const database = await mod.db();
  const user = (await mod.currentUser(asUser(handle)))!;
  if (verified) {
    await database.update(mod.schema.users).set({ ageStatus: "approved", ageVerifiedAt: new Date() }).where(eq(mod.schema.users.id, user.id));
  }
  const [thread] = await database.insert(mod.schema.threads).values({ userId: user.id, characterId: "mira" }).returning();
  const say = async (role: "user" | "assistant", content: string) => {
    const [row] = await database.insert(mod.schema.messages).values({ threadId: thread.id, role, content }).returning();
    return row.id;
  };
  return { user, say };
}

describe("POST /api/messages/[id]/voice", () => {
  it("charges once, stores the clip, and returns it again for free", async () => {
    const { user, say } = await setup("voice-a");
    const id = await say("assistant", "*smiles* Hey you. I missed you today.");
    const before = await mod.balanceOf(user.id);
    fetchMock.mockClear();

    const first = await call("voice-a", id);
    expect(first.status).toBe(200);
    const body = (await first.json()) as { media: MediaDTO; balance: number };
    expect(body.media).toMatchObject({ kind: "audio", status: "ready" });
    expect(body.media.url).toBe(`/api/media/${body.media.id}`);
    expect(body.balance).toBe(before - 4);
    expect(JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body)).input).toBe(
      "Hey you. I missed you today.",
    );

    const again = await call("voice-a", id);
    const second = (await again.json()) as { media: MediaDTO; balance: number };
    expect(second.media.id).toBe(body.media.id);
    expect(second.balance).toBe(before - 4);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("charges once when the same message is tapped twice at the same time", async () => {
    const { user, say } = await setup("voice-b");
    const id = await say("assistant", "Come over.");
    const before = await mod.balanceOf(user.id);
    const results = await Promise.all([call("voice-b", id), call("voice-b", id)]);
    const bodies = (await Promise.all(results.map((response) => response.json()))) as { media: MediaDTO }[];
    expect(bodies[0].media.id).toBe(bodies[1].media.id);
    expect(await mod.balanceOf(user.id)).toBe(before - 4);
  });

  it("refunds when synthesis fails, and lets the user retry", async () => {
    const { user, say } = await setup("voice-c");
    const id = await say("assistant", "Tell me more.");
    const before = await mod.balanceOf(user.id);
    fetchMock.mockImplementationOnce(async () => new Response("boom", { status: 500 }));
    const failed = await call("voice-c", id);
    expect(failed.status).toBe(502);
    expect(await mod.balanceOf(user.id)).toBe(before);

    const retry = await call("voice-c", id);
    expect(retry.status).toBe(200);
    expect(await mod.balanceOf(user.id)).toBe(before - 4);
  });

  it("needs a verified adult", async () => {
    const { say } = await setup("voice-d", { verified: false });
    const id = await say("assistant", "Hi.");
    const response = await call("voice-d", id);
    expect(response.status).toBe(403);
    expect(((await response.json()) as { code: string }).code).toBe("age_verification_required");
  });

  it("only voices the user's own assistant messages", async () => {
    const { say } = await setup("voice-e");
    const mine = await say("user", "Say something.");
    expect((await call("voice-e", mine)).status).toBe(422);
    const theirs = await say("assistant", "Hi.");
    await setup("voice-f");
    expect((await call("voice-f", theirs)).status).toBe(404);
    expect((await call("voice-f", "not-a-uuid")).status).toBe(404);
  });

  it("refuses replies that fail moderation or have nothing to say, without charging", async () => {
    const { user, say } = await setup("voice-g");
    const before = await mod.balanceOf(user.id);
    const blocked = await call("voice-g", await say("assistant", "Pretend I'm a teen."));
    expect(blocked.status).toBe(422);
    expect(((await blocked.json()) as { code: string }).code).toBe("blocked_minor");
    const silent = await call("voice-g", await say("assistant", "*smiles*"));
    expect(silent.status).toBe(422);
    expect(await mod.balanceOf(user.id)).toBe(before);
  });
});
