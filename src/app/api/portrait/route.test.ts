import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { MediaDTO } from "@/lib/api-types";

// The worker and Hive are faked over fetch, so the full path runs: charge,
// generate, moderate, store or refund. Env is read at import, hence the late imports.
let mediaDir: string;
let childInFrame = false;
let workerDown = false;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, ...new Array(4000).fill(9)]);

const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  if (url.startsWith("http://worker.test/v1/images")) {
    if (workerDown) return new Response("CUDA out of memory", { status: 500 });
    return new Response(PNG, { headers: { "Content-Type": "image/png", "X-Seed": "42" } });
  }
  if (url.startsWith("https://api.thehive.ai/")) {
    const child = childInFrame ? 0.4 : 0.01;
    return Response.json({
      status: [
        {
          status: { code: "0", message: "SUCCESS" },
          response: {
            output: [
              {
                time: 0,
                classes: [
                  { class: "general_not_nsfw_not_suggestive", score: 0.95 },
                  { class: "general_nsfw", score: 0.01 },
                  { class: "yes_child_present", score: child },
                  { class: "no_child_present", score: 1 - child },
                ],
              },
            ],
          },
        },
      ],
    });
  }
  throw new Error(`Unexpected fetch ${url} ${init?.method ?? "GET"}`);
});

type Mod = {
  POST: (request: Request) => Promise<Response>;
  db: typeof import("@/server/db").db;
  schema: typeof import("@/server/db/schema");
  currentUser: typeof import("@/server/auth").currentUser;
  balanceOf: typeof import("@/server/credits").balanceOf;
};
let mod: Mod;

beforeAll(async () => {
  mediaDir = await mkdtemp(path.join(os.tmpdir(), "simulust-portrait-"));
  vi.stubEnv("MEDIA_DIR", mediaDir);
  vi.stubEnv("IMAGE_PROVIDER", "worker");
  vi.stubEnv("IMAGE_API_URL", "http://worker.test");
  vi.stubEnv("IMAGE_API_KEY", "worker-key");
  vi.stubEnv("HIVE_API_KEY", "hive-key");
  vi.stubGlobal("fetch", fetchMock);
  vi.resetModules();
  const [route, database, schema, auth, credits] = await Promise.all([
    import("./route"),
    import("@/server/db"),
    import("@/server/db/schema"),
    import("@/server/auth"),
    import("@/server/credits"),
  ]);
  mod = { POST: route.POST, db: database.db, schema, currentUser: auth.currentUser, balanceOf: credits.balanceOf };
});

afterAll(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await rm(mediaDir, { recursive: true, force: true });
});

const choices = {
  section: "girls",
  style: "anime",
  ethnicity: "Asian",
  age: 22,
  hair: "Black",
  hairStyle: "Short",
  eyeColor: "Brown",
  body: "Petite",
  breast: "Small",
  personality: "Playful",
  role: "Girlfriend",
  occupation: "Designer",
  kinks: ["Teasing"],
  name: "Aya",
};

function post(handle: string | null, body: unknown) {
  return mod.POST(
    new Request("http://localhost/api/portrait", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(handle ? { "x-dev-user": handle } : {}) },
      body: JSON.stringify(body),
    }),
  );
}

async function userFor(handle: string) {
  return (await mod.currentUser(new Request("http://localhost", { headers: { "x-dev-user": handle } })))!;
}

async function mediaRow(id: string) {
  const { eq } = await import("drizzle-orm");
  const [row] = await (await mod.db()).select().from(mod.schema.media).where(eq(mod.schema.media.id, id));
  return row;
}

describe("POST /api/portrait", () => {
  it("asks for a login first", async () => {
    expect((await post(null, choices)).status).toBe(401);
  });

  it("charges, generates with adult anchors, moderates and stores the portrait", async () => {
    const user = await userFor("portrait-a");
    const before = await mod.balanceOf(user.id);
    fetchMock.mockClear();

    const response = await post("portrait-a", choices);
    expect(response.status).toBe(200);
    const { media } = (await response.json()) as { media: MediaDTO };
    expect(media).toMatchObject({ kind: "image", status: "ready", url: `/api/media/${media.id}` });
    expect(await mod.balanceOf(user.id)).toBe(before - 8);

    const call = fetchMock.mock.calls.find(([url]) => String(url).includes("/v1/images"))!;
    const init = call[1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer worker-key");
    const sent = JSON.parse(String(init.body));
    expect(sent).toMatchObject({ style: "anime", width: 896, height: 1152, lora: null });
    expect(sent.prompt).toContain("adult anime character");
    expect(sent.prompt).toContain("mature female");
    expect(sent.prompt).not.toContain("Aya");
    expect(sent.negative_prompt).toContain("loli");

    const row = await mediaRow(media.id);
    expect(row).toMatchObject({ purpose: "portrait", userId: user.id, mimeType: "image/png", creditsSpent: 8 });
    expect(row.moderation).toMatchObject({ provider: "worker", seed: 42 });
  });

  it("refuses ages under 18 before charging", async () => {
    const user = await userFor("portrait-b");
    const before = await mod.balanceOf(user.id);
    const response = await post("portrait-b", { ...choices, age: 17 });
    expect(response.status).toBe(400);
    expect(await mod.balanceOf(user.id)).toBe(before);
  });

  it("blocks and refunds when moderation sees a child", async () => {
    const user = await userFor("portrait-c");
    const before = await mod.balanceOf(user.id);
    childInFrame = true;
    try {
      const response = await post("portrait-c", choices);
      expect(response.status).toBe(422);
      expect(((await response.json()) as { code: string }).code).toBe("image_blocked");
    } finally {
      childInFrame = false;
    }
    expect(await mod.balanceOf(user.id)).toBe(before);

    const { and, eq } = await import("drizzle-orm");
    const database = await mod.db();
    const [row] = await database
      .select()
      .from(mod.schema.media)
      .where(and(eq(mod.schema.media.userId, user.id), eq(mod.schema.media.purpose, "portrait")));
    expect(row.status).toBe("blocked");
    expect(row.storageKey).toBeNull();
    const events = await database.select().from(mod.schema.moderationEvents).where(eq(mod.schema.moderationEvents.targetId, row.id));
    expect(events[0]).toMatchObject({ category: "minor", action: "blocked" });
  });

  it("refunds when the worker fails", async () => {
    const user = await userFor("portrait-d");
    const before = await mod.balanceOf(user.id);
    workerDown = true;
    try {
      const response = await post("portrait-d", choices);
      expect(response.status).toBe(502);
    } finally {
      workerDown = false;
    }
    expect(await mod.balanceOf(user.id)).toBe(before);
  });

  it("returns 402 without enough credits", async () => {
    const { eq } = await import("drizzle-orm");
    const user = await userFor("portrait-e");
    await (await mod.db()).update(mod.schema.creditBalances).set({ balance: 3 }).where(eq(mod.schema.creditBalances.userId, user.id));
    const response = await post("portrait-e", choices);
    expect(response.status).toBe(402);
    expect(await mod.balanceOf(user.id)).toBe(3);
  });
});
