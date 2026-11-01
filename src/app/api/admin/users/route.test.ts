import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { GET as listUsers, PATCH as changeUser } from "./route";
import { POST as attest } from "@/app/api/age/attest/route";
import { POST as signup } from "@/app/api/auth/signup/route";
import { currentUser, explicitAllowed, isAgeVerified } from "@/server/auth";
import { placeExplicitHold } from "@/server/age";
import { db } from "@/server/db";
import { moderationEvents, users } from "@/server/db/schema";
import { logModeration } from "@/server/safety/moderation";
import type { AdminUserDTO } from "../_lib/types";

function call(path: string, handle: string, json?: unknown) {
  return new Request(`http://localhost${path}`, {
    method: json === undefined ? "GET" : "PATCH",
    headers: { "x-dev-user": handle, ...(json !== undefined ? { "content-type": "application/json" } : {}) },
    body: json === undefined ? undefined : JSON.stringify(json),
  });
}

async function user(handle: string) {
  return (await currentUser(call("/api/me", handle)))!;
}

async function reload(id: string) {
  const database = await db();
  const [row] = await database.select().from(users).where(eq(users.id, id));
  return row;
}

async function held() {
  const response = await listUsers(call("/api/admin/users?hold=1", "admin"));
  return ((await response.json()) as { users: AdminUserDTO[] }).users;
}

const clear = (id: string, handle = "admin", reason = "Roleplay, checked the chat") =>
  changeUser(call("/api/admin/users", handle, { id, explicitHold: false, reason }));

describe("explicit holds in the admin console", () => {
  it("lists only accounts on a hold, with when it started", async () => {
    const minor = await user("hold-list-minor");
    const other = await user("hold-list-other");
    await placeExplicitHold(minor.id);

    const list = await held();
    const found = list.find((item) => item.id === minor.id);
    expect(found?.explicitHoldAt).toEqual(expect.any(String));
    expect(list.some((item) => item.id === other.id)).toBe(false);
    expect(list.every((item) => item.explicitHoldAt !== null)).toBe(true);

    // The ordinary search shows the hold too.
    const search = await listUsers(call(`/api/admin/users?q=${minor.id}`, "admin"));
    expect(((await search.json()) as { users: AdminUserDTO[] }).users[0]).toMatchObject({ explicitHoldAt: expect.any(String) });
  });

  it("clears a hold from a date of birth, reviews its finding and logs who did it", async () => {
    const person = await user("hold-clear-attest");
    const response = await attest(
      new Request("http://localhost/api/age/attest", {
        method: "POST",
        headers: { "x-dev-user": "hold-clear-attest", "content-type": "application/json" },
        body: JSON.stringify({ birthDate: "2015-01-01", consent: true }),
      }),
    );
    expect(response.status).toBe(403);
    expect((await held()).some((item) => item.id === person.id)).toBe(true);

    const cleared = await clear(person.id);
    expect(cleared.status).toBe(200);
    expect(((await cleared.json()) as { user: AdminUserDTO }).user).toMatchObject({ explicitHoldAt: null, ageAttestedAt: null });
    expect((await reload(person.id)).explicitHoldAt).toBeNull();
    expect((await held()).some((item) => item.id === person.id)).toBe(false);

    const database = await db();
    const [finding] = await database
      .select()
      .from(moderationEvents)
      .where(and(eq(moderationEvents.userId, person.id), eq(moderationEvents.category, "attested_minor")));
    expect(finding.reviewedAt).toBeInstanceOf(Date);
    const admin = await user("admin");
    const [audit] = await database
      .select()
      .from(moderationEvents)
      .where(and(eq(moderationEvents.userId, person.id), eq(moderationEvents.category, "explicit_hold_cleared")));
    expect(audit).toMatchObject({ action: "blocked", targetType: "profile", targetId: person.id });
    expect(audit.reviewedAt).toBeInstanceOf(Date);
    expect(audit.details).toMatchObject({
      adminId: admin.id,
      reason: "Roleplay, checked the chat",
      heldSince: expect.any(String),
      findingsReviewed: [finding.id],
    });
  });

  it("leaves the user to confirm their age again", async () => {
    const person = await user("hold-clear-reconfirm");
    const database = await db();
    // Confirmed as an adult, then said they're 16 in chat.
    await database.update(users).set({ ageAttestedAt: new Date() }).where(eq(users.id, person.id));
    await logModeration({ userId: person.id, targetType: "message" }, "self_declared_minor", "escalated", { excerpt: "I'm 16" });
    await placeExplicitHold(person.id);
    expect(isAgeVerified(await reload(person.id))).toBe(false);

    expect((await clear(person.id)).status).toBe(200);
    // The hold cleared the earlier confirmation, so even when the admin decides
    // it was a mistake, the user confirms their age again before anything explicit.
    const cleared = await reload(person.id);
    expect(cleared.explicitHoldAt).toBeNull();
    expect(cleared.ageAttestedAt).toBeNull();
    expect(isAgeVerified(cleared)).toBe(false);
    expect(explicitAllowed(cleared)).toBe(false);
    const confirmed = await attest(
      new Request("http://localhost/api/age/attest", {
        method: "POST",
        headers: { "x-dev-user": "hold-clear-reconfirm", "content-type": "application/json" },
        body: JSON.stringify({ birthDate: "1990-01-01", consent: true }),
      }),
    );
    expect(confirmed.status).toBe(200);
    expect(explicitAllowed(await reload(person.id))).toBe(true);
    const [finding] = await database
      .select()
      .from(moderationEvents)
      .where(and(eq(moderationEvents.userId, person.id), eq(moderationEvents.category, "self_declared_minor")));
    expect(finding.reviewedAt).toBeInstanceOf(Date);
  });

  it("is for admins only, and not for their own account", async () => {
    const person = await user("hold-not-admin");
    await placeExplicitHold(person.id);
    expect((await clear(person.id, "hold-not-admin")).status).toBe(403);
    expect((await listUsers(call("/api/admin/users?hold=1", "hold-not-admin"))).status).toBe(403);
    expect((await reload(person.id)).explicitHoldAt).toBeInstanceOf(Date);

    const admin = await user("admin");
    await placeExplicitHold(admin.id);
    expect((await clear(admin.id)).status).toBe(400);
    expect((await reload(admin.id)).explicitHoldAt).toBeInstanceOf(Date);
    const database = await db();
    await database.update(users).set({ explicitHoldAt: null }).where(eq(users.id, admin.id));
  });

  it("says when there's no hold to clear", async () => {
    const person = await user("hold-none");
    const response = await clear(person.id);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "not_on_hold" });
    expect((await clear(crypto.randomUUID())).status).toBe(404);
  });

  it("shows and finds username accounts by their username", async () => {
    const response = await signup(
      new Request("http://localhost/api/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json", "x-real-ip": "10.60.0.1" },
        body: JSON.stringify({ username: "Velvet_Admin_Test", password: "a long quiet evening", birthDate: "1990-02-02", consent: true }),
      }),
    );
    expect(response.status).toBe(201);
    const search = await listUsers(call("/api/admin/users?q=velvet_admin", "admin"));
    const found = ((await search.json()) as { users: AdminUserDTO[] }).users;
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ username: "velvet_admin_test", displayName: "Velvet_Admin_Test", privyId: "acct:velvet_admin_test" });
    // Never the credentials.
    expect(JSON.stringify(found[0])).not.toMatch(/scrypt|password|recovery/i);
  });

  it("still bans and unbans", async () => {
    const person = await user("hold-ban");
    const banned = await changeUser(call("/api/admin/users", "admin", { id: person.id, banned: true, reason: "test" }));
    expect(((await banned.json()) as { user: AdminUserDTO }).user.bannedAt).not.toBeNull();
    const unbanned = await changeUser(call("/api/admin/users", "admin", { id: person.id, banned: false }));
    expect(((await unbanned.json()) as { user: AdminUserDTO }).user.bannedAt).toBeNull();
  });
});
