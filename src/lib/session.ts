import type { Me } from "@/lib/api-types";

// Who's signed in, as the app shows it. It comes from /api/me: there's one kind
// of account, a username and password (plus dev accounts in local development).
export type Session = {
  // The name in the top bar and menus.
  display: string;
  // "@username", or the account id for dev accounts. Pages also use it as a
  // per-account cache key, so it never changes while the same account is in.
  detail: string;
};

export function sessionFromMe(me: Pick<Me, "id" | "displayName" | "username">): Session {
  const named = me.displayName && me.displayName !== "You" ? me.displayName : null;
  return {
    display: named ?? me.username ?? "You",
    detail: me.username ? `@${me.username}` : me.id,
  };
}

/* Usernames and passwords: the same rules the server checks. */

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 24;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

// Usernames are case-insensitive, so they're sent (and kept) in lower case.
export function normalizeUsername(value: string) {
  return value.trim().toLowerCase();
}

export function usernameProblem(value: string): string | null {
  const name = normalizeUsername(value);
  if (!name) return "Choose a username.";
  if (name.length < USERNAME_MIN || name.length > USERNAME_MAX) {
    return `Use ${USERNAME_MIN} to ${USERNAME_MAX} characters.`;
  }
  if (!/^[a-z0-9_]+$/.test(name)) return "Use only letters, numbers and underscores.";
  return null;
}

export function passwordProblem(value: string): string | null {
  if (value.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (value.length > PASSWORD_MAX) return `Use ${PASSWORD_MAX} characters or fewer.`;
  return null;
}

/* What an account request's failure means to the person */

export type AuthAction = "login" | "signup" | "recover" | "password";

// Which field a server error belongs to, by its code; anything else is about
// the whole form.
export function authErrorField(code: string | undefined): "username" | "password" | "birthDate" | null {
  if (code === "username_taken" || code === "invalid_username") return "username";
  if (code === "weak_password" || code === "wrong_password") return "password";
  if (code === "invalid_birth_date") return "birthDate";
  return null;
}

// status null: the request never reached the server.
export function authErrorMessage(
  action: AuthAction,
  status: number | null,
  body: { error?: string; code?: string } | null,
): string {
  if (status === null) return "We couldn't reach Simulust. Check your connection and try again.";
  if (status === 429) return "Too many tries. Wait a few minutes, then try again.";
  if (body?.code === "username_taken" || (action === "signup" && status === 409)) {
    return "That username is taken. Try another.";
  }
  if (body?.code === "wrong_password" || (action === "password" && status === 401)) {
    return "Your current password isn't right.";
  }
  if (status === 401) {
    if (action === "login") return "That username and password don't match. Check both and try again.";
    if (action === "recover") return "That username and recovery code don't match. Check the code and try again.";
  }
  if (status === 403) {
    if (body?.code === "under_18") return "Simulust is only for adults.";
    if (body?.code === "age_locked") {
      return "This account is locked while we review an age check. If that's wrong, contact support through the report page.";
    }
    // A ban (the plain "forbidden" code); anything more specific says itself.
    if (!body?.code || body.code === "forbidden" || !body.error) {
      return "This account has been suspended. To appeal, contact support through the report page.";
    }
  }
  if (body?.error) return body.error;
  return "Something went wrong. Try again.";
}

/* The age line on the account menu, profile and settings */

export type AgeLine = {
  label: string;
  // ok: everything's open. hold: paused for review. todo: needs confirming.
  tone: "ok" | "hold" | "todo" | "pending";
  // Where to confirm it, when there's something to do.
  href?: string;
};

// From what explicit content needs (me.ageVerified) and the hold, never the
// ID-check status alone: an account that confirmed its date of birth at sign-up
// has no ID check and is still an adult here.
export function ageLine(me: Pick<Me, "ageVerified" | "explicitHold" | "ageStatus">): AgeLine {
  if (me.explicitHold) return { label: "Paused for review", tone: "hold" };
  if (me.ageVerified) return { label: "Age confirmed", tone: "ok" };
  if (me.ageStatus === "pending") return { label: "Checking your age", tone: "pending", href: "/verify" };
  return { label: "Confirm your age", tone: "todo", href: "/verify" };
}

/* Wallet */

// The Solana wallet the server has on the account, when it sends one.
export function walletOf(me: Me | null): string | null {
  const value = (me as (Me & { walletAddress?: unknown }) | null)?.walletAddress;
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function shortAddress(address: string) {
  return address.length > 12 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address;
}
