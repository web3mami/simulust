import "server-only";
import { createHash, randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { asName, checkText } from "@/server/safety/text";

// Passwords are hashed with scrypt: slow and memory-hard, so a leaked table is
// expensive to guess through. Stored as "scrypt$N$r$p$salt$hash" (base64), so
// the cost can be raised later without breaking older hashes.
const COST = { N: 32768, r: 8, p: 1 };
const KEY_BYTES = 64;
const SALT_BYTES = 16;
// N=32768, r=8 needs 32 MiB, exactly Node's default ceiling, so it's raised.
const MAXMEM = 64 * 1024 * 1024;

function derive(password: string, salt: Buffer, length: number, options: ScryptOptions) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password.normalize("NFKC"), salt, length, { ...options, maxmem: MAXMEM }, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

export async function hashPassword(password: string) {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, KEY_BYTES, COST);
  return ["scrypt", COST.N, COST.r, COST.p, salt.toString("base64"), key.toString("base64")].join("$");
}

// Only costs this server could have written: anything bigger in the table is
// tampering, and would tie up the thread pool.
function parse(encoded: string) {
  const [scheme, n, r, p, salt, hash] = encoded.split("$");
  if (scheme !== "scrypt" || hash === undefined) return null;
  const cost = { N: Number(n), r: Number(r), p: Number(p) };
  const powerOfTwo = Number.isInteger(cost.N) && cost.N >= 1024 && cost.N <= 131072 && (cost.N & (cost.N - 1)) === 0;
  if (!powerOfTwo || !Number.isInteger(cost.r) || cost.r < 1 || cost.r > 16) return null;
  if (!Number.isInteger(cost.p) || cost.p < 1 || cost.p > 4 || 128 * cost.N * cost.r * cost.p > MAXMEM) return null;
  const key = Buffer.from(hash, "base64");
  if (key.length < 16 || key.length > 128) return null;
  return { cost, salt: Buffer.from(salt, "base64"), key };
}

export async function verifyPassword(password: string, encoded: string) {
  const stored = parse(encoded);
  if (!stored) return false;
  const key = await derive(password, stored.salt, stored.key.length, stored.cost);
  return timingSafeEqual(key, stored.key);
}

// A hash made with a lower cost than today's, to be redone at the next login.
export function needsRehash(encoded: string) {
  const stored = parse(encoded);
  return !stored || stored.cost.N < COST.N || stored.cost.r < COST.r || stored.key.length < KEY_BYTES;
}

// Checked when the username doesn't exist or has no password, so a wrong
// username takes as long to refuse as a wrong password. A real scrypt hash of
// a random string nobody knows.
export const DUMMY_PASSWORD_HASH =
  "scrypt$32768$8$1$GU3C2bP6h94y/SSPshHIRA==$pqrnhgz24Yi8X9EooFMW15B9viexK11YYduwpTTzlF1YD81/uAucbwnmMlRQhbQNqNkE42PsfCq6YjQuI/Yo6w==";

// The most common passwords in breach lists that pass the length rule.
const COMMON = new Set([
  "password", "password1", "password12", "password123", "password1234", "passw0rd", "p@ssw0rd", "pass1234",
  "12345678", "123456789", "1234567890", "0123456789", "12341234", "123123123", "987654321", "11111111",
  "00000000", "88888888", "11223344", "12121212", "qwertyui", "qwertyuiop", "qwerty123", "qwerty12",
  "1q2w3e4r", "1q2w3e4r5t", "1qaz2wsx", "zaq12wsx", "q1w2e3r4", "asdfghjk", "asdfasdf", "abcd1234",
  "abc12345", "abcdefgh", "iloveyou", "iloveyou1", "letmein1", "letmein123", "welcome1", "welcome123",
  "sunshine", "princess", "football", "baseball", "superman", "starwars", "whatever", "trustno1",
  "dragon123", "monkey123", "changeme", "computer", "internet", "michelle", "jennifer", "1234qwer",
  "admin123", "administrator", "simulust", "simulust1", "simulust123", "sexy1234", "loveyou1",
]);

// Why a password can't be used, in words for the form, or null when it's fine.
export function passwordProblem(password: string, username: string) {
  const length = [...password.normalize("NFKC")].length;
  if (length < 8) return "Use at least 8 characters for your password.";
  if (length > 128) return "Keep your password to 128 characters or fewer.";
  const lower = password.toLowerCase();
  if (lower === username.toLowerCase()) return "Your password can't be your username.";
  if (COMMON.has(lower) || /^(.)\1+$/u.test(password)) return "That password is too easy to guess. Try a longer phrase.";
  return null;
}

export const USERNAME = /^[a-z0-9_]{3,24}$/;

const RESERVED = new Set([
  "admin", "administrator", "simulust", "support", "help", "moderator", "mod", "mods", "root", "system",
  "official", "staff", "team", "security", "safety", "trust", "legal", "privacy", "abuse", "billing",
  "payments", "owner", "operator", "null", "undefined", "anonymous", "everyone", "nobody", "api", "www",
  "mail", "info", "contact", "dev", "test", "you",
]);

// The login name as stored: lowercase. Login and recovery look accounts up by it.
export function normalizeUsername(raw: string) {
  return raw.trim().toLowerCase();
}

// Why a username (as typed, trimmed) can't be used, or null when it's fine. Only
// ASCII letters, digits and underscores, checked before lowercasing so no
// look-alike letter can lowercase into someone else's name.
export function usernameProblem(typed: string) {
  if (!/^[A-Za-z0-9_]{3,24}$/.test(typed)) return "Use 3 to 24 letters, numbers or underscores for your username.";
  const name = typed.toLowerCase();
  const staffLike = name.startsWith("admin") || /^(official|staff|support|team|mod|moderator|security)_/.test(name);
  if (RESERVED.has(name) || name.includes("simulust") || staffLike) return "That username is reserved. Pick another.";
  // Shown across the app, so it's held to the same blocklist as chat (minors,
  // real people), locally: sign-up never waits on the classifier.
  if (!checkText(asName(name.replace(/_/g, " "))).ok) return "Pick a different username.";
  return null;
}

// Recovery codes stand in for a reset email. 20 base32 characters (100 bits),
// shown as XXXXX-XXXXX-XXXXX-XXXXX. Only a SHA-256 is stored; with this much
// randomness a fast hash is enough.
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function newRecoveryCode() {
  // 256 is a multiple of 32, so every character is equally likely.
  const chars = [...randomBytes(20)].map((byte) => BASE32[byte & 31]).join("");
  return chars.match(/.{5}/g)!.join("-");
}

// Upper case, without spaces or dashes, with the digits people type for the
// letters they look like (base32 has no 0, 1 or 8). null when it can't be a code.
function normalizeRecoveryCode(code: string) {
  const plain = code.toUpperCase().replace(/[\s-]/g, "").replace(/0/g, "O").replace(/1/g, "I").replace(/8/g, "B");
  return /^[A-Z2-7]{20}$/.test(plain) ? plain : null;
}

export function recoveryCodeHash(code: string) {
  const plain = normalizeRecoveryCode(code);
  return plain ? createHash("sha256").update(plain).digest("hex") : null;
}

// Compared in constant time, and compared even when there's nothing to match,
// so a missing account answers as fast as a wrong code.
export function recoveryCodeMatches(code: string, storedHash: string | null) {
  const given = recoveryCodeHash(code);
  const stored = storedHash && /^[0-9a-f]{64}$/.test(storedHash) ? storedHash : null;
  const equal = timingSafeEqual(Buffer.from(given ?? "0".repeat(64), "hex"), Buffer.from(stored ?? "f".repeat(64), "hex"));
  return equal && given !== null && stored !== null;
}
