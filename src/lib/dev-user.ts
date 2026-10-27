// Local-development sign-in when Privy isn't configured. The server ignores this
// cookie in production.

export const DEV_USER_COOKIE = "simulust-dev-user";

export function readDevUser() {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${DEV_USER_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export function writeDevUser(handle: string | null) {
  document.cookie = handle
    ? `${DEV_USER_COOKIE}=${encodeURIComponent(handle)}; path=/; max-age=${60 * 60 * 24 * 30}; samesite=lax`
    : `${DEV_USER_COOKIE}=; path=/; max-age=0; samesite=lax`;
}
