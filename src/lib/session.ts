export type Session = {
  provider: "google" | "wallet";
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
    if (parsed.provider !== "google" && parsed.provider !== "wallet") return null;
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
