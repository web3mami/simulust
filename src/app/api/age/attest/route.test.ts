import { afterEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { POST as attest } from "./route";
import { currentUser, explicitAllowed, isAgeVerified } from "@/server/auth";
import { db } from "@/server/db";
import { moderationEvents, users } from "@/server/db/schema";
import type { Me } from "@/lib/api-types";

function call(handle: string | null, json: unknown, path = "/api/age/attest", method = "POST") {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { ...(handle ? { "x-dev-user": handle } : {}), "content-type": "application/json" },
    body: JSON.stringify(json),
  });
}

const confirm = (handle: string, birthDate: string, today?: string) =>
  attest(call(handle, { birthDate, consent: true, ...(today ? { today } : {}) }));

async function row(handle: string) {
  const user = (await currentUser(call(handle, {})))!;
  const database = await db();
  const [found] = await database.select().from(users).where(eq(users.id, user.id));
  return found;
}

async function events(userId: string) {
  const database = await db();
  return database
    .select()
    .from(moderationEvents)
    .where(and(eq(moderationEvents.userId, userId), eq(moderationEvents.category, "attested_minor")));
}

// A date of birth this many years (and days) before today, as YYYY-MM-DD.
function bornYearsAgo(years: number, days = 0) {
  const date = new Date();
  date.setUTCFullYear(date.getUTCFullYear() - years);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

describe("POST /api/age/attest", () => {
  it("records when an adult confirmed, never the date, and opens explicit content", async () => {
    const response = await confirm("attest-adult", "1990-03-30");
    expect(response.status).toBe(200);
    const { me } = (await response.json()) as { me: Me };
    expect(me).toMatchObject({ ageAttested: true, ageVerified: true, explicitHold: false });

    const stored = await row("attest-adult");
    expect(stored.ageAttestedAt).toBeInstanceOf(Date);
    expect(isAgeVerified(stored)).toBe(true);
    // There's no separate switch: a confirmed adult gets explicit content.
    expect(explicitAllowed(stored)).toBe(true);
    // The consent tick is recorded, once.
    const consentAt = stored.settings.explicitConsentAt;
    expect(consentAt).toEqual(expect.any(String));
    expect(JSON.stringify(stored)).not.toMatch(/1990/);
    expect(await events(stored.id)).toHaveLength(0);
    expect((await confirm("attest-adult", "1990-03-30")).status).toBe(200);
    expect((await row("attest-adult")).settings.explicitConsentAt).toBe(consentAt);
  });

  it("counts the 18th birthday itself, and not the day before", async () => {
    expect((await confirm("attest-birthday", bornYearsAgo(18))).status).toBe(200);
    const response = await confirm("attest-day-before", bornYearsAgo(18, 1));
    expect(response.status).toBe(403);
  });

  it("counts the birthday by the browser's own date, when some time zone is on it", async () => {
    // Today furthest east (UTC+14), where it's already the birthday; after
    // 10:00 UTC that's tomorrow in UTC. The edges are pinned in age.test.ts.
    const east = new Date(Date.now() + 14 * 60 * 60 * 1000);
    const eighteenThere = new Date(east);
    eighteenThere.setUTCFullYear(east.getUTCFullYear() - 18);
    const [today, birthDate] = [east, eighteenThere].map((date) => date.toISOString().slice(0, 10));
    expect((await confirm("attest-east", birthDate, today)).status).toBe(200);
    // A "today" no time zone could have is ignored.
    const farOff = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    expect((await confirm("attest-far-off", bornYearsAgo(18, 1), farOff)).status).toBe(403);
  });

  it("holds explicit content for an under-18 date, logging it without the date", async () => {
    const birthDate = bornYearsAgo(16);
    const response = await confirm("attest-minor", birthDate);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "under_18" });

    const stored = await row("attest-minor");
    // The browser is marked as a held account's, so signing up again starts held.
    expect(response.headers.getSetCookie()).toEqual([
      `simulust-held=${stored.id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${365 * 24 * 60 * 60}`,
    ]);
    expect(stored.explicitHoldAt).toBeInstanceOf(Date);
    expect(stored.ageAttestedAt).toBeNull();
    expect(isAgeVerified(stored)).toBe(false);
    // Not banned: they can still leave, export or delete their account.
    expect(stored.bannedAt).toBeNull();

    const logged = await events(stored.id);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ action: "escalated", targetType: "profile", targetId: stored.id, reviewedAt: null });
    expect(logged[0].details).toMatchObject({ source: "age_attest" });
    expect(JSON.stringify(logged[0].details)).not.toContain(birthDate.slice(0, 4));
    expect(JSON.stringify(stored)).not.toContain(birthDate);
  });

  it("takes explicit content and the confirmation away if an adult then gives an under-18 date", async () => {
    expect((await confirm("attest-changed", "1985-06-01")).status).toBe(200);
    expect(explicitAllowed(await row("attest-changed"))).toBe(true);
    const settings = (await row("attest-changed")).settings;

    expect((await confirm("attest-changed", bornYearsAgo(15))).status).toBe(403);
    const stored = await row("attest-changed");
    expect(stored.ageAttestedAt).toBeNull();
    expect(stored.explicitHoldAt).toBeInstanceOf(Date);
    expect(explicitAllowed(stored)).toBe(false);
    // The hold is the whole change: settings are left as they were.
    expect(stored.settings).toEqual(settings);
  });

  it("won't take a new date of birth while the hold is open", async () => {
    expect((await confirm("attest-retry", bornYearsAgo(17))).status).toBe(403);
    const retry = await confirm("attest-retry", "1990-01-01");
    expect(retry.status).toBe(403);
    expect(await retry.json()).toEqual({ error: "Paused while we review this account.", code: "explicit_hold" });
    const stored = await row("attest-retry");
    expect(retry.headers.getSetCookie()[0]).toMatch(new RegExp(`^simulust-held=${stored.id}; `));
    expect(stored.ageAttestedAt).toBeNull();
    expect(isAgeVerified(stored)).toBe(false);
    expect(await events(stored.id)).toHaveLength(1);
  });

  it("refuses dates that aren't real, without a hold", async () => {
    const tomorrow = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    for (const birthDate of ["2001-02-30", "1899-12-31", tomorrow, "30/03/1990", "1990-3-30", "", "1990-03-30T00:00:00Z"]) {
      const response = await confirm("attest-typo", birthDate);
      expect(response.status, birthDate).toBe(400);
      expect(await response.json()).toMatchObject({ code: "invalid_birth_date" });
    }
    const stored = await row("attest-typo");
    expect(stored.explicitHoldAt).toBeNull();
    expect(stored.ageAttestedAt).toBeNull();
  });

  it("needs the consent box", async () => {
    for (const json of [{ birthDate: "1990-03-30" }, { birthDate: "1990-03-30", consent: false }, { birthDate: "1990-03-30", consent: "yes" }]) {
      expect((await attest(call("attest-consent", json))).status).toBe(400);
    }
    expect((await row("attest-consent")).ageAttestedAt).toBeNull();
  });

  it("needs a signed-in user", async () => {
    const response = await attest(call(null, { birthDate: "1990-03-30", consent: true }));
    expect(response.status).toBe(401);
  });

  it("is rate limited", async () => {
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 11; attempt++) statuses.push((await confirm("attest-limit", "1990-03-30")).status);
    expect(statuses.slice(0, 10).every((status) => status === 200)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});

describe("with AGE_VERIFICATION=id", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("doesn't count a date of birth as an age check", async () => {
    vi.stubEnv("AGE_VERIFICATION", "id");
    vi.resetModules();
    const { POST: attestId } = await import("./route");
    const { explicitAllowed: allowedId, isAgeVerified: verifiedId } = await import("@/server/auth");

    const response = await attestId(call("attest-id-mode", { birthDate: "1990-03-30", consent: true }));
    expect(response.status).toBe(200);
    expect(((await response.json()) as { me: Me }).me).toMatchObject({ ageAttested: true, ageVerified: false });
    expect(verifiedId(await row("attest-id-mode"))).toBe(false);
    expect(allowedId(await row("attest-id-mode"))).toBe(false);
  });
});
