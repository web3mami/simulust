import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, lt, ne } from "drizzle-orm";
import { db, type Tx } from "@/server/db";
import { sessions, users, type User } from "@/server/db/schema";
import { isProduction } from "@/server/env";

// Signed-in browsers. The cookie holds a random 32-byte token; the database
// keeps only its SHA-256, so a leaked table can't be replayed as a login.
export const SESSION_COOKIE = "simulust-session";
const MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function readCookie(request: Request, name: string) {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key !== name) continue;
    try {
      return decodeURIComponent(rest.join("="));
    } catch {
      return undefined;
    }
  }
  return undefined;
}

// The hash of this request's session token, if it carries a well-formed one.
export function sessionTokenHash(request: Request) {
  const token = readCookie(request, SESSION_COOKIE);
  return token && TOKEN.test(token) ? hashToken(token) : null;
}

export async function createSession(userId: string, outer?: Tx) {
  const token = randomBytes(32).toString("base64url");
  const database = outer ?? (await db());
  await database.insert(sessions).values({
    tokenHash: hashToken(token),
    userId,
    expiresAt: new Date(Date.now() + MAX_AGE_SECONDS * 1000),
  });
  return token;
}

// The account behind this request's session, or null when there's no session
// or it has expired.
export async function readSession(request: Request): Promise<{ tokenHash: string; user: User } | null> {
  const tokenHash = sessionTokenHash(request);
  if (!tokenHash) return null;
  const database = await db();
  const [row] = await database
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, new Date())))
    .limit(1);
  return row ? { tokenHash, user: row.user } : null;
}

export async function deleteSession(tokenHash: string, outer?: Tx) {
  const database = outer ?? (await db());
  await database.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
}

// Signs the account out everywhere, except the browser making the change when
// its session is given.
export async function deleteUserSessions(userId: string, exceptTokenHash?: string | null, outer?: Tx) {
  const database = outer ?? (await db());
  await database
    .delete(sessions)
    .where(and(eq(sessions.userId, userId), exceptTokenHash ? ne(sessions.tokenHash, exceptTokenHash) : undefined));
}

// Expired rows do nothing but take space; the reconcile cron can call this.
export async function pruneSessions() {
  const database = await db();
  const removed = await database
    .delete(sessions)
    .where(lt(sessions.expiresAt, new Date()))
    .returning({ tokenHash: sessions.tokenHash });
  return removed.length;
}

// httpOnly so page scripts can't read it, SameSite=Lax so other sites can't
// send it with a form post, Secure wherever there's https.
function serialize(name: string, value: string, maxAge: number) {
  return [`${name}=${value}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAge}`]
    .concat(isProduction ? ["Secure"] : [])
    .join("; ");
}

export function setSessionCookie<T extends Response>(response: T, token: string): T {
  response.headers.append("Set-Cookie", serialize(SESSION_COOKIE, token, MAX_AGE_SECONDS));
  return response;
}

export function clearSessionCookie<T extends Response>(response: T): T {
  response.headers.append("Set-Cookie", serialize(SESSION_COOKIE, "", 0));
  return response;
}

// A browser that has seen an account on an explicit hold (the user said
// they're under 18) remembers it for a year, so an account signed up again
// from it starts on hold too (POST /api/auth/signup). The value is the held
// account's id, for the review to name; it's httpOnly like the session.
export const HELD_COOKIE = "simulust-held";
const HELD_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;
const USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The age gate's own mark on a device that gave it an under-18 date of birth.
// The page sets it (it isn't httpOnly), so it's a signal, not a proof: it only
// ever takes something away.
export const AGE_REFUSED_COOKIE = "simulust-age-refused";

// The held account this browser remembers, if any.
export function heldAccountOf(request: Request) {
  const id = readCookie(request, HELD_COOKIE);
  return id && USER_ID.test(id) ? id.toLowerCase() : null;
}

export function deviceRefused(request: Request) {
  return readCookie(request, AGE_REFUSED_COOKIE) === "1";
}

// Keeps the held mark in step with an account the server has just seen: set
// (or renewed) while it's on hold, and cleared once a review lifts the hold
// on the very account it names. Another account's mark is left alone.
export function syncHeldCookie<T extends Response>(
  request: Request,
  response: T,
  user: Pick<User, "id" | "explicitHoldAt"> | null,
): T {
  if (!user) return response;
  if (user.explicitHoldAt) {
    response.headers.append("Set-Cookie", serialize(HELD_COOKIE, user.id, HELD_MAX_AGE_SECONDS));
  } else if (heldAccountOf(request) === user.id.toLowerCase()) {
    response.headers.append("Set-Cookie", serialize(HELD_COOKIE, "", 0));
  }
  return response;
}
