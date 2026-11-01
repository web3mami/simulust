// Small formatting helpers for the chat screens.

import { studioPerson } from "@/lib/studio";

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

// "8:05 PM", under a message.
export function clockTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

// The local calendar day, so messages can be split by day.
export function dayKey(iso: string) {
  const date = new Date(iso);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

// "Today", "Yesterday", "Tuesday" within the week, then "Mar 4" (or "Mar 4, 2025").
export function dayLabel(iso: string, now = new Date()) {
  const date = new Date(iso);
  const startOf = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(date)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return date.toLocaleDateString("en-US", { weekday: "long" });
  return date.toLocaleDateString(
    "en-US",
    date.getFullYear() === now.getFullYear()
      ? { month: "short", day: "numeric" }
      : { month: "short", day: "numeric", year: "numeric" },
  );
}

// Where a message sits in a run from the same sender, which shapes its corners.
export type GroupPosition = "single" | "first" | "middle" | "last";

// Messages from the same sender within this long read as one burst.
const GROUP_GAP_MS = 5 * 60 * 1000;

type Groupable = { role: string; createdAt: string };

function sameGroup(a: Groupable | undefined, b: Groupable | undefined) {
  if (!a || !b || a.role !== b.role || a.role === "notice") return false;
  if (dayKey(a.createdAt) !== dayKey(b.createdAt)) return false;
  return Math.abs(new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()) <= GROUP_GAP_MS;
}

export function groupPositions(items: Groupable[]): GroupPosition[] {
  return items.map((item, index) => {
    const joinsPrevious = sameGroup(items[index - 1], item);
    const joinsNext = sameGroup(item, items[index + 1]);
    if (joinsPrevious && joinsNext) return "middle";
    if (joinsPrevious) return "last";
    if (joinsNext) return "first";
    return "single";
  });
}

// The last message before a pause (or the very last one) shows its time;
// inside a quick back-and-forth the times stay out of the way.
export function stampedAt(items: Groupable[]): boolean[] {
  return items.map((item, index) => {
    const next = items[index + 1];
    if (!next) return true;
    if (dayKey(next.createdAt) !== dayKey(item.createdAt)) return true;
    return new Date(next.createdAt).getTime() - new Date(item.createdAt).getTime() > GROUP_GAP_MS;
  });
}

// Tappable first lines for a brand-new chat. Fixed text, not model calls.
export const OPENERS = [
  "Hey you. How was your day?",
  "Tell me something nobody knows about you",
  "*sits next to you* What's the plan tonight?",
];

// Reply starters above the message box. They fill the draft rather than send,
// so they are only ever a nudge. Fixed text, picked by what just happened.
export function replyStarters(last: { role: string; hasPhoto: boolean } | null): string[] {
  if (!last) return ["Hi, I'm new here", "What are you up to?"];
  if (last.role === "assistant" && last.hasPhoto) return ["You look amazing", "Where was this taken?", "Send another?"];
  if (last.role === "assistant") return ["Tell me more", "*smiles* Go on…", "What are you wearing?"];
  // Their reply hasn't come: nothing to answer yet.
  return [];
}

export type PhotoIdea = { label: string; hint: string };

// Ideas for "Send me a photo". Each is passed to the photo endpoint as its hint,
// which runs the same safety checks as anything typed.
export const PHOTO_IDEAS: PhotoIdea[] = [
  { label: "A selfie, right now", hint: "a casual selfie right now" },
  { label: "Tonight's outfit", hint: "showing off tonight's outfit in a mirror" },
  { label: "At the beach", hint: "at the beach in the golden hour sun" },
  { label: "Getting ready for bed", hint: "getting ready for bed, soft lamp light" },
  { label: "After the gym", hint: "after a workout at the gym" },
];

// Quick actions for every confirmed adult: the whole site is uncensored, so
// there's nothing to turn on first. The photo endpoint screens these like
// anything typed, charges the same, and refuses photos altogether to a held or
// unconfirmed account (the server decides, not this list). Worded for who the
// character is (explicitPhotoIdeas); this is the list for a woman or anyone
// who isn't plainly a man, and the first idea is the same for everyone.
export const EXPLICIT_PHOTO_IDEAS: PhotoIdea[] = [
  { label: "Send me a nude", hint: "a nude photo, a sensual pose in soft bedroom light" },
  { label: "Topless", hint: "topless, a teasing look over one shoulder" },
  { label: "Lingerie", hint: "in lace lingerie on the bed, warm lamp light" },
  { label: "In the shower", hint: "nude in the shower, steam and wet skin" },
];

// A man's: shirtless rather than topless, underwear rather than lingerie.
export const EXPLICIT_PHOTO_IDEAS_MAN: PhotoIdea[] = [
  EXPLICIT_PHOTO_IDEAS[0],
  { label: "Shirtless", hint: "shirtless, a teasing look over one shoulder" },
  { label: "Underwear", hint: "in fitted boxer briefs on the bed, warm lamp light" },
  EXPLICIT_PHOTO_IDEAS[3],
];

// The explicit quick actions for a character, by their stored gender.
export function explicitPhotoIdeas(gender: string | null | undefined): PhotoIdea[] {
  return studioPerson(gender) === "man" ? EXPLICIT_PHOTO_IDEAS_MAN : EXPLICIT_PHOTO_IDEAS;
}

// The label to show while a photo from a known idea is being taken.
export function photoIdeaLabel(hint: string | null) {
  if (!hint) return null;
  return [...PHOTO_IDEAS, ...EXPLICIT_PHOTO_IDEAS, ...EXPLICIT_PHOTO_IDEAS_MAN].find((idea) => idea.hint === hint)?.label ?? null;
}
