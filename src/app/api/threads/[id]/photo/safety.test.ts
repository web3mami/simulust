import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { MessageDTO } from "@/lib/api-types";
import { hasPython } from "@/test/python";

// The scene model is scripted per test; images are the offline mock SVGs.
vi.mock("@/server/llm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/llm")>();
  return { ...actual, complete: vi.fn(actual.complete) };
});

// The real text screen, which a test can script for one call.
vi.mock("@/server/safety/text", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/safety/text")>();
  return { ...actual, checkImagePrompt: vi.fn(actual.checkImagePrompt) };
});

let mediaDir: string;
type Handler = (request: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
type PhotoResponse = { message: MessageDTO; notice: MessageDTO | null; balance: number };
let POST: Handler;
let db: typeof import("@/server/db").db;
let schema: typeof import("@/server/db/schema");
let currentUser: typeof import("@/server/auth").currentUser;
let complete: typeof import("@/server/llm").complete;
let checkImagePrompt: typeof import("@/server/safety/text").checkImagePrompt;
let envModule: typeof import("@/server/env");

beforeAll(async () => {
  mediaDir = await mkdtemp(path.join(os.tmpdir(), "simulust-photo-safety-"));
  vi.stubEnv("MEDIA_DIR", mediaDir);
  vi.stubEnv("IMAGE_PROVIDER", "mock");
  vi.resetModules();
  POST = (await import("./route")).POST as unknown as Handler;
  db = (await import("@/server/db")).db;
  schema = await import("@/server/db/schema");
  currentUser = (await import("@/server/auth")).currentUser;
  complete = (await import("@/server/llm")).complete;
  checkImagePrompt = (await import("@/server/safety/text")).checkImagePrompt;
  envModule = await import("@/server/env");
});

afterEach(() => {
  envModule.features.remoteModeration = false;
  Object.assign(envModule.env, { imageProvider: "mock", imageApiUrl: undefined });
  vi.unstubAllGlobals();
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await rm(mediaDir, { recursive: true, force: true });
});

// A stand-in for the remote text classifier; `answer` decides each text it's sent.
function classifier(answer: (text: string) => string | Error) {
  Object.assign(envModule.env, { moderationBaseUrl: "http://classifier.test", moderationApiKey: "test", moderationModel: "test" });
  envModule.features.remoteModeration = true;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const text = (JSON.parse(String(init.body)) as { messages: { content: string }[] }).messages[1].content;
      const result = answer(text);
      if (result instanceof Error) throw result;
      return Response.json({ choices: [{ message: { content: result } }] });
    }),
  );
}

function writes(scene: string, caption: string) {
  vi.mocked(complete).mockResolvedValueOnce(JSON.stringify({ scene, caption }));
}

async function setup(handle: string) {
  const { eq } = await import("drizzle-orm");
  const database = await db();
  const user = (await currentUser(new Request("http://localhost", { headers: { "x-dev-user": handle } })))!;
  await database.update(schema.users).set({ ageStatus: "approved", ageVerifiedAt: new Date() }).where(eq(schema.users.id, user.id));
  const [thread] = await database.insert(schema.threads).values({ userId: user.id, characterId: "mira" }).returning();
  return { user, thread };
}

function call(handle: string, threadId: string, body: unknown = {}) {
  return POST(
    new Request(`http://localhost/api/threads/${threadId}/photo`, {
      method: "POST",
      headers: { "x-dev-user": handle, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: threadId }) },
  );
}

async function photo(handle: string, threadId: string) {
  const response = await call(handle, threadId);
  expect(response.status).toBe(200);
  return (await response.json()) as PhotoResponse;
}

async function promptOf(body: PhotoResponse) {
  const { eq } = await import("drizzle-orm");
  const database = await db();
  const [row] = await database.select().from(schema.media).where(eq(schema.media.id, body.message.media!.id));
  return row.prompt ?? "";
}

async function eventsFor(userId: string) {
  const { eq } = await import("drizzle-orm");
  const database = await db();
  return database.select().from(schema.moderationEvents).where(eq(schema.moderationEvents.userId, userId));
}

const SCENE = "on a rooftop terrace at golden hour, linen sundress, leaning on the railing, shot from a low angle";
const CAPTION = "Wish you were up here with me.";

describe("photo scene and caption screening", () => {
  it("uses what the model wrote when the classifier allows it", async () => {
    const { thread } = await setup("photo-scene-ok");
    classifier(() => "ALLOW");
    writes(SCENE, CAPTION);
    const body = await photo("photo-scene-ok", thread.id);
    expect(await promptOf(body)).toContain("rooftop terrace");
    expect(body.message.content).toBe(CAPTION);
  });

  it("falls back to the neutral scene and a stock caption when the classifier can't check them", async () => {
    const { user, thread } = await setup("photo-scene-down");
    classifier(() => new Error("classifier timed out"));
    writes(SCENE, CAPTION);
    const body = await photo("photo-scene-down", thread.id);
    const prompt = await promptOf(body);
    expect(prompt).toContain("relaxing at home");
    expect(prompt).not.toContain("rooftop");
    expect(body.message.content).not.toBe(CAPTION);
    expect((await eventsFor(user.id)).map((event) => [event.category, event.targetType, event.targetId])).toEqual([
      ["classifier_error", "image_prompt", body.message.media!.id],
    ]);
  });

  it("falls back when the classifier blocks them", async () => {
    const { user, thread } = await setup("photo-scene-block");
    classifier((text) => (text.includes("rooftop") ? "BLOCK:minor" : "ALLOW"));
    writes(SCENE, CAPTION);
    const body = await photo("photo-scene-block", thread.id);
    expect(await promptOf(body)).toContain("relaxing at home");
    expect(body.message.content).not.toBe(CAPTION);
    expect((await eventsFor(user.id)).map((event) => [event.category, event.action])).toEqual([["minor", "blocked"]]);
  });

  it("falls back when the blocklist catches them", async () => {
    const { thread } = await setup("photo-scene-blocklist");
    writes("sitting at a desk in a school uniform", CAPTION);
    const body = await photo("photo-scene-blocklist", thread.id);
    expect(await promptOf(body)).toContain("relaxing at home");
    expect(body.message.content).not.toBe(CAPTION);
  });
});

describe("photo AI disclosure", () => {
  it("adds the disclosure before a photo that opens a thread, then not again", async () => {
    const { eq } = await import("drizzle-orm");
    const { thread } = await setup("photo-disclose");
    const first = await photo("photo-disclose", thread.id);
    expect(first.notice?.role).toBe("notice");
    expect(first.notice?.content).toContain("is an AI character");
    expect(new Date(first.notice!.createdAt).getTime()).toBeLessThanOrEqual(new Date(first.message.createdAt).getTime());

    const database = await db();
    const [row] = await database.select().from(schema.threads).where(eq(schema.threads.id, thread.id));
    expect(row.disclosedAt).not.toBeNull();
    const second = await photo("photo-disclose", thread.id);
    expect(second.notice).toBeNull();
  });
});

describe("words that are fine in chat but never in a photo", () => {
  it("refuses such a hint before charging, and logs nothing against the user", async () => {
    const { eq } = await import("drizzle-orm");
    const { user, thread } = await setup("photo-hint-kids");
    const { balanceOf } = await import("@/server/credits");
    const before = await balanceOf(user.id);
    for (const hint of ["relaxing after putting the kids to bed", "in my old high school hoodie", "a minor change of outfit"]) {
      const response = await call("photo-hint-kids", thread.id, { hint });
      expect(response.status, hint).toBe(422);
      expect(((await response.json()) as { code: string }).code).toBe("blocked_image_prompt");
    }
    expect(await balanceOf(user.id)).toBe(before);
    expect(await eventsFor(user.id)).toEqual([]);
    const database = await db();
    expect(await database.select().from(schema.media).where(eq(schema.media.threadId, thread.id))).toEqual([]);
  });

  it("logs a hint that pairs such a word with a sexual one as minor content, before charging, and holds deletion", async () => {
    const { user, thread } = await setup("photo-hint-minor");
    const { balanceOf } = await import("@/server/credits");
    const before = await balanceOf(user.id);
    // Stands in for a hint that puts a sexual word near an age under 18, a child
    // or a family word: checkText lets it through, checkImagePrompt marks it.
    vi.mocked(checkImagePrompt).mockReturnValueOnce({ ok: false, category: "image", matched: "9yrs", minor: "9yrs" });
    const response = await call("photo-hint-minor", thread.id, { hint: "by the lake at dusk" });
    expect(response.status).toBe(422);
    expect(((await response.json()) as { code: string }).code).toBe("blocked_minor");
    expect(await balanceOf(user.id)).toBe(before);
    expect(
      (await eventsFor(user.id)).map((event) => [event.category, event.action, event.targetType, event.targetId, event.details]),
    ).toEqual([["minor", "blocked", "image_prompt", thread.id, { matched: "9yrs", excerpt: "by the lake at dusk" }]]);

    const { DELETE } = await import("@/app/api/me/account/route");
    const deletion = await DELETE(
      new Request("http://localhost/api/me/account", {
        method: "DELETE",
        headers: { "x-dev-user": "photo-hint-minor", "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "DELETE" }),
      }),
    );
    expect(deletion.status).toBe(409);
    expect(((await deletion.json()) as { code: string }).code).toBe("deletion_on_hold");
  });

  it("marks only picture-only refusals that pair the word with a sexual one", async () => {
    const actual = await vi.importActual<typeof import("@/server/safety/text")>("@/server/safety/text");
    for (const hint of ["a minor tilt of the head", "relaxing after putting the kids to bed", "two 9-year-olds at the park"]) {
      const verdict = actual.checkImagePrompt(hint);
      expect(verdict, hint).toMatchObject({ ok: false, category: "image" });
      expect(verdict, hint).not.toHaveProperty("minor");
    }
  });

  it("still logs a hint checkText refuses as minor content", async () => {
    const { user, thread } = await setup("photo-hint-teen");
    const response = await call("photo-hint-teen", thread.id, { hint: "dressed as a teen" });
    expect(((await response.json()) as { code: string }).code).toBe("blocked_minor");
    expect((await eventsFor(user.id)).map((event) => [event.category, event.action])).toEqual([["minor", "blocked"]]);
  });

  it("swaps a scene that picked them up for the neutral one, quietly", async () => {
    const { user, thread } = await setup("photo-scene-kids");
    const seen: string[] = [];
    classifier((text) => {
      seen.push(text);
      return "ALLOW";
    });
    writes("relaxing on the couch after putting the kids to bed, soft lamp light, smiling at the camera", CAPTION);
    const body = await photo("photo-scene-kids", thread.id);
    const prompt = await promptOf(body);
    expect(prompt).toContain("relaxing at home");
    expect(prompt).not.toContain("kids");
    expect(body.message.content).toBe(CAPTION);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain(CAPTION);
    expect(seen[0]).not.toContain("kids");
    expect(await eventsFor(user.id)).toEqual([]);
  });

  it("refuses a character whose name carries an age", async () => {
    const { eq } = await import("drizzle-orm");
    const { user, thread } = await setup("photo-name-age");
    const database = await db();
    for (const [index, name] of ["Yuki, 17", "Yuki (17)", "Yuki seventeen", "Kid sister Yuki"].entries()) {
      const id = `photo-name-age-${index}`;
      await database.insert(schema.characters).values({
        id,
        ownerId: user.id,
        name,
        age: 21,
        gender: "Woman",
        ethnicity: "Asian",
        body: "Petite",
        role: "Girlfriend",
        heat: "Sweet",
        line: "",
        lane: "girls",
      });
      await database.update(schema.threads).set({ characterId: id }).where(eq(schema.threads.id, thread.id));
      const response = await call("photo-name-age", thread.id);
      expect(response.status, name).toBe(422);
      expect(((await response.json()) as { code: string }).code, name).toBe("blocked_minor");
    }
  });
});

// The real worker screen (workers/media/safety.py), when Python is here.
const python = hasPython();
const WORKER_SCREEN = String.raw`
import importlib.util, sys, types
for name in ("numpy", "PIL", "PIL.Image"):
    sys.modules.setdefault(name, types.ModuleType(name))
sys.modules["PIL"].Image = sys.modules["PIL.Image"]
sys.modules["PIL.Image"].Image = object
sys.modules["numpy"].ndarray = object
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("worker_safety", sys.argv[1])
safety = importlib.util.module_from_spec(spec)
spec.loader.exec_module(safety)
print(safety.screen_prompt(sys.stdin.read()) or "")
`;

// Serves /v1/images the way the worker would, screening each prompt with `screen`.
function worker(screen: (prompt: string) => string) {
  Object.assign(envModule.env, { imageProvider: "worker", imageApiUrl: "http://worker.test" });
  const prompts: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const { prompt } = JSON.parse(String(init.body)) as { prompt: string };
      prompts.push(prompt);
      const reason = screen(prompt);
      if (reason) return Response.json({ error: "blocked", reason }, { status: 422 });
      return new Response(new Uint8Array(4000), { headers: { "content-type": "image/png" } });
    }),
  );
  return prompts;
}

describe("photos through the worker's prompt screen", () => {
  it.skipIf(!python)("gets a scene that mentioned the kids past the real worker", async () => {
    const { user, thread } = await setup("photo-worker-kids");
    const prompts = worker((prompt) => {
      const result = spawnSync("python3", ["-I", "-c", WORKER_SCREEN, path.resolve("workers/media/safety.py")], {
        input: prompt,
        encoding: "utf8",
      });
      if (result.status !== 0) throw new Error(result.stderr);
      return result.stdout.trim();
    });
    writes("relaxing on the couch after putting the kids to bed, soft lamp light, smiling at the camera", CAPTION);
    const body = await photo("photo-worker-kids", thread.id);
    expect(body.message.media).toMatchObject({ status: "ready" });
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).not.toContain("kids");
    expect(await eventsFor(user.id)).toEqual([]);
  });

  it("files a worker's image-only word refusal as a worker refusal, not minor content", async () => {
    const { user, thread } = await setup("photo-worker-term");
    worker(() => "term:kids");
    const response = await call("photo-worker-term", thread.id);
    expect(response.status).toBe(502);
    expect((await eventsFor(user.id)).map((event) => [event.category, event.action])).toEqual([["worker_refused", "blocked"]]);
  });
});
