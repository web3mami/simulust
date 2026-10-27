import { rm } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

vi.hoisted(() => {
  // Keep stored test files out of the project's .data directory.
  process.env.MEDIA_DIR = `${process.env.TMPDIR ?? "/tmp"}/simulust-media-test-${process.pid}`;
});

import { currentUser } from "@/server/auth";
import { balanceOf, chargeFor } from "@/server/credits";
import { db } from "@/server/db";
import { media } from "@/server/db/schema";
import { ABANDONED_AFTER_MS, abandonedMedia, createMedia, failAbandoned, failMedia, storeMedia } from "@/server/media";
import { readLocalObject } from "@/server/storage";
import { FREE } from "@/lib/pricing";

async function user(handle: string) {
  return (await currentUser(new Request("http://localhost/api/me", { headers: { "x-dev-user": handle } })))!;
}

async function age(id: string, ms: number) {
  const database = await db();
  await database.update(media).set({ createdAt: new Date(Date.now() - ms) }).where(eq(media.id, id));
  const [row] = await database.select().from(media).where(eq(media.id, id));
  return row;
}

beforeAll(async () => {
  await db();
});

afterAll(async () => {
  await rm(process.env.MEDIA_DIR!, { recursive: true, force: true });
});

describe("media status changes", () => {
  it("only makes a pending row ready, and drops the file otherwise", async () => {
    const owner = await user("media-guard");
    const row = await createMedia({ userId: owner.id, kind: "image", purpose: "chat" });
    await failMedia(row.id, "failed", "Gave up.");
    const stored = await storeMedia(row, new Uint8Array([1, 2, 3]), "image/png");
    expect(stored.status).toBe("failed");
    expect(await readLocalObject(`image/${owner.id}/${row.id}.png`)).toBeNull();
  });

  it("never turns a blocked row into a failed one", async () => {
    const owner = await user("media-blocked");
    const row = await createMedia({ userId: owner.id, kind: "image", purpose: "chat" });
    await failMedia(row.id, "blocked", "Removed after report");
    expect(await failMedia(row.id, "failed", "Generation failed.")).toBeUndefined();
  });

  it("lets a give-up lose to a job that already finished", async () => {
    const owner = await user("media-race");
    const row = await createMedia({ userId: owner.id, kind: "video", purpose: "video" });
    await storeMedia(row, new Uint8Array(2000), "video/mp4");
    expect(await failMedia(row.id, "failed", "Timed out.", undefined, { pendingOnly: true })).toBeUndefined();
  });
});

describe("abandoned media", () => {
  it("fails and refunds an image whose request died, exactly once", async () => {
    const owner = await user("media-abandoned");
    const row = await createMedia({ userId: owner.id, kind: "image", purpose: "chat", creditsSpent: 8 });
    await chargeFor(owner, "photo", row.id);
    expect(await balanceOf(owner.id)).toBe(FREE.signupCredits - 8);

    expect((await failAbandoned(row)).status).toBe("pending");
    const old = await age(row.id, ABANDONED_AFTER_MS + 1000);
    expect((await abandonedMedia()).map((item) => item.id)).toContain(row.id);
    expect((await failAbandoned(old)).status).toBe("failed");
    expect((await failAbandoned(old)).status).toBe("failed");
    expect(await balanceOf(owner.id)).toBe(FREE.signupCredits);
  });

  it("refunds nothing for a row that was never charged", async () => {
    const owner = await user("media-uncharged");
    const row = await createMedia({ userId: owner.id, kind: "audio", purpose: "voice", creditsSpent: 4 });
    const old = await age(row.id, ABANDONED_AFTER_MS + 1000);
    expect((await failAbandoned(old)).status).toBe("failed");
    expect(await balanceOf(owner.id)).toBe(FREE.signupCredits);
  });
});
