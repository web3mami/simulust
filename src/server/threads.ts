import "server-only";
import { and, desc, eq, inArray, isNull, lt, ne, or } from "drizzle-orm";
import { z } from "zod";
import { db, type Tx } from "@/server/db";
import {
  characters,
  media,
  messages,
  threads,
  type CharacterRow,
  type Media,
  type Message,
  type Thread,
  type User,
} from "@/server/db/schema";
import { findCharacterFor, requireCharacter, toCharacterDTO } from "@/server/characters";
import { notFound } from "@/server/http";
import { toMediaDTO } from "@/server/media";
import type { MessageDTO, ThreadDTO } from "@/lib/api-types";

export const PAGE_SIZE = 50;
const PREVIEW_LENGTH = 160;
const uuid = z.uuid();

export function toMessageDTO(
  row: Message,
  attached: Media | null = null,
  extras: { voice?: Media | null; video?: Media | null } = {},
): MessageDTO {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    createdAt: row.createdAt.toISOString(),
    media: attached ? toMediaDTO(attached) : null,
    voice: extras.voice ? toMediaDTO(extras.voice) : null,
    video: extras.video ? toMediaDTO(extras.video) : null,
  };
}

const VOICE_PREFIX = "voice:message:";
const LIVE = ["pending", "ready"] as const;

// Voice notes point back at their message through media.prompt, and videos at
// their source photo through sourceMediaId. Newest wins when there are several.
async function mediaExtras(rows: { message: Message; media: Media | null }[]) {
  const database = await db();
  const voiceKeys = rows.map((row) => `${VOICE_PREFIX}${row.message.id}`);
  const photoIds = rows.map((row) => row.media?.id).filter((id): id is string => Boolean(id));
  const [voices, videos] = await Promise.all([
    voiceKeys.length
      ? database
          .select()
          .from(media)
          .where(and(eq(media.purpose, "voice"), inArray(media.prompt, voiceKeys), inArray(media.status, LIVE)))
          .orderBy(desc(media.createdAt))
      : [],
    photoIds.length
      ? database
          .select()
          .from(media)
          .where(and(eq(media.kind, "video"), inArray(media.sourceMediaId, photoIds), inArray(media.status, LIVE)))
          .orderBy(desc(media.createdAt))
      : [],
  ]);
  const voiceByMessage = new Map<string, Media>();
  for (const row of voices) {
    const id = row.prompt!.slice(VOICE_PREFIX.length);
    if (!voiceByMessage.has(id)) voiceByMessage.set(id, row);
  }
  const videoBySource = new Map<string, Media>();
  for (const row of videos) {
    if (row.sourceMediaId && !videoBySource.has(row.sourceMediaId)) videoBySource.set(row.sourceMediaId, row);
  }
  return { voiceByMessage, videoBySource };
}

export function toThreadDTO(thread: Thread, character: CharacterRow): ThreadDTO {
  return {
    id: thread.id,
    character: toCharacterDTO(character),
    lastPreview: thread.lastPreview,
    lastMessageAt: thread.lastMessageAt.toISOString(),
  };
}

// One thread per user and character. The character must be one this user can
// see (official, or their own and not deleted).
export async function getOrCreateThread(user: User, characterId: string) {
  const character = await requireCharacter(user.id, characterId);
  const database = await db();
  await database
    .insert(threads)
    .values({ userId: user.id, characterId: character.id })
    .onConflictDoNothing({ target: [threads.userId, threads.characterId] });
  const [thread] = await database
    .select()
    .from(threads)
    .where(and(eq(threads.userId, user.id), eq(threads.characterId, character.id)))
    .limit(1);
  if (!thread) throw new Error("Thread insert raced and vanished.");
  return { thread, character };
}

export async function requireThread(user: User, id: string) {
  if (!uuid.safeParse(id).success) throw notFound("That chat is gone.");
  const database = await db();
  const [thread] = await database
    .select()
    .from(threads)
    .where(and(eq(threads.id, id), eq(threads.userId, user.id)))
    .limit(1);
  if (!thread) throw notFound("That chat is gone.");
  const character = await findCharacterFor(user.id, thread.characterId);
  if (!character) throw notFound("That character is gone.");
  return { thread, character };
}

// Chats with at least one exchange, most recent first.
export async function listThreads(user: User): Promise<ThreadDTO[]> {
  const database = await db();
  const rows = await database
    .select({ thread: threads, character: characters })
    .from(threads)
    .innerJoin(characters, eq(threads.characterId, characters.id))
    .where(
      and(
        eq(threads.userId, user.id),
        ne(threads.lastPreview, ""),
        isNull(characters.deletedAt),
        or(isNull(characters.ownerId), eq(characters.ownerId, user.id)),
      ),
    )
    .orderBy(desc(threads.lastMessageAt))
    .limit(100);
  return rows.map((row) => toThreadDTO(row.thread, row.character));
}

// One page of messages, oldest first. `before` is the createdAt of the oldest
// message the client already has. Timestamps are microsecond precision in the
// database but millisecond on the wire, so the page includes anything within
// that millisecond and the client drops ids it already has; otherwise a message
// sharing the boundary millisecond could be skipped.
export async function loadMessages(threadId: string, before?: Date) {
  const database = await db();
  const rows = await database
    .select({ message: messages, media })
    .from(messages)
    .leftJoin(media, eq(messages.mediaId, media.id))
    .where(
      and(
        eq(messages.threadId, threadId),
        before ? lt(messages.createdAt, new Date(before.getTime() + 1)) : undefined,
      ),
    )
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(PAGE_SIZE);
  const { voiceByMessage, videoBySource } = await mediaExtras(rows);
  return {
    messages: rows.reverse().map((row) =>
      toMessageDTO(row.message, row.media, {
        voice: voiceByMessage.get(row.message.id),
        video: row.media ? videoBySource.get(row.media.id) : null,
      }),
    ),
    hasMore: rows.length === PAGE_SIZE,
  };
}

export async function addMessage(values: {
  id?: string;
  threadId: string;
  role: Message["role"];
  content: string;
  mediaId?: string | null;
  creditsSpent?: number;
  flagged?: boolean;
}, tx?: Tx) {
  const database = tx ?? (await db());
  const [row] = await database.insert(messages).values(values).returning();
  return row;
}

export async function deleteMessage(id: string) {
  const database = await db();
  await database.delete(messages).where(eq(messages.id, id));
}

export function previewOf(text: string) {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > PREVIEW_LENGTH ? `${flat.slice(0, PREVIEW_LENGTH - 1)}…` : flat;
}

export async function touchThread(threadId: string, preview: string) {
  const database = await db();
  await database
    .update(threads)
    .set({ lastPreview: previewOf(preview), lastMessageAt: new Date() })
    .where(eq(threads.id, threadId));
}

export async function markDisclosed(threadId: string, at = new Date()) {
  const database = await db();
  await database.update(threads).set({ disclosedAt: at }).where(eq(threads.id, threadId));
}

// AI disclosure is shown at the start of a session and again every 3 hours.
export const DISCLOSURE_INTERVAL_MS = 3 * 60 * 60 * 1000;

export function needsDisclosure(thread: Pick<Thread, "disclosedAt">, now = Date.now()) {
  return !thread.disclosedAt || now - thread.disclosedAt.getTime() >= DISCLOSURE_INTERVAL_MS;
}

// Saves the AI disclosure notice when one is due, before the character's next
// message (a reply or a photo). Returns it, or null when none was due.
export async function discloseIfDue(thread: Pick<Thread, "id" | "disclosedAt">, characterName: string) {
  if (!needsDisclosure(thread)) return null;
  const notice = await addMessage({
    threadId: thread.id,
    role: "notice",
    content: `Reminder: ${characterName} is an AI character, not a real person.`,
  });
  await markDisclosed(thread.id);
  return notice;
}
