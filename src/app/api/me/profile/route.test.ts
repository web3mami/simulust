import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { currentUser } from "@/server/auth";
import { db } from "@/server/db";
import { users } from "@/server/db/schema";
import { GET, PUT } from "./route";

const get = (handle: string) => GET(new Request("http://localhost/api/me/profile", { headers: { "x-dev-user": handle } }));
const put = (handle: string, body: unknown) =>
  PUT(
    new Request("http://localhost/api/me/profile", {
      method: "PUT",
      headers: { "x-dev-user": handle, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

describe("/api/me/profile", () => {
  it("needs a signed-in user", async () => {
    expect((await GET(new Request("http://localhost/api/me/profile"))).status).toBe(401);
  });

  it("starts empty, saves, and keeps the account name in step", async () => {
    expect(await (await get("prof-a")).json()).toEqual({ profile: null });

    const saved = await put("prof-a", { name: "  Sam ", gender: "Non-binary", looking: ["Guys", "Girls", "Guys"], bio: "Night owl." });
    expect(saved.status).toBe(200);
    const { profile } = (await saved.json()) as { profile: Record<string, unknown> };
    expect(profile).toMatchObject({ name: "Sam", gender: "Non-binary", looking: ["Girls", "Guys"], bio: "Night owl." });

    expect(((await (await get("prof-a")).json()) as { profile: unknown }).profile).toEqual(profile);
    const user = (await currentUser(new Request("http://localhost", { headers: { "x-dev-user": "prof-a" } })))!;
    const database = await db();
    const [row] = await database.select({ displayName: users.displayName }).from(users).where(eq(users.id, user.id));
    expect(row.displayName).toBe("Sam");

    const updated = await put("prof-a", { name: "Sam", gender: "Man", looking: [], bio: "" });
    expect(((await updated.json()) as { profile: { gender: string; looking: string[] } }).profile).toMatchObject({ gender: "Man", looking: [] });
  });

  it("validates fields", async () => {
    expect((await put("prof-b", { name: "", gender: "Woman", looking: [], bio: "" })).status).toBe(400);
    expect((await put("prof-b", { name: "x".repeat(41), gender: "Woman" })).status).toBe(400);
    expect((await put("prof-b", { name: "Bo", gender: "Robot" })).status).toBe(400);
    expect((await put("prof-b", { name: "Bo", gender: "Woman", looking: ["Teens"] })).status).toBe(400);
    expect((await put("prof-b", { name: "Bo", gender: "Woman", bio: "x".repeat(501) })).status).toBe(400);
  });

  it("screens the name and bio", async () => {
    const name = await put("prof-c", { name: "jailbait", gender: "Woman" });
    expect(name.status).toBe(422);
    const bio = await put("prof-c", { name: "Cleo", gender: "Woman", bio: "I like schoolgirl stuff" });
    expect(bio.status).toBe(422);
    expect(((await bio.json()) as { error: string }).error).toMatch(/bio/);
    expect(await (await get("prof-c")).json()).toEqual({ profile: null });
  });
});
