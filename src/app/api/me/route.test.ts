import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The moderation classifier is faked over fetch. Env is read at import, hence
// the late imports.
let classifier: "ALLOW" | "BLOCK:minor" | "down" = "ALLOW";
let screened: string[] = [];

const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  if (url === "http://classifier.test/v1/chat/completions") {
    const body = JSON.parse(String(init?.body)) as { messages: { role: string; content: string }[] };
    screened.push(body.messages.find((message) => message.role === "user")!.content);
    if (classifier === "down") return new Response("upstream error", { status: 502 });
    return Response.json({ choices: [{ message: { content: classifier } }] });
  }
  throw new Error(`Unexpected fetch ${url}`);
});

let PATCH: (request: Request) => Promise<Response>;

beforeAll(async () => {
  vi.stubEnv("MODERATION_BASE_URL", "http://classifier.test/v1");
  vi.stubEnv("MODERATION_API_KEY", "classifier-key");
  vi.stubEnv("MODERATION_MODEL", "safeguard");
  vi.stubGlobal("fetch", fetchMock);
  vi.resetModules();
  ({ PATCH } = await import("./route"));
});

afterAll(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  classifier = "ALLOW";
  screened = [];
});

function patch(handle: string, json: unknown) {
  return PATCH(
    new Request("http://localhost/api/me", {
      method: "PATCH",
      headers: { "x-dev-user": handle, "Content-Type": "application/json" },
      body: JSON.stringify(json),
    }),
  );
}

describe("PATCH /api/me", () => {
  it("sets a display name the classifier allows", async () => {
    const response = await patch("me-name-ok", { displayName: "Sam" });
    expect(response.status).toBe(200);
    expect(((await response.json()) as { me: { displayName: string } }).me.displayName).toBe("Sam");
    expect(screened).toHaveLength(1);
    expect(screened[0]).toContain("Sam");
  });

  it("refuses a display name the classifier blocks, as the profile name does", async () => {
    classifier = "BLOCK:minor";
    const response = await patch("me-name-minor", { displayName: "Your little Amy" });
    expect(response.status).toBe(422);
    expect(((await response.json()) as { code: string }).code).toBe("blocked_name");
    expect(screened).toHaveLength(1);
    expect(screened[0]).toContain("Your Little Amy");
  });

  it("fails closed when the classifier can't answer", async () => {
    classifier = "down";
    const response = await patch("me-name-down", { displayName: "Sam" });
    expect(response.status).toBe(503);
    expect(((await response.json()) as { code: string }).code).toBe("moderation_unavailable");
  });

  it("doesn't ask the classifier about settings or an unchanged name", async () => {
    expect((await patch("me-name-settings", { settings: { unpromptedMedia: false } })).status).toBe(200);
    expect((await patch("me-name-settings", { displayName: "Sam" })).status).toBe(200);
    expect((await patch("me-name-settings", { displayName: "Sam", settings: { unpromptedMedia: true } })).status).toBe(200);
    expect(screened).toHaveLength(1);
  });
});
