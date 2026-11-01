import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { and, eq, like } from "drizzle-orm";
import { POST as signup } from "./signup/route";
import { POST as login } from "./login/route";
import { POST as logout } from "./logout/route";
import { POST as recover } from "./recover/route";
import { GET as getMe, PATCH as patchMe } from "@/app/api/me/route";
import { DELETE as deleteAccount } from "@/app/api/me/account/route";
import { createAccount, currentUser, explicitAllowed, identityHash } from "@/server/auth";
import { balanceOf } from "@/server/credits";
import { db } from "@/server/db";
import { creditLedger, deletedIdentities, moderationEvents, rateLimits, sessions, users } from "@/server/db/schema";
import * as passwords from "@/server/password";
import * as sessionStore from "@/server/sessions";
import { FREE } from "@/lib/pricing";
import type { Me } from "@/lib/api-types";

type Options = { ip?: string; cookie?: string; origin?: string; method?: string; devUser?: string };

function call(path: string, json?: unknown, options: Options = {}) {
  const headers: Record<string, string> = { "x-real-ip": options.ip ?? "192.0.2.1" };
  if (json !== undefined) headers["content-type"] = "application/json";
  if (options.cookie) headers.cookie = options.cookie;
  if (options.origin) headers.origin = options.origin;
  if (options.devUser) headers["x-dev-user"] = options.devUser;
  return new Request(`http://localhost${path}`, {
    method: options.method ?? (json === undefined ? "GET" : "POST"),
    headers,
    body: json === undefined ? undefined : JSON.stringify(json),
  });
}

// Each test signs up from its own address, clear of the per-IP limits.
let address = 0;
const freshIp = () => `10.20.${Math.floor(++address / 250)}.${address % 250}`;
let names = 0;
const freshName = (prefix = "user") => `${prefix}_${Date.now().toString(36).slice(-4)}${++names}`;

// A date of birth this many years (and days) before today (UTC), as YYYY-MM-DD.
function bornYearsAgo(years: number, days = 0) {
  const date = new Date();
  date.setUTCFullYear(date.getUTCFullYear() - years);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const PASSWORD = "velvet hours after dark";

function signUp(username: string, extra: Record<string, unknown> = {}, ip = freshIp(), cookie?: string) {
  return signup(
    call("/api/auth/signup", { username, password: PASSWORD, birthDate: "1994-07-12", consent: true, ...extra }, { ip, cookie }),
  );
}

function logIn(username: string, password = PASSWORD, options: Options = {}) {
  return login(call("/api/auth/login", { username, password }, { ip: freshIp(), ...options }));
}

// "simulust-session=<token>", ready to send back as a Cookie header.
function sessionOf(response: Response) {
  const set = response.headers.getSetCookie().find((cookie) => cookie.startsWith("simulust-session="));
  return set?.split(";")[0];
}

async function account(cookie: string) {
  return currentUser(call("/api/me", undefined, { cookie }));
}

async function row(username: string) {
  const database = await db();
  const [found] = await database.select().from(users).where(eq(users.username, username.toLowerCase()));
  return found;
}

async function newAccount(prefix = "user") {
  const username = freshName(prefix);
  const response = await signUp(username);
  expect(response.status).toBe(201);
  const body = (await response.json()) as { me: Me; recoveryCode: string };
  return { username, cookie: sessionOf(response)!, recoveryCode: body.recoveryCode, me: body.me };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/auth/signup", () => {
  it("makes a signed-in adult account with explicit content open, keeping no date of birth", async () => {
    const username = freshName("Kate");
    const response = await signUp(username, { birthDate: "1994-07-12" });
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as { me: Me; recoveryCode: string };
    expect(body.me).toMatchObject({
      username: username.toLowerCase(),
      displayName: username,
      ageAttested: true,
      ageVerified: true,
      explicitHold: false,
      balance: FREE.signupCredits,
    });
    expect(body.recoveryCode).toMatch(/^[A-Z2-7]{5}(-[A-Z2-7]{5}){3}$/);

    const cookie = response.headers.getSetCookie().find((value) => value.startsWith("simulust-session="))!;
    expect(cookie).toMatch(/^simulust-session=[A-Za-z0-9_-]{43}; /);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain(`Max-Age=${30 * 24 * 60 * 60}`);
    // Secure only in production, where there's https.
    expect(cookie).not.toContain("Secure");

    const stored = await row(username);
    expect(stored).toMatchObject({ privyId: `acct:${username.toLowerCase()}`, username: username.toLowerCase() });
    expect(stored.passwordHash).toMatch(/^scrypt\$/);
    expect(stored.passwordHash).not.toContain(PASSWORD);
    expect(stored.recoveryCodeHash).toBe(
      createHash("sha256").update(body.recoveryCode.replace(/-/g, "")).digest("hex"),
    );
    expect(stored.ageAttestedAt).toBeInstanceOf(Date);
    expect(stored.settings.explicitConsentAt).toEqual(expect.any(String));
    expect(JSON.stringify(stored)).not.toMatch(/1994|07-12/);
    expect(explicitAllowed(stored)).toBe(true);

    // The cookie signs the browser in.
    const signedIn = await account(sessionOf(response)!);
    expect(signedIn?.id).toBe(stored.id);
    const me = (await (await getMe(call("/api/me", undefined, { cookie: sessionOf(response) }))).json()) as { me: Me };
    expect(me.me.username).toBe(username.toLowerCase());
  });

  it("refuses anyone under 18 and keeps nothing, not even a rate-limit row", async () => {
    const username = freshName("young");
    const ip = freshIp();
    for (const birthDate of [bornYearsAgo(16), bornYearsAgo(18, 1)]) {
      const response = await signUp(username, { birthDate }, ip);
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: "under_18" });
      expect(sessionOf(response)).toBeUndefined();
    }
    expect(await row(username)).toBeUndefined();
    const database = await db();
    expect(await database.select().from(rateLimits).where(like(rateLimits.key, `%${ip}`))).toHaveLength(0);
  });

  it("counts the 18th birthday by the browser's own date", async () => {
    // Today furthest east (UTC+14), where it's already the birthday; after
    // 10:00 UTC that's tomorrow in UTC. The edges are pinned in age.test.ts.
    const east = new Date(Date.now() + 14 * 60 * 60 * 1000);
    const eighteenThere = new Date(east);
    eighteenThere.setUTCFullYear(east.getUTCFullYear() - 18);
    const [today, birthDate] = [east, eighteenThere].map((date) => date.toISOString().slice(0, 10));
    expect((await signUp(freshName("tz"), { birthDate, today })).status).toBe(201);
    // A "today" no time zone could have is ignored.
    const farOff = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    expect((await signUp(freshName("tz"), { birthDate: bornYearsAgo(18, 1), today: farOff })).status).toBe(403);
  });

  it("needs a real date of birth and the consent tick", async () => {
    for (const birthDate of ["2001-02-30", "1899-12-31", "12/07/1994", "", bornYearsAgo(-1)]) {
      const response = await signUp(freshName("date"), { birthDate });
      expect(response.status, birthDate).toBe(400);
      expect(await response.json()).toMatchObject({ code: "invalid_birth_date" });
    }
    for (const consent of [false, "yes", undefined]) {
      expect((await signUp(freshName("consent"), { consent })).status).toBe(400);
    }
  });

  it("checks the username, and that it's free whatever the case", async () => {
    for (const username of ["ab", "kate smith", "käte", "Kate_x", "admin", "Simulust_Girl", "support_team"]) {
      const response = await signUp(username);
      expect(response.status, username).toBe(400);
      expect(await response.json()).toMatchObject({ code: "invalid_username" });
    }
    const { username } = await newAccount("taken");
    const again = await signUp(username.toUpperCase());
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ code: "username_taken" });
  });

  it("checks the password", async () => {
    const username = freshName("pw");
    for (const password of ["short", "password123", username.toUpperCase()]) {
      const response = await signUp(username, { password });
      expect(response.status, password).toBe(400);
      expect(await response.json()).toMatchObject({ code: "weak_password" });
    }
    expect(await row(username)).toBeUndefined();
  });

  it("ends the session the browser already had", async () => {
    const first = await newAccount("before");
    const response = await signup(
      call(
        "/api/auth/signup",
        { username: freshName("after"), password: PASSWORD, birthDate: "1994-07-12", consent: true },
        { ip: freshIp(), cookie: first.cookie },
      ),
    );
    expect(response.status).toBe(201);
    expect(await account(first.cookie)).toBeNull();
    expect(await account(sessionOf(response)!)).not.toBeNull();
  });

  it("makes at most 5 accounts an hour from one address", async () => {
    const ip = freshIp();
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await signUp(freshName("burst"), {}, ip)).status);
    expect(statuses).toEqual([201, 201, 201, 201, 201, 429]);
  });

  // ACC-3: one IPv6 subscriber holds a whole /64, so stepping through it
  // mustn't reset the limits or the signup-credits cap.
  it("counts IPv6 addresses by their /64", async () => {
    const network = `2001:db8:${(++address).toString(16)}:7`;
    const made: Me[] = [];
    const statuses: number[] = [];
    for (let i = 1; i <= 6; i++) {
      const response = await signUp(freshName("six"), {}, `${network}:${i.toString(16)}::${i}`);
      statuses.push(response.status);
      if (response.status === 201) made.push(((await response.json()) as { me: Me }).me);
    }
    expect(statuses).toEqual([201, 201, 201, 201, 201, 429]);
    expect(made.map((me) => me.balance)).toEqual([FREE.signupCredits, FREE.signupCredits, 0, 0, 0]);
    const database = await db();
    const keys = (await database.select().from(rateLimits).where(like(rateLimits.key, `%${network}::/64`))).map((row) => row.key);
    expect(keys.sort()).toEqual([`signup-attempt:${network}::/64`, `signup-credits:${network}::/64`, `signup:${network}::/64`]);
    // The next /64 over is someone else.
    expect((await signUp(freshName("six"), {}, `2001:db8:${address.toString(16)}:8::1`)).status).toBe(201);
  });

  it("counts IPv4-mapped IPv6 as the IPv4 address", async () => {
    const ip = freshIp();
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await signUp(freshName("mapped"), {}, i % 2 ? `::ffff:${ip}` : ip)).status);
    expect(statuses).toEqual([201, 201, 201, 201, 201, 429]);
  });

  it("gives the signup credits only to the first two accounts from one address in a day", async () => {
    const ip = freshIp();
    const made: Me[] = [];
    for (let i = 0; i < 3; i++) {
      const response = await signUp(freshName("farm"), {}, ip);
      expect(response.status).toBe(201);
      made.push(((await response.json()) as { me: Me }).me);
    }
    expect(made.map((me) => me.balance)).toEqual([FREE.signupCredits, FREE.signupCredits, 0]);
    // The free messages come with every account.
    expect(made.map((me) => me.freeMessagesLeft)).toEqual([FREE.dailyMessages, FREE.dailyMessages, FREE.dailyMessages]);
    const database = await db();
    const ledger = await database.select().from(creditLedger).where(eq(creditLedger.userId, made[2].id));
    expect(ledger).toHaveLength(0);
    expect(await balanceOf(made[2].id)).toBe(0);
    // Another address still gets them.
    expect(((await (await signUp(freshName("farm"))).json()) as { me: Me }).me.balance).toBe(FREE.signupCredits);
  });

  it("gives a deleted username's signup credits to whoever takes it next", async () => {
    const { username, cookie } = await newAccount("again");
    const removed = await deleteAccount(
      call("/api/me/account", { confirm: "DELETE" }, { cookie, method: "DELETE" }),
    );
    expect(removed.status).toBe(200);
    // The browser's cookie goes, and so does the session behind it.
    expect(removed.headers.getSetCookie()[0]).toMatch(/^simulust-session=; .*Max-Age=0/);
    expect(await account(cookie)).toBeNull();
    const database = await db();
    expect(await database.select().from(sessions).where(eq(sessions.tokenHash, hashOf(cookie)))).toHaveLength(0);

    // Usernames are free for anyone to take again, so a deleted one says
    // nothing about who's back; the per-address cap is what stops farming.
    const back = await signUp(username);
    expect(back.status).toBe(201);
    expect(((await back.json()) as { me: Me }).me.balance).toBe(FREE.signupCredits);
    expect(await balanceOf((await row(username)).id)).toBe(FREE.signupCredits);
  });

  it("still keeps the signup credits from other deleted logins", async () => {
    const database = await db();
    const devLogin = `dev:${freshName("gone")}`;
    await database.insert(deletedIdentities).values({ privyIdHash: identityHash(devLogin) });
    const dev = await createAccount({ privyId: devLogin });
    expect(await balanceOf(dev!.id)).toBe(0);

    const name = freshName("freed");
    await database.insert(deletedIdentities).values({ privyIdHash: identityHash(`acct:${name}`) });
    const named = await createAccount({ privyId: `acct:${name}`, username: name });
    expect(await balanceOf(named!.id)).toBe(FREE.signupCredits);
    // And none at all when sign-up says the address has had its share.
    const capped = await createAccount({ privyId: `dev:${freshName("capped")}` }, { signupCredits: false });
    expect(await balanceOf(capped!.id)).toBe(0);
  });
});

const hashOf = (cookie: string) => createHash("sha256").update(cookie.split("=")[1]).digest("hex");

describe("POST /api/auth/login", () => {
  it("signs in with the right password, any case of the username", async () => {
    const { username } = await newAccount("Login");
    const response = await logIn(username.toUpperCase());
    expect(response.status).toBe(200);
    const { me } = (await response.json()) as { me: Me };
    expect(me.username).toBe(username.toLowerCase());
    const cookie = sessionOf(response)!;
    expect((await account(cookie))?.username).toBe(username.toLowerCase());
  });

  it("gives one answer whether the username exists or not", async () => {
    const { username } = await newAccount("same");
    // An account with no password to match (development handles have none).
    const { username: noPassword } = await newAccount("nopass");
    const database = await db();
    await database.update(users).set({ passwordHash: null }).where(eq(users.username, noPassword));
    const answers = [
      await logIn(username, "not the password at all"),
      await logIn(freshName("nobody")),
      await logIn("x"),
      await logIn(noPassword),
    ];
    const bodies = await Promise.all(answers.map((response) => response.json()));
    expect(answers.map((response) => response.status)).toEqual([401, 401, 401, 401]);
    for (const body of bodies) {
      expect(body).toEqual({ error: "That username and password don't match.", code: "invalid_credentials" });
    }
    expect(answers.every((response) => sessionOf(response) === undefined)).toBe(true);
  });

  it("tells a banned account so, but only with the right password", async () => {
    const { username } = await newAccount("banned");
    const database = await db();
    await database.update(users).set({ bannedAt: new Date() }).where(eq(users.username, username));
    expect((await logIn(username, "wrong password here")).status).toBe(401);
    const response = await logIn(username);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "forbidden" });
    expect(sessionOf(response)).toBeUndefined();
  });

  it("ends the session the browser already had", async () => {
    const first = await newAccount("first");
    const second = await newAccount("second");
    const response = await logIn(second.username, PASSWORD, { cookie: first.cookie });
    expect(response.status).toBe(200);
    expect(await account(first.cookie)).toBeNull();
    expect((await account(sessionOf(response)!))?.username).toBe(second.username);
  });

  it("limits guesses at one username, from any address", async () => {
    const { username } = await newAccount("guess");
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await logIn(username, `guess number ${i}`)).status);
    expect(statuses.slice(0, 10).every((status) => status === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
    // Even the right password waits now.
    expect((await logIn(username)).status).toBe(429);
  });

  it("limits attempts from one address across usernames", async () => {
    const ip = freshIp();
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) statuses.push((await logIn(freshName("spray"), PASSWORD, { ip })).status);
    expect(statuses.slice(0, 20).every((status) => status === 401)).toBe(true);
    expect(statuses[20]).toBe(429);
  });
});

describe("POST /api/auth/logout", () => {
  it("ends the session and clears the cookie", async () => {
    const { cookie } = await newAccount("bye");
    const response = await logout(call("/api/auth/logout", undefined, { cookie, method: "POST" }));
    expect(response.status).toBe(204);
    expect(response.headers.getSetCookie()[0]).toMatch(/^simulust-session=; Path=\/; HttpOnly; SameSite=Lax; Max-Age=0/);
    expect(await account(cookie)).toBeNull();
  });

  it("is fine signed out", async () => {
    expect((await logout(call("/api/auth/logout", undefined, { method: "POST" }))).status).toBe(204);
  });
});

describe("sessions", () => {
  it("expire", async () => {
    const { cookie } = await newAccount("expire");
    const database = await db();
    await database.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(sessions.tokenHash, hashOf(cookie)));
    expect(await account(cookie)).toBeNull();
  });

  it("are stored only as a hash of the cookie's token", async () => {
    const { cookie, me } = await newAccount("hashed");
    const database = await db();
    const rows = await database.select().from(sessions).where(eq(sessions.userId, me.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).toBe(hashOf(cookie));
    expect(JSON.stringify(rows)).not.toContain(cookie.split("=")[1]);
  });

  it("don't count on changes sent from another site", async () => {
    const { cookie } = await newAccount("csrf");
    const rename = (origin?: string) =>
      patchMe(call("/api/me", { settings: { unpromptedMedia: true } }, { cookie, origin, method: "PATCH" }));
    expect((await rename("https://evil.example")).status).toBe(401);
    expect((await rename("null")).status).toBe(401);
    expect((await rename("http://localhost")).status).toBe(200);
    expect((await rename()).status).toBe(200);
    // Reading is fine from anywhere: a page elsewhere can't read the answer.
    expect((await account(cookie))).not.toBeNull();
    const read = await getMe(call("/api/me", undefined, { cookie, origin: "https://evil.example" }));
    expect(((await read.json()) as { me: Me | null }).me).not.toBeNull();
  });

  it("come before the development header", async () => {
    const { cookie, username } = await newAccount("first_in");
    const user = await currentUser(call("/api/me", undefined, { cookie, devUser: "someone-else" }));
    expect(user?.username).toBe(username);
  });

  it("make an account an admin only by its id in ADMIN_USER_IDS", async () => {
    const { cookie, me } = await newAccount("boss");
    expect((await account(cookie))?.isAdmin).toBe(false);
    vi.stubEnv("ADMIN_USER_IDS", `${crypto.randomUUID()}, ${me.id.toUpperCase()}`);
    vi.resetModules();
    const fresh = await import("@/server/auth");
    expect((await fresh.currentUser(call("/api/me", undefined, { cookie })))?.isAdmin).toBe(true);
    vi.unstubAllEnvs();
    vi.resetModules();
    const again = await import("@/server/auth");
    expect((await again.currentUser(call("/api/me", undefined, { cookie })))?.isAdmin).toBe(false);
  });
});

describe("POST /api/auth/recover", () => {
  const reset = (json: Record<string, unknown>, options: Options = {}) =>
    recover(call("/api/auth/recover", json, { ip: freshIp(), ...options }));

  it("resets the password with the code, swaps the code and signs out everywhere else", async () => {
    const { username, cookie, recoveryCode } = await newAccount("forgot");
    const otherBrowser = sessionOf(await logIn(username))!;
    const newPassword = "a new song at midnight";
    const response = await reset({ username: username.toUpperCase(), recoveryCode: recoveryCode.toLowerCase().replace(/-/g, " "), newPassword });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { me: Me; recoveryCode: string };
    expect(body.me.username).toBe(username);
    expect(body.recoveryCode).toMatch(/^[A-Z2-7]{5}(-[A-Z2-7]{5}){3}$/);
    expect(body.recoveryCode).not.toBe(recoveryCode);

    expect(await account(cookie)).toBeNull();
    expect(await account(otherBrowser)).toBeNull();
    expect((await account(sessionOf(response)!))?.username).toBe(username);

    expect((await logIn(username)).status).toBe(401);
    expect((await logIn(username, newPassword)).status).toBe(200);
    // The old code is used up; the new one works.
    expect((await reset({ username, recoveryCode, newPassword: "yet another long phrase" })).status).toBe(401);
    expect((await reset({ username, recoveryCode: body.recoveryCode, newPassword: "yet another long phrase" })).status).toBe(200);
  });

  it("consumes a recovery code only once when two resets race", async () => {
    const { username, cookie, recoveryCode, me } = await newAccount("recoverrace");
    const otherBrowser = sessionOf(await logIn(username))!;
    const previous = [await newAccount("racebefore"), await newAccount("racebefore")];
    const newPasswords = ["the first recovered phrase", "the second recovered phrase"];
    const hashPassword = passwords.hashPassword;
    let arrived = 0;
    let release!: () => void;
    const bothHashing = new Promise<void>((resolve) => (release = resolve));
    // Both requests must have accepted the same old code before either can
    // update it. This makes the original read-then-write race deterministic.
    const hashing = vi.spyOn(passwords, "hashPassword").mockImplementation(async (password) => {
      const hash = await hashPassword(password);
      if (++arrived === 2) release();
      await bothHashing;
      return hash;
    });
    let responses: Response[];
    try {
      responses = await Promise.all(
        newPasswords.map((newPassword, index) => reset({ username, recoveryCode, newPassword }, { cookie: previous[index].cookie })),
      );
    } finally {
      hashing.mockRestore();
    }

    expect(responses.map((response) => response.status).sort()).toEqual([200, 401]);
    const winner = responses.findIndex((response) => response.status === 200);
    const loser = 1 - winner;
    const replacement = (await responses[winner].json()) as { me: Me; recoveryCode: string };
    expect(await responses[loser].json()).toEqual({
      error: "That username and recovery code don't match.",
      code: "invalid_recovery",
    });
    expect(sessionOf(responses[loser])).toBeUndefined();
    expect(await account(cookie)).toBeNull();
    expect(await account(otherBrowser)).toBeNull();
    expect(await account(previous[winner].cookie)).toBeNull();
    expect((await account(previous[loser].cookie))?.id).toBe(previous[loser].me.id);
    expect((await account(sessionOf(responses[winner])!))?.id).toBe(me.id);
    expect(await (await db()).select().from(sessions).where(eq(sessions.userId, me.id))).toHaveLength(1);
    expect((await logIn(username, newPasswords[winner])).status).toBe(200);
    expect((await logIn(username, newPasswords[loser])).status).toBe(401);
    expect((await logIn(username)).status).toBe(401);
    expect((await reset({ username, recoveryCode, newPassword: "a replayed recovery phrase" })).status).toBe(401);
    expect((await reset({ username, recoveryCode: replacement.recoveryCode, newPassword: "a fresh recovery phrase" })).status).toBe(200);
  });

  it("keeps the original credentials and sessions when issuing the replacement session fails", async () => {
    const { username, cookie, recoveryCode, me } = await newAccount("recoverretry");
    const otherBrowser = sessionOf(await logIn(username))!;
    const previous = await newAccount("retrybefore");
    const original = await row(username);
    const createSession = vi.spyOn(sessionStore, "createSession").mockRejectedValueOnce(new Error("Session insert failed"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    let response: Response;
    try {
      response = await reset({ username, recoveryCode, newPassword: "a replacement after retry" }, { cookie: previous.cookie });
    } finally {
      createSession.mockRestore();
      log.mockRestore();
    }

    expect(response.status).toBe(500);
    expect(sessionOf(response)).toBeUndefined();
    expect(await row(username)).toMatchObject({ passwordHash: original.passwordHash, recoveryCodeHash: original.recoveryCodeHash });
    expect((await account(cookie))?.id).toBe(me.id);
    expect((await account(otherBrowser))?.id).toBe(me.id);
    expect((await account(previous.cookie))?.id).toBe(previous.me.id);
    expect(await (await db()).select().from(sessions).where(eq(sessions.userId, me.id))).toHaveLength(2);
    expect((await logIn(username)).status).toBe(200);
    expect((await reset({ username, recoveryCode, newPassword: "a replacement after retry" })).status).toBe(200);
  });

  it("gives one answer for a wrong code and a username nobody has", async () => {
    const { username } = await newAccount("wrongcode");
    const answers = [
      await reset({ username, recoveryCode: "AAAAA-AAAAA-AAAAA-AAAAA", newPassword: "a long new phrase" }),
      await reset({ username: freshName("ghost"), recoveryCode: "AAAAA-AAAAA-AAAAA-AAAAA", newPassword: "a long new phrase" }),
      await reset({ username, recoveryCode: "not a code", newPassword: "a long new phrase" }),
    ];
    expect(answers.map((response) => response.status)).toEqual([401, 401, 401]);
    for (const response of answers) {
      expect(await response.json()).toEqual({ error: "That username and recovery code don't match.", code: "invalid_recovery" });
    }
    expect((await logIn(username)).status).toBe(200);
  });

  it("checks the new password", async () => {
    const { username, recoveryCode } = await newAccount("weaknew");
    const response = await reset({ username, recoveryCode, newPassword: "12345678" });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "weak_password" });
    expect((await logIn(username)).status).toBe(200);
  });

  it("is rate limited per username", async () => {
    const { username } = await newAccount("recoverlimit");
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      statuses.push((await reset({ username, recoveryCode: "AAAAA-AAAAA-AAAAA-AAAAA", newPassword: "a long new phrase" })).status);
    }
    expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
  });
});

// The Set-Cookie line for the held mark, if the response sets one.
const heldMarkOf = (response: Response) =>
  response.headers.getSetCookie().find((cookie) => cookie.startsWith("simulust-held="));

async function hold(userId: string) {
  const database = await db();
  await database.update(users).set({ explicitHoldAt: new Date(), ageAttestedAt: null }).where(eq(users.id, userId));
}

async function findingsFor(userId: string, category: string) {
  const database = await db();
  return database
    .select()
    .from(moderationEvents)
    .where(and(eq(moderationEvents.userId, userId), eq(moderationEvents.category, category)));
}

describe("a held account's browser", () => {
  it("is marked for a year wherever the server sees the held account", async () => {
    const { username, cookie, me } = await newAccount("marked");
    // Not while the account is in good standing.
    expect(heldMarkOf(await getMe(call("/api/me", undefined, { cookie })))).toBeUndefined();
    await hold(me.id);

    const mark = heldMarkOf(await getMe(call("/api/me", undefined, { cookie })));
    expect(mark).toBe(`simulust-held=${me.id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${365 * 24 * 60 * 60}`);
    expect(heldMarkOf(await logIn(username))).toMatch(new RegExp(`^simulust-held=${me.id}; `));
    // Signing out reads the account before the session goes.
    const out = await logout(call("/api/auth/logout", undefined, { cookie, method: "POST" }));
    expect(out.headers.getSetCookie()[0]).toMatch(/^simulust-session=; /);
    expect(heldMarkOf(out)).toMatch(new RegExp(`^simulust-held=${me.id}; .*Max-Age=31536000`));
    expect(await account(cookie)).toBeNull();
    // Signed out, or another account in good standing: nothing changes.
    expect(heldMarkOf(await logout(call("/api/auth/logout", undefined, { method: "POST" })))).toBeUndefined();
    const other = await newAccount("unmarked");
    const otherMe = await getMe(call("/api/me", undefined, { cookie: `${other.cookie}; simulust-held=${me.id}` }));
    expect(heldMarkOf(otherMe)).toBeUndefined();
  });

  it("makes the next sign-up from it start held, with a review naming the earlier account", async () => {
    const earlier = await newAccount("earlier");
    await hold(earlier.me.id);
    const username = freshName("again");
    const response = await signUp(username, { birthDate: "1994-07-12" }, freshIp(), `simulust-held=${earlier.me.id}`);
    expect(response.status).toBe(201);
    const { me } = (await response.json()) as { me: Me };
    expect(me).toMatchObject({ explicitHold: true, ageAttested: false, ageVerified: false });

    const stored = await row(username);
    expect(stored.explicitHoldAt).toBeInstanceOf(Date);
    expect(stored.ageAttestedAt).toBeNull();
    expect(explicitAllowed(stored)).toBe(false);
    // Held, not banned: they can still sign in, export or delete the account.
    expect(stored.bannedAt).toBeNull();
    expect((await account(sessionOf(response)!))?.id).toBe(stored.id);
    expect(heldMarkOf(response)).toMatch(new RegExp(`^simulust-held=${stored.id}; `));

    const logged = await findingsFor(stored.id, "self_declared_minor");
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ action: "escalated", targetType: "profile", targetId: stored.id, reviewedAt: null });
    expect(logged[0].details).toMatchObject({ source: "held_browser", earlierAccountId: earlier.me.id });
    expect(JSON.stringify(logged[0].details)).not.toMatch(/1994|07-12/);
  });

  it("isn't held by a mark that isn't an account id", async () => {
    const username = freshName("garbled");
    const response = await signUp(username, {}, freshIp(), "simulust-held=not-an-id");
    expect(response.status).toBe(201);
    expect(((await response.json()) as { me: Me }).me.explicitHold).toBe(false);
    expect(heldMarkOf(response)).toBeUndefined();
  });

  // ACC-1a: a mark can be gone (cleared, or never set) while the browser is
  // still signed in to the held account; the session says it all the same.
  it("makes a sign-up start held while it's still signed in to the held account, mark or not", async () => {
    const earlier = await newAccount("stillin");
    await hold(earlier.me.id);
    const username = freshName("fromheld");
    const response = await signUp(username, {}, freshIp(), earlier.cookie);
    expect(response.status).toBe(201);
    expect(((await response.json()) as { me: Me }).me).toMatchObject({ explicitHold: true, ageAttested: false, ageVerified: false });
    const stored = await row(username);
    expect(stored.explicitHoldAt).toBeInstanceOf(Date);
    expect(explicitAllowed(stored)).toBe(false);
    expect(heldMarkOf(response)).toMatch(new RegExp(`^simulust-held=${stored.id}; `));
    const logged = await findingsFor(stored.id, "self_declared_minor");
    expect(logged).toHaveLength(1);
    expect(logged[0].details).toMatchObject({ source: "held_browser", earlierAccountId: earlier.me.id });
    // The held account's session still ends here.
    expect(await account(earlier.cookie)).toBeNull();

    // With a mark too, the review names the mark's account.
    const marked = await newAccount("markfirst");
    await hold(marked.me.id);
    const signedIn = await newAccount("signedin");
    await hold(signedIn.me.id);
    const both = freshName("both");
    const again = await signUp(both, {}, freshIp(), `${signedIn.cookie}; simulust-held=${marked.me.id}`);
    expect(again.status).toBe(201);
    const bothRow = await row(both);
    expect(bothRow.explicitHoldAt).toBeInstanceOf(Date);
    expect((await findingsFor(bothRow.id, "self_declared_minor"))[0].details).toMatchObject({ earlierAccountId: marked.me.id });

    // Signed in to an account in good standing, nothing is held.
    const fine = await newAccount("fine");
    const clean = freshName("clean");
    expect((await signUp(clean, {}, freshIp(), fine.cookie)).status).toBe(201);
    expect((await row(clean)).explicitHoldAt).toBeNull();
  });

  // ACC-1b: deleting the held account mustn't wipe what the browser knows.
  it("stays marked after the held account is deleted, so the next sign-up starts held", async () => {
    const { cookie, me } = await newAccount("deleted");
    await hold(me.id);
    const removed = await deleteAccount(call("/api/me/account", { confirm: "DELETE" }, { cookie, method: "DELETE" }));
    expect(removed.status).toBe(200);
    expect(removed.headers.getSetCookie()[0]).toMatch(/^simulust-session=; .*Max-Age=0/);
    const mark = heldMarkOf(removed);
    expect(mark).toBe(`simulust-held=${me.id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${365 * 24 * 60 * 60}`);
    expect(await account(cookie)).toBeNull();

    const username = freshName("afterdel");
    const response = await signUp(username, {}, freshIp(), mark!.split(";")[0]);
    expect(response.status).toBe(201);
    expect(((await response.json()) as { me: Me }).me.explicitHold).toBe(true);
    expect((await findingsFor((await row(username)).id, "self_declared_minor"))[0].details).toMatchObject({
      earlierAccountId: me.id,
    });

    // An account in good standing leaves no mark behind.
    const other = await newAccount("deletedok");
    const gone = await deleteAccount(call("/api/me/account", { confirm: "DELETE" }, { cookie: other.cookie, method: "DELETE" }));
    expect(gone.status).toBe(200);
    expect(heldMarkOf(gone)).toBeUndefined();
  });

  // ACC-1a, signing in: switching accounts mustn't wipe what the browser knows.
  it("stays marked when it signs in to another account, so the next sign-up starts held", async () => {
    const held = await newAccount("switchfrom");
    await hold(held.me.id);
    const other = await newAccount("switchto");
    // The mark is gone (cleared, or never set); the session still says it.
    const response = await logIn(other.username, PASSWORD, { cookie: held.cookie });
    expect(response.status).toBe(200);
    const mark = heldMarkOf(response);
    expect(mark).toBe(`simulust-held=${held.me.id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${365 * 24 * 60 * 60}`);
    // The held account's session still ends here, and the other one starts.
    expect(await account(held.cookie)).toBeNull();
    expect((await account(sessionOf(response)!))?.id).toBe(other.me.id);
    expect((await row(other.username)).explicitHoldAt).toBeNull();

    const username = freshName("afterswitch");
    const again = await signUp(username, {}, freshIp(), mark!.split(";")[0]);
    expect(((await again.json()) as { me: Me }).me.explicitHold).toBe(true);
    expect((await findingsFor((await row(username)).id, "self_declared_minor"))[0].details).toMatchObject({
      earlierAccountId: held.me.id,
    });
  });

  it("keeps the earlier account's mark when the account signing in clears its own", async () => {
    const held = await newAccount("switchheld");
    await hold(held.me.id);
    // A mark naming the account signing in, whose hold a review lifted.
    const lifted = await newAccount("switchlifted");
    const response = await logIn(lifted.username, PASSWORD, { cookie: `${held.cookie}; simulust-held=${lifted.me.id}` });
    expect(response.status).toBe(200);
    const marks = response.headers.getSetCookie().filter((cookie) => cookie.startsWith("simulust-held="));
    expect(marks[0]).toMatch(/^simulust-held=; .*Max-Age=0/);
    // The browser keeps the last one it's sent.
    expect(marks.at(-1)).toMatch(new RegExp(`^simulust-held=${held.me.id}; .*Max-Age=31536000`));
  });

  it("isn't marked for switching from an account in good standing, or signing in to the same held one", async () => {
    const fine = await newAccount("switchfine");
    const other = await newAccount("switchother");
    expect(heldMarkOf(await logIn(other.username, PASSWORD, { cookie: fine.cookie }))).toBeUndefined();

    const held = await newAccount("switchsame");
    await hold(held.me.id);
    const response = await logIn(held.username, PASSWORD, { cookie: held.cookie });
    const marks = response.headers.getSetCookie().filter((cookie) => cookie.startsWith("simulust-held="));
    expect(marks).toEqual([`simulust-held=${held.me.id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${365 * 24 * 60 * 60}`]);
  });

  // ACC-1a, recovering: the same for a password reset from the held account's browser.
  it("stays marked when it recovers another account, and the held account's session ends", async () => {
    const held = await newAccount("recoverfrom");
    await hold(held.me.id);
    const other = await newAccount("recoverto");
    const response = await recover(
      call(
        "/api/auth/recover",
        { username: other.username, recoveryCode: other.recoveryCode, newPassword: "a new song at midnight" },
        { ip: freshIp(), cookie: held.cookie },
      ),
    );
    expect(response.status).toBe(200);
    expect(heldMarkOf(response)).toBe(`simulust-held=${held.me.id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${365 * 24 * 60 * 60}`);
    expect(await account(held.cookie)).toBeNull();
    expect((await account(sessionOf(response)!))?.id).toBe(other.me.id);
    expect((await row(other.username)).explicitHoldAt).toBeNull();

    // From an account in good standing, nothing is marked.
    const fine = await newAccount("recoverfine");
    const next = await newAccount("recovernext");
    const clean = await recover(
      call(
        "/api/auth/recover",
        { username: next.username, recoveryCode: next.recoveryCode, newPassword: "a new song at midnight" },
        { ip: freshIp(), cookie: fine.cookie },
      ),
    );
    expect(clean.status).toBe(200);
    expect(heldMarkOf(clean)).toBeUndefined();
    expect(await account(fine.cookie)).toBeNull();
  });

  it("is unmarked once a review lifts the hold on the account it names", async () => {
    const { cookie, me } = await newAccount("lifted");
    await hold(me.id);
    const database = await db();
    await database.update(users).set({ explicitHoldAt: null }).where(eq(users.id, me.id));
    const response = await getMe(call("/api/me", undefined, { cookie: `${cookie}; simulust-held=${me.id}` }));
    expect(heldMarkOf(response)).toMatch(/^simulust-held=; .*Max-Age=0/);
  });
});

describe("a device the age gate refused", () => {
  const refused = "simulust-age-refused=1";

  it("can't sign up, whatever date it gives now, and nothing is kept", async () => {
    const username = freshName("refused");
    const ip = freshIp();
    const response = await signUp(username, { birthDate: "1990-01-01" }, ip, refused);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "device_refused" });
    expect(sessionOf(response)).toBeUndefined();
    expect(await row(username)).toBeUndefined();
    const database = await db();
    expect(await database.select().from(rateLimits).where(like(rateLimits.key, `%${ip}`))).toHaveLength(0);
    // Any other value isn't the gate's mark.
    expect((await signUp(freshName("refused"), {}, freshIp(), "simulust-age-refused=0")).status).toBe(201);
  });

  it("can sign in, but the account goes on hold as the gate's own call does", async () => {
    const { username, me } = await newAccount("refusedin");
    const response = await logIn(username, PASSWORD, { cookie: refused });
    expect(response.status).toBe(200);
    expect(((await response.json()) as { me: Me }).me).toMatchObject({ explicitHold: true, ageAttested: false, ageVerified: false });
    const stored = await row(username);
    expect(stored.explicitHoldAt).toBeInstanceOf(Date);
    expect(stored.ageAttestedAt).toBeNull();
    expect(stored.bannedAt).toBeNull();
    expect(heldMarkOf(response)).toMatch(new RegExp(`^simulust-held=${me.id}; `));
    const logged = await findingsFor(me.id, "attested_minor");
    expect(logged).toHaveLength(1);
    expect(logged[0].details).toMatchObject({ source: "device_gate" });
    // A wrong password from it changes nothing.
    const { username: other } = await newAccount("refusedwrong");
    expect((await logIn(other, "not the password at all", { cookie: refused })).status).toBe(401);
    expect((await row(other)).explicitHoldAt).toBeNull();
  });

  it("can recover an account, which goes on hold too", async () => {
    const { username, recoveryCode, me } = await newAccount("refusedrec");
    const response = await recover(
      call(
        "/api/auth/recover",
        { username, recoveryCode, newPassword: "a new song at midnight" },
        { ip: freshIp(), cookie: refused },
      ),
    );
    expect(response.status).toBe(200);
    expect(((await response.json()) as { me: Me }).me).toMatchObject({ explicitHold: true, ageVerified: false });
    expect((await row(username)).explicitHoldAt).toBeInstanceOf(Date);
    expect(heldMarkOf(response)).toMatch(new RegExp(`^simulust-held=${me.id}; `));
    expect(await findingsFor(me.id, "attested_minor")).toHaveLength(1);
  });
});
