import { asc, desc, eq, inArray } from "drizzle-orm";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import {
  ageChecks,
  characters,
  creditBalances,
  creditLedger,
  media,
  memories,
  messages,
  orders,
  profiles,
  reports,
  sessions,
  threads,
  users,
} from "@/server/db/schema";
import { route } from "@/server/http";
import { rateLimit } from "@/server/ratelimit";

// Everything we hold about the signed-in user, as one JSON file (GDPR access
// and portability). Media files themselves stay at their URLs while the
// account exists; this lists them.
export const GET = route(async (request: Request) => {
  const user = await requireUser(request);
  await rateLimit(`export:${user.id}`, 5, 60 * 60);
  const database = await db();

  const [account] = await database.select().from(users).where(eq(users.id, user.id));
  const [profile] = await database.select().from(profiles).where(eq(profiles.userId, user.id));
  const [balance] = await database.select().from(creditBalances).where(eq(creditBalances.userId, user.id));
  const ownCharacters = await database.select().from(characters).where(eq(characters.ownerId, user.id));

  const threadRows = await database
    .select({ thread: threads, characterName: characters.name })
    .from(threads)
    .leftJoin(characters, eq(threads.characterId, characters.id))
    .where(eq(threads.userId, user.id))
    .orderBy(asc(threads.createdAt));
  const threadIds = threadRows.map(({ thread }) => thread.id);
  const messageRows = threadIds.length
    ? await database.select().from(messages).where(inArray(messages.threadId, threadIds)).orderBy(asc(messages.createdAt))
    : [];

  const memoryRows = await database
    .select({
      id: memories.id,
      characterId: memories.characterId,
      kind: memories.kind,
      content: memories.content,
      pinned: memories.pinned,
      createdAt: memories.createdAt,
      updatedAt: memories.updatedAt,
    })
    .from(memories)
    .where(eq(memories.userId, user.id))
    .orderBy(asc(memories.createdAt));

  const mediaRows = await database
    .select({
      id: media.id,
      kind: media.kind,
      purpose: media.purpose,
      status: media.status,
      characterId: media.characterId,
      threadId: media.threadId,
      prompt: media.prompt,
      creditsSpent: media.creditsSpent,
      createdAt: media.createdAt,
    })
    .from(media)
    .where(eq(media.userId, user.id))
    .orderBy(asc(media.createdAt));

  const orderRows = await database.select().from(orders).where(eq(orders.userId, user.id)).orderBy(asc(orders.createdAt));
  const ledgerRows = await database.select().from(creditLedger).where(eq(creditLedger.userId, user.id)).orderBy(asc(creditLedger.id));
  const checkRows = await database
    .select({ provider: ageChecks.provider, status: ageChecks.status, createdAt: ageChecks.createdAt, decidedAt: ageChecks.decidedAt })
    .from(ageChecks)
    .where(eq(ageChecks.userId, user.id))
    .orderBy(desc(ageChecks.createdAt));
  const sessionRows = await database
    .select({ createdAt: sessions.createdAt, expiresAt: sessions.expiresAt })
    .from(sessions)
    .where(eq(sessions.userId, user.id))
    .orderBy(asc(sessions.createdAt));
  const reportRows = await database
    .select({ id: reports.id, kind: reports.kind, target: reports.target, status: reports.status, createdAt: reports.createdAt })
    .from(reports)
    .where(eq(reports.reporterUserId, user.id));

  const messagesByThread = new Map<string, typeof messageRows>();
  for (const message of messageRows) {
    const list = messagesByThread.get(message.threadId) ?? [];
    list.push(message);
    messagesByThread.set(message.threadId, list);
  }

  // Fields picked one by one: the password and recovery-code hashes are
  // credentials, never part of an export.
  const data = {
    exportedAt: new Date().toISOString(),
    user: {
      id: account.id,
      login: account.privyId,
      username: account.username,
      displayName: account.displayName,
      walletAddress: account.walletAddress,
      ageStatus: account.ageStatus,
      ageVerifiedAt: account.ageVerifiedAt,
      // When they confirmed a date of birth of 18 or over (the date is never kept).
      ageAttestedAt: account.ageAttestedAt,
      explicitHoldAt: account.explicitHoldAt,
      memberUntil: account.memberUntil,
      settings: account.settings,
      createdAt: account.createdAt,
      lastSeenAt: account.lastSeenAt,
      creditBalance: balance?.balance ?? 0,
    },
    profile: profile ?? null,
    characters: ownCharacters,
    threads: threadRows.map(({ thread, characterName }) => ({
      id: thread.id,
      characterId: thread.characterId,
      characterName,
      summary: thread.summary,
      createdAt: thread.createdAt,
      lastMessageAt: thread.lastMessageAt,
      messages: (messagesByThread.get(thread.id) ?? []).map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        mediaId: message.mediaId,
        creditsSpent: message.creditsSpent,
        createdAt: message.createdAt,
      })),
    })),
    memories: memoryRows,
    media: mediaRows.map((row) => ({ ...row, url: row.status === "ready" ? `/api/media/${row.id}` : null })),
    orders: orderRows,
    ledger: ledgerRows,
    // Only outcomes: no ID documents or birth dates are ever stored.
    ageChecks: checkRows,
    // Signed-in browsers, by when they signed in and when they'll be signed out.
    sessions: sessionRows,
    reportsFiled: reportRows,
  };

  const json = JSON.stringify(data, (_key, value) => (typeof value === "bigint" ? value.toString() : value), 2);
  const day = new Date().toISOString().slice(0, 10);
  return new Response(json, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="simulust-export-${day}.json"`,
      "Cache-Control": "no-store",
    },
  });
});
