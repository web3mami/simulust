import { rm } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";

vi.hoisted(() => {
  // Keep stored test files out of the project's .data directory.
  process.env.MEDIA_DIR = `${process.env.TMPDIR ?? "/tmp"}/simulust-admin-test-${process.pid}`;
});

import { POST as postReport } from "@/app/api/reports/route";
import { GET as listReports, PATCH as resolveReport } from "@/app/api/admin/reports/route";
import { POST as takedown } from "@/app/api/admin/reports/takedown/route";
import { GET as listQueue, PATCH as reviewQueue } from "@/app/api/admin/moderation/route";
import { GET as searchUsers, PATCH as banUser } from "@/app/api/admin/users/route";
import { GET as listMedia } from "@/app/api/admin/media/route";
import { GET as exportData } from "@/app/api/me/export/route";
import { DELETE as deleteAccount } from "@/app/api/me/account/route";
import { currentUser, UNDERAGE_FINDING } from "@/server/auth";
import { db } from "@/server/db";
import { characters, media, messages, moderationEvents, orders, reports, threads, users } from "@/server/db/schema";
import { createMedia, storeMedia } from "@/server/media";
import { logModeration, moderateText } from "@/server/safety/moderation";
import { readLocalObject } from "@/server/storage";
import { lockForAgeReview } from "@/server/veriff";
import { blockVideo, videoPrompt } from "@/server/video";
import type { AdminModerationEventDTO, AdminReportDTO, AdminTakedownResult, AdminUserDTO } from "./types";

function call(path: string, handle: string | null, init: { method?: string; json?: unknown; ip?: string } = {}) {
  const headers: Record<string, string> = {};
  if (handle) headers["x-dev-user"] = handle;
  if (init.json !== undefined) headers["content-type"] = "application/json";
  headers["x-real-ip"] = init.ip ?? "203.0.113.1";
  return new Request(`http://localhost${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
  });
}

async function user(handle: string) {
  return (await currentUser(call("/api/me", handle)))!;
}

async function storedImage(userId: string) {
  const row = await createMedia({ userId, kind: "image", purpose: "chat", prompt: "test" });
  return storeMedia(row, new Uint8Array([1, 2, 3]), "image/png", { hive: "ok" });
}

async function report(kind: string, target: string, ip = "198.51.100.7") {
  const response = await postReport(call("/api/reports", null, { method: "POST", json: { kind, target, email: "a@b.co" }, ip }));
  expect(response.status).toBe(200);
  const database = await db();
  const [row] = await database.select().from(reports).where(eq(reports.target, target));
  return row;
}

async function reportWithDetails(kind: string, target: string, details: string, ip: string) {
  const response = await postReport(call("/api/reports", null, { method: "POST", json: { kind, target, details, email: "a@b.co" }, ip }));
  expect(response.status).toBe(200);
  const database = await db();
  const [row] = await database.select().from(reports).where(eq(reports.target, target));
  return row;
}

async function openReports() {
  return ((await (await listReports(call("/api/admin/reports", "admin"))).json()) as { reports: AdminReportDTO[] }).reports;
}

async function queue() {
  return ((await (await listQueue(call("/api/admin/moderation", "admin"))).json()) as { events: AdminModerationEventDTO[] }).events;
}

const remove = (handle: string) => deleteAccount(call("/api/me/account", handle, { method: "DELETE", json: { confirm: "DELETE" } }));

async function character(ownerId: string | null) {
  const id = ownerId ? crypto.randomUUID() : `official-${crypto.randomUUID().slice(0, 8)}`;
  const database = await db();
  await database.insert(characters).values({
    id,
    ownerId,
    name: ownerId ? "Theirs" : "Official",
    age: 30,
    gender: "Woman",
    ethnicity: "x",
    body: "x",
    role: "x",
    heat: "x",
    line: "x",
    lane: "girls",
  });
  return id;
}

async function photoOf(userId: string, characterId: string) {
  return storeMedia(await createMedia({ userId, characterId, kind: "image", purpose: "chat" }), new Uint8Array([1, 2, 3]), "image/png");
}

async function takeDownWith(json: Record<string, unknown>) {
  const response = await takedown(call("/api/admin/reports/takedown", "admin", { method: "POST", json }));
  return { status: response.status, body: (await response.json()) as AdminTakedownResult & { code?: string } };
}

async function heldFile(item: { id: string; storageKey: string | null }) {
  const database = await db();
  const [row] = await database.select().from(media).where(eq(media.id, item.id));
  return {
    status: row.status,
    hold: (row.moderation as { takedown?: { legalHoldUntil?: string } } | null)?.takedown?.legalHoldUntil ?? null,
    file: (await readLocalObject(item.storageKey!)) !== null,
  };
}

beforeAll(async () => {
  await db();
});

afterAll(async () => {
  await rm(process.env.MEDIA_DIR!, { recursive: true, force: true });
});

describe("reports and admin console", () => {

  it("accepts a public report with a 48-hour deadline and logs it", async () => {
    const response = await postReport(
      call("/api/reports", null, { method: "POST", json: { kind: "real_person", target: "https://simulust.test/date/mira", details: "Looks like a celebrity" }, ip: "192.0.2.10" }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; dueAt: string };
    const hours = (new Date(body.dueAt).getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(47.9);
    expect(hours).toBeLessThanOrEqual(48);

    const database = await db();
    const events = await database
      .select()
      .from(moderationEvents)
      .where(and(eq(moderationEvents.category, "report_real_person"), eq(moderationEvents.targetId, "mira")));
    expect(events[0]?.action).toBe("escalated");
    expect(events[0]?.targetType).toBe("character");
  });

  it("validates reports", async () => {
    const bad = await postReport(call("/api/reports", null, { method: "POST", json: { kind: "spam", target: "x" }, ip: "192.0.2.11" }));
    expect(bad.status).toBe(400);
    const noEmail = await postReport(call("/api/reports", null, { method: "POST", json: { kind: "ncii", target: "x" }, ip: "192.0.2.11" }));
    expect(noEmail.status).toBe(400);
    expect(((await noEmail.json()) as { error: string }).error).toMatch(/email/i);
  });

  it("rate-limits reports per IP", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const response = await postReport(
        call("/api/reports", null, { method: "POST", json: { kind: "other", target: `spam-${i}` }, ip: "192.0.2.99" }),
      );
      statuses.push(response.status);
    }
    expect(statuses.slice(0, 5).every((status) => status === 200)).toBe(true);
    expect(statuses[5]).toBe(429);
  });

  it("keeps the admin API to admins", async () => {
    await user("regular");
    expect((await listReports(call("/api/admin/reports", "regular"))).status).toBe(403);
    expect((await listReports(call("/api/admin/reports", null))).status).toBe(401);
    expect((await listReports(call("/api/admin/reports", "admin"))).status).toBe(200);
  });

  it("lists open reports soonest-due first and resolves them with a note", async () => {
    const database = await db();
    const old = await report("other", "old-thing", "198.51.100.20");
    await database.update(reports).set({ dueAt: new Date(Date.now() - 60_000) }).where(eq(reports.id, old.id));

    const body = (await (await listReports(call("/api/admin/reports", "admin"))).json()) as { reports: AdminReportDTO[] };
    expect(body.reports[0].id).toBe(old.id);
    expect(body.reports[0].overdue).toBe(true);
    const dues = body.reports.map((item) => new Date(item.dueAt).getTime());
    expect([...dues].sort((a, b) => a - b)).toEqual(dues);

    const noNote = await resolveReport(call("/api/admin/reports", "admin", { method: "PATCH", json: { id: old.id, status: "dismissed", resolution: " " } }));
    expect(noNote.status).toBe(400);
    const ok = await resolveReport(call("/api/admin/reports", "admin", { method: "PATCH", json: { id: old.id, status: "dismissed", resolution: "Not a violation" } }));
    expect(ok.status).toBe(200);
    const again = await resolveReport(call("/api/admin/reports", "admin", { method: "PATCH", json: { id: old.id, status: "actioned", resolution: "x" } }));
    expect(again.status).toBe(409);
  });

  it("takes down reported media and deletes the file", async () => {
    const owner = await user("media-owner");
    const item = await storedImage(owner.id);
    expect(await readLocalObject(item.storageKey!)).not.toBeNull();
    const row = await report("real_person", `https://simulust.test/api/media/${item.id}`, "198.51.100.30");

    const response = await takedown(call("/api/admin/reports/takedown", "admin", { method: "POST", json: { id: row.id, note: "Celebrity likeness" } }));
    expect(response.status).toBe(200);
    const database = await db();
    const [after] = await database.select().from(media).where(eq(media.id, item.id));
    expect(after.status).toBe("blocked");
    expect(after.error).toBe("Removed after report");
    expect(await readLocalObject(item.storageKey!)).toBeNull();
    const [closed] = await database.select().from(reports).where(eq(reports.id, row.id));
    expect(closed.status).toBe("actioned");
    expect(closed.resolution).toContain("Celebrity likeness");
  });

  it("keeps CSAM files under legal hold, and the account until the hold ends", async () => {
    const owner = await user("csam-owner");
    const item = await storedImage(owner.id);
    const row = await report("csam", item.id, "198.51.100.31");
    expect((await takedown(call("/api/admin/reports/takedown", "admin", { method: "POST", json: { id: row.id } }))).status).toBe(200);

    const database = await db();
    const [after] = await database.select().from(media).where(eq(media.id, item.id));
    expect(after.status).toBe("blocked");
    const hold = (after.moderation as { takedown?: { legalHoldUntil?: string } }).takedown?.legalHoldUntil;
    expect(new Date(hold!).getTime()).toBeGreaterThan(Date.now() + 364 * 24 * 3_600_000);
    expect(await readLocalObject(item.storageKey!)).not.toBeNull();

    const [audit] = await database
      .select()
      .from(moderationEvents)
      .where(and(eq(moderationEvents.category, "takedown"), eq(moderationEvents.targetId, item.id)));
    expect(audit.reviewedAt).not.toBeNull();
    expect(audit.details).toMatchObject({ storageKey: item.storageKey, deleted: false });

    const deleted = await deleteAccount(call("/api/me/account", "csam-owner", { method: "DELETE", json: { confirm: "DELETE" } }));
    expect(deleted.status).toBe(409);
    expect(await readLocalObject(item.storageKey!)).not.toBeNull();
    expect(await database.select().from(users).where(eq(users.id, owner.id))).toHaveLength(1);
    expect(await database.select().from(media).where(eq(media.id, item.id))).toHaveLength(1);
  });

  it("takes down videos made from a reported photo, under the same hold", async () => {
    const owner = await user("cascade-owner");
    const photo = await storedImage(owner.id);
    const clip = await createMedia({ userId: owner.id, kind: "video", purpose: "video", sourceMediaId: photo.id });
    const ready = await storeMedia(clip, new Uint8Array(2000), "video/mp4");
    const rendering = await createMedia({ userId: owner.id, kind: "video", purpose: "video", sourceMediaId: photo.id });

    const row = await report("csam", photo.id, "198.51.100.34");
    expect((await takedown(call("/api/admin/reports/takedown", "admin", { method: "POST", json: { id: row.id } }))).status).toBe(200);

    const database = await db();
    const [video] = await database.select().from(media).where(eq(media.id, ready.id));
    expect(video.status).toBe("blocked");
    expect((video.moderation as { takedown?: { legalHoldUntil?: string } }).takedown?.legalHoldUntil).toBeTruthy();
    expect(await readLocalObject(ready.storageKey!)).not.toBeNull();

    // A render that finishes after the takedown stays blocked, and its file is
    // kept for the hold instead of being served.
    const late = await storeMedia(rendering, new Uint8Array(2000), "video/mp4");
    expect(late.status).toBe("blocked");
    expect(late.storageKey).toBeTruthy();
    expect(await readLocalObject(late.storageKey!)).not.toBeNull();
  });

  it("takes down every photo, video and voice note of a reported character", async () => {
    const owner = await user("char-media-owner");
    const database = await db();
    const id = crypto.randomUUID();
    await database.insert(characters).values({
      id,
      ownerId: owner.id,
      name: "Lookalike",
      age: 30,
      gender: "Woman",
      ethnicity: "x",
      body: "x",
      role: "x",
      heat: "x",
      line: "x",
      lane: "girls",
    });
    const photo = await storeMedia(
      await createMedia({ userId: owner.id, characterId: id, kind: "image", purpose: "chat" }),
      new Uint8Array([1, 2, 3]),
      "image/png",
    );
    const voice = await storeMedia(
      await createMedia({ userId: owner.id, characterId: id, kind: "audio", purpose: "voice" }),
      new Uint8Array([1, 2, 3]),
      "audio/mpeg",
    );
    const row = await report("real_person", `https://simulust.test/date/${id}`, "198.51.100.35");
    const response = await takedown(call("/api/admin/reports/takedown", "admin", { method: "POST", json: { id: row.id } }));
    expect(response.status).toBe(200);

    for (const item of [photo, voice]) {
      const [after] = await database.select().from(media).where(eq(media.id, item.id));
      expect(after.status).toBe("blocked");
      expect(await readLocalObject(item.storageKey!)).toBeNull();
    }
  });

  it("keeps an earlier legal hold through a later ordinary takedown", async () => {
    const owner = await user("hold-owner");
    const item = await storedImage(owner.id);
    const first = await report("csam", item.id, "198.51.100.36");
    await takedown(call("/api/admin/reports/takedown", "admin", { method: "POST", json: { id: first.id } }));
    const second = await report("real_person", `https://simulust.test/api/media/${item.id}`, "198.51.100.37");
    expect((await takedown(call("/api/admin/reports/takedown", "admin", { method: "POST", json: { id: second.id } }))).status).toBe(200);

    const database = await db();
    const [after] = await database.select().from(media).where(eq(media.id, item.id));
    expect((after.moderation as { takedown?: { legalHoldUntil?: string } }).takedown?.legalHoldUntil).toBeTruthy();
    expect(await readLocalObject(item.storageKey!)).not.toBeNull();
  });

  it("keeps the files by default when moderation tied the target to a minor", async () => {
    const owner = await user("minor-signal-owner");
    const photo = await storedImage(owner.id);
    // The owner tried to animate the photo with a prompt blocked as sexualizing a minor.
    await logModeration({ userId: owner.id, targetType: "video", targetId: photo.id }, "minor", "blocked", { excerpt: "x" });
    const row = await report("real_person", `https://simulust.test/api/media/${photo.id}`, "198.51.100.40");

    const listed = (await (await listReports(call("/api/admin/reports", "admin"))).json()) as { reports: AdminReportDTO[] };
    expect(listed.reports.find((item) => item.id === row.id)).toMatchObject({ minorFlagged: true, preserveByDefault: true });

    const response = await takedown(call("/api/admin/reports/takedown", "admin", { method: "POST", json: { id: row.id } }));
    expect(((await response.json()) as { preserved: boolean }).preserved).toBe(true);
    const database = await db();
    const [after] = await database.select().from(media).where(eq(media.id, photo.id));
    expect(after.status).toBe("blocked");
    expect((after.moderation as { takedown?: { legalHoldUntil?: string } }).takedown?.legalHoldUntil).toBeTruthy();
    expect(await readLocalObject(photo.storageKey!)).not.toBeNull();
  });

  it("counts minor verdicts on media made from the target, or a character's media", async () => {
    const owner = await user("minor-copy-owner");
    const database = await db();
    const photo = await storedImage(owner.id);
    const clip = await createMedia({ userId: owner.id, kind: "video", purpose: "video", sourceMediaId: photo.id });
    await logModeration({ userId: owner.id, targetType: "video", targetId: clip.id }, "minor", "blocked");

    const id = crypto.randomUUID();
    await database.insert(characters).values({
      id,
      ownerId: owner.id,
      name: "Flagged",
      age: 30,
      gender: "Woman",
      ethnicity: "x",
      body: "x",
      role: "x",
      heat: "x",
      line: "x",
      lane: "girls",
    });
    const attempt = await createMedia({ userId: owner.id, characterId: id, kind: "image", purpose: "chat" });
    await logModeration({ userId: owner.id, targetType: "image", targetId: attempt.id }, "minor", "blocked");

    const clean = await storedImage(owner.id);
    const photoReport = await report("other", photo.id, "198.51.100.41");
    const characterReport = await report("other", `https://simulust.test/date/${id}`, "198.51.100.41");
    const cleanReport = await report("other", clean.id, "198.51.100.41");

    const listed = (await (await listReports(call("/api/admin/reports", "admin"))).json()) as { reports: AdminReportDTO[] };
    const byId = (reportId: string) => listed.reports.find((item) => item.id === reportId);
    expect(byId(photoReport.id)).toMatchObject({ minorFlagged: true, preserveByDefault: true });
    expect(byId(characterReport.id)).toMatchObject({ minorFlagged: true, preserveByDefault: true });
    expect(byId(cleanReport.id)).toMatchObject({ minorFlagged: false, preserveByDefault: false });
  });

  it("keeps the files by default when a report's details say a child is involved", async () => {
    const owner = await user("child-details-owner");
    const photo = await storedImage(owner.id);
    const row = await reportWithDetails(
      "real_person",
      `https://simulust.test/api/media/${photo.id}`,
      "This is my 14 year old daughter's face. She is a child.",
      "198.51.100.44",
    );
    expect((await openReports()).find((item) => item.id === row.id)).toMatchObject({ minorFlagged: true, preserveByDefault: true });

    const database = await db();
    const [signal] = await database
      .select()
      .from(moderationEvents)
      .where(and(eq(moderationEvents.category, "minor"), eq(moderationEvents.targetId, photo.id)));
    // Logged against the content, not the reporter, and out of the safety queue.
    expect(signal).toMatchObject({ userId: null, action: "escalated", details: { source: "report", reportId: row.id } });

    const response = await takedown(call("/api/admin/reports/takedown", "admin", { method: "POST", json: { id: row.id } }));
    expect(((await response.json()) as { preserved: boolean }).preserved).toBe(true);
    expect(await readLocalObject(photo.storageKey!)).not.toBeNull();
  });

  it.each([
    ["She is a child.", true, 1],
    ["my kid sister's photo", true, 2],
    ["she was 16 when this was taken", true, 3],
    ["she's only fifteen", true, 4],
    ["aged 13 in this picture", true, 5],
    ["I'm 15 and this is me", true, 6],
    ["Looks like a celebrity", false, 7],
    ["This is my face, used without asking", false, 8],
    // Phrasings an earlier screen missed: compounds, babies and school years.
    ["This is a photo of a little girl. Please remove it.", true, 9],
    ["She is my stepdaughter, she is in 8th grade.", true, 10],
    ["That's my granddaughter's face.", true, 11],
    ["She's twelve years old.", true, 12],
    ["She looks about 12.", true, 13],
    ["This is a picture of a baby.", true, 14],
    ["This is my 7th grader.", true, 15],
    ["She is in middle school.", true, 16],
    ["A young girl, obviously prepubescent.", true, 17],
    ["This is my sister, she's 15.", true, 18],
    ["It's my little sister, she is fourteen", true, 19],
    ["infant", true, 20],
    ["This shows a toddler", true, 21],
    ["This is my grandson", true, 22],
    ["she is a high school freshman", true, 23],
    ["this is a student at my school, she is in year 9", true, 24],
    ["my great-grandson’s photo", true, 25],
    ["He’s 13", true, 26],
    ["This photo was taken 5 years ago", false, 27],
    ["She is 25 and did not consent", false, 28],
    ["Jason posted this of me in 2019", false, 29],
  ])("reads %j as %s for a child", async (details, flagged, n) => {
    const owner = await user("child-details-each");
    const photo = await storedImage(owner.id);
    const row = await reportWithDetails("other", photo.id, details, `198.51.101.${n}`);
    expect((await openReports()).find((item) => item.id === row.id)).toMatchObject({ minorFlagged: flagged, preserveByDefault: flagged });
  });

  it("holds only the flagged media of an official character, so its other users can still leave", async () => {
    const database = await db();
    const id = `official-${crypto.randomUUID().slice(0, 8)}`;
    await database.insert(characters).values({
      id,
      ownerId: null,
      name: "Official",
      age: 30,
      gender: "Woman",
      ethnicity: "x",
      body: "x",
      role: "x",
      heat: "x",
      line: "x",
      lane: "girls",
    });
    const a = await user("official-a");
    const b = await user("official-b");
    const photoOf = async (userId: string) =>
      storeMedia(await createMedia({ userId, characterId: id, kind: "image", purpose: "chat" }), new Uint8Array([1, 2, 3]), "image/png");
    const photoA = await photoOf(a.id);
    const photoB = await photoOf(b.id);
    // A's request to animate their photo was blocked as minor (the original
    // finding's false positive).
    await logModeration({ userId: a.id, targetType: "video", targetId: photoA.id }, "minor", "blocked", {
      matched: "classifier",
      excerpt: "she twirls under a gentle breeze",
    });

    const row = await report("real_person", `https://simulust.test/date/${id}`, "198.51.100.45");
    expect((await openReports()).find((item) => item.id === row.id)).toMatchObject({
      minorFlagged: false,
      preserveByDefault: false,
      preserveScope: "flagged",
    });

    // Even an admin asking to keep the files holds only what's tied to a minor,
    // and the answer says so.
    const response = await takedown(call("/api/admin/reports/takedown", "admin", { method: "POST", json: { id: row.id, preserve: true } }));
    expect(response.status).toBe(200);
    const result = (await response.json()) as AdminTakedownResult;
    expect(result).toMatchObject({ preserved: false, held: 1, deleted: 1 });
    expect(result.resolution).toContain("1 kept under legal hold for one year, 1 deleted");

    const [heldA] = await database.select().from(media).where(eq(media.id, photoA.id));
    expect(heldA.status).toBe("blocked");
    expect((heldA.moderation as { takedown?: { legalHoldUntil?: string } }).takedown?.legalHoldUntil).toBeTruthy();
    expect(await readLocalObject(photoA.storageKey!)).not.toBeNull();
    const [blockedB] = await database.select().from(media).where(eq(media.id, photoB.id));
    expect(blockedB.status).toBe("blocked");
    expect((blockedB.moderation as { takedown?: { legalHoldUntil?: string } }).takedown?.legalHoldUntil).toBeUndefined();
    expect(await readLocalObject(photoB.storageKey!)).toBeNull();

    expect((await remove("official-b")).status).toBe(200);
    expect((await remove("official-a")).status).toBe(409);
  });

  it("keeps an official character's flagged media even when the admin chose to delete", async () => {
    const database = await db();
    const id = `official-${crypto.randomUUID().slice(0, 8)}`;
    await database.insert(characters).values({
      id,
      ownerId: null,
      name: "Official",
      age: 30,
      gender: "Woman",
      ethnicity: "x",
      body: "x",
      role: "x",
      heat: "x",
      line: "x",
      lane: "girls",
    });
    const owner = await user("official-c");
    const photo = await storeMedia(
      await createMedia({ userId: owner.id, characterId: id, kind: "image", purpose: "chat" }),
      new Uint8Array([1, 2, 3]),
      "image/png",
    );
    await logModeration({ userId: owner.id, targetType: "image", targetId: photo.id }, "minor", "blocked", { categories: ["minor"], provider: "hive" });
    const row = await report("other", `https://simulust.test/date/${id}`, "198.51.100.46");
    await takedown(call("/api/admin/reports/takedown", "admin", { method: "POST", json: { id: row.id, preserve: false } }));
    expect(await readLocalObject(photo.storageKey!)).not.toBeNull();
  });

  it.each([
    ["by default", undefined, 1],
    ["when asked", true, 2],
  ] as const)("keeps every user's media of an official character taken down on a child-abuse report, %s", async (_label, preserve, n) => {
    const id = await character(null);
    const a = await user(`official-csam-a${n}`);
    const b = await user(`official-csam-b${n}`);
    const photoA = await photoOf(a.id, id);
    const photoB = await photoOf(b.id, id);
    const clipA = await storeMedia(
      await createMedia({ userId: a.id, characterId: id, kind: "video", purpose: "video", sourceMediaId: photoA.id }),
      new Uint8Array(2000),
      "video/mp4",
    );
    // A signed-in user reports the character's page, not any one photo.
    const filed = await postReport(
      call("/api/reports", `official-csam-a${n}`, {
        method: "POST",
        json: { kind: "csam", target: `/date/${id}`, details: "she looks like a child in the photos" },
        ip: `198.51.102.${n}`,
      }),
    );
    expect(filed.status).toBe(200);
    const database = await db();
    const [row] = await database.select().from(reports).where(eq(reports.target, `/date/${id}`));
    expect((await openReports()).find((item) => item.id === row.id)).toMatchObject({
      minorFlagged: true,
      preserveByDefault: true,
      preserveScope: "all",
    });

    const { status, body } = await takeDownWith({ id: row.id, kind: "csam", note: "Filed with NCMEC.", ...(preserve === undefined ? {} : { preserve }) });
    expect(status).toBe(200);
    expect(body).toMatchObject({ preserved: true, held: 3, deleted: 0 });
    expect(body.resolution).toContain("3 media items: files kept under legal hold for one year");
    for (const item of [photoA, photoB, clipA]) {
      expect(await heldFile(item)).toMatchObject({ status: "blocked", hold: expect.any(String), file: true });
    }
    const [audit] = await database
      .select()
      .from(moderationEvents)
      .where(and(eq(moderationEvents.category, "takedown"), eq(moderationEvents.targetId, id)));
    expect(audit.details).toMatchObject({ official: true, mediaHeld: 3, mediaDeleted: 0 });
    expect((await remove(`official-csam-a${n}`)).status).toBe(409);
    expect((await remove(`official-csam-b${n}`)).status).toBe(409);
  });

  it("keeps every user's media of an official character when a report says a child is on it", async () => {
    const id = await character(null);
    const a = await user("official-details-a");
    const b = await user("official-details-b");
    const photos = [await photoOf(a.id, id), await photoOf(b.id, id)];
    const row = await reportWithDetails("real_person", `/date/${id}`, "She is 15 in these pictures.", "198.51.102.10");
    expect((await openReports()).find((item) => item.id === row.id)).toMatchObject({
      minorFlagged: true,
      preserveByDefault: true,
      preserveScope: "all",
    });

    const { body } = await takeDownWith({ id: row.id, kind: "real_person" });
    expect(body).toMatchObject({ preserved: true, held: 2, deleted: 0 });
    for (const item of photos) expect(await heldFile(item)).toMatchObject({ hold: expect.any(String), file: true });
  });

  it("deletes an official character's unflagged media when the admin clears a child-abuse report, and says so", async () => {
    const id = await character(null);
    const a = await user("official-cleared-a");
    const b = await user("official-cleared-b");
    const photoA = await photoOf(a.id, id);
    const photoB = await photoOf(b.id, id);
    await logModeration({ userId: a.id, targetType: "image", targetId: photoA.id }, "minor", "blocked", { categories: ["minor"], provider: "hive" });
    const row = await report("csam", `/date/${id}`, "198.51.102.11");

    const { body } = await takeDownWith({ id: row.id, kind: "csam", preserve: false });
    expect(body).toMatchObject({ preserved: false, held: 1, deleted: 1 });
    expect(body.resolution).toContain("1 kept under legal hold for one year, 1 deleted");
    expect(await heldFile(photoA)).toMatchObject({ hold: expect.any(String), file: true });
    expect(await heldFile(photoB)).toMatchObject({ status: "blocked", hold: null, file: false });
    expect((await remove("official-cleared-b")).status).toBe(200);
    expect((await remove("official-cleared-a")).status).toBe(409);
  });

  it("stops tying an official character's media to a child once its child-abuse report is dismissed", async () => {
    const id = await character(null);
    const a = await user("official-dismissed-a");
    const photo = await photoOf(a.id, id);
    const other = await photoOf(a.id, id);
    const csam = await report("csam", `/date/${id}`, "198.51.102.12");
    // While it's open, a report on one of the character's photos keeps it by default.
    const copyright = await report("copyright", photo.id, "198.51.102.12");
    expect((await openReports()).find((item) => item.id === copyright.id)).toMatchObject({ minorFlagged: true, preserveByDefault: true });

    await resolveReport(call("/api/admin/reports", "admin", { method: "PATCH", json: { id: csam.id, status: "dismissed", resolution: "Seeded adult, bogus" } }));
    const later = await report("other", `https://simulust.test/date/${id}`, "198.51.102.12");
    const listed = await openReports();
    expect(listed.find((item) => item.id === copyright.id)).toMatchObject({ minorFlagged: false, preserveByDefault: false });
    expect(listed.find((item) => item.id === later.id)).toMatchObject({
      minorFlagged: false,
      preserveByDefault: false,
      preserveScope: "flagged",
    });

    // An admin asking to keep the files can't hold every user's media on that.
    const { body } = await takeDownWith({ id: later.id, kind: "other", preserve: true });
    expect(body).toMatchObject({ preserved: false, held: 0, deleted: 2 });
    expect(body.resolution).toContain("2 media items: files deleted");
    expect(await heldFile(other)).toMatchObject({ status: "blocked", file: false });
  });

  it("carries a child-abuse report on a user's character, or a minor signal on a photo, down to what was made from it", async () => {
    const owner = await user("charsig-owner");
    const id = await character(owner.id);
    const photo = await photoOf(owner.id, id);
    await report("csam", `/date/${id}`, "198.51.102.13");
    const copyright = await report("copyright", `https://simulust.test/api/media/${photo.id}`, "198.51.102.13");

    const flaggedPhoto = await storedImage(owner.id);
    await logModeration({ userId: owner.id, targetType: "image", targetId: flaggedPhoto.id }, "minor", "blocked", { categories: ["minor"], provider: "hive" });
    const clip = await storeMedia(
      await createMedia({ userId: owner.id, kind: "video", purpose: "video", sourceMediaId: flaggedPhoto.id }),
      new Uint8Array(2000),
      "video/mp4",
    );
    const clipReport = await report("other", clip.id, "198.51.102.13");

    const listed = await openReports();
    expect(listed.find((item) => item.id === copyright.id)).toMatchObject({ minorFlagged: true, preserveByDefault: true });
    expect(listed.find((item) => item.id === clipReport.id)).toMatchObject({ minorFlagged: true, preserveByDefault: true });

    const { body } = await takeDownWith({ id: copyright.id, kind: "copyright" });
    expect(body).toMatchObject({ preserved: true, held: 1, deleted: 0 });
    expect(await heldFile(photo)).toMatchObject({ hold: expect.any(String), file: true });
  });

  it("resolves a report pasted as the file's storage URL to the media item, not its owner", async () => {
    const owner = await user("s3-url-owner");
    const item = await storedImage(owner.id);
    const target = `https://simulust-media.s3.us-east-1.amazonaws.com/${item.storageKey}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=300&X-Amz-Signature=deadbeef`;
    const row = await report("csam", target, "198.51.102.14");
    expect((await openReports()).find((entry) => entry.id === row.id)?.resolved).toMatchObject({ type: "media", id: item.id });

    const database = await db();
    const [event] = await database
      .select()
      .from(moderationEvents)
      .where(and(eq(moderationEvents.category, "report_csam"), sql`${moderationEvents.details}->>'reportId' = ${row.id}`));
    expect(event.targetId).toBe(item.id);
    expect((await remove("s3-url-owner")).status).toBe(409);

    const { status, body } = await takeDownWith({ id: row.id, kind: "csam" });
    expect(status).toBe(200);
    expect(body).toMatchObject({ preserved: true, held: 1 });
    expect(await heldFile(item)).toMatchObject({ file: true });
  });

  it("won't take down a report reclassified since the admin opened it", async () => {
    const owner = await user("race-owner");
    const item = await storedImage(owner.id);
    const row = await report("real_person", item.id, "198.51.102.15");
    // Another admin reclassifies it while this one still sees "real person"
    // and has chosen to delete.
    await resolveReport(call("/api/admin/reports", "admin", { method: "PATCH", json: { id: row.id, kind: "csam" } }));
    const stale = await takeDownWith({ id: row.id, kind: "real_person", preserve: false });
    expect(stale).toMatchObject({ status: 409, body: { code: "report_changed" } });
    expect(await heldFile(item)).toMatchObject({ status: "ready", file: true });

    const database = await db();
    const [open] = await database.select().from(reports).where(eq(reports.id, row.id));
    expect(open.status).toBe("open");
    const [signal] = await database
      .select()
      .from(moderationEvents)
      .where(and(eq(moderationEvents.category, "report_csam"), eq(moderationEvents.targetId, item.id)));
    expect(signal.reviewedAt).toBeNull();

    const fresh = await takeDownWith({ id: row.id, kind: "csam" });
    expect(fresh.body).toMatchObject({ preserved: true, held: 1 });
  });

  it("never deletes a CSAM report's files when a reclassification races the takedown", async () => {
    const owner = await user("race-owner-2");
    const item = await storedImage(owner.id);
    const row = await report("other", item.id, "198.51.102.16");
    const [down, reclassified] = await Promise.all([
      takedown(call("/api/admin/reports/takedown", "admin", { method: "POST", json: { id: row.id, kind: "other", preserve: false } })),
      resolveReport(call("/api/admin/reports", "admin", { method: "PATCH", json: { id: row.id, kind: "csam" } })),
    ]);
    const database = await db();
    const [after] = await database.select().from(reports).where(eq(reports.id, row.id));
    const kept = (await readLocalObject(item.storageKey!)) !== null;
    if (down.status === 200) {
      // The takedown closed the report first; the reclassification found it closed.
      expect(reclassified.status).toBe(409);
      expect(after.kind).toBe("other");
    } else {
      expect(down.status).toBe(409);
      expect(after).toMatchObject({ kind: "csam", status: "open" });
      expect(kept).toBe(true);
    }
    const signals = await database
      .select()
      .from(moderationEvents)
      .where(and(eq(moderationEvents.category, "report_csam"), sql`${moderationEvents.details}->>'reportId' = ${row.id}`));
    for (const signal of signals) expect(signal.reviewedAt).toBeNull();
  });

  it("lets the admin choose to keep or delete the files", async () => {
    const owner = await user("preserve-choice-owner");
    const kept = await storedImage(owner.id);
    const keepReport = await report("real_person", kept.id, "198.51.100.42");
    const keep = await takedown(call("/api/admin/reports/takedown", "admin", { method: "POST", json: { id: keepReport.id, preserve: true } }));
    expect(((await keep.json()) as { preserved: boolean }).preserved).toBe(true);
    expect(await readLocalObject(kept.storageKey!)).not.toBeNull();

    // An admin who has looked and found no child can still delete a CSAM report's files; the audit says so.
    const removed = await storedImage(owner.id);
    const removeReport = await report("csam", removed.id, "198.51.100.42");
    const remove = await takedown(call("/api/admin/reports/takedown", "admin", { method: "POST", json: { id: removeReport.id, preserve: false } }));
    expect(((await remove.json()) as { preserved: boolean }).preserved).toBe(false);
    expect(await readLocalObject(removed.storageKey!)).toBeNull();
    const database = await db();
    const [audit] = await database
      .select()
      .from(moderationEvents)
      .where(and(eq(moderationEvents.category, "takedown"), eq(moderationEvents.targetId, removed.id)));
    expect(audit.details).toMatchObject({ deleted: true, reportId: removeReport.id });
  });

  it("reclassifies a report as CSAM before the takedown", async () => {
    const owner = await user("reclassify-owner");
    const item = await storedImage(owner.id);
    const row = await report("real_person", `https://simulust.test/api/media/${item.id}`, "198.51.100.43");
    const listed = (await (await listReports(call("/api/admin/reports", "admin"))).json()) as { reports: AdminReportDTO[] };
    expect(listed.reports.find((entry) => entry.id === row.id)?.preserveByDefault).toBe(false);

    const wrong = await resolveReport(call("/api/admin/reports", "admin", { method: "PATCH", json: { id: row.id, kind: "other" } }));
    expect(wrong.status).toBe(400);
    const response = await resolveReport(call("/api/admin/reports", "admin", { method: "PATCH", json: { id: row.id, kind: "csam" } }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { report: AdminReportDTO };
    expect(body.report).toMatchObject({ kind: "csam", status: "open", preserveByDefault: true });

    const database = await db();
    const [event] = await database
      .select()
      .from(moderationEvents)
      .where(and(eq(moderationEvents.category, "report_csam"), eq(moderationEvents.targetId, item.id)));
    expect(event.details).toMatchObject({ reportId: row.id, reclassifiedFrom: "real_person" });

    const done = await takedown(call("/api/admin/reports/takedown", "admin", { method: "POST", json: { id: row.id } }));
    expect(((await done.json()) as { preserved: boolean }).preserved).toBe(true);
    expect(await readLocalObject(item.storageKey!)).not.toBeNull();

    // A later report on the same content defaults to keeping it, whatever it's filed as.
    const later = await report("copyright", item.id, "198.51.100.43");
    const relisted = (await (await listReports(call("/api/admin/reports", "admin"))).json()) as { reports: AdminReportDTO[] };
    expect(relisted.reports.find((entry) => entry.id === later.id)).toMatchObject({ minorFlagged: true, preserveByDefault: true });

    const closed = await resolveReport(call("/api/admin/reports", "admin", { method: "PATCH", json: { id: row.id, kind: "csam" } }));
    expect(closed.status).toBe(409);
  });

  it("lists child-abuse reports before everything else", async () => {
    const database = await db();
    const old = await report("other", "overdue-other", "198.51.100.38");
    await database.update(reports).set({ dueAt: new Date(Date.now() - 60_000) }).where(eq(reports.id, old.id));
    await report("csam", "https://example.test/some-image", "198.51.100.38");
    const body = (await (await listReports(call("/api/admin/reports", "admin"))).json()) as { reports: AdminReportDTO[] };
    expect(body.reports[0].kind).toBe("csam");
  });

  it("returns the open report when the same report is sent again", async () => {
    const send = () =>
      postReport(call("/api/reports", null, { method: "POST", json: { kind: "other", target: "twice-sent" }, ip: "198.51.100.39" }));
    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(200);
    const database = await db();
    expect(await database.select().from(reports).where(eq(reports.target, "twice-sent"))).toHaveLength(1);
  });

  it("ignores IP headers the client sets when rate-limiting reports", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const request = new Request("http://localhost/api/reports", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-real-ip": "192.0.2.150",
          "cf-connecting-ip": `203.0.113.${i}`,
          "x-forwarded-for": `203.0.113.${i}`,
        },
        body: JSON.stringify({ kind: "other", target: `spoof-${i}` }),
      });
      statuses.push((await postReport(request)).status);
    }
    expect(statuses[5]).toBe(429);
  });

  it("soft-deletes a reported character", async () => {
    const owner = await user("char-owner");
    const database = await db();
    const id = crypto.randomUUID();
    await database.insert(characters).values({
      id,
      ownerId: owner.id,
      name: "Test",
      age: 30,
      gender: "Woman",
      ethnicity: "x",
      body: "x",
      role: "x",
      heat: "x",
      line: "x",
      lane: "girls",
    });
    const row = await report("real_person", `https://simulust.test/date/${id}`, "198.51.100.32");
    const response = await takedown(call("/api/admin/reports/takedown", "admin", { method: "POST", json: { id: row.id } }));
    expect(response.status).toBe(200);
    const [after] = await database.select().from(characters).where(eq(characters.id, id));
    expect(after.deletedAt).not.toBeNull();
  });

  it("refuses a takedown when the target can't be matched", async () => {
    const row = await report("other", "somewhere on twitter", "198.51.100.33");
    const response = await takedown(call("/api/admin/reports/takedown", "admin", { method: "POST", json: { id: row.id } }));
    expect(response.status).toBe(422);
  });

  it("reviews the moderation queue", async () => {
    const someone = await user("queue-user");
    await logModeration({ userId: someone.id, targetType: "message" }, "minor", "blocked", { excerpt: "x" });
    const body = (await (await listQueue(call("/api/admin/moderation", "admin"))).json()) as { events: { id: number; userId: string }[] };
    const mine = body.events.filter((event) => event.userId === someone.id);
    expect(mine).toHaveLength(1);
    const reviewed = await reviewQueue(call("/api/admin/moderation", "admin", { method: "PATCH", json: { ids: [mine[0].id] } }));
    expect(((await reviewed.json()) as { reviewed: number }).reviewed).toBe(1);
    const after = (await (await listQueue(call("/api/admin/moderation", "admin"))).json()) as { events: { userId: string }[] };
    expect(after.events.some((event) => event.userId === someone.id)).toBe(false);
  });

  it("won't close an age lock from the queue, and labels it in Users", async () => {
    const locked = await user("queue-age-lock");
    const database = await db();
    await database.transaction((tx) => lockForAgeReview(tx, locked.id, { sessionId: "queue-test", note: "test" }));

    const events = await queue();
    expect(events[0].category).toBe(UNDERAGE_FINDING);
    const finding = events.find((event) => event.userId === locked.id && event.category === UNDERAGE_FINDING)!;
    const other = await user("queue-age-lock-other");
    await logModeration({ userId: other.id, targetType: "message" }, "minor", "blocked", { excerpt: "x" });
    const blocked = (await queue()).find((event) => event.userId === other.id)!;

    const response = await reviewQueue(call("/api/admin/moderation", "admin", { method: "PATCH", json: { ids: [finding.id, blocked.id] } }));
    const result = (await response.json()) as { reviewed: number; skipped: number[]; note?: string };
    expect(result).toMatchObject({ reviewed: 1, skipped: [finding.id] });
    expect(result.note).toMatch(/Unban/);
    // Still an age lock, not an ordinary suspension.
    await expect(currentUser(call("/api/me", "queue-age-lock"))).rejects.toMatchObject({ status: 403, code: "age_locked" });

    const found = (await (await searchUsers(call(`/api/admin/users?q=${locked.id}`, "admin"))).json()) as { users: AdminUserDTO[] };
    expect(found.users[0]).toMatchObject({ ageLocked: true });
    const unbanned = await banUser(call("/api/admin/users", "admin", { method: "PATCH", json: { id: locked.id, banned: false } }));
    expect(((await unbanned.json()) as { user: AdminUserDTO }).user).toMatchObject({ bannedAt: null, ageLocked: false });
    const [audit] = await database
      .select()
      .from(moderationEvents)
      .where(and(eq(moderationEvents.category, "unban"), eq(moderationEvents.targetId, locked.id)));
    expect(audit.details).toMatchObject({ ageLockCleared: true });
  });

  it("lists age locks first, then self-declared minors, and caps each kind on its own", async () => {
    const flooder = await user("queue-flood");
    const older = await user("queue-flood-older");
    const database = await db();
    await logModeration({ userId: older.id, targetType: "image_prompt" }, "minor", "blocked", { matched: "teen", excerpt: "x" });
    await database.transaction((tx) => lockForAgeReview(tx, older.id, { sessionId: "flood-test", note: "test" }));
    // One account repeating "I'm 16" a few hundred times.
    await database.insert(moderationEvents).values(
      Array.from({ length: 250 }, () => ({
        userId: flooder.id,
        targetType: "message" as const,
        category: "self_declared_minor",
        action: "escalated" as const,
        details: { excerpt: "I'm 16" },
      })),
    );

    const events = await queue();
    const rank = (event: AdminModerationEventDTO) =>
      event.category === UNDERAGE_FINDING ? 0 : event.category === "self_declared_minor" ? 1 : 2;
    const ranks = events.map(rank);
    expect([...ranks].sort((x, y) => x - y)).toEqual(ranks);
    expect(events.some((event) => event.userId === older.id && event.category === UNDERAGE_FINDING)).toBe(true);
    expect(events.some((event) => event.userId === older.id && event.category === "minor")).toBe(true);
    expect(events.filter((event) => event.category === "self_declared_minor").length).toBeLessThanOrEqual(100);
    // "Mark all shown" fits in one request.
    expect(events.filter((event) => event.category !== UNDERAGE_FINDING).length).toBeLessThanOrEqual(200);
  });

  it("searches, bans and unbans users", async () => {
    const target = await user("ban-me");
    const found = (await (await searchUsers(call("/api/admin/users?q=ban-me", "admin"))).json()) as { users: AdminUserDTO[] };
    expect(found.users.map((item) => item.id)).toContain(target.id);
    const byId = (await (await searchUsers(call(`/api/admin/users?q=${target.id}`, "admin"))).json()) as { users: AdminUserDTO[] };
    expect(byId.users).toHaveLength(1);

    const banned = await banUser(call("/api/admin/users", "admin", { method: "PATCH", json: { id: target.id, banned: true, reason: "test" } }));
    expect(((await banned.json()) as { user: AdminUserDTO }).user.bannedAt).not.toBeNull();
    await expect(currentUser(call("/api/me", "ban-me"))).rejects.toMatchObject({ status: 403 });

    const admin = await user("admin");
    expect((await banUser(call("/api/admin/users", "admin", { method: "PATCH", json: { id: admin.id, banned: true } }))).status).toBe(400);

    await banUser(call("/api/admin/users", "admin", { method: "PATCH", json: { id: target.id, banned: false } }));
    expect((await currentUser(call("/api/me", "ban-me")))?.id).toBe(target.id);
  });

  it("lists generated media for admins", async () => {
    const owner = await user("media-list");
    const item = await storedImage(owner.id);
    const body = (await (await listMedia(call("/api/admin/media", "admin"))).json()) as { media: { id: string; moderation: unknown }[] };
    expect(body.media.find((row) => row.id === item.id)?.moderation).toEqual({ hive: "ok" });
  });
});

describe("account controls", () => {
  it("exports only the user's own data", async () => {
    const me = await user("exporter");
    const other = await user("someone-else");
    const database = await db();
    const [thread] = await database.insert(threads).values({ userId: me.id, characterId: "mira" }).returning();
    await database.insert(messages).values({ threadId: thread.id, role: "user", content: "hello from exporter" });
    const [otherThread] = await database.insert(threads).values({ userId: other.id, characterId: "mira" }).returning();
    await database.insert(messages).values({ threadId: otherThread.id, role: "user", content: "private to someone else" });

    const response = await exportData(call("/api/me/export", "exporter"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toMatch(/attachment; filename="simulust-export-/);
    const text = await response.text();
    expect(text).toContain("hello from exporter");
    expect(text).not.toContain("private to someone else");
    const data = JSON.parse(text) as { user: { id: string }; threads: { messages: unknown[] }[] };
    expect(data.user.id).toBe(me.id);
    expect(data.threads[0].messages).toHaveLength(1);
  });

  it("deletes the account, its files and everything that cascades", async () => {
    const me = await user("deleter");
    const item = await storedImage(me.id);
    const database = await db();
    await database.insert(threads).values({ userId: me.id, characterId: "mira" });

    const wrong = await deleteAccount(call("/api/me/account", "deleter", { method: "DELETE", json: { confirm: "delete" } }));
    expect(wrong.status).toBe(400);
    expect(((await wrong.json()) as { error: string }).error).toMatch(/DELETE/);

    const ok = await deleteAccount(call("/api/me/account", "deleter", { method: "DELETE", json: { confirm: "DELETE" } }));
    expect(ok.status).toBe(200);
    expect(await database.select().from(users).where(eq(users.id, me.id))).toHaveLength(0);
    expect(await database.select().from(threads).where(eq(threads.userId, me.id))).toHaveLength(0);
    expect(await database.select().from(media).where(eq(media.id, item.id))).toHaveLength(0);
    expect(await readLocalObject(item.storageKey!)).toBeNull();
  });

  it("refuses deletion while an open report points at the user's media, and allows it once closed", async () => {
    const me = await user("reported-deleter");
    const item = await storedImage(me.id);
    const row = await report("csam", `https://simulust.test/api/media/${item.id}`, "198.51.100.50");

    const refused = await remove("reported-deleter");
    expect(refused.status).toBe(409);
    const body = (await refused.json()) as { error: string; code: string };
    expect(body.code).toBe("deletion_on_hold");
    expect(body.error).toMatch(/support|email/i);
    expect(body.error).not.toMatch(/csam|minor|child/i);
    expect(await readLocalObject(item.storageKey!)).not.toBeNull();
    const database = await db();
    expect(await database.select().from(users).where(eq(users.id, me.id))).toHaveLength(1);

    await resolveReport(call("/api/admin/reports", "admin", { method: "PATCH", json: { id: row.id, status: "dismissed", resolution: "Adult, not a violation" } }));
    expect((await remove("reported-deleter")).status).toBe(200);
    expect(await readLocalObject(item.storageKey!)).toBeNull();
  });

  it("refuses deletion while an open report points at one of the user's characters", async () => {
    const me = await user("character-deleter");
    const database = await db();
    const id = crypto.randomUUID();
    await database.insert(characters).values({
      id,
      ownerId: me.id,
      name: "Reported",
      age: 30,
      gender: "Woman",
      ethnicity: "x",
      body: "x",
      role: "x",
      heat: "x",
      line: "x",
      lane: "girls",
    });
    await report("real_person", `https://simulust.test/date/${id}`, "198.51.100.51");
    expect((await remove("character-deleter")).status).toBe(409);
    expect(await database.select().from(characters).where(eq(characters.id, id))).toHaveLength(1);
  });

  it("refuses deletion for 90 days after a blocked minor verdict on a prompt the user wrote", async () => {
    const me = await user("minor-deleter");
    const verdict = await moderateText("make her look like a teen", { userId: me.id, targetType: "image_prompt", targetId: crypto.randomUUID() });
    expect(verdict.ok).toBe(false);
    expect((await remove("minor-deleter")).status).toBe(409);

    const database = await db();
    await database
      .update(moderationEvents)
      .set({ createdAt: new Date(Date.now() - 91 * 24 * 3_600_000) })
      .where(eq(moderationEvents.userId, me.id));
    expect((await remove("minor-deleter")).status).toBe(200);
  });

  it.each(["image_prompt", "video", "character"] as const)(
    "lifts the hold from a %s block once an admin has reviewed it",
    async (targetType) => {
      const handle = `minor-reviewed-${targetType}`;
      const me = await user(handle);
      await moderateText("she's a teen in her school uniform", { userId: me.id, targetType, targetId: crypto.randomUUID() }, { failClosed: true });
      expect((await remove(handle)).status).toBe(409);

      const mine = (await queue()).filter((event) => event.userId === me.id);
      expect(mine).toHaveLength(1);
      await reviewQueue(call("/api/admin/moderation", "admin", { method: "PATCH", json: { ids: [mine[0].id] } }));
      expect((await remove(handle)).status).toBe(200);
    },
  );

  it("lets someone who said they're a minor in chat delete their account", async () => {
    const me = await user("self-declared-deleter");
    const threadId = crypto.randomUUID();
    for (const content of ["I am 13, can I still use this?", "I was 15 when I first saw the ocean, it was magical"]) {
      const verdict = await moderateText(content, { userId: me.id, targetType: "message", targetId: threadId });
      if (!verdict.ok) {
        await logModeration({ userId: me.id, targetType: "message", targetId: threadId }, "self_declared_minor", "escalated", { excerpt: content });
      }
    }
    expect((await remove("self-declared-deleter")).status).toBe(200);
  });

  it("doesn't hold deletion for our model's text, or for verdicts on generated media", async () => {
    const me = await user("system-verdict-deleter");
    const threadId = crypto.randomUUID();
    // The chat reply, a chat photo's scene, a summary and a memory, all model output.
    await moderateText('I said "she\'s a minor"', { userId: me.id, targetType: "message", targetId: threadId, details: { source: "model_output" } });
    await moderateText("a teen in a school uniform", { userId: me.id, targetType: "image_prompt", targetId: threadId, details: { source: "model_output" } }, { failClosed: true });
    await moderateText("They talked about being a teen", { userId: me.id, targetType: "message", details: { source: "summary" } }, { failClosed: true });
    await moderateText("Was a teen in 2009", { userId: me.id, targetType: "message", details: { source: "memory" } }, { failClosed: true });
    // The video worker refusing our default motion (the user wrote none), and
    // Hive and the image worker on a photo that was never stored.
    const clip = await createMedia({ userId: me.id, kind: "video", purpose: "video", prompt: videoPrompt().prompt });
    await blockVideo(clip, "minor: apparent child in frame");
    const photo = await createMedia({ userId: me.id, kind: "image", purpose: "chat" });
    await logModeration({ userId: me.id, targetType: "image", targetId: photo.id }, "minor", "blocked", { categories: ["minor"], provider: "hive" });
    await logModeration({ userId: me.id, targetType: "image", targetId: photo.id }, "minor", "blocked", { reason: "minor: apparent child" });

    const database = await db();
    const minor = await database
      .select()
      .from(moderationEvents)
      .where(and(eq(moderationEvents.userId, me.id), eq(moderationEvents.category, "minor"), eq(moderationEvents.action, "blocked")));
    expect(minor.length).toBeGreaterThanOrEqual(5);
    expect((await remove("system-verdict-deleter")).status).toBe(200);
  });

  it("refuses deletion while a CSAM report on the user's content hasn't been cleared", async () => {
    const actioned = await user("csam-actioned-deleter");
    const kept = await storedImage(actioned.id);
    const first = await report("csam", kept.id, "198.51.100.52");
    // Handled by hand: closed, but nobody cleared it.
    await resolveReport(call("/api/admin/reports", "admin", { method: "PATCH", json: { id: first.id, status: "actioned", resolution: "Filed with NCMEC" } }));
    expect((await remove("csam-actioned-deleter")).status).toBe(409);

    const cleared = await user("csam-cleared-deleter");
    const removed = await storedImage(cleared.id);
    const second = await report("csam", removed.id, "198.51.100.53");
    await takedown(call("/api/admin/reports/takedown", "admin", { method: "POST", json: { id: second.id, preserve: false } }));
    expect((await remove("csam-cleared-deleter")).status).toBe(200);
  });

  it("doesn't hold the reporter's account", async () => {
    const owner = await user("reported-owner");
    const item = await storedImage(owner.id);
    await user("reporter-deleter");
    const filed = await postReport(
      call("/api/reports", "reporter-deleter", {
        method: "POST",
        json: { kind: "csam", target: item.id, details: "This is a 12 year old child" },
        ip: "198.51.100.54",
      }),
    );
    expect(filed.status).toBe(200);
    expect((await remove("reporter-deleter")).status).toBe(200);
    expect((await remove("reported-owner")).status).toBe(409);
  });

  it("finds an open report naming the user's content among many others, however it's written", async () => {
    const me = await user("many-reports-deleter");
    const item = await storedImage(me.id);
    const database = await db();
    // A pile of open public reports about other things.
    const pile = await database
      .insert(reports)
      .values(
        Array.from({ length: 300 }, (_, i) => ({
          kind: "other" as const,
          target: `https://simulust.test/api/media/${crypto.randomUUID()} report ${i}`,
          dueAt: new Date(Date.now() + 48 * 3_600_000),
        })),
      )
      .returning({ id: reports.id });
    try {
      const named = await report("other", `HTTPS://BUCKET.S3.AMAZONAWS.COM/IMAGE/${me.id.toUpperCase()}/${item.id.toUpperCase()}.PNG?X-Amz-Signature=x`, "198.51.100.55");
      expect((await remove("many-reports-deleter")).status).toBe(409);
      await resolveReport(call("/api/admin/reports", "admin", { method: "PATCH", json: { id: named.id, status: "dismissed", resolution: "Not a violation" } }));
      expect((await remove("many-reports-deleter")).status).toBe(200);
    } finally {
      await database.delete(reports).where(inArray(reports.id, pile.map((row) => row.id)));
    }
  });

  it("refuses deletion after the video worker refuses a motion the user wrote, until it's reviewed", async () => {
    const me = await user("worker-prompt-deleter");
    const photo = await storedImage(me.id);
    const clip = await createMedia({
      userId: me.id,
      kind: "video",
      purpose: "video",
      sourceMediaId: photo.id,
      prompt: videoPrompt("she is a teen, dancing").prompt,
    });
    await blockVideo(clip, "minor:teen");
    expect((await remove("worker-prompt-deleter")).status).toBe(409);

    const mine = (await queue()).filter((event) => event.userId === me.id);
    expect(mine).toMatchObject([{ category: "minor", targetType: "video", details: { matched: "teen", excerpt: "she is a teen, dancing" } }]);
    await reviewQueue(call("/api/admin/moderation", "admin", { method: "PATCH", json: { ids: mine.map((event) => event.id) } }));
    expect((await remove("worker-prompt-deleter")).status).toBe(200);
  });

  it("blocks a stored photo the video worker's tagger flags, and holds deletion until it's reviewed", async () => {
    const me = await user("worker-tagger-deleter");
    const photo = await storedImage(me.id);
    const clip = await createMedia({ userId: me.id, kind: "video", purpose: "video", sourceMediaId: photo.id, prompt: videoPrompt().prompt });
    await blockVideo(clip, "apparent minor: loli:0.91, school_uniform:0.88", "render");
    expect(await heldFile(photo)).toMatchObject({ status: "blocked", file: true });
    expect((await remove("worker-tagger-deleter")).status).toBe(409);

    // A report on the photo keeps it by default.
    const row = await report("other", photo.id, "198.51.100.56");
    expect((await openReports()).find((entry) => entry.id === row.id)).toMatchObject({ minorFlagged: true, preserveByDefault: true });
    await resolveReport(call("/api/admin/reports", "admin", { method: "PATCH", json: { id: row.id, status: "dismissed", resolution: "Seen" } }));

    const mine = (await queue()).filter((event) => event.userId === me.id);
    expect(mine.find((event) => event.targetId === photo.id)).toMatchObject({
      category: "minor",
      targetType: "image",
      details: { source: "video_worker", videoId: clip.id },
    });
    await reviewQueue(call("/api/admin/moderation", "admin", { method: "PATCH", json: { ids: mine.map((event) => event.id) } }));
    expect((await remove("worker-tagger-deleter")).status).toBe(200);
  });

  it("expires the user's open checkouts, keeping one whose payment was already seen", async () => {
    const me = await user("checkout-deleter");
    const database = await db();
    const checkout = (extra: Partial<typeof orders.$inferInsert> = {}) => ({
      userId: me.id,
      productId: "credits-6500",
      usdCents: 4999,
      currency: "USDC" as const,
      amount: BigInt(49_990_000),
      recipient: "treasury",
      reference: crypto.randomUUID(),
      expiresAt: new Date(Date.now() + 15 * 60_000),
      ...extra,
    });
    const [open] = await database.insert(orders).values(checkout()).returning();
    const [seen] = await database.insert(orders).values(checkout({ signature: `sig-${crypto.randomUUID()}` })).returning();
    const [paid] = await database.insert(orders).values(checkout({ status: "confirmed", signature: `sig-${crypto.randomUUID()}` })).returning();

    expect((await remove("checkout-deleter")).status).toBe(200);
    const status = async (id: string) => (await database.select().from(orders).where(eq(orders.id, id)))[0];
    expect(await status(open.id)).toMatchObject({ status: "expired", userId: null });
    expect(await status(seen.id)).toMatchObject({ status: "pending", userId: null });
    expect(await status(paid.id)).toMatchObject({ status: "confirmed", userId: null });
  });
});
