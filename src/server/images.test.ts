import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The worker's error answers: its own safety block, FastAPI's validation
// errors (also 422) and plain-text failures, each read from one body.
let generateImage: typeof import("@/server/images").generateImage;
let ImageGenerationError: typeof import("@/server/images").ImageGenerationError;
let workerRefusalCategory: typeof import("@/server/images").workerRefusalCategory;

beforeAll(async () => {
  vi.stubEnv("IMAGE_PROVIDER", "worker");
  vi.stubEnv("IMAGE_API_URL", "http://worker.test");
  vi.resetModules();
  ({ generateImage, ImageGenerationError, workerRefusalCategory } = await import("@/server/images"));
});

afterAll(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function answer(response: Response) {
  vi.stubGlobal("fetch", vi.fn(async () => response));
  return generateImage({ prompt: "portrait", negativePrompt: "child", width: 896, height: 1152, style: "anime" }).catch(
    (error: unknown) => error,
  );
}

describe("image worker errors", () => {
  it("treats the worker's block as a moderation block, with its reason", async () => {
    const error = await answer(Response.json({ error: "blocked", reason: "apparent minor: loli:0.91" }, { status: 422 }));
    expect(error).toBeInstanceOf(ImageGenerationError);
    expect(error).toMatchObject({ blocked: true, reason: "apparent minor: loli:0.91" });
  });

  it("keeps a validation error's detail instead of failing to read the body twice", async () => {
    const detail = { detail: [{ type: "string_too_long", loc: ["body", "prompt"], msg: "String should have at most 4000 characters" }] };
    const error = await answer(Response.json(detail, { status: 422 }));
    expect(error).toBeInstanceOf(ImageGenerationError);
    expect(error).toMatchObject({ blocked: false, reason: null });
    expect((error as Error).message).toContain("Image worker 422");
    expect((error as Error).message).toContain("string_too_long");
  });

  it("keeps a non-JSON error body", async () => {
    const error = await answer(new Response("<html>502 Bad Gateway</html>", { status: 502 }));
    expect(error).toMatchObject({ blocked: false });
    expect((error as Error).message).toBe("Image worker 502: <html>502 Bad Gateway</html>");
  });

  it("only counts a 422 as a block", async () => {
    const error = await answer(Response.json({ error: "blocked" }, { status: 503 }));
    expect(error).toMatchObject({ blocked: false });
  });
});

describe("workerRefusalCategory", () => {
  it("files minors and real people under the app's own categories", () => {
    expect(workerRefusalCategory("minor:teen")).toBe("minor");
    expect(workerRefusalCategory("minor:stated age")).toBe("minor");
    expect(workerRefusalCategory("apparent minor: loli:0.91, child:0.40")).toBe("minor");
    expect(workerRefusalCategory("real_person:deepfake")).toBe("real_person");
    expect(workerRefusalCategory("safety")).toBe("worker_refused");
    expect(workerRefusalCategory("minority report")).toBe("worker_refused");
  });

  // WPC-5: a second person is the one-person rule, never minor content.
  it("files the tagger seeing a second person as its own category, never minor", () => {
    for (const reason of ["people:2girls:0.80", "people:1boy+1girl:0.71, multiple_boys:0.40", "people (source):2girls:0.80", "people (frames):hetero:0.52", "People:couple:0.9"]) {
      expect(workerRefusalCategory(reason), reason).toBe("one_person");
    }
    // An apparent minor still comes first, whatever else it lists.
    expect(workerRefusalCategory("apparent minor (frames): loli:0.91")).toBe("minor");
    for (const reason of ["peoples", "term:people", "minor:people"]) {
      expect(workerRefusalCategory(reason), reason).not.toBe("one_person");
    }
  });

  it("keeps the worker's image-only words out of the minor category", () => {
    for (const reason of ["term:minor", "term:kid", "term:high school", "term:unassigned U+1CCE9", "term:adult (negative prompt)"]) {
      expect(workerRefusalCategory(reason), reason).toBe("worker_refused");
    }
    expect(workerRefusalCategory("minor")).toBe("worker_refused");
  });
});
