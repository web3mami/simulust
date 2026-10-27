import "server-only";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, ne, sql } from "drizzle-orm";
import { CRISIS_NOTICE } from "@/server/crisis";
import { db } from "@/server/db";
import { media, memories, messages, threads, type Memory, type Message, type Thread } from "@/server/db/schema";
import { features } from "@/server/env";
import { complete, embed } from "@/server/llm";
import { moderateText, type ModerationContext } from "@/server/safety/moderation";
import { checkText, detectCrisis, normalize, recentYears } from "@/server/safety/text";
import type { MemoryDTO } from "@/lib/api-types";

// Long-term memory has three layers, all kept in our own database so explicit
// chat never goes to a memory vendor:
// 1. the recent conversation, verbatim;
// 2. a rolling summary of everything older (threads.summary);
// 3. short facts about the user, extracted after each reply, which the user can
//    see, edit, pin and delete on /memories/[characterId].
// Every model call here may return "" or "{}" (the dev stand-in, or a provider
// hiccup); that must leave memory unchanged, never broken.

export const RECENT_WINDOW = 24;
// Older messages are folded into the summary once more than this many pile up.
export const SUMMARY_TRIGGER = 30;
// Until they are summarized, older messages stay verbatim in the prompt so
// nothing falls into a gap between the summary and the recent window. This caps
// that when summarizing falls behind.
const MAX_VERBATIM = RECENT_WINDOW + SUMMARY_TRIGGER + 6;
// The verbatim history is capped by size too: a run of long messages must not
// push the prompt past the model's context, or every turn would fail and the
// summary, which only advances after a turn, would never catch up. The newest
// message (the one being answered) is always whole; older ones are clipped.
const HISTORY_CHAR_BUDGET = 24_000;
const OLDER_MESSAGE_CHARS = 1_500;
const SUMMARY_MAX_BATCH = 120;
const SUMMARY_MAX_CHARS = 24_000;
export const MEMORY_CAP = 200;
// Pinned memories go into every prompt, so they need a ceiling of their own.
export const PINNED_CAP = 40;
// Boundaries also go into every prompt, with a separate ceiling so pinning
// can never push one out.
const BOUNDARY_CAP = 40;
const RELEVANT_K = 8;
// Memories saved while embeddings were down have no vector, so similarity
// search can't find them; the newest few ride along until they get one.
const UNEMBEDDED_K = 4;
const RECENT_FALLBACK = 12;
const MAX_OPS_PER_TURN = 12;
export const MAX_MEMORY_LENGTH = 280;
// Memory works without embeddings (recency and pinned facts), so it waits 10 s
// for one, not the 30 s llm.ts allows: that keeps the chat route inside its
// maxDuration when every call is slow.
const EMBED_TIMEOUT_MS = 10_000;
// A crisis rarely ends with the message that set off detection ("the pills are
// on my desk"), so the next few turns stay out of memory too: this many more
// user messages, and the replies to them.
export const CRISIS_TURNS = 3;

export type MemoryKind = Memory["kind"];
const KINDS: readonly MemoryKind[] = ["fact", "preference", "event", "boundary"];

// Everything but the 1024-float embedding, which only the database needs.
const columns = {
  id: memories.id,
  userId: memories.userId,
  characterId: memories.characterId,
  kind: memories.kind,
  content: memories.content,
  sourceMessageId: memories.sourceMessageId,
  pinned: memories.pinned,
  createdAt: memories.createdAt,
  updatedAt: memories.updatedAt,
};
export type MemoryRow = Omit<Memory, "embedding">;

export type TranscriptMessage = Pick<Message, "id" | "role" | "content" | "createdAt"> & {
  mediaKind: "image" | "audio" | "video" | null;
};

export type MemoryContext = {
  summary: string;
  // Pinned memories and boundaries: always in the prompt.
  always: MemoryRow[];
  // The rest, chosen by similarity to the latest message (or recency).
  relevant: MemoryRow[];
  recent: TranscriptMessage[];
};

type ThreadRef = Pick<Thread, "id" | "userId" | "characterId" | "summary" | "summarizedCount">;

function clip(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

const owner = (userId: string, characterId: string) =>
  and(eq(memories.userId, userId), eq(memories.characterId, characterId));

const conversational = (threadId: string) =>
  and(eq(messages.threadId, threadId), inArray(messages.role, ["user", "assistant"]));

export function toMemoryDTO(row: MemoryRow): MemoryDTO {
  return {
    id: row.id,
    characterId: row.characterId,
    kind: row.kind,
    content: row.content,
    pinned: row.pinned,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function cleanMemoryText(text: string) {
  return text.replace(/\s+/g, " ").trim().slice(0, MAX_MEMORY_LENGTH);
}

// Self-harm the way extracted facts put it, in the third person ("Cut their
// wrists last night."); detectCrisis catches the rest ("Has felt suicidal").
const SELF_HARM_FACT =
  /\b(?:cut|cuts|cutting|slit|slits|slitting|slash|slashed|slashing) (?:their|his|her|my) wrists?\b|\b(?:kill|kills|killed|killing|hurt|hurts|hurting|harm|harms|harmed|harming|cut|cuts|cutting|hang|hanged|hanging|starve|starved|starving) (?:themselves|themself|himself|herself)\b/;

// Facts have no subject ("Is 15.", "Turns 16 soon.", "Age: 15", "Is a junior in
// high school."), which the blocklist's age patterns, written for chat, don't
// read as anyone's age. A false hit ("Anniversary is 12 June.") costs one memory.
const UNDER_18 = "(?:[1-9]|1[0-7]|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen)";
const YEARS_OLD = String.raw`\b${UNDER_18}(?:\s\d/\d)?\s?-?\s?(?:y/?o|y\.o|(?:yrs?|years?)\s?-?\s?(?:old|young))\b`;
const SCHOOL = String.raw`(?:high|middle|elementary|junior high|jr\.? high|grade|secondary|prep|primary)`;
// Where a school name ends: "Attends Lincoln High.", not "High Point University".
const SCHOOL_ENDS = String.raw`(?:[ -]?school)?(?=\s?(?:$|[.,;!]|(?:and|in|this|next|with|now)\b))`;
const MINOR_FACT = [
  // "Is 15.", "Is 12yo.", "Is 13½." (read as "13 1/2"), but not "Is 6 1/2 feet tall."
  /\b(?:is|was|be|turns?|turned|turning|age|aged)\b[\s:]*(?:(?:only|just|about|around|almost|nearly|barely|now|still|not even) )?(?:[1-9]|1[0-7]|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen)\b(?!\s?(?:['"]|[:.,/]\d|%|(?:-|to|or) ?\d|(?:\d\/\d\s?)?(?:minutes?|mins?|hours?|hrs?|days?|weeks?|months?|miles?|km|feet|foot|ft|inch(?:es)?|cm|kg|lbs?|pounds?|stone|percent|times|o'clock|am|pm)\b))/,
  /\b(?:freshman|sophomore|junior|senior|student|pupil) (?:in|at) (?:a |the )?(?:[a-z]+ ){0,2}?(?:high[ -]?school|middle[ -]?school|junior[ -]?high|secondary school|hs|high(?=\s?(?:$|[.,;!])))\b/,
  /\b(?:high[ -]?school|middle[ -]?school|junior[ -]?high|hs) (?:freshman|sophomore|junior|senior|student|pupil)\b/,
  /\bin year (?:[1-9]|1[0-3])\b/,
  // "Is in high school.", "Is still in school.", "Goes to Lincoln High.", "Attends
  // Lincoln High.", "Started high school this year.", "Will graduate high school
  // in 2030.", "Is a year 9 student.", but not "Is in school for nursing."
  new RegExp(String.raw`\bis (?:still |currently )?in (?:${SCHOOL}[ -]?school|junior[ -]?high|hs|elementary|school)\b(?! (?:for|to become|part[ -]?time|online|again)\b)`),
  /\bstill in (?:school|class)\b(?! (?:for|to become)\b)/,
  new RegExp(String.raw`\b(?:goes|go|going|attends?|attending) (?:to )?(?:a |the )?(?:[a-z]+ ){0,2}?${SCHOOL}${SCHOOL_ENDS}`),
  new RegExp(String.raw`\bstart(?:s|ed|ing)? ${SCHOOL}[ -]?school\b`),
  /\b(?:will|going to|gonna|plans to|about to) graduate (?:from )?(?:high|middle)[ -]?school\b/,
  /\ban? (?:year|yr|grade) (?:[1-9]|1[0-3]) (?:student|pupil)\b(?! (?:at|in) (?:uni|university|college)\b)/,
  /\bcurfew\b[^.]{0,40}\b(?:parents?|mom|dad|mum|mother|father)\b|\b(?:parents?|mom|dad|mum|mother|father)(?:'s)? curfew\b/,
  // "Is a minor.", "Is legally a child.", "Is not an adult yet.", but not "Is a
  // minor league umpire." or "Is a kid at heart."
  /\bis (?:(?:still|just|only|legally|technically|basically) )?an? minor(?=\s?(?:$|[.,;!]|(?:and|but|so|who|in|at|under)\b))/,
  /\bis (?:(?:still|just|only|legally|technically|basically) )?(?:an? )?(?:child|kid)(?=\s?(?:$|[.,;!]|(?:and|but|so|who)\b))/,
  /\bis (?:still )?not (?:yet |even )?(?:an? )?adult(?:\s?yet)?(?=\s?(?:$|[.,;!]|(?:yet|and|but)\b))/,
  // "Was born in 2012.", "Birthday is May 3, 2011.", in one of the last 18 years
  new RegExp(String.raw`(?:^|\b(?:was|is) )born (?:in |on |back in )?(?:[a-z]+ (?:\d{1,2}(?:st|nd|rd|th)?,? )?)?(?:${recentYears()})\b`),
  new RegExp(String.raw`\bbirthday (?:is |was |: ?)?(?:on )?(?:[a-z]+ \d{1,2}(?:st|nd|rd|th)?,? |\d{1,2}(?:st|nd|rd|th)? [a-z]+,? )?(?:${recentYears()})\b`),
  // An age as what the user is, looks like or wants to be called ("Is a 15 year
  // old girl.", "like a 12 year old", "Has a ten year old body."), but not a
  // parent's "proud 5 year old's mom".
  new RegExp(String.raw`\b(?:is|like|as|be|being|called|treated as|pretends? to be|pretending to be) (?:an? |her |his |their |your )?(?:[a-z]+ ){0,2}?${YEARS_OLD}(?!'s|s'|\s?(?:mom|mum|mother|dad|father|parent|son|daughter|kid|child|twins?|dog|cat|car)\b)`),
  new RegExp(String.raw`${YEARS_OLD}(?:'s)? (?:[a-z]+ )?(?:body|figure|frame|face|build|chest|looks?)\b`),
];

function keptOut(text: string) {
  // normalize reads digits inside a word as letters, so "12yo" is split first.
  const plain = normalize(text.replace(/(\d)(?=(?:y\/?o|y\.o|yrs?)\b)/gi, "$1 "));
  return detectCrisis(text) || SELF_HARM_FACT.test(plain) || MINOR_FACT.some((pattern) => pattern.test(plain));
}

// Summaries and extracted memories are model output that lands in every later
// prompt, so they get the full check and fail closed, under the memory policy:
// self-harm stays out (health details aren't remembered, though talking about
// them is fine). Local hits are dropped quietly, since some are innocent (see
// MINOR_FACT); moderateText logs what the classifier blocks and when it can't
// answer. An answer it can't read counts as a block, not an outage.
async function screen(text: string, context: ModerationContext): Promise<"ok" | "blocked" | "unavailable"> {
  if (!checkText(text).ok || keptOut(text)) return "blocked";
  const verdict = await moderateText(text, context, { failClosed: true, policy: "memory" });
  if (verdict.ok) return "ok";
  return "unavailable" in verdict && !verdict.unreadable ? "unavailable" : "blocked";
}

// Embeddings with a short timeout; null when it runs out, like any other failure.
async function embedWithin(texts: string[]) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), EMBED_TIMEOUT_MS);
  });
  try {
    return await Promise.race([embed(texts), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Reading memory for a prompt

async function countConversational(threadId: string) {
  const database = await db();
  const [row] = await database
    .select({ total: sql<number>`count(*)::int` })
    .from(messages)
    .where(conversational(threadId));
  return row?.total ?? 0;
}

// The verbatim part of the prompt, oldest first: at least the last 24 messages,
// plus anything older that the summary doesn't cover yet, within the size budget.
export async function recentMessages(thread: Pick<Thread, "id" | "summarizedCount">): Promise<TranscriptMessage[]> {
  const database = await db();
  const total = await countConversational(thread.id);
  const limit = Math.min(MAX_VERBATIM, Math.max(RECENT_WINDOW, total - thread.summarizedCount));
  const rows = await database
    .select({
      id: messages.id,
      role: messages.role,
      content: messages.content,
      createdAt: messages.createdAt,
      mediaKind: media.kind,
    })
    .from(messages)
    .leftJoin(media, eq(messages.mediaId, media.id))
    .where(conversational(thread.id))
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(limit);
  const kept: TranscriptMessage[] = [];
  let used = 0;
  for (const [index, row] of rows.entries()) {
    const content = index === 0 ? row.content : clip(row.content, OLDER_MESSAGE_CHARS);
    if (index > 0 && used + content.length > HISTORY_CHAR_BUDGET) break;
    used += content.length;
    kept.push({ ...row, content });
  }
  return kept.reverse();
}

export function vectorLiteral(vector: number[]) {
  return `[${vector.map((value) => (Number.isFinite(value) ? value : 0)).join(",")}]`;
}

// Closest unpinned memories by cosine distance (pgvector).
export async function nearestMemories(userId: string, characterId: string, vector: number[], k: number) {
  const database = await db();
  const distance = sql`${memories.embedding} <=> ${vectorLiteral(vector)}::vector`;
  return database
    .select(columns)
    .from(memories)
    .where(
      and(owner(userId, characterId), isNotNull(memories.embedding), eq(memories.pinned, false), ne(memories.kind, "boundary")),
    )
    .orderBy(distance)
    .limit(k);
}

async function alwaysMemories(userId: string, characterId: string) {
  const database = await db();
  const [boundaries, pinned] = await Promise.all([
    database
      .select(columns)
      .from(memories)
      .where(and(owner(userId, characterId), eq(memories.kind, "boundary")))
      .orderBy(desc(memories.updatedAt), desc(memories.id))
      .limit(BOUNDARY_CAP),
    database
      .select(columns)
      .from(memories)
      .where(and(owner(userId, characterId), eq(memories.pinned, true), ne(memories.kind, "boundary")))
      .orderBy(desc(memories.updatedAt), desc(memories.id))
      .limit(PINNED_CAP),
  ]);
  return [...boundaries, ...pinned];
}

async function unembeddedMemories(userId: string, characterId: string, limit: number) {
  const database = await db();
  return database
    .select(columns)
    .from(memories)
    .where(and(owner(userId, characterId), isNull(memories.embedding), eq(memories.pinned, false), ne(memories.kind, "boundary")))
    .orderBy(desc(memories.updatedAt), desc(memories.id))
    .limit(limit);
}

async function recentMemories(userId: string, characterId: string, limit: number) {
  const database = await db();
  return database
    .select(columns)
    .from(memories)
    .where(and(owner(userId, characterId), eq(memories.pinned, false), ne(memories.kind, "boundary")))
    .orderBy(desc(memories.updatedAt), desc(memories.id))
    .limit(limit);
}

async function embedOne(text: string) {
  if (!text.trim()) return null;
  try {
    return (await embedWithin([text.slice(0, 2000)]))?.[0] ?? null;
  } catch (error) {
    console.warn("Embedding failed; falling back to recent memories.", error);
    return null;
  }
}

export async function retrieveMemories(userId: string, characterId: string, query: string) {
  const always = await alwaysMemories(userId, characterId);
  const fallback = await recentMemories(userId, characterId, RECENT_FALLBACK);
  // Nothing beyond the always-on set: skip the embedding call entirely.
  if (fallback.length === 0) return { always, relevant: [] as MemoryRow[] };
  const vector = await embedOne(query);
  if (vector) {
    const nearest = await nearestMemories(userId, characterId, vector, RELEVANT_K);
    if (nearest.length) {
      const seen = new Set(nearest.map((row) => row.id));
      const unembedded = await unembeddedMemories(userId, characterId, UNEMBEDDED_K);
      return { always, relevant: [...nearest, ...unembedded.filter((row) => !seen.has(row.id))] };
    }
  }
  return { always, relevant: fallback };
}

export async function memoryContext(thread: ThreadRef, query: string): Promise<MemoryContext> {
  const [recent, { always, relevant }] = await Promise.all([
    recentMessages(thread),
    retrieveMemories(thread.userId, thread.characterId, query),
  ]);
  return { summary: thread.summary, always, relevant, recent };
}

// ---------------------------------------------------------------------------
// Rolling summary

function transcriptLine(message: TranscriptMessage, names: { user: string; character: string }) {
  const who = message.role === "user" ? names.user : names.character;
  const attachment =
    message.mediaKind === "image" ? " [sent a photo]" : message.mediaKind === "video" ? " [sent a video]" : "";
  return `${who}: ${message.content.replace(/\s+/g, " ").slice(0, 1000)}${attachment}`;
}

// Every crisis turn stores CRISIS_NOTICE, so a crisis is marked even when its
// message was refused and never saved.
const crisisNotices = (threadId: string) =>
  and(eq(messages.threadId, threadId), eq(messages.role, "notice"), eq(messages.content, CRISIS_NOTICE));

// Which messages, oldest first, fall in a crisis window. A crisis notice, or a
// user message detectCrisis flags, opens one; it covers the next CRISIS_TURNS
// user messages and the replies up to the one after them. `notices` holds the
// crisis notices' times, oldest first.
function crisisWindow(rows: Pick<TranscriptMessage, "role" | "content" | "createdAt">[], notices: Date[]) {
  let left = 0;
  let inside = false;
  let next = 0;
  return rows.map((row) => {
    for (; next < notices.length && notices[next] <= row.createdAt; next++) {
      left = CRISIS_TURNS;
      inside = true;
    }
    if (row.role !== "user") return inside;
    if (detectCrisis(row.content)) {
      left = CRISIS_TURNS;
      inside = true;
    } else {
      inside = left > 0;
      left = Math.max(0, left - 1);
    }
    return inside;
  });
}

// Folds messages older than the recent window into threads.summary once more
// than SUMMARY_TRIGGER of them are waiting. Returns true when it advanced.
export async function maybeSummarize(threadId: string, names: { user: string; character: string }) {
  const database = await db();
  const [thread] = await database.select().from(threads).where(eq(threads.id, threadId)).limit(1);
  if (!thread) return false;
  const total = await countConversational(thread.id);
  const pending = total - RECENT_WINDOW - thread.summarizedCount;
  if (pending <= SUMMARY_TRIGGER) return false;

  // Enough messages of lookbehind to know whether the batch opens inside a
  // crisis window that began in the last one.
  const lookbehind = Math.min(thread.summarizedCount, 2 * CRISIS_TURNS + 1);
  const rows = await database
    .select({
      id: messages.id,
      role: messages.role,
      content: messages.content,
      createdAt: messages.createdAt,
      mediaKind: media.kind,
    })
    .from(messages)
    .leftJoin(media, eq(messages.mediaId, media.id))
    .where(conversational(thread.id))
    .orderBy(asc(messages.createdAt), asc(messages.id))
    .offset(thread.summarizedCount - lookbehind)
    .limit(Math.min(pending, SUMMARY_MAX_BATCH) + lookbehind);
  if (rows.length <= lookbehind) return false;
  const [first, last] = [rows[0].createdAt, rows[rows.length - 1].createdAt];
  const [earlier, during] = await Promise.all([
    database
      .select({ at: messages.createdAt })
      .from(messages)
      .where(and(crisisNotices(thread.id), lt(messages.createdAt, first)))
      .orderBy(desc(messages.createdAt))
      .limit(1),
    database
      .select({ at: messages.createdAt })
      .from(messages)
      .where(and(crisisNotices(thread.id), gte(messages.createdAt, first), lte(messages.createdAt, last)))
      .orderBy(asc(messages.createdAt)),
  ]);
  const inCrisis = crisisWindow(rows, [...earlier, ...during].map((row) => row.at));

  // Self-harm disclosures are health data: crisis windows stay out of the
  // summary, though they count as summarized. The batch is capped by size too,
  // so a backlog of long messages can't overflow the utility model and fail the
  // same way on every turn.
  const lines: string[] = [];
  let taken = 0;
  let size = 0;
  for (const [index, message] of rows.entries()) {
    if (index < lookbehind) continue;
    if (!inCrisis[index]) {
      const line = transcriptLine(message, names);
      if (lines.length && size + line.length > SUMMARY_MAX_CHARS) break;
      lines.push(line);
      size += line.length;
    }
    taken += 1;
  }
  if (!taken) return false;

  // Guarded on summarizedCount so two overlapping runs can't double-advance, and
  // on the memory epoch so a "forget everything" during the call wins.
  const advance = async (summary: string) => {
    const [updated] = await database
      .update(threads)
      .set({ summary, summarizedCount: thread.summarizedCount + taken })
      .where(
        and(
          eq(threads.id, thread.id),
          eq(threads.summarizedCount, thread.summarizedCount),
          eq(threads.memoryEpoch, thread.memoryEpoch),
        ),
      )
      .returning({ id: threads.id });
    return Boolean(updated);
  };
  if (!lines.length) return advance(thread.summary);

  const raw = await complete(
    [
      {
        role: "system",
        content: `You keep the running memory of a long chat between ${names.user} and ${names.character}, a fictional adult companion character. Merge the new messages into the summary so far.
Keep what will matter later: facts about ${names.user}, how the relationship has developed, plans and promises, inside jokes, important emotional moments, preferences and boundaries, and where any ongoing story or scene left off. Drop small talk.
Leave out health details, including anything about self-harm or suicide.
Write plain third-person prose in the past tense, at most 250 words. Reply with the updated summary only.`,
      },
      {
        role: "user",
        content: `Summary so far:\n${thread.summary || "(nothing yet)"}\n\nNew messages:\n${lines.join("\n")}`,
      },
    ],
    { tier: "utility", temperature: 0.3, maxTokens: 600 },
  );
  const summary = raw.trim().slice(0, 4000);
  // Empty means the model gave us nothing (or this is the dev stand-in): try again next turn.
  if (!summary) return false;

  const verdict = await screen(summary, {
    userId: thread.userId,
    targetType: "message",
    targetId: thread.id,
    details: { source: "summary" },
  });
  // The check couldn't run: write nothing and try again next turn.
  if (verdict === "unavailable") return false;
  // A blocked summary is dropped, but the batch still counts as summarized:
  // the same messages would most likely be blocked again, paying for a retry on
  // every turn while the summary never moves.
  if (verdict === "blocked") console.warn(`Discarded a summary for thread ${thread.id} that failed the text check.`);
  return advance(verdict === "ok" ? summary : thread.summary);
}

// ---------------------------------------------------------------------------
// Fact extraction

export type MemoryOp =
  | { op: "add"; kind: MemoryKind; content: string }
  | { op: "update"; id: string; kind?: MemoryKind; content: string }
  | { op: "delete"; id: string };

function asKind(value: unknown): MemoryKind | undefined {
  return typeof value === "string" && (KINDS as readonly string[]).includes(value) ? (value as MemoryKind) : undefined;
}

// Tolerant parser for the utility model's JSON: accepts code fences, prose
// around the object, a bare array, and skips malformed ops.
export function parseOps(raw: string): MemoryOp[] {
  const text = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  let data: unknown;
  const objectStart = text.indexOf("{");
  const arrayStart = text.indexOf("[");
  try {
    if (arrayStart >= 0 && (objectStart < 0 || arrayStart < objectStart)) {
      data = { ops: JSON.parse(text.slice(arrayStart, text.lastIndexOf("]") + 1)) };
    } else if (objectStart >= 0) {
      data = JSON.parse(text.slice(objectStart, text.lastIndexOf("}") + 1));
    } else {
      return [];
    }
  } catch {
    return [];
  }
  const list = (data as { ops?: unknown })?.ops;
  if (!Array.isArray(list)) return [];

  const ops: MemoryOp[] = [];
  for (const item of list.slice(0, MAX_OPS_PER_TURN)) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    const op = typeof entry.op === "string" ? entry.op.toLowerCase() : "";
    const id = typeof entry.id === "string" ? entry.id.trim() : "";
    const content = typeof entry.content === "string" ? cleanMemoryText(entry.content) : "";
    if (op === "add" && content) ops.push({ op, kind: asKind(entry.kind) ?? "fact", content });
    else if (op === "update" && id && content) ops.push({ op, id, kind: asKind(entry.kind), content });
    else if (op === "delete" && id) ops.push({ op, id });
  }
  return ops;
}

// The existing memories the extractor reconciles against: all of them when
// there are few, otherwise the always-on set plus the most relevant and most
// recent ones.
async function reconciliationSet(userId: string, characterId: string, query: string) {
  const database = await db();
  const all = await database
    .select(columns)
    .from(memories)
    .where(owner(userId, characterId))
    .orderBy(desc(memories.updatedAt), desc(memories.id))
    .limit(81);
  if (all.length <= 80) return all;

  const picked = new Map<string, MemoryRow>();
  for (const row of await alwaysMemories(userId, characterId)) picked.set(row.id, row);
  const vector = await embedOne(query);
  if (vector) for (const row of await nearestMemories(userId, characterId, vector, 30)) picked.set(row.id, row);
  for (const row of all.slice(0, 30)) picked.set(row.id, row);
  return [...picked.values()];
}

export type TurnInput = {
  userId: string;
  characterId: string;
  userName: string;
  characterName: string;
  userText: string;
  replyText: string;
  sourceMessageId?: string | null;
  // threads.memoryEpoch when the turn began; a "forget everything" since then
  // means the turn's memories are dropped.
  memoryEpoch?: number;
};

const EXTRACT_SYSTEM = (userName: string, characterName: string) => `You maintain long-term memory for ${characterName}, a fictional companion character, about the user (${userName}).
Read the latest exchange and decide what is worth remembering for future conversations:
- fact: stable facts about ${userName} (name, work, city, pets, family, hobbies).
- preference: what ${userName} likes or dislikes, including how they like to be talked to.
- event: things that happened or are planned, including plans made together (include dates if given).
- boundary: things ${userName} does not want, or limits they set.
Rules:
- Only record what ${userName} said or clearly agreed to. Ignore ${characterName}'s own invented details unless ${userName} took them up.
- One short sentence each, third person, e.g. "Has a dog named Biscuit." or "Prefers being called Sam."
- Use update when new information changes an existing memory, and delete when ${userName} says it is no longer true or asks you to forget it.
- Do not duplicate existing memories. Most exchanges add nothing; that is fine.
- Never record: contact details, addresses, passwords, account or ID numbers, health or crisis details, or anything about minors or real people.
Reply with JSON only: {"ops":[{"op":"add","kind":"fact","content":"..."},{"op":"update","id":"m2","kind":"preference","content":"..."},{"op":"delete","id":"m3"}]}
Reply {"ops":[]} when there is nothing to change.`;

export type ExtractResult = { added: number; updated: number; deleted: number };

export async function extractMemories(input: TurnInput): Promise<ExtractResult> {
  const none = { added: 0, updated: 0, deleted: 0 };
  if (!input.userText.trim()) return none;

  const existing = await reconciliationSet(input.userId, input.characterId, input.userText);
  const aliases = new Map(existing.map((row, index) => [`m${index + 1}`, row]));
  const listing = existing.length
    ? existing.map((row, index) => `m${index + 1} [${row.kind}${row.pinned ? ", pinned" : ""}] ${row.content}`).join("\n")
    : "(none yet)";

  const raw = await complete(
    [
      { role: "system", content: EXTRACT_SYSTEM(input.userName, input.characterName) },
      {
        role: "user",
        content: `Existing memories:\n${listing}\n\nLatest exchange:\n${input.userName}: ${input.userText.slice(0, 4000)}\n${input.characterName}: ${
          input.replyText.slice(0, 2000) || "(no reply)"
        }`,
      },
    ],
    { tier: "utility", json: true, temperature: 0.2, maxTokens: 500 },
  );
  const ops = parseOps(raw);
  if (!ops.length) return none;
  return applyOps(input, ops, aliases);
}

// Applies extractor ops. Ids are the short aliases (m1, m2...) the model saw, so
// it can only touch memories it was shown. Pinned memories can be updated but
// never deleted by the model; only the user deletes those.
export async function applyOps(
  input: Pick<TurnInput, "userId" | "characterId" | "sourceMessageId" | "memoryEpoch">,
  ops: MemoryOp[],
  aliases: Map<string, MemoryRow>,
): Promise<ExtractResult> {
  const database = await db();
  const known = await database
    .select({ content: memories.content })
    .from(memories)
    .where(owner(input.userId, input.characterId));
  const seen = new Set(known.map((row) => row.content.toLowerCase()));

  const adds: { kind: MemoryKind; content: string }[] = [];
  const updates: { row: MemoryRow; kind: MemoryKind; content: string }[] = [];
  const deletes = new Set<string>();
  const touched = new Set<string>();

  for (const op of ops) {
    if (op.op === "add") {
      const key = op.content.toLowerCase();
      if (seen.has(key) || !checkText(op.content).ok) continue;
      seen.add(key);
      adds.push({ kind: op.kind, content: op.content });
    } else if (op.op === "update") {
      const row = aliases.get(op.id);
      if (!row || touched.has(row.id) || !checkText(op.content).ok) continue;
      const kind = op.kind ?? row.kind;
      if (op.content === row.content && kind === row.kind) continue;
      touched.add(row.id);
      updates.push({ row, kind, content: op.content });
    } else {
      const row = aliases.get(op.id);
      if (!row || row.pinned || touched.has(row.id)) continue;
      touched.add(row.id);
      deletes.add(row.id);
    }
  }

  // What passed the blocklist above still goes through the classifier, failing
  // closed: anything it blocks or can't check is not written.
  const context: ModerationContext = {
    userId: input.userId,
    targetType: "message",
    targetId: input.sourceMessageId ?? null,
    details: { source: "memory" },
  };
  const passed = await Promise.all([...adds, ...updates].map(async (item) => (await screen(item.content, context)) === "ok"));
  const addsKept = adds.filter((_, index) => passed[index]);
  const updatesKept = updates.filter((_, index) => passed[adds.length + index]);

  const texts = [...addsKept.map((item) => item.content), ...updatesKept.map((item) => item.content)];
  let vectors: number[][] | null = null;
  if (texts.length) {
    try {
      vectors = await embedWithin(texts);
    } catch (error) {
      console.warn("Embedding new memories failed; storing them without vectors.", error);
    }
  }

  // Checked last, after the slow calls, so a "forget everything" made while
  // they ran still wins.
  if (input.memoryEpoch !== undefined && (await currentEpoch(input.userId, input.characterId)) !== input.memoryEpoch) {
    return { added: 0, updated: 0, deleted: 0 };
  }
  if (addsKept.length) {
    await database.insert(memories).values(
      addsKept.map((item, index) => ({
        userId: input.userId,
        characterId: input.characterId,
        kind: item.kind,
        content: item.content,
        embedding: vectors?.[index] ?? null,
        sourceMessageId: input.sourceMessageId ?? null,
      })),
    );
  }
  for (const [index, item] of updatesKept.entries()) {
    await database
      .update(memories)
      .set({
        content: item.content,
        kind: item.kind,
        // A stale vector would point at the old content, so clear it when we can't re-embed.
        embedding: vectors?.[addsKept.length + index] ?? null,
        updatedAt: new Date(),
      })
      .where(and(eq(memories.id, item.row.id), owner(input.userId, input.characterId)));
  }
  if (deletes.size) {
    await database
      .delete(memories)
      .where(and(inArray(memories.id, [...deletes]), owner(input.userId, input.characterId), eq(memories.pinned, false)));
  }
  await enforceCap(input.userId, input.characterId);
  return { added: addsKept.length, updated: updatesKept.length, deleted: deletes.size };
}

async function currentEpoch(userId: string, characterId: string) {
  const database = await db();
  const [row] = await database
    .select({ epoch: threads.memoryEpoch })
    .from(threads)
    .where(and(eq(threads.userId, userId), eq(threads.characterId, characterId)))
    .limit(1);
  return row?.epoch ?? 0;
}

// Gives a vector to memories saved while embeddings were down. The content is
// part of the guard so an edit made meanwhile keeps its own vector.
export async function embedMissing(userId: string, characterId: string, limit = 20) {
  if (!features.embeddings) return 0;
  const database = await db();
  const rows = await database
    .select({ id: memories.id, content: memories.content })
    .from(memories)
    .where(and(owner(userId, characterId), isNull(memories.embedding)))
    .limit(limit);
  if (!rows.length) return 0;
  const vectors = await embed(rows.map((row) => row.content));
  if (!vectors) return 0;
  let count = 0;
  for (const [index, row] of rows.entries()) {
    const vector = vectors[index];
    if (!vector) continue;
    await database
      .update(memories)
      .set({ embedding: vector })
      .where(and(eq(memories.id, row.id), eq(memories.content, row.content)));
    count += 1;
  }
  return count;
}

// Keeps at most `cap` memories per user and character, dropping the least
// recently touched unpinned ones first.
export async function enforceCap(userId: string, characterId: string, cap = MEMORY_CAP) {
  const database = await db();
  const [pinned] = await database
    .select({ count: sql<number>`count(*)::int` })
    .from(memories)
    .where(and(owner(userId, characterId), eq(memories.pinned, true)));
  const keep = Math.max(0, cap - (pinned?.count ?? 0));
  const excess = await database
    .select({ id: memories.id })
    .from(memories)
    .where(and(owner(userId, characterId), eq(memories.pinned, false)))
    .orderBy(desc(memories.updatedAt), desc(memories.createdAt), desc(memories.id))
    .offset(keep);
  if (!excess.length) return 0;
  await database.delete(memories).where(inArray(memories.id, excess.map((row) => row.id)));
  return excess.length;
}

// Whether a user message falls in the window after a crisis (see CRISIS_TURNS).
export async function afterCrisis(threadId: string, messageId: string) {
  const database = await db();
  const [turn] = await database.select({ at: messages.createdAt }).from(messages).where(eq(messages.id, messageId)).limit(1);
  if (!turn) return false;
  const [previous, [notice]] = await Promise.all([
    database
      .select({ content: messages.content, at: messages.createdAt })
      .from(messages)
      .where(and(eq(messages.threadId, threadId), eq(messages.role, "user"), lt(messages.createdAt, turn.at)))
      .orderBy(desc(messages.createdAt), desc(messages.id))
      .limit(CRISIS_TURNS),
    database
      .select({ at: messages.createdAt })
      .from(messages)
      .where(and(crisisNotices(threadId), lt(messages.createdAt, turn.at)))
      .orderBy(desc(messages.createdAt))
      .limit(1),
  ]);
  if (previous.some((row) => detectCrisis(row.content))) return true;
  return notice !== undefined && previous.filter((row) => row.at > notice.at).length < CRISIS_TURNS;
}

// Runs after a reply has been sent (inside after()). Failures are logged and
// never reach the user.
export async function rememberTurn(input: TurnInput & { threadId: string; skipFacts?: boolean }) {
  const extract = async () => {
    if (input.sourceMessageId && (await afterCrisis(input.threadId, input.sourceMessageId))) return;
    await extractMemories(input);
  };
  const jobs: Promise<unknown>[] = [
    maybeSummarize(input.threadId, { user: input.userName, character: input.characterName }).catch((error) =>
      console.error("Summarizing thread failed", error),
    ),
  ];
  if (!input.skipFacts) {
    jobs.push(extract().catch((error) => console.error("Memory extraction failed", error)));
  }
  jobs.push(
    embedMissing(input.userId, input.characterId).catch((error) => console.error("Re-embedding memories failed", error)),
  );
  await Promise.all(jobs);
}

// ---------------------------------------------------------------------------
// The user's view: list, edit, pin, delete, forget everything

export async function listMemories(userId: string, characterId: string) {
  const database = await db();
  return database
    .select(columns)
    .from(memories)
    .where(owner(userId, characterId))
    .orderBy(desc(memories.pinned), desc(memories.updatedAt), desc(memories.id))
    .limit(MEMORY_CAP + PINNED_CAP);
}

export async function findMemory(userId: string, id: string) {
  const database = await db();
  const [row] = await database
    .select(columns)
    .from(memories)
    .where(and(eq(memories.id, id), eq(memories.userId, userId)))
    .limit(1);
  return row ?? null;
}

export async function countPinned(userId: string, characterId: string) {
  const database = await db();
  const [row] = await database
    .select({ count: sql<number>`count(*)::int` })
    .from(memories)
    .where(and(owner(userId, characterId), eq(memories.pinned, true)));
  return row?.count ?? 0;
}

// Content must already have passed moderation.
export async function editMemory(row: MemoryRow, changes: { content?: string; pinned?: boolean }) {
  const database = await db();
  const content = changes.content !== undefined ? cleanMemoryText(changes.content) : undefined;
  const contentChanged = content !== undefined && content !== row.content;
  let embedding: number[] | null | undefined;
  if (contentChanged) {
    try {
      embedding = (await embed([content]))?.[0] ?? null;
    } catch {
      embedding = null;
    }
  }
  const [updated] = await database
    .update(memories)
    .set({
      ...(contentChanged ? { content, embedding } : {}),
      ...(changes.pinned !== undefined ? { pinned: changes.pinned } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(memories.id, row.id), eq(memories.userId, row.userId)))
    .returning(columns);
  return updated ?? null;
}

export async function deleteMemory(userId: string, id: string) {
  const database = await db();
  const deleted = await database
    .delete(memories)
    .where(and(eq(memories.id, id), eq(memories.userId, userId)))
    .returning({ id: memories.id });
  return deleted.length > 0;
}

// Deletes every memory and the rolling summary for this character. The chat
// history stays, and the summary isn't rebuilt from it: summarizedCount keeps
// pointing past the forgotten messages. The epoch is bumped first, so memory
// work already running for an earlier turn finds it changed and writes nothing.
export async function forgetAll(userId: string, characterId: string) {
  const database = await db();
  await database
    .update(threads)
    .set({ summary: "", memoryEpoch: sql`${threads.memoryEpoch} + 1` })
    .where(and(eq(threads.userId, userId), eq(threads.characterId, characterId)));
  const deleted = await database
    .delete(memories)
    .where(owner(userId, characterId))
    .returning({ id: memories.id });
  return deleted.length;
}
