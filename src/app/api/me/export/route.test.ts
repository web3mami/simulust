import { describe, expect, it } from "vitest";
import { GET as exportData } from "./route";
import { POST as signup } from "@/app/api/auth/signup/route";

describe("GET /api/me/export", () => {
  it("includes the username and age record, never the password or recovery code", async () => {
    const password = "midnight swim with you";
    const response = await signup(
      new Request("http://localhost/api/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json", "x-real-ip": "10.70.0.1" },
        body: JSON.stringify({ username: "Export_Me", password, birthDate: "1988-04-04", consent: true }),
      }),
    );
    expect(response.status).toBe(201);
    const { recoveryCode } = (await response.json()) as { recoveryCode: string };
    const cookie = response.headers.getSetCookie()[0].split(";")[0];

    const exported = await exportData(new Request("http://localhost/api/me/export", { headers: { cookie } }));
    expect(exported.status).toBe(200);
    const text = await exported.text();
    const data = JSON.parse(text) as { user: Record<string, unknown>; sessions: unknown[] };
    expect(data.user).toMatchObject({
      username: "export_me",
      displayName: "Export_Me",
      login: "acct:export_me",
      ageAttestedAt: expect.any(String),
      explicitHoldAt: null,
    });
    expect(data.sessions).toEqual([{ createdAt: expect.any(String), expiresAt: expect.any(String) }]);
    for (const secret of ["passwordHash", "recoveryCodeHash", "scrypt$", password, recoveryCode, cookie.split("=")[1], "tokenHash"]) {
      expect(text, secret).not.toContain(secret);
    }
    // Only when they confirmed their age, never the date.
    expect(text).not.toContain("1988");
  });
});
