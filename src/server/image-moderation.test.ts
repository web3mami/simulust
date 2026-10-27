import { afterEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { collectScores, evaluateHive, THRESHOLDS } from "@/server/image-moderation";

// Response shapes follow Hive's V2 sync docs: an envelope whose status[0].response.output
// holds classification classes, or bounding_poly[].classes for detection models.
// https://docs.thehive.ai/reference/submit-a-task-synchronously
// https://docs.thehive.ai/reference/detection
// https://docs.thehive.ai/docs/visual-content-moderation (class names)
function envelope(output: unknown[]) {
  return {
    id: "a1b2c3d4-0000-11ee-8000-000000000000",
    code: 200,
    project_id: 12345,
    user_id: 67890,
    created_on: "2026-10-26T12:00:00.000Z",
    status: [
      {
        status: { code: "0", message: "SUCCESS" },
        response: {
          input: { id: "a1b2c3d4", charge: 0.003, model: "visual", model_version: 1, model_type: "CATEGORIZATION" },
          output,
        },
      },
    ],
    from_cache: false,
  };
}

function visual(overrides: Record<string, number> = {}) {
  const base: Record<string, number> = {
    general_nsfw: 0.02,
    general_suggestive: 0.1,
    general_not_nsfw_not_suggestive: 0.88,
    yes_sexual_activity: 0.01,
    no_sexual_activity: 0.99,
    yes_female_nudity: 0.01,
    no_female_nudity: 0.99,
    yes_male_nudity: 0.0,
    no_male_nudity: 1.0,
    yes_child_present: 0.01,
    no_child_present: 0.99,
    yes_child_safety: 0.0,
    no_child_safety: 1.0,
    very_bloody: 0.0,
    a_little_bloody: 0.01,
    other_blood: 0.0,
    no_blood: 0.99,
    human_corpse: 0.0,
    animated_corpse: 0.0,
    no_corpse: 1.0,
    yes_self_harm: 0.0,
    no_self_harm: 1.0,
    animated: 0.03,
    hybrid: 0.02,
    natural: 0.95,
    ...overrides,
  };
  return envelope([{ time: 0, classes: Object.entries(base).map(([name, score]) => ({ class: name, score })) }]);
}

const NSFW_ADULT = { general_nsfw: 0.97, general_not_nsfw_not_suggestive: 0.01, yes_female_nudity: 0.96, no_female_nudity: 0.04 };

function face(classes: Record<string, number>) {
  return {
    vertices: [
      { x: 310, y: 120 },
      { x: 520, y: 120 },
      { x: 520, y: 390 },
      { x: 310, y: 390 },
    ],
    dimensions: { top: 120, bottom: 390, left: 310, right: 520 },
    classes: Object.entries(classes).map(([name, score]) => ({ class: name, score })),
    meta: { score: 0.99, type: "face" },
  };
}

function demographic(...faces: Record<string, number>[]) {
  return envelope([{ time: 0, bounding_poly: faces.map(face) }]);
}

const ADULT_FACE = { female: 0.98, male: 0.02, adult: 0.86, middle_aged: 0.1, teenager: 0.03, senior: 0.01 };
const TEEN_FACE = { female: 0.97, male: 0.03, adult: 0.55, teenager: 0.41, pre_teen: 0.02 };

describe("collectScores", () => {
  it("reads classification and detection output, keeping the highest score per class", () => {
    expect(collectScores(visual({ yes_child_present: 0.3 }))).toMatchObject({ yes_child_present: 0.3, natural: 0.95 });
    expect(collectScores(demographic(ADULT_FACE, TEEN_FACE))).toMatchObject({ teenager: 0.41, adult: 0.86 });
    const video = envelope([
      { time: 0, classes: [{ class: "very_bloody", score: 0.1 }] },
      { time: 1, classes: [{ class: "very_bloody", score: 0.7 }] },
    ]);
    expect(collectScores(video).very_bloody).toBe(0.7);
  });
});

describe("evaluateHive", () => {
  const scores = (v: Record<string, number> = {}, extra: Partial<Parameters<typeof evaluateHive>[0]> = {}) => ({
    visual: collectScores(visual(v)),
    ...extra,
  });

  it("passes a clothed adult", () => {
    expect(evaluateHive(scores(), { allowExplicit: false })).toEqual([]);
  });

  it("allows adult nudity only when the user opted into explicit content", () => {
    expect(evaluateHive(scores(NSFW_ADULT), { allowExplicit: true })).toEqual([]);
    expect(evaluateHive(scores(NSFW_ADULT), { allowExplicit: false })).toEqual(["explicit"]);
  });

  it("blocks any sign of a child, even at low confidence and even when explicit is allowed", () => {
    expect(evaluateHive(scores({ yes_child_present: 0.25, no_child_present: 0.75 }), { allowExplicit: true })).toEqual(["minor"]);
    expect(evaluateHive(scores({ yes_child_safety: THRESHOLDS.childPresent }), { allowExplicit: true })).toEqual(["minor"]);
    expect(evaluateHive(scores({ ...NSFW_ADULT, yes_child_present: 0.3 }), { allowExplicit: false })).toEqual(["minor", "explicit"]);
  });

  it("blocks faces that read as under 18", () => {
    expect(
      evaluateHive(scores({}, { demographic: collectScores(demographic(ADULT_FACE, TEEN_FACE)) }), { allowExplicit: true }),
    ).toEqual(["minor"]);
    expect(evaluateHive(scores({}, { demographic: collectScores(demographic(ADULT_FACE)) }), { allowExplicit: true })).toEqual([]);
  });

  it("blocks recognised real people", () => {
    const celebrity = collectScores(demographic({ "Famous Actor": 0.92 }));
    expect(evaluateHive(scores({}, { celebrity }), { allowExplicit: true })).toEqual(["real_person"]);
    const weak = collectScores(demographic({ "Famous Actor": 0.3 }));
    expect(evaluateHive(scores({}, { celebrity: weak }), { allowExplicit: true })).toEqual([]);
    const none = collectScores(demographic({ no_celebrity: 0.99 }));
    expect(evaluateHive(scores({}, { celebrity: none }), { allowExplicit: true })).toEqual([]);
  });

  it("blocks gore and prohibited content", () => {
    expect(evaluateHive(scores({ very_bloody: 0.8, no_blood: 0.1 }), { allowExplicit: true })).toEqual(["gore"]);
    expect(evaluateHive(scores({ animated_corpse: 0.6 }), { allowExplicit: true })).toEqual(["gore"]);
    expect(evaluateHive(scores({ animal_genitalia_and_human: 0.7 }), { allowExplicit: true })).toEqual(["prohibited"]);
  });
});

type Module = typeof import("@/server/image-moderation");

const KEYS = { visual: "hive-visual-key", demographic: "hive-demo-key", celebrity: "hive-celeb-key" };
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, ...new Array(2000).fill(7)]);

// Env is read when modules load, so each scenario loads them fresh.
async function load(vars: Record<string, string>, responder?: (key: string) => Response) {
  vi.unstubAllEnvs();
  for (const [name, value] of Object.entries(vars)) vi.stubEnv(name, value);
  const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const key = String((init?.headers as Record<string, string>)?.Authorization ?? "").replace(/^Token /, "");
    return responder ? responder(key) : Response.json({ error: "unexpected" }, { status: 500 });
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.resetModules();
  const mod: Module = await import("@/server/image-moderation");
  const { db } = await import("@/server/db");
  const { moderationEvents } = await import("@/server/db/schema");
  const events = async (targetId: string) =>
    (await db()).select().from(moderationEvents).where(and(eq(moderationEvents.targetId, targetId)));
  return { mod, fetchMock, events };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("moderateImage", () => {
  it("sends the image to every Hive project and blocks a teenage-looking face", async () => {
    const { mod, fetchMock, events } = await load(
      { HIVE_API_KEY: KEYS.visual, HIVE_DEMOGRAPHIC_API_KEY: KEYS.demographic, HIVE_CELEBRITY_API_KEY: KEYS.celebrity },
      (key) =>
        Response.json(
          key === KEYS.visual ? visual(NSFW_ADULT) : key === KEYS.demographic ? demographic(TEEN_FACE) : demographic({ no_celebrity: 0.99 }),
        ),
    );
    const result = await mod.moderateImage(PNG, "image/png", {
      userId: null,
      targetType: "image",
      targetId: "img-teen",
      allowExplicit: true,
    });
    expect(result.ok).toBe(false);
    expect(result.categories).toEqual(["minor"]);
    expect(result.unavailable).toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.thehive.ai/api/v2/task/sync");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Token ${KEYS.visual}`);
    const media = (init.body as FormData).get("media") as File;
    expect(media.type).toBe("image/png");
    expect(media.size).toBe(PNG.byteLength);

    const logged = await events("img-teen");
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ targetType: "image", category: "minor", action: "blocked" });
  });

  it("passes an explicit adult image for an opted-in user and keeps the scores", async () => {
    const { mod, events } = await load({ HIVE_API_KEY: KEYS.visual }, () => Response.json(visual(NSFW_ADULT)));
    const result = await mod.moderateImage(PNG, "image/png", { targetType: "image", targetId: "img-ok", allowExplicit: true });
    expect(result.ok).toBe(true);
    expect(result.raw).toMatchObject({ provider: "hive", scores: { visual: { general_nsfw: 0.97 } } });
    expect(await events("img-ok")).toHaveLength(0);

    const tasteful = await mod.moderateImage(PNG, "image/png", { targetType: "image", targetId: "img-nsfw" });
    expect(tasteful).toMatchObject({ ok: false, categories: ["explicit"] });
  });

  it("fails closed when Hive errors", async () => {
    const { mod, events } = await load({ HIVE_API_KEY: KEYS.visual }, () => new Response("upstream", { status: 503 }));
    const result = await mod.moderateImage(PNG, "image/png", { targetType: "image", targetId: "img-down" });
    expect(result).toMatchObject({ ok: false, unavailable: true, categories: ["moderation_error"] });
    expect((await events("img-down"))[0]).toMatchObject({ category: "moderation_error", action: "flagged" });
  });

  it("fails closed when a Hive task reports failure", async () => {
    const failed = { ...visual(), status: [{ status: { code: "500", message: "ERROR" }, response: { output: [] } }] };
    const { mod } = await load({ HIVE_API_KEY: KEYS.visual }, () => Response.json(failed));
    const result = await mod.moderateImage(PNG, "image/png", { targetType: "image", targetId: "img-task-failed" });
    expect(result).toMatchObject({ ok: false, unavailable: true });
  });

  it("fails closed when Hive returns no classes", async () => {
    const { mod } = await load({ HIVE_API_KEY: KEYS.visual }, () => Response.json(envelope([])));
    const result = await mod.moderateImage(PNG, "image/png", { targetType: "image", targetId: "img-empty" });
    expect(result).toMatchObject({ ok: false, unavailable: true });
  });

  it("without Hive, allows images only when unmoderated images are allowed", async () => {
    const allowed = await load({});
    expect(await allowed.mod.moderateImage(PNG, "image/png", { targetType: "image", targetId: "img-dev" })).toMatchObject({ ok: true });
    expect(allowed.fetchMock).not.toHaveBeenCalled();

    const strict = await load({ ALLOW_UNMODERATED_IMAGES: "0" });
    const result = await strict.mod.moderateImage(PNG, "image/png", { targetType: "image", targetId: "img-strict" });
    expect(result).toMatchObject({ ok: false, unavailable: true, categories: ["moderation_unavailable"] });
    expect((await strict.events("img-strict"))[0]).toMatchObject({ category: "moderation_unavailable" });
  });

  it("skips the development mock SVGs", async () => {
    const { mod, fetchMock } = await load({ HIVE_API_KEY: KEYS.visual, ALLOW_UNMODERATED_IMAGES: "0" });
    const svg = new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>");
    expect(await mod.moderateImage(svg, "image/svg+xml", { targetType: "image", targetId: "img-svg" })).toMatchObject({ ok: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("moderateFrames", () => {
  it("blocks a video when any frame is blocked, logging one event", async () => {
    let call = 0;
    const { mod, events } = await load({ HIVE_API_KEY: KEYS.visual }, () =>
      Response.json(call++ === 2 ? visual({ very_bloody: 0.9 }) : visual()),
    );
    const frames = Array.from({ length: 4 }, () => ({ bytes: PNG, mimeType: "image/jpeg" }));
    const result = await mod.moderateFrames(frames, { targetType: "video", targetId: "vid-gore", allowExplicit: true });
    expect(result).toMatchObject({ ok: false, categories: ["gore"] });
    expect(await events("vid-gore")).toHaveLength(1);
  });

  it("refuses to pass a video with no frames to check", async () => {
    const { mod } = await load({ HIVE_API_KEY: KEYS.visual }, () => Response.json(visual()));
    expect(await mod.moderateFrames([], { targetType: "video", targetId: "vid-empty" })).toMatchObject({ ok: false, unavailable: true });
  });
});
