export type Session = {
  provider: "google" | "twitter" | "email" | "wallet";
  display: string;
  detail: string;
};

export const SESSION_KEY = "simulust-session";

export function readSession(): Session | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Session;
    if (
      parsed.provider !== "google" &&
      parsed.provider !== "twitter" &&
      parsed.provider !== "email" &&
      parsed.provider !== "wallet"
    ) {
      return null;
    }
    if (!parsed.display || !parsed.detail) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeSession(session: Session) {
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession() {
  window.localStorage.removeItem(SESSION_KEY);
}

export type PrivyLikeUser = {
  id: string;
  google?: { name?: string | null; email?: string | null; subject?: string | null } | null;
  twitter?: { name?: string | null; username?: string | null; subject?: string | null } | null;
  wallet?: { address?: string | null } | null;
  email?: { address?: string | null } | null;
  linkedAccounts?: Array<{
    type?: string;
    email?: string | null;
    name?: string | null;
    username?: string | null;
    address?: string | null;
    subject?: string | null;
  }> | null;
};

function linked(user: PrivyLikeUser, type: string) {
  return user.linkedAccounts?.find((account) => account.type === type);
}

export function sessionFromPrivyUser(user: PrivyLikeUser): Session {
  const google = user.google ?? linked(user, "google");
  if (google && (google.email || google.name || google.subject)) {
    return {
      provider: "google",
      display: google.name || google.email || "Google",
      detail: google.email || google.subject || user.id,
    };
  }

  const twitter = user.twitter ?? linked(user, "twitter");
  if (twitter && (twitter.username || twitter.name || twitter.subject)) {
    const handle = twitter.username ? `@${twitter.username}` : null;
    return {
      provider: "twitter",
      display: twitter.name || handle || "X",
      detail: handle || twitter.subject || user.id,
    };
  }

  const wallet = user.wallet ?? linked(user, "wallet");
  if (wallet?.address) {
    return {
      provider: "wallet",
      display: `${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}`,
      detail: wallet.address,
    };
  }

  const email = user.email ?? linked(user, "email");
  if (email?.address || email?.email) {
    const address = email.address || email.email || "";
    return {
      provider: "email",
      display: address,
      detail: address,
    };
  }

  return {
    provider: "wallet",
    display: "Account",
    detail: user.id,
  };
}
