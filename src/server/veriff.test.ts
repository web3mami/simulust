import { createHmac } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";

vi.hoisted(() => {
  process.env.VERIFF_API_KEY = "test-api-key";
  process.env.VERIFF_SHARED_SECRET = "test-shared-secret";
});

import { PATCH as banUser } from "@/app/api/admin/users/route";
import { POST as startCheck } from "@/app/api/age/start/route";
import { currentUser, requireUser, UNDERAGE_FINDING } from "@/server/auth";
import { db } from "@/server/db";
import { ageChecks, moderationEvents, users, type User } from "@/server/db/schema";
import { ageOn, createSession, handleDecision, verifySignature } from "@/server/veriff";

const SECRET = "test-shared-secret";

function sign(body: string, secret = SECRET) {
  return createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

function asUser(handle: string, path = "/api/me", init: { method?: string; json?: unknown } = {}) {
  return new Request(`http://localhost${path}`, {
    method: init.method ?? "GET",
    headers: { "x-dev-user": handle, ...(init.json !== undefined ? { "content-type": "application/json" } : {}) },
    body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
  });
}

async function devUser(handle: string) {
  const user = await currentUser(asUser(handle));
  return user!;
}

async function reload(user: User) {
  const database = await db();
  const [row] = await database.select().from(users).where(eq(users.id, user.id));
  return row;
}

async function checkFor(sessionId: string) {
  const database = await db();
  const [row] = await database.select().from(ageChecks).where(eq(ageChecks.sessionId, sessionId));
  return row;
}

async function eventsFor(user: User, category: string) {
  const database = await db();
  return database
    .select()
    .from(moderationEvents)
    .where(and(eq(moderationEvents.userId, user.id), eq(moderationEvents.category, category)));
}

// Starts a session through createSession with Veriff's API stubbed out.
async function startSession(user: User) {
  const sessionId = crypto.randomUUID();
  const fetchMock = vi.fn(async () =>
    Response.json({
      status: "success",
      verification: { id: sessionId, url: `https://magic.veriff.me/v/${sessionId}`, vendorData: user.id },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const result = await createSession(user);
  vi.unstubAllGlobals();
  return { ...result, sessionId, fetchMock };
}

// Veriff sends the document's birth date in person.dateOfBirth.
const adult = { person: { dateOfBirth: "1990-03-30" } };
const minor = { person: { dateOfBirth: "2009-01-01" } };

function decision(sessionId: string, status: string, extra: Record<string, unknown> = {}) {
  return {
    status: "success",
    verification: {
      id: sessionId,
      status,
      code: 9001,
      vendorData: null,
      decisionTime: "2026-10-26T12:00:00.000Z",
      ...extra,
    },
  };
}

describe("veriff signature", () => {
  const body = JSON.stringify(decision("abc", "approved"));

  it("accepts the HMAC-SHA256 hex of the raw body", () => {
    expect(verifySignature(body, new Headers({ "x-hmac-signature": sign(body) }))).toBe(true);
  });

  it("accepts an uppercase hex signature", () => {
    expect(verifySignature(body, new Headers({ "X-HMAC-SIGNATURE": sign(body).toUpperCase() }))).toBe(true);
  });

  it("rejects a tampered body", () => {
    const signature = sign(body);
    expect(verifySignature(body.replace("approved", "declined"), new Headers({ "x-hmac-signature": signature }))).toBe(false);
  });

  it("rejects a signature made with another secret", () => {
    expect(verifySignature(body, new Headers({ "x-hmac-signature": sign(body, "other-secret") }))).toBe(false);
  });

  it("rejects a missing or malformed signature", () => {
    expect(verifySignature(body, new Headers())).toBe(false);
    expect(verifySignature(body, new Headers({ "x-hmac-signature": "not-hex" }))).toBe(false);
    expect(verifySignature(body, new Headers({ "x-hmac-signature": sign(body).slice(0, 40) }))).toBe(false);
  });

  it("rejects everything when no secret is configured", () => {
    expect(verifySignature(body, new Headers({ "x-hmac-signature": sign(body) }), "")).toBe(false);
  });

  it("is sensitive to re-serialized JSON", () => {
    const pretty = JSON.stringify(JSON.parse(body), null, 2);
    expect(verifySignature(pretty, new Headers({ "x-hmac-signature": sign(body) }))).toBe(false);
  });
});

describe("veriff sessions and decisions", () => {
  beforeAll(async () => {
    await db();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates a session with our user id as vendorData and marks the user pending", async () => {
    const user = await devUser("veriff-start");
    const { url, sessionId, fetchMock } = await startSession(user);
    expect(url).toContain(sessionId);

    const [endpoint, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(endpoint).toBe("https://stationapi.veriff.com/v1/sessions");
    expect((init.headers as Record<string, string>)["X-AUTH-CLIENT"]).toBe("test-api-key");
    const sent = JSON.parse(String(init.body));
    expect(sent.verification.vendorData).toBe(user.id);
    expect(sent.verification.callback).toMatch(/\/verify\?from=veriff$/);

    const check = await checkFor(sessionId);
    expect(check).toMatchObject({ userId: user.id, provider: "veriff", status: "created" });
    expect((await reload(user)).ageStatus).toBe("pending");
  });

  it("surfaces a provider failure without creating a check", async () => {
    const user = await devUser("veriff-fail");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    await expect(createSession(user)).rejects.toMatchObject({ status: 502 });
    const database = await db();
    expect(await database.select().from(ageChecks).where(eq(ageChecks.userId, user.id))).toHaveLength(0);
  });

  it("approves an adult and stores only the outcome", async () => {
    const user = await devUser("veriff-approve");
    const { sessionId } = await startSession(user);
    const result = await handleDecision(
      decision(sessionId, "approved", {
        vendorData: user.id,
        person: { firstName: "SARAH", lastName: "MORGAN", dateOfBirth: "1990-03-30", idNumber: "X123" },
      }),
    );
    expect(result).toEqual({ applied: true, status: "approved" });
    const row = await reload(user);
    expect(row.ageStatus).toBe("approved");
    expect(row.ageVerifiedAt).toBeInstanceOf(Date);
    const check = await checkFor(sessionId);
    expect(check.status).toBe("approved");
    expect(check.decidedAt).toBeInstanceOf(Date);
    expect(JSON.stringify(check)).not.toContain("1990");
    expect(JSON.stringify(row)).not.toContain("1990");
  });

  it("declines an approval whose birth date is under 18 and locks the account", async () => {
    const user = await devUser("veriff-minor");
    const { sessionId } = await startSession(user);
    const result = await handleDecision(decision(sessionId, "approved", minor));
    expect(result).toEqual({ applied: true, status: "declined" });
    const row = await reload(user);
    expect(row.ageStatus).toBe("declined");
    expect(row.ageVerifiedAt).toBeNull();
    expect(row.bannedAt).toBeInstanceOf(Date);
    const events = await eventsFor(user, UNDERAGE_FINDING);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ action: "escalated", targetType: "profile", targetId: user.id, reviewedAt: null });
    expect(JSON.stringify(events)).not.toContain("2009");
  });

  it("treats someone turning 18 the day after the decision as a minor", async () => {
    expect(ageOn("2008-10-27", new Date("2026-10-26T12:00:00Z"))).toBe(17);
    expect(ageOn("2008-10-26", new Date("2026-10-26T12:00:00Z"))).toBe(18);
    expect(ageOn("not-a-date", new Date())).toBeNull();
  });

  // Veriff approves genuine documents; an approval says nothing about age
  // unless it carries a birth date we can read.
  it.each([
    ["no person data", "nodob-missing", {}],
    ["a null person", "nodob-null-person", { person: null }],
    ["a null birth date", "nodob-null", { person: { dateOfBirth: null } }],
    ["no birth date field", "nodob-no-field", { person: { firstName: "SARAH" } }],
    ["an unreadable birth date", "nodob-unreadable", { person: { dateOfBirth: "unknown" } }],
  ])("declines an approval with %s, flags it, and doesn't lock the account", async (_, handle, extra) => {
    const user = await devUser(handle);
    const { sessionId } = await startSession(user);
    expect(await handleDecision(decision(sessionId, "approved", extra))).toEqual({ applied: true, status: "declined" });
    expect((await checkFor(sessionId)).status).toBe("declined");
    const row = await reload(user);
    expect(row.ageStatus).toBe("declined");
    expect(row.ageVerifiedAt).toBeNull();
    expect(row.bannedAt).toBeNull();
    const flagged = await eventsFor(user, "age_check_no_dob");
    expect(flagged).toHaveLength(1);
    expect(flagged[0]).toMatchObject({ action: "flagged", targetId: user.id, details: { sessionId } });
    expect(await eventsFor(user, UNDERAGE_FINDING)).toHaveLength(0);
    // Declined, not locked: the user can sign in and try again.
    expect((await currentUser(asUser(handle)))?.id).toBe(user.id);
  });

  it("maps declined, resubmission, expired and abandoned", async () => {
    const declined = await devUser("veriff-declined");
    const d = await startSession(declined);
    expect(await handleDecision(decision(d.sessionId, "declined"))).toEqual({ applied: true, status: "declined" });
    expect((await reload(declined)).ageStatus).toBe("declined");

    const resubmit = await devUser("veriff-resubmit");
    const r = await startSession(resubmit);
    expect(await handleDecision(decision(r.sessionId, "resubmission_requested"))).toEqual({
      applied: true,
      status: "resubmission",
    });
    expect((await reload(resubmit)).ageStatus).toBe("pending");
    // Resubmission isn't final: the same session can still be approved.
    expect(await handleDecision(decision(r.sessionId, "approved", adult))).toEqual({ applied: true, status: "approved" });
    expect((await reload(resubmit)).ageStatus).toBe("approved");

    const expired = await devUser("veriff-expired");
    const e = await startSession(expired);
    expect(await handleDecision(decision(e.sessionId, "expired"))).toEqual({ applied: true, status: "expired" });
    expect((await reload(expired)).ageStatus).toBe("none");

    const abandoned = await devUser("veriff-abandoned");
    const a = await startSession(abandoned);
    expect((await handleDecision(decision(a.sessionId, "abandoned"))).status).toBe("expired");
    expect((await reload(abandoned)).ageStatus).toBe("none");
  });

  it("records a submitted event without deciding", async () => {
    const user = await devUser("veriff-event");
    const { sessionId } = await startSession(user);
    const result = await handleDecision({
      id: sessionId,
      attemptId: crypto.randomUUID(),
      feature: "selfid",
      code: 7002,
      action: "submitted",
      vendorData: user.id,
      endUserId: user.id,
    });
    expect(result).toEqual({ applied: true, status: "submitted" });
    expect((await checkFor(sessionId)).status).toBe("submitted");
    expect((await reload(user)).ageStatus).toBe("pending");
  });

  it("applies a duplicated decision once, even when deliveries race", async () => {
    const user = await devUser("veriff-dupe");
    const { sessionId } = await startSession(user);
    const payload = decision(sessionId, "approved", adult);
    const results = await Promise.all([handleDecision(payload), handleDecision(payload), handleDecision(payload)]);
    expect(results.filter((result) => result.applied)).toHaveLength(1);
    const first = (await reload(user)).ageVerifiedAt;

    const replay = await handleDecision(payload);
    expect(replay).toEqual({ applied: false, status: "approved", reason: "already_final" });
    expect((await reload(user)).ageVerifiedAt?.getTime()).toBe(first?.getTime());
  });

  it("ignores a late decision after the session is final", async () => {
    const user = await devUser("veriff-late");
    const { sessionId } = await startSession(user);
    await handleDecision(decision(sessionId, "approved", adult));
    const late = await handleDecision(decision(sessionId, "declined"));
    expect(late.applied).toBe(false);
    expect((await checkFor(sessionId)).status).toBe("approved");
    expect((await reload(user)).ageStatus).toBe("approved");
  });

  it("keeps an approval when another session of the same user is declined", async () => {
    const user = await devUser("veriff-two");
    const first = await startSession(user);
    const second = await startSession(user);
    await handleDecision(decision(first.sessionId, "approved", adult));
    await handleDecision(decision(second.sessionId, "declined"));
    expect((await reload(user)).ageStatus).toBe("approved");
  });

  it("ignores unknown sessions, mismatched users and unknown statuses", async () => {
    expect(await handleDecision(decision(crypto.randomUUID(), "approved"))).toEqual({
      applied: false,
      reason: "unknown_session",
    });

    const user = await devUser("veriff-mismatch");
    const other = await devUser("veriff-other");
    const { sessionId } = await startSession(user);
    expect(await handleDecision(decision(sessionId, "approved", { ...adult, vendorData: other.id }))).toEqual({
      applied: false,
      reason: "user_mismatch",
    });
    expect((await reload(user)).ageStatus).toBe("pending");

    expect((await handleDecision(decision(sessionId, "something_new"))).reason).toBe("unknown_status");
    expect((await handleDecision({ hello: "world" })).reason).toBe("ignored");
    expect((await handleDecision({ status: "success", verification: null })).reason).toBe("ignored");
  });
});

describe("underage lock", () => {
  beforeAll(async () => {
    await db();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function unban(user: User) {
    const response = await banUser(asUser("admin", "/api/admin/users", { method: "PATCH", json: { id: user.id, banned: false } }));
    expect(response.status).toBe(200);
  }

  it("refuses every request from the locked account with an age-specific 403", async () => {
    const user = await devUser("lock-requests");
    const { sessionId } = await startSession(user);
    await handleDecision(decision(sessionId, "approved", minor));

    const locked = { status: 403, code: "age_locked" };
    await expect(currentUser(asUser("lock-requests"))).rejects.toMatchObject(locked);
    await expect(requireUser(asUser("lock-requests"))).rejects.toMatchObject(locked);
    // Re-verifying can't lift it: starting a new check is refused like everything else.
    const start = await startCheck(asUser("lock-requests", "/api/age/start", { method: "POST" }));
    expect(start.status).toBe(403);
    expect(await start.json()).toMatchObject({ code: "age_locked" });
  });

  it("isn't overridden by an approval for another session that lands later", async () => {
    const user = await devUser("lock-late-approval");
    const minorSession = await startSession(user);
    const adultSession = await startSession(user);
    await handleDecision(decision(minorSession.sessionId, "approved", minor));

    // Someone else's ID, still pending from before the lock.
    expect(await handleDecision(decision(adultSession.sessionId, "approved", adult))).toEqual({
      applied: true,
      status: "approved",
    });
    const row = await reload(user);
    expect(row.ageStatus).toBe("declined");
    expect(row.ageVerifiedAt).toBeNull();
    expect(row.bannedAt).toBeInstanceOf(Date);
  });

  it("overrides an approval that landed first", async () => {
    const user = await devUser("lock-early-approval");
    const adultSession = await startSession(user);
    const minorSession = await startSession(user);
    await handleDecision(decision(adultSession.sessionId, "approved", adult));
    expect((await reload(user)).ageStatus).toBe("approved");

    await handleDecision(decision(minorSession.sessionId, "approved", minor));
    const row = await reload(user);
    expect(row.ageStatus).toBe("declined");
    expect(row.ageVerifiedAt).toBeNull();
    expect(row.bannedAt).toBeInstanceOf(Date);
  });

  it("is lifted only by an admin unban, which leaves the user to verify again", async () => {
    const user = await devUser("lock-unban");
    const adultSession = await startSession(user);
    const minorSession = await startSession(user);
    const pendingSession = await startSession(user);
    await handleDecision(decision(adultSession.sessionId, "approved", adult));
    await handleDecision(decision(minorSession.sessionId, "approved", minor));

    await unban(user);
    const row = await reload(user);
    expect(row.bannedAt).toBeNull();
    // The approval from before the lock no longer counts.
    expect(row.ageStatus).toBe("none");
    expect(row.ageVerifiedAt).toBeNull();
    const [finding] = await eventsFor(user, UNDERAGE_FINDING);
    expect(finding.reviewedAt).toBeInstanceOf(Date);
    const [audit] = await eventsFor(user, "unban");
    expect(audit.details).toMatchObject({ ageLockCleared: true });
    expect((await currentUser(asUser("lock-unban")))?.id).toBe(user.id);

    // Nor does a session started before the review that finishes after it.
    await handleDecision(decision(pendingSession.sessionId, "approved", adult));
    expect((await reload(user)).ageStatus).toBe("none");

    // A new check does.
    const fresh = await startSession(user);
    expect((await reload(user)).ageStatus).toBe("pending");
    await handleDecision(decision(fresh.sessionId, "approved", adult));
    expect((await reload(user)).ageStatus).toBe("approved");
  });

  // With Veriff's own age rule on (SETUP.md), an under-18 document comes back
  // declined, not approved, and still carries its birth date.
  const ownId = { code: 9102, reason: "Person is under 18 years old", reasonCode: 533, person: { dateOfBirth: "2011-04-02" } };

  it("locks on a decline whose birth date is under 18", async () => {
    const user = await devUser("lock-declined");
    const { sessionId } = await startSession(user);
    expect(await handleDecision(decision(sessionId, "declined", ownId))).toEqual({ applied: true, status: "declined" });
    const row = await reload(user);
    expect(row.ageStatus).toBe("declined");
    expect(row.bannedAt).toBeInstanceOf(Date);
    const events = await eventsFor(user, UNDERAGE_FINDING);
    expect(events).toHaveLength(1);
    expect(events[0].details).toMatchObject({ sessionId, decision: "declined", reasonCode: 533 });
    expect(JSON.stringify(events)).not.toContain("2011");
    // Five fresh sessions a day would otherwise be one tap away.
    const start = await startCheck(asUser("lock-declined", "/api/age/start", { method: "POST" }));
    expect(start.status).toBe(403);
    expect(await start.json()).toMatchObject({ code: "age_locked" });
  });

  it.each([
    ["a resubmission request", "lock-resubmit-minor", "resubmission_requested", minor],
    ["a decline for another reason", "lock-other-decline", "declined", { reasonCode: 102, ...minor }],
    ["an expiry", "lock-expired-minor", "expired", minor],
  ])("locks on %s whose birth date is under 18", async (_, handle, status, extra) => {
    const user = await devUser(handle);
    const { sessionId } = await startSession(user);
    expect(await handleDecision(decision(sessionId, status, extra))).toEqual({ applied: true, status: "declined" });
    expect((await reload(user)).bannedAt).toBeInstanceOf(Date);
    expect(await eventsFor(user, UNDERAGE_FINDING)).toHaveLength(1);
  });

  it.each([530, 531, 532, 533])("locks on Veriff's under-18 reason code %i without a birth date", async (reasonCode) => {
    const user = await devUser(`lock-reason-${reasonCode}`);
    const { sessionId } = await startSession(user);
    await handleDecision(decision(sessionId, "declined", { reasonCode }));
    expect((await reload(user)).bannedAt).toBeInstanceOf(Date);
    expect(await eventsFor(user, UNDERAGE_FINDING)).toHaveLength(1);
  });

  it.each([534, 535, 536])("treats reason code %i (an age limit above 18) as a plain decline", async (reasonCode) => {
    const user = await devUser(`lock-reason-${reasonCode}`);
    const { sessionId } = await startSession(user);
    expect(await handleDecision(decision(sessionId, "declined", { reasonCode, ...adult }))).toEqual({
      applied: true,
      status: "declined",
    });
    const row = await reload(user);
    expect(row.ageStatus).toBe("declined");
    expect(row.bannedAt).toBeNull();
    expect(await eventsFor(user, UNDERAGE_FINDING)).toHaveLength(0);
  });

  it("isn't outweighed by a sibling's ID approved in a parallel session", async () => {
    const user = await devUser("lock-sibling");
    const sibling = await startSession(user);
    const own = await startSession(user);
    await handleDecision(decision(sibling.sessionId, "approved", { person: { dateOfBirth: "1999-01-01" } }));
    expect((await reload(user)).ageStatus).toBe("approved");

    await handleDecision(decision(own.sessionId, "declined", ownId));
    const row = await reload(user);
    expect(row.ageStatus).toBe("declined");
    expect(row.ageVerifiedAt).toBeNull();
    expect(row.bannedAt).toBeInstanceOf(Date);
    await expect(currentUser(asUser("lock-sibling"))).rejects.toMatchObject({ status: 403, code: "age_locked" });
  });

  it("counts a minor shown after the session is final, once", async () => {
    const user = await devUser("lock-out-of-order");
    const { sessionId } = await startSession(user);
    // The resubmitted (adult) document's approval overtakes the first attempt's decision.
    await handleDecision(decision(sessionId, "approved", adult));
    const late = decision(sessionId, "resubmission_requested", minor);
    expect(await handleDecision(late)).toEqual({ applied: true, status: "approved" });
    expect((await checkFor(sessionId)).status).toBe("approved");
    const row = await reload(user);
    expect(row.ageStatus).toBe("declined");
    expect(row.bannedAt).toBeInstanceOf(Date);

    // Redelivered, it doesn't open a second finding; and once an admin has
    // reviewed it, it doesn't reopen it.
    expect((await handleDecision(late)).applied).toBe(false);
    expect(await eventsFor(user, UNDERAGE_FINDING)).toHaveLength(1);
    await unban(user);
    expect((await handleDecision(late)).applied).toBe(false);
    expect((await reload(user)).bannedAt).toBeNull();
    expect(await eventsFor(user, UNDERAGE_FINDING)).toHaveLength(1);
  });

  it("opens one finding when a minor's decline is delivered twice", async () => {
    const user = await devUser("lock-redelivered");
    const { sessionId } = await startSession(user);
    const payload = decision(sessionId, "declined", ownId);
    await Promise.all([handleDecision(payload), handleDecision(payload)]);
    expect(await handleDecision(payload)).toEqual({ applied: false, reason: "already_final" });
    expect(await eventsFor(user, UNDERAGE_FINDING)).toHaveLength(1);
  });

  it("stays locked if an admin bans the account again after the review", async () => {
    const user = await devUser("lock-reban");
    const { sessionId } = await startSession(user);
    await handleDecision(decision(sessionId, "approved", minor));
    await unban(user);
    const response = await banUser(
      asUser("admin", "/api/admin/users", { method: "PATCH", json: { id: user.id, banned: true, reason: "confirmed minor" } }),
    );
    expect(response.status).toBe(200);
    // The finding was reviewed, so this is an ordinary suspension.
    await expect(currentUser(asUser("lock-reban"))).rejects.toMatchObject({ status: 403, code: "forbidden" });
  });

  it("leaves age status alone when an ordinary ban is lifted", async () => {
    const user = await devUser("lock-ordinary");
    const { sessionId } = await startSession(user);
    await handleDecision(decision(sessionId, "approved", adult));
    await banUser(asUser("admin", "/api/admin/users", { method: "PATCH", json: { id: user.id, banned: true } }));
    await expect(currentUser(asUser("lock-ordinary"))).rejects.toMatchObject({ status: 403, code: "forbidden" });

    await unban(user);
    const row = await reload(user);
    expect(row.ageStatus).toBe("approved");
    expect(row.ageVerifiedAt).toBeInstanceOf(Date);
    const [audit] = await eventsFor(user, "unban");
    expect(audit.details).not.toHaveProperty("ageLockCleared");
  });
});
