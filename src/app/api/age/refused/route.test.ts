import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { POST as refused } from "./route";
import { currentUser, explicitAllowed } from "@/server/auth";
import { db } from "@/server/db";
import { moderationEvents, rateLimits, users } from "@/server/db/schema";

function call(handle: string | null, json: unknown = { today: "2026-06-14" }) {
  return new Request("http://localhost/api/age/refused", {
    method: "POST",
    headers: { ...(handle ? { "x-dev-user": handle } : {}), "content-type": "application/json" },
    body: JSON.stringify(json),
  });
}

async function confirmedAdult(handle: string) {
  const user = (await currentUser(call(handle)))!;
  const database = await db();
  const [row] = await database
    .update(users)
    .set({ ageAttestedAt: new Date() })
    .where(eq(users.id, user.id))
    .returning();
  return row;
}

async function reload(id: string) {
  const database = await db();
  const [row] = await database.select().from(users).where(eq(users.id, id));
  return row;
}

async function findings(userId: string) {
  const database = await db();
  return database
    .select()
    .from(moderationEvents)
    .where(and(eq(moderationEvents.userId, userId), eq(moderationEvents.category, "attested_minor")));
}

describe("POST /api/age/refused", () => {
  it("does nothing for a visitor who isn't signed in", async () => {
    const database = await db();
    const before = (await database.select().from(rateLimits)).length;
    const response = await refused(call(null));
    expect(response.status).toBe(204);
    expect(response.headers.getSetCookie()).toEqual([]);
    expect((await database.select().from(rateLimits)).length).toBe(before);
  });

  it("puts a signed-in account on an explicit hold, logged without any date", async () => {
    const adult = await confirmedAdult("refused-adult");
    expect(explicitAllowed(adult)).toBe(true);

    const response = await refused(call("refused-adult", { today: "2026-06-14", birthDate: "2012-05-01" }));
    expect(response.status).toBe(204);
    // The browser is marked as a held account's, so signing up again starts held.
    expect(response.headers.getSetCookie()).toEqual([
      `simulust-held=${adult.id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${365 * 24 * 60 * 60}`,
    ]);
    const stored = await reload(adult.id);
    expect(stored.explicitHoldAt).toBeInstanceOf(Date);
    // The confirmation goes too, so clearing the hold still asks again.
    expect(stored.ageAttestedAt).toBeNull();
    expect(explicitAllowed(stored)).toBe(false);
    // Not banned: they can still leave, export or delete their account.
    expect(stored.bannedAt).toBeNull();

    const logged = await findings(adult.id);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ action: "escalated", targetType: "profile", targetId: adult.id, reviewedAt: null });
    expect(logged[0].details).toMatchObject({ source: "device_gate" });
    expect(JSON.stringify(logged[0].details)).not.toMatch(/2012|2026/);
  });

  it("keeps one open review per account, counting repeats", async () => {
    const adult = await confirmedAdult("refused-repeat");
    for (let i = 0; i < 3; i++) expect((await refused(call("refused-repeat"))).status).toBe(204);
    const logged = await findings(adult.id);
    expect(logged).toHaveLength(1);
    expect(logged[0].details).toMatchObject({ repeats: 2 });
  });

  it("is rate limited, with the hold already in place", async () => {
    const adult = await confirmedAdult("refused-limit");
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) statuses.push((await refused(call("refused-limit"))).status);
    expect(statuses.slice(0, 20).every((status) => status === 204)).toBe(true);
    expect(statuses[20]).toBe(429);
    expect((await reload(adult.id)).explicitHoldAt).toBeInstanceOf(Date);
  });

  it("accepts an empty body", async () => {
    const response = await refused(
      new Request("http://localhost/api/age/refused", { method: "POST", headers: { "x-dev-user": "refused-empty" } }),
    );
    expect(response.status).toBe(204);
  });
});
