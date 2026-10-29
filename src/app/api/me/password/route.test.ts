import { describe, expect, it } from "vitest";
import { POST as changePassword } from "./route";
import { POST as signup } from "@/app/api/auth/signup/route";
import { POST as login } from "@/app/api/auth/login/route";
import { currentUser } from "@/server/auth";

const PASSWORD = "slow dance in the dark";
let count = 0;

function call(path: string, json: unknown, headers: Record<string, string> = {}) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-real-ip": `10.40.0.${++count}`, ...headers },
    body: JSON.stringify(json),
  });
}

const sessionOf = (response: Response) =>
  response.headers.getSetCookie().find((cookie) => cookie.startsWith("simulust-session="))!.split(";")[0];

async function newAccount() {
  const username = `pwchange_${Date.now().toString(36).slice(-4)}${++count}`;
  const response = await signup(call("/api/auth/signup", { username, password: PASSWORD, birthDate: "1991-09-09", consent: true }));
  expect(response.status).toBe(201);
  return { username, cookie: sessionOf(response) };
}

const signedIn = async (cookie: string) =>
  currentUser(new Request("http://localhost/api/me", { headers: { cookie } }));

const change = (cookie: string | null, json: unknown) =>
  changePassword(call("/api/me/password", json, cookie ? { cookie } : {}));

describe("POST /api/me/password", () => {
  it("changes the password and signs out every other browser", async () => {
    const { username, cookie } = await newAccount();
    const other = sessionOf(await login(call("/api/auth/login", { username, password: PASSWORD })));
    const newPassword = "a brand new long phrase";

    const response = await change(cookie, { currentPassword: PASSWORD, newPassword });
    expect(response.status).toBe(204);
    expect(await signedIn(cookie)).not.toBeNull();
    expect(await signedIn(other)).toBeNull();

    expect((await login(call("/api/auth/login", { username, password: PASSWORD }))).status).toBe(401);
    expect((await login(call("/api/auth/login", { username, password: newPassword }))).status).toBe(200);
  });

  it("needs the current password", async () => {
    const { cookie } = await newAccount();
    const response = await change(cookie, { currentPassword: "not my password", newPassword: "a brand new long phrase" });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "wrong_password" });
    // Still signed in: only the password typed was wrong.
    expect(await signedIn(cookie)).not.toBeNull();
  });

  it("checks the new password", async () => {
    const { username, cookie } = await newAccount();
    for (const newPassword of ["short", "password1", username]) {
      const response = await change(cookie, { currentPassword: PASSWORD, newPassword });
      expect(response.status, newPassword).toBe(400);
      expect(await response.json()).toMatchObject({ code: "weak_password" });
    }
  });

  it("needs a signed-in account that has a password", async () => {
    expect((await change(null, { currentPassword: PASSWORD, newPassword: "a brand new long phrase" })).status).toBe(401);
    const response = await changePassword(
      call("/api/me/password", { currentPassword: PASSWORD, newPassword: "a brand new long phrase" }, { "x-dev-user": "pw-dev" }),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "no_password" });
  });

  it("is rate limited", async () => {
    const { cookie } = await newAccount();
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      statuses.push((await change(cookie, { currentPassword: "wrong guess here", newPassword: "a brand new long phrase" })).status);
    }
    expect(statuses.slice(0, 10).every((status) => status === 403)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});
