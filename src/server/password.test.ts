import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  DUMMY_PASSWORD_HASH,
  hashPassword,
  needsRehash,
  newRecoveryCode,
  normalizeUsername,
  passwordProblem,
  recoveryCodeHash,
  recoveryCodeMatches,
  usernameProblem,
  verifyPassword,
} from "@/server/password";

describe("passwords", () => {
  it("hashes with scrypt and a fresh salt, and verifies", async () => {
    const hash = await hashPassword("velvet midnight");
    expect(hash).toMatch(/^scrypt\$32768\$8\$1\$[A-Za-z0-9+/]{22}==\$[A-Za-z0-9+/]{86}==$/);
    expect(hash).not.toContain("velvet");
    expect(await hashPassword("velvet midnight")).not.toBe(hash);
    expect(await verifyPassword("velvet midnight", hash)).toBe(true);
    expect(await verifyPassword("velvet midnighT", hash)).toBe(false);
    expect(needsRehash(hash)).toBe(false);
  });

  it("treats the same text in another Unicode form as the same password", async () => {
    const hash = await hashPassword("café au lait");
    expect(await verifyPassword("café au lait", hash)).toBe(true);
  });

  it("refuses malformed or oversized hashes without running them", async () => {
    for (const encoded of ["", "bcrypt$x", "scrypt$1048576$8$1$c2FsdA==$aGFzaA==", "scrypt$32768$8$1$c2FsdA==$aGk="]) {
      expect(await verifyPassword("anything", encoded)).toBe(false);
    }
    expect(needsRehash("scrypt$16384$8$1$GU3C2bP6h94y/SSPshHIRA==$" + "A".repeat(86) + "==")).toBe(true);
  });

  it("has a dummy hash that's a real one nobody can match", async () => {
    expect(needsRehash(DUMMY_PASSWORD_HASH)).toBe(false);
    expect(await verifyPassword("", DUMMY_PASSWORD_HASH)).toBe(false);
    expect(await verifyPassword("password", DUMMY_PASSWORD_HASH)).toBe(false);
  });

  it("asks for 8 to 128 characters, not the username, not a common one", () => {
    expect(passwordProblem("short1", "kate")).toMatch(/at least 8/);
    expect(passwordProblem("x".repeat(129) + "y", "kate")).toMatch(/128/);
    expect(passwordProblem("Kate_1990", "kate_1990")).toMatch(/username/);
    for (const common of ["password", "Password1", "12345678", "qwertyuiop", "iloveyou", "zzzzzzzzzz"]) {
      expect(passwordProblem(common, "kate"), common).toMatch(/too easy/);
    }
    expect(passwordProblem("slow burn in the rain", "kate")).toBeNull();
    // Counted in characters, not UTF-16 units.
    expect(passwordProblem("\u{1F525}\u{1F319}\u{1F377}\u{1F339}\u{1F4AB}\u{1F48B}\u{1F5A4}", "kate")).toMatch(/at least 8/);
    expect(passwordProblem("\u{1F525}\u{1F319}\u{1F377}\u{1F339}\u{1F4AB}\u{1F48B}\u{1F5A4}\u{1F3AD}", "kate")).toBeNull();
  });
});

describe("usernames", () => {
  it("takes 3 to 24 ASCII letters, digits and underscores, stored lowercase", () => {
    expect(usernameProblem("Kate_1990")).toBeNull();
    expect(normalizeUsername("  Kate_1990 ")).toBe("kate_1990");
    for (const name of ["ka", "k".repeat(25), "kate smith", "kate-smith", "kate.s", "käte", "Kate"]) {
      expect(usernameProblem(name), name).toMatch(/3 to 24/);
    }
  });

  it("keeps staff-like names for the team", () => {
    for (const name of ["admin", "Administrator", "admin2", "simulust", "SimulustFan", "support", "support_team", "mod", "official_kate", "null", "undefined", "root", "system", "security"]) {
      expect(usernameProblem(name), name).toMatch(/reserved/);
    }
  });

  it("holds names to the chat blocklist", () => {
    expect(usernameProblem("schoolgirl_14")).toBe("Pick a different username.");
  });
});

describe("recovery codes", () => {
  it("are 20 base32 characters in groups of five", () => {
    const code = newRecoveryCode();
    expect(code).toMatch(/^[A-Z2-7]{5}-[A-Z2-7]{5}-[A-Z2-7]{5}-[A-Z2-7]{5}$/);
    expect(newRecoveryCode()).not.toBe(code);
  });

  it("store only a SHA-256 of the code, however it's typed", () => {
    const code = "ABCDE-FGHIJ-KLMNO-PQRS7";
    const hash = createHash("sha256").update("ABCDEFGHIJKLMNOPQRS7").digest("hex");
    expect(recoveryCodeHash(code)).toBe(hash);
    expect(recoveryCodeHash(" abcde fghij klmno pqrs7 ")).toBe(hash);
    // Digits typed for the letters they look like.
    expect(recoveryCodeHash("ABCDE-FGH1J-KLMN0-PQRS7")).toBe(hash);
    expect(recoveryCodeMatches("abcdefghijklmnopqrs7", hash)).toBe(true);
  });

  it("never match a wrong, malformed or missing code", () => {
    const hash = recoveryCodeHash("ABCDE-FGHIJ-KLMNO-PQRS7");
    expect(recoveryCodeMatches("ABCDE-FGHIJ-KLMNO-PQRS6", hash)).toBe(false);
    expect(recoveryCodeMatches("ABCDE", hash)).toBe(false);
    expect(recoveryCodeMatches("ABCDE-FGHIJ-KLMNO-PQRS7", null)).toBe(false);
    expect(recoveryCodeHash("ABCDE-FGHIJ-KLMNO-PQRS!")).toBeNull();
  });
});
