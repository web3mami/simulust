import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { currentUser, identityHash } from "@/server/auth";
import { balanceOf, grant, refund, spend, InsufficientCredits } from "@/server/credits";
import { db } from "@/server/db";
import { characters, creditLedger, deletedIdentities, users } from "@/server/db/schema";
import { FREE } from "@/lib/pricing";

function devRequest(handle: string) {
  return new Request("http://localhost/api/me", { headers: { "x-dev-user": handle } });
}

describe("database spine", () => {
  beforeAll(async () => {
    await db();
  });

  it("migrates and seeds official characters", async () => {
    const database = await db();
    const rows = await database.select({ id: characters.id }).from(characters);
    expect(rows.length).toBeGreaterThan(10);
  });

  it("creates a user once, with signup credits", async () => {
    const first = await currentUser(devRequest("alice"));
    const again = await currentUser(devRequest("alice"));
    expect(first?.id).toBeDefined();
    expect(again?.id).toBe(first?.id);
    expect(await balanceOf(first!.id)).toBe(FREE.signupCredits);
  });

  it("refuses to overspend, even under concurrency", async () => {
    const user = (await currentUser(devRequest("bob")))!;
    const attempts = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) => spend(user.id, 8, "photo", { type: "test", id: String(i) })),
    );
    const spent = attempts.filter((result) => result.status === "fulfilled").length;
    expect(spent).toBe(Math.floor(FREE.signupCredits / 8));
    expect(attempts.some((result) => result.status === "rejected" && result.reason instanceof InsufficientCredits)).toBe(true);
    expect(await balanceOf(user.id)).toBe(FREE.signupCredits - spent * 8);
  });

  it("credits a purchase exactly once", async () => {
    const user = (await currentUser(devRequest("carol")))!;
    const ref = { type: "order", id: "order-1" };
    const results = await Promise.all([grant(user.id, 500, "purchase", ref), grant(user.id, 500, "purchase", ref)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await balanceOf(user.id)).toBe(FREE.signupCredits + 500);
    const database = await db();
    const rows = await database.select().from(creditLedger).where(eq(creditLedger.userId, user.id));
    expect(rows.filter((row) => row.reason === "purchase")).toHaveLength(1);
  });

  it("refunds only what was actually charged, once", async () => {
    const user = (await currentUser(devRequest("erin")))!;
    expect(await refund(user.id, 60, "never-charged")).toBe(false);
    await spend(user.id, 8, "photo", { type: "photo", id: "photo-1" });
    expect(await refund(user.id, 60, "photo-1")).toBe(true);
    expect(await refund(user.id, 8, "photo-1")).toBe(false);
    expect(await balanceOf(user.id)).toBe(FREE.signupCredits);
  });

  it("doesn't grant signup credits again after an account is deleted", async () => {
    const database = await db();
    const first = (await currentUser(devRequest("dave")))!;
    await database.insert(deletedIdentities).values({ privyIdHash: identityHash(first.privyId) });
    await database.delete(users).where(eq(users.id, first.id));
    const again = (await currentUser(devRequest("dave")))!;
    expect(again.id).not.toBe(first.id);
    expect(await balanceOf(again.id)).toBe(0);
  });

  it("rejects characters under 18 at the database level", async () => {
    const database = await db();
    await expect(
      database.insert(characters).values({
        id: "too-young",
        name: "X",
        age: 17,
        gender: "Woman",
        ethnicity: "x",
        body: "x",
        role: "x",
        heat: "x",
        line: "x",
        lane: "girls",
      }),
    ).rejects.toThrow();
  });
});
