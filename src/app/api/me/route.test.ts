import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Me } from "@/lib/api-types";

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
let GET: (request: Request) => Promise<Response>;

beforeAll(async () => {
  vi.stubEnv("MODERATION_BASE_URL", "http://classifier.test/v1");
  vi.stubEnv("MODERATION_API_KEY", "classifier-key");
  vi.stubEnv("MODERATION_MODEL", "safeguard");
  vi.stubGlobal("fetch", fetchMock);
  vi.resetModules();
  ({ PATCH, GET } = await import("./route"));
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

describe("PATCH /api/me fields", () => {
  it("has no explicit switch, and refuses fields it doesn't know", async () => {
    for (const json of [
      { settings: { explicit: true } },
      { settings: { explicit: false, unpromptedMedia: true } },
      { explicit: true },
      { username: "someone_else" },
      { isAdmin: true },
    ]) {
      const response = await patch("me-unknown-field", json);
      expect(response.status, JSON.stringify(json)).toBe(400);
      expect(((await response.json()) as { code: string }).code).toBe("invalid");
    }
    const me = (await (await GET(new Request("http://localhost/api/me", { headers: { "x-dev-user": "me-unknown-field" } }))).json()) as {
      me: Me;
    };
    expect(me.me.settings).toEqual({ unpromptedMedia: false });
    expect(me.me.isAdmin).toBe(false);
    expect(screened).toHaveLength(0);
  });

  it("sets unprompted media and a Solana wallet address", async () => {
    const response = await patch("me-wallet", {
      settings: { unpromptedMedia: true },
      walletAddress: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
    });
    expect(response.status).toBe(200);
    expect(((await response.json()) as { me: Me }).me.settings).toEqual({ unpromptedMedia: true });
    for (const walletAddress of ["0xabc", "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU0O", "not a wallet"]) {
      expect((await patch("me-wallet", { walletAddress })).status, walletAddress).toBe(400);
    }
    expect((await patch("me-wallet", { walletAddress: null })).status).toBe(200);
  });
});

describe("GET /api/me", () => {
  it("tells the app the date-of-birth gate is the age check", async () => {
    const response = await GET(new Request("http://localhost/api/me", { headers: { "x-dev-user": "me-features" } }));
    const body = (await response.json()) as { me: Me; features: { ageVerification: string } };
    expect(body.features.ageVerification).toBe("gate");
    // A development account: no username, and no age confirmation yet.
    expect(body.me).toMatchObject({ username: null, ageAttested: false, ageVerified: false, explicitHold: false });
  });

  it("answers signed out with no account", async () => {
    const response = await GET(new Request("http://localhost/api/me"));
    expect(((await response.json()) as { me: Me | null }).me).toBeNull();
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("marks a held account's browser, and unmarks it once the hold is lifted", async () => {
    const { eq } = await import("drizzle-orm");
    const { db } = await import("@/server/db");
    const { users } = await import("@/server/db/schema");
    const read = (cookie?: string) =>
      GET(new Request("http://localhost/api/me", { headers: { "x-dev-user": "me-held", ...(cookie ? { cookie } : {}) } }));
    const { me } = (await (await read()).json()) as { me: Me };
    expect((await read()).headers.getSetCookie()).toEqual([]);

    const database = await db();
    await database.update(users).set({ explicitHoldAt: new Date() }).where(eq(users.id, me.id));
    const held = await read();
    expect(((await held.json()) as { me: Me }).me.explicitHold).toBe(true);
    expect(held.headers.getSetCookie()).toEqual([
      `simulust-held=${me.id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${365 * 24 * 60 * 60}`,
    ]);

    await database.update(users).set({ explicitHoldAt: null }).where(eq(users.id, me.id));
    expect((await read(`simulust-held=${me.id}`)).headers.getSetCookie()).toEqual([
      "simulust-held=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
    ]);
    // Another account's mark is left alone.
    expect((await read(`simulust-held=${crypto.randomUUID()}`)).headers.getSetCookie()).toEqual([]);
  });
});
