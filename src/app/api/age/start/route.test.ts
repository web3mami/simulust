import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

// ID checks on, with Veriff configured, so only the hold stands in the way.
vi.hoisted(() => {
  process.env.AGE_VERIFICATION = "id";
  process.env.VERIFF_API_KEY = "test-api-key";
  process.env.VERIFF_SHARED_SECRET = "test-shared-secret";
});

import { POST as start } from "./route";
import { currentUser } from "@/server/auth";
import { db } from "@/server/db";
import { ageChecks, rateLimits, users } from "@/server/db/schema";

const call = (handle: string) =>
  new Request("http://localhost/api/age/start", { method: "POST", headers: { "x-dev-user": handle } });

async function devUser(handle: string) {
  return (await currentUser(new Request("http://localhost/api/me", { headers: { "x-dev-user": handle } })))!;
}

// Veriff's answer to a new session, so a check that does start never leaves the test.
function stubVeriff() {
  const sessionId = crypto.randomUUID();
  const fetchMock = vi.fn(async () =>
    Response.json({ status: "success", verification: { id: sessionId, url: `https://magic.veriff.me/v/${sessionId}` } }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("POST /api/age/start", () => {
  // CA-V2: an ID check can't lift a hold (only the review can), and each
  // Veriff session costs money, so a held account never starts one.
  it("refuses a held account before the rate limit and before Veriff", async () => {
    const user = await devUser("start-held");
    const database = await db();
    await database.update(users).set({ explicitHoldAt: new Date(), ageAttestedAt: null }).where(eq(users.id, user.id));
    const fetchMock = stubVeriff();

    for (let i = 0; i < 7; i++) {
      const response = await start(call("start-held"));
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "Paused while we review this account.", code: "explicit_hold" });
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await database.select().from(rateLimits).where(eq(rateLimits.key, `age-start:${user.id}`))).toHaveLength(0);
    expect(await database.select().from(ageChecks).where(eq(ageChecks.userId, user.id))).toHaveLength(0);
    const [stored] = await database.select().from(users).where(eq(users.id, user.id));
    expect(stored.ageStatus).not.toBe("pending");
  });

  it("starts a check for an account that isn't held", async () => {
    const user = await devUser("start-open");
    const fetchMock = stubVeriff();
    const response = await start(call("start-open"));
    expect(response.status).toBe(200);
    expect((await response.json()) as { url: string }).toMatchObject({ url: expect.stringMatching(/^https:\/\/magic\.veriff\.me\/v\//) });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const database = await db();
    expect(await database.select().from(ageChecks).where(eq(ageChecks.userId, user.id))).toHaveLength(1);
  });

  it("needs a signed-in account", async () => {
    const response = await start(new Request("http://localhost/api/age/start", { method: "POST" }));
    expect(response.status).toBe(401);
  });
});
