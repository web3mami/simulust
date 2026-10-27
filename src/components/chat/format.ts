// Small formatting helpers for the chat screens.

// Where "Explore characters" buttons on the chat screens go.
export const EXPLORE_HREF = "/discover";

// "now", "5m", "3h", "Yesterday", "Tue", "Mar 4": short enough for a list row.
export function relativeTime(iso: string, now = Date.now()) {
  const then = new Date(iso);
  const seconds = Math.max(0, Math.round((now - then.getTime()) / 1000));
  if (seconds < 60) return "now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return then.toLocaleDateString("en-US", { weekday: "short" });
  const sameYear = then.getFullYear() === new Date(now).getFullYear();
  return then.toLocaleDateString(
    "en-US",
    sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" },
  );
}

// The report form takes a page link, a media id or a character id.
export function reportHref(target: string) {
  return `/report?target=${encodeURIComponent(target)}`;
}
