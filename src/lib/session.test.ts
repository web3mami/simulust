import { describe, expect, it } from "vitest";
import type { Me } from "@/lib/api-types";
import {
  ageLine,
  authErrorField,
  authErrorMessage,
  normalizeUsername,
  passwordProblem,
  sessionFromMe,
  shortAddress,
  usernameProblem,
  walletOf,
} from "@/lib/session";

const ADDRESS = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";

describe("sessionFromMe", () => {
  it("shows the display name and @username", () => {
    expect(sessionFromMe({ id: "u1", displayName: "Alice", username: "alice" })).toEqual({
      display: "Alice",
      detail: "@alice",
    });
  });

  it("falls back to the username before a display name is set", () => {
    expect(sessionFromMe({ id: "u1", displayName: "You", username: "alice" }).display).toBe("alice");
  });

  it("keys dev accounts (no username) on the account id", () => {
    expect(sessionFromMe({ id: "u2", displayName: "You", username: null })).toEqual({ display: "You", detail: "u2" });
  });
});

describe("username and password rules", () => {
  it("accepts 3 to 24 letters, numbers and underscores, in any case", () => {
    expect(usernameProblem("alice_01")).toBeNull();
    expect(usernameProblem("  Alice_01 ")).toBeNull();
    expect(normalizeUsername("  Alice_01 ")).toBe("alice_01");
    expect(usernameProblem("abc")).toBeNull();
    expect(usernameProblem("a".repeat(24))).toBeNull();
  });

  it("refuses short, long and odd usernames", () => {
    expect(usernameProblem("")).toMatch(/choose/i);
    expect(usernameProblem("ab")).toMatch(/3 to 24/);
    expect(usernameProblem("a".repeat(25))).toMatch(/3 to 24/);
    expect(usernameProblem("al ice")).toMatch(/letters, numbers and underscores/);
    expect(usernameProblem("alice-b")).toMatch(/letters, numbers and underscores/);
    expect(usernameProblem("alice@example.com")).not.toBeNull();
  });

  it("wants 8 to 128 characters of password", () => {
    expect(passwordProblem("1234567")).toMatch(/at least 8/);
    expect(passwordProblem("12345678")).toBeNull();
    expect(passwordProblem("x".repeat(128))).toBeNull();
    expect(passwordProblem("x".repeat(129))).toMatch(/128/);
  });
});

describe("authErrorMessage", () => {
  it("never says whether a username exists on login", () => {
    const wrong = authErrorMessage("login", 401, { code: "invalid_credentials" });
    expect(wrong).toBe(authErrorMessage("login", 401, { error: "No such user", code: "invalid_credentials" }));
    expect(wrong).toMatch(/don't match/);
    expect(wrong).not.toMatch(/no such|not found|exist/i);
  });

  it("names the taken username, too many tries and a lost connection", () => {
    expect(authErrorMessage("signup", 409, { code: "username_taken" })).toMatch(/taken/);
    expect(authErrorMessage("login", 429, null)).toMatch(/too many tries/i);
    expect(authErrorMessage("recover", 429, null)).toMatch(/too many tries/i);
    expect(authErrorMessage("signup", null, null)).toMatch(/connection/);
  });

  it("explains wrong recovery codes, wrong current passwords and locked accounts", () => {
    expect(authErrorMessage("recover", 401, null)).toMatch(/recovery code/);
    expect(authErrorMessage("password", 401, null)).toMatch(/current password/);
    // The server says 403 here: the session is fine, only the typed password isn't.
    expect(authErrorMessage("password", 403, { error: "Wrong.", code: "wrong_password" })).toMatch(/current password/);
    expect(authErrorMessage("login", 403, { error: "This account has been suspended.", code: "forbidden" })).toMatch(
      /suspended/,
    );
    expect(authErrorMessage("login", 403, { code: "age_locked" })).toMatch(/locked/);
    expect(authErrorMessage("login", 403, { code: "banned" })).toMatch(/suspended/);
  });

  it("passes the server's own words through for a bad request", () => {
    expect(authErrorMessage("signup", 400, { error: "Pick a different username.", code: "blocked_name" })).toBe(
      "Pick a different username.",
    );
  });
});

describe("authErrorField", () => {
  it("puts server errors on the field they're about", () => {
    expect(authErrorField("username_taken")).toBe("username");
    expect(authErrorField("invalid_username")).toBe("username");
    expect(authErrorField("weak_password")).toBe("password");
    expect(authErrorField("invalid_birth_date")).toBe("birthDate");
    expect(authErrorField("invalid_credentials")).toBeNull();
    expect(authErrorField(undefined)).toBeNull();
  });
});

describe("ageLine", () => {
  const me = (overrides: Partial<Pick<Me, "ageVerified" | "explicitHold" | "ageStatus">>) => ({
    ageVerified: false,
    explicitHold: false,
    ageStatus: "none" as const,
    ...overrides,
  });

  // AGE-4: a sign-up date-of-birth confirmation has no ID check behind it, and
  // still counts.
  it("says confirmed for an attested adult with no ID check", () => {
    expect(ageLine(me({ ageVerified: true, ageStatus: "none" }))).toEqual({ label: "Age confirmed", tone: "ok" });
  });

  it("says paused for a held account, whatever the ID check says, with no way to unlock", () => {
    const line = ageLine(me({ explicitHold: true, ageStatus: "approved" }));
    expect(line).toEqual({ label: "Paused for review", tone: "hold" });
    expect(line.href).toBeUndefined();
  });

  it("asks unconfirmed accounts to confirm on /verify", () => {
    expect(ageLine(me({}))).toEqual({ label: "Confirm your age", tone: "todo", href: "/verify" });
    expect(ageLine(me({ ageStatus: "declined" })).href).toBe("/verify");
    expect(ageLine(me({ ageStatus: "pending" })).label).toBe("Checking your age");
  });
});

describe("wallet", () => {
  it("reads the wallet the server sends, when it sends one", () => {
    expect(walletOf(null)).toBeNull();
    expect(walletOf({ walletAddress: null } as unknown as Me)).toBeNull();
    expect(walletOf({ walletAddress: ADDRESS } as unknown as Me)).toBe(ADDRESS);
  });

  it("shortens an address for display", () => {
    expect(shortAddress(ADDRESS)).toBe("7xKX…gAsU");
    expect(shortAddress("short")).toBe("short");
  });
});
