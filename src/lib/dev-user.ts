// Local development: the server also accepts a dev handle from this cookie (or
// the x-dev-user header) when NODE_ENV isn't production. Nothing in the app sets
// it any more (everyone signs up with a username and password), but a cookie
// left from earlier is cleared on sign-out so it can't sign the browser back in.

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
