import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";

vi.mock("@/server/llm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/llm")>();
  return { ...actual, complete: vi.fn(actual.complete), embed: vi.fn(actual.embed) };
});

import { complete, embed, type ChatMessage } from "@/server/llm";
import { currentUser } from "@/server/auth";
import { CRISIS_NOTICE } from "@/server/crisis";
import { db } from "@/server/db";
import { memories, messages, moderationEvents, threads, type User } from "@/server/db/schema";
import { env, features } from "@/server/env";
import {
  afterCrisis,
  CRISIS_TURNS,
  enforceCap,
  extractMemories,
  forgetAll,
  maybeSummarize,
  MEMORY_CAP,
  parseOps,
  RECENT_WINDOW,
  recentMessages,
  rememberTurn,
  retrieveMemories,
} from "@/server/memory";
import { getOrCreateThread, loadMessages, PAGE_SIZE } from "@/server/threads";

async function makeUser(handle: string): Promise<User> {
  const user = await currentUser(new Request("http://localhost/api/me", { headers: { "x-dev-user": handle } }));
  if (!user) throw new Error("dev auth is off in tests");
  return user;
}

// One-hot-ish unit vectors, so cosine distance is easy to reason about.
function vec(index: number, blend?: number) {
  const v = new Array<number>(1024).fill(0);
  v[index] = 1;
  if (blend !== undefined) v[blend] = 0.3;
  return v;
}

async function addMemory(
  user: User,
  characterId: string,
  content: string,
  extra: Partial<typeof memories.$inferInsert> = {},
) {
  const database = await db();
  const [row] = await database
    .insert(memories)
    .values({ userId: user.id, characterId, content, ...extra })
    .returning();
  return row;
}

async function memoriesOf(user: User, characterId: string) {
  const database = await db();
  return database
    .select()
    .from(memories)
    .where(and(eq(memories.userId, user.id), eq(memories.characterId, characterId)));
}

async function addConversation(threadId: string, count: number, start = Date.UTC(2026, 9, 1)) {
  const database = await db();
  await database.insert(messages).values(
    Array.from({ length: count }, (_, i) => ({
      threadId,
      role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: `message ${i + 1}`,
      createdAt: new Date(start + i * 1000),
    })),
  );
}

// A stand-in for the remote text classifier; `answer` decides each text it's sent.
function classifier(answer: (text: string) => string | Error) {
  Object.assign(env, { moderationBaseUrl: "http://classifier.test", moderationApiKey: "test", moderationModel: "test" });
  features.remoteModeration = true;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const text = (JSON.parse(String(init.body)) as { messages: { content: string }[] }).messages[1].content;
      const result = answer(text);
      if (result instanceof Error) throw result;
      return Response.json({ choices: [{ message: { content: result } }] });
    }),
  );
}

async function threadRow(id: string) {
  const database = await db();
  const [row] = await database.select().from(threads).where(eq(threads.id, id));
  return row;
}

beforeAll(async () => {
  await db();
});

afterEach(() => {
  vi.mocked(complete).mockClear();
  vi.mocked(embed).mockClear();
  features.remoteModeration = false;
  vi.unstubAllGlobals();
});

describe("parseOps", () => {
  it("reads well-formed ops and normalizes content", () => {
    expect(parseOps('{"ops":[{"op":"add","kind":"preference","content":"  Likes   jazz "}]}')).toEqual([
      { op: "add", kind: "preference", content: "Likes jazz" },
    ]);
  });

  it("tolerates code fences, prose and bare arrays", () => {
    expect(parseOps('```json\n{"ops":[{"op":"delete","id":"m1"}]}\n```')).toEqual([{ op: "delete", id: "m1" }]);
    expect(parseOps('Sure! {"ops":[{"op":"delete","id":"m2"}]} Hope that helps.')).toEqual([{ op: "delete", id: "m2" }]);
    expect(parseOps('[{"op":"add","content":"Has a dog."}]')).toEqual([{ op: "add", kind: "fact", content: "Has a dog." }]);
  });

  it("returns nothing for the dev stand-in and junk", () => {
    expect(parseOps("{}")).toEqual([]);
    expect(parseOps("")).toEqual([]);
    expect(parseOps("not json at all")).toEqual([]);
    expect(parseOps('{"ops":"nope"}')).toEqual([]);
    expect(parseOps('{"ops":[{"op":"add"')).toEqual([]);
  });

  it("drops malformed ops, defaults unknown kinds and caps the batch", () => {
    const ops = parseOps(
      JSON.stringify({
        ops: [
          { op: "add", kind: "secret", content: "Works nights." },
          { op: "update", id: "m1" },
          { op: "delete" },
          { op: "explode", id: "m1" },
          { op: "UPDATE", id: "m3", content: "Lives in Denver." },
        ],
      }),
    );
    expect(ops).toEqual([
      { op: "add", kind: "fact", content: "Works nights." },
      { op: "update", id: "m3", kind: undefined, content: "Lives in Denver." },
    ]);
    const many = parseOps(JSON.stringify({ ops: Array.from({ length: 40 }, (_, i) => ({ op: "add", content: `Fact ${i}` })) }));
    expect(many.length).toBe(12);
  });
});

describe("fact extraction", () => {
  it("changes nothing with the dev stand-in model", async () => {
    const user = await makeUser("mem-dev");
    const result = await extractMemories({
      userId: user.id,
      characterId: "mira",
      userName: "Sam",
      characterName: "Mira",
      userText: "I just adopted a dog named Biscuit.",
      replyText: "Biscuit! I love that.",
    });
    expect(result).toEqual({ added: 0, updated: 0, deleted: 0 });
    expect(await memoriesOf(user, "mira")).toHaveLength(0);
  });

  it("reconciles add, update and delete against existing memories", async () => {
    const user = await makeUser("mem-ops");
    await addMemory(user, "mira", "Lives in Austin.");
    await addMemory(user, "mira", "Has a cat.");
    await addMemory(user, "mira", "Birthday is in May.", { kind: "event", pinned: true });

    let prompt = "";
    vi.mocked(complete).mockImplementationOnce(async (sent: ChatMessage[]) => {
      prompt = sent[1].content;
      const alias = (text: string) => prompt.match(new RegExp(`(m\\d+) \\[[^\\]]+\\] ${text.replace(".", "\\.")}`))?.[1];
      return JSON.stringify({
        ops: [
          { op: "update", id: alias("Lives in Austin."), content: "Lives in Denver now." },
          { op: "delete", id: alias("Has a cat.") },
          // Pinned: the model may not delete it.
          { op: "delete", id: alias("Birthday is in May.") },
          { op: "add", kind: "preference", content: "Likes slow mornings." },
          // Fails the text check: never stored.
          { op: "add", kind: "fact", content: "Is 16 years old." },
          // Duplicate of the add above.
          { op: "add", kind: "fact", content: "likes slow mornings." },
          // Not an id the model was shown.
          { op: "delete", id: "m999" },
        ],
      });
    });

    const result = await extractMemories({
      userId: user.id,
      characterId: "mira",
      userName: "Sam",
      characterName: "Mira",
      userText: "I moved to Denver, and the cat went with my ex. Slow mornings are my thing now.",
      replyText: "Denver suits you.",
      sourceMessageId: crypto.randomUUID(),
    });

    expect(vi.mocked(complete).mock.calls[0][1]).toMatchObject({ tier: "utility", json: true });
    expect(prompt).toContain("Lives in Austin.");
    expect(result).toEqual({ added: 1, updated: 1, deleted: 1 });

    const rows = await memoriesOf(user, "mira");
    const contents = rows.map((row) => row.content).sort();
    expect(contents).toEqual(["Birthday is in May.", "Likes slow mornings.", "Lives in Denver now."]);
    expect(rows.find((row) => row.content === "Likes slow mornings.")?.kind).toBe("preference");
    expect(rows.find((row) => row.content === "Birthday is in May.")?.pinned).toBe(true);
  });

  it("stores embeddings for new memories when the embedding model is available", async () => {
    const user = await makeUser("mem-embed");
    vi.mocked(complete).mockResolvedValueOnce('{"ops":[{"op":"add","kind":"fact","content":"Plays bass in a band."}]}');
    vi.mocked(embed).mockResolvedValueOnce([vec(7)]);
    await extractMemories({
      userId: user.id,
      characterId: "jonah",
      userName: "Sam",
      characterName: "Jonah",
      userText: "I play bass in a band.",
      replyText: "Of course you do.",
    });
    const [row] = await memoriesOf(user, "jonah");
    expect(row.content).toBe("Plays bass in a band.");
    expect(row.embedding?.length).toBe(1024);
  });

  it("caps memories per character, keeping pinned ones and dropping the oldest", async () => {
    const user = await makeUser("mem-cap");
    const database = await db();
    const base = Date.UTC(2026, 0, 1);
    await database.insert(memories).values([
      ...Array.from({ length: 3 }, (_, i) => ({
        userId: user.id,
        characterId: "aiko",
        content: `Pinned ${i}`,
        pinned: true,
        updatedAt: new Date(base - 1_000_000 + i),
      })),
      ...Array.from({ length: MEMORY_CAP + 5 }, (_, i) => ({
        userId: user.id,
        characterId: "aiko",
        content: `Fact ${i}`,
        updatedAt: new Date(base + i * 1000),
      })),
    ]);
    const dropped = await enforceCap(user.id, "aiko");
    expect(dropped).toBe(8);
    const rows = await memoriesOf(user, "aiko");
    expect(rows).toHaveLength(MEMORY_CAP);
    expect(rows.filter((row) => row.pinned)).toHaveLength(3);
    const kept = new Set(rows.map((row) => row.content));
    for (let i = 0; i < 8; i++) expect(kept.has(`Fact ${i}`)).toBe(false);
    expect(kept.has(`Fact ${MEMORY_CAP + 4}`)).toBe(true);
  });
});

describe("retrieval", () => {
  it("returns pinned and boundary memories, plus the nearest ones by embedding", async () => {
    const user = await makeUser("mem-near");
    await addMemory(user, "nadia", "Calls her Nadi.", { pinned: true });
    await addMemory(user, "nadia", "Doesn't want to talk about work.", { kind: "boundary" });
    for (let i = 0; i < 12; i++) await addMemory(user, "nadia", `Unrelated ${i}`, { embedding: vec(100 + i) });
    await addMemory(user, "nadia", "Loves ramen.", { embedding: vec(5, 6) });
    await addMemory(user, "nadia", "Hates cilantro.", { embedding: vec(6) });

    vi.mocked(embed).mockResolvedValueOnce([vec(5)]);
    const { always, relevant } = await retrieveMemories(user.id, "nadia", "What should we eat tonight?");
    expect(always.map((row) => row.content).sort()).toEqual(["Calls her Nadi.", "Doesn't want to talk about work."]);
    expect(relevant).toHaveLength(8);
    expect(relevant[0].content).toBe("Loves ramen.");
    expect(relevant.some((row) => row.pinned || row.kind === "boundary")).toBe(false);
  });

  it("falls back to the 12 most recent memories without embeddings", async () => {
    const user = await makeUser("mem-recent");
    const base = Date.UTC(2026, 0, 1);
    for (let i = 0; i < 15; i++) {
      await addMemory(user, "leo", `Fact ${i}`, { updatedAt: new Date(base + i * 1000) });
    }
    const { relevant } = await retrieveMemories(user.id, "leo", "hey");
    expect(relevant).toHaveLength(12);
    expect(relevant[0].content).toBe("Fact 14");
  });

  it("skips the embedding call when there is nothing to rank", async () => {
    const user = await makeUser("mem-empty");
    await addMemory(user, "mira", "Pinned only.", { pinned: true });
    const { always, relevant } = await retrieveMemories(user.id, "mira", "hello");
    expect(always).toHaveLength(1);
    expect(relevant).toHaveLength(0);
    expect(embed).not.toHaveBeenCalled();
  });
});

describe("rolling summary", () => {
  it("keeps unsummarized history verbatim and folds it into the summary past the trigger", async () => {
    const user = await makeUser("mem-summary");
    const { thread } = await getOrCreateThread(user, "mira");
    await addConversation(thread.id, 60);

    // Nothing summarized yet: everything up to the verbatim ceiling is in the prompt.
    expect(await recentMessages(thread)).toHaveLength(60);

    // Dev stand-in returns "" for utility calls: no change, retried next turn.
    expect(await maybeSummarize(thread.id, { user: "Sam", character: "Mira" })).toBe(false);

    vi.mocked(complete).mockResolvedValueOnce("Sam and Mira traded 36 messages about nothing much.");
    expect(await maybeSummarize(thread.id, { user: "Sam", character: "Mira" })).toBe(true);
    const sent = vi.mocked(complete).mock.calls.at(-1)!;
    expect(sent[1]).toMatchObject({ tier: "utility" });
    expect(sent[0][1].content).toContain("message 36");
    expect(sent[0][1].content).not.toContain("message 37");

    const database = await db();
    const [after] = await database.select().from(threads).where(eq(threads.id, thread.id));
    expect(after.summarizedCount).toBe(60 - RECENT_WINDOW);
    expect(after.summary).toContain("36 messages");

    const recent = await recentMessages(after);
    expect(recent).toHaveLength(RECENT_WINDOW);
    expect(recent[0].content).toBe("message 37");
    expect(recent.at(-1)?.content).toBe("message 60");

    // Not enough new messages for another pass.
    expect(await maybeSummarize(thread.id, { user: "Sam", character: "Mira" })).toBe(false);
  });

  it("drops a summary that fails the text check but still advances", async () => {
    const user = await makeUser("mem-summary-bad");
    const { thread } = await getOrCreateThread(user, "jonah");
    await addConversation(thread.id, 56);
    vi.mocked(complete).mockResolvedValueOnce("They talked about when she was 15.");
    expect(await maybeSummarize(thread.id, { user: "Sam", character: "Jonah" })).toBe(true);
    const database = await db();
    const [after] = await database.select().from(threads).where(eq(threads.id, thread.id));
    expect(after.summary).toBe("");
    expect(after.summarizedCount).toBe(56 - RECENT_WINDOW);
  });

  it("forget everything clears memories and the summary", async () => {
    const user = await makeUser("mem-forget");
    const { thread } = await getOrCreateThread(user, "aiko");
    const database = await db();
    await database.update(threads).set({ summary: "Old story." }).where(eq(threads.id, thread.id));
    await addMemory(user, "aiko", "Pinned.", { pinned: true });
    await addMemory(user, "aiko", "Not pinned.");
    expect(await forgetAll(user.id, "aiko")).toBe(2);
    expect(await memoriesOf(user, "aiko")).toHaveLength(0);
    const [after] = await database.select().from(threads).where(eq(threads.id, thread.id));
    expect(after.summary).toBe("");
  });
});

describe("prompt size and races", () => {
  it("keeps a run of long messages within the history budget", async () => {
    const user = await makeUser("mem-long");
    const { thread } = await getOrCreateThread(user, "mira");
    const database = await db();
    await database.insert(messages).values(
      Array.from({ length: 40 }, (_, i) => ({
        threadId: thread.id,
        role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
        content: `${i + 1} ${"x".repeat(3990)}`,
        createdAt: new Date(Date.UTC(2026, 9, 2) + i * 1000),
      })),
    );
    const recent = await recentMessages(thread);
    expect(recent.at(-1)?.content).toHaveLength(`40 ${"x".repeat(3990)}`.length);
    expect(recent.slice(0, -1).every((message) => message.content.length <= 1501)).toBe(true);
    const total = recent.reduce((sum, message) => sum + message.content.length, 0);
    expect(total).toBeLessThanOrEqual(24_000 + 4_000);
    expect(recent.length).toBeGreaterThan(10);
  });

  it("caps a summary batch by size", async () => {
    const user = await makeUser("mem-summary-long");
    const { thread } = await getOrCreateThread(user, "nadia");
    const database = await db();
    await database.insert(messages).values(
      Array.from({ length: 60 }, (_, i) => ({
        threadId: thread.id,
        role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
        content: "y".repeat(2000),
        createdAt: new Date(Date.UTC(2026, 9, 3) + i * 1000),
      })),
    );
    vi.mocked(complete).mockResolvedValueOnce("A long talk.");
    expect(await maybeSummarize(thread.id, { user: "Sam", character: "Nadia" })).toBe(true);
    const sent = vi.mocked(complete).mock.calls.at(-1)!;
    expect(sent[0][1].content.length).toBeLessThan(26_000);
    const [after] = await database.select().from(threads).where(eq(threads.id, thread.id));
    expect(after.summarizedCount).toBeGreaterThan(0);
    expect(after.summarizedCount).toBeLessThan(60 - RECENT_WINDOW);
  });

  it("keeps boundaries in the prompt when 40 memories are pinned", async () => {
    const user = await makeUser("mem-boundary-cap");
    await addMemory(user, "leo", "Doesn't want to be called babe.", {
      kind: "boundary",
      updatedAt: new Date(Date.UTC(2025, 0, 1)),
    });
    for (let i = 0; i < 40; i++) await addMemory(user, "leo", `Pinned ${i}`, { pinned: true });
    const { always } = await retrieveMemories(user.id, "leo", "hi");
    expect(always.some((row) => row.kind === "boundary")).toBe(true);
    expect(always.filter((row) => row.pinned)).toHaveLength(40);
  });

  it("brings along memories saved while embeddings were down", async () => {
    const user = await makeUser("mem-unembedded");
    for (let i = 0; i < 10; i++) await addMemory(user, "nadia", `Embedded ${i}`, { embedding: vec(200 + i) });
    await addMemory(user, "nadia", "Saved during an outage.");
    vi.mocked(embed).mockResolvedValueOnce([vec(200)]);
    const { relevant } = await retrieveMemories(user.id, "nadia", "anything");
    expect(relevant.some((row) => row.content === "Saved during an outage.")).toBe(true);
  });

  it("lets forget everything win over memory work that was already running", async () => {
    const user = await makeUser("mem-forget-race");
    const { thread } = await getOrCreateThread(user, "aiko");
    await addConversation(thread.id, 60, Date.UTC(2026, 9, 4));

    // Forgotten while the summary call is in flight: the old story isn't written back.
    vi.mocked(complete).mockImplementationOnce(async () => {
      await forgetAll(user.id, "aiko");
      return "A summary of things the user asked to forget.";
    });
    expect(await maybeSummarize(thread.id, { user: "Sam", character: "Aiko" })).toBe(false);
    const database = await db();
    const [after] = await database.select().from(threads).where(eq(threads.id, thread.id));
    expect(after.summary).toBe("");

    // Facts from a turn that began before the forget aren't saved either.
    vi.mocked(complete).mockResolvedValueOnce(JSON.stringify({ ops: [{ op: "add", kind: "fact", content: "Has a cat." }] }));
    const result = await extractMemories({
      userId: user.id,
      characterId: "aiko",
      userName: "Sam",
      characterName: "Aiko",
      userText: "I have a cat.",
      replyText: "Cute!",
      memoryEpoch: thread.memoryEpoch,
    });
    expect(result.added).toBe(0);
    expect(await memoriesOf(user, "aiko")).toHaveLength(0);
  });
});

describe("message paging", () => {
  it("pages backwards without skipping messages that share a millisecond", async () => {
    const user = await makeUser("mem-paging");
    const { thread } = await getOrCreateThread(user, "nadia");
    await addConversation(thread.id, PAGE_SIZE + 10);
    const database = await db();
    // Two more rows in the same millisecond as the 11th message, so they straddle the page boundary.
    const shared = new Date(Date.UTC(2026, 9, 1) + 10 * 1000 + 0.5);
    await database.insert(messages).values([
      { threadId: thread.id, role: "notice", content: "same ms A", createdAt: shared },
      { threadId: thread.id, role: "notice", content: "same ms B", createdAt: shared },
    ]);

    const first = await loadMessages(thread.id);
    expect(first.messages).toHaveLength(PAGE_SIZE);
    expect(first.hasMore).toBe(true);
    expect(first.messages.at(-1)?.content).toBe(`message ${PAGE_SIZE + 10}`);

    const seen = new Set(first.messages.map((message) => message.id));
    const second = await loadMessages(thread.id, new Date(first.messages[0].createdAt));
    for (const message of second.messages) seen.add(message.id);
    expect(seen.size).toBe(PAGE_SIZE + 12);
  });
});

describe("crisis messages and the summary", () => {
  it("leaves a crisis and the turns after it out, but counts them as summarized", async () => {
    const user = await makeUser("mem-crisis");
    const { thread } = await getOrCreateThread(user, "mira");
    await addConversation(thread.id, 60, Date.UTC(2026, 9, 5));
    const database = await db();
    const rows = await database.select().from(messages).where(eq(messages.threadId, thread.id));
    const byContent = new Map(rows.map((row) => [row.content, row.id]));
    await database.update(messages).set({ content: "Some days I want to die." }).where(eq(messages.id, byContent.get("message 5")!));
    await database.update(messages).set({ content: "Please call or text 988." }).where(eq(messages.id, byContent.get("message 6")!));

    vi.mocked(complete).mockResolvedValueOnce("They talked.");
    expect(await maybeSummarize(thread.id, { user: "Sam", character: "Mira" })).toBe(true);
    const sent = vi.mocked(complete).mock.calls.at(-1)![0][1].content;
    expect(sent).toContain("message 4");
    expect(sent).not.toContain("want to die");
    expect(sent).not.toContain("988");
    // The crisis message (5), then CRISIS_TURNS more turns: messages 6 to 12.
    for (let n = 7; n <= 12; n++) expect(sent).not.toContain(`message ${n}\n`);
    expect(sent).toContain("message 13");
    expect((await threadRow(thread.id)).summarizedCount).toBe(60 - RECENT_WINDOW);
  });

  it("keeps follow-ups the detector misses out of the summary", async () => {
    const user = await makeUser("mem-crisis-follow");
    const { thread } = await getOrCreateThread(user, "lucia");
    const database = await db();
    const rows = Array.from({ length: 60 }, (_, i) => ({
      threadId: thread.id,
      role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: `message ${i + 1}`,
      createdAt: new Date(Date.UTC(2026, 9, 10) + i * 1000),
    }));
    rows[4].content = "I want to kill myself tonight.";
    rows[5].content = "Please call or text 988.";
    rows[6].content = "I already wrote the note and the pills are on my desk.";
    rows[7].content = "Oh no, please stay with me, are you safe right now?";
    rows[8].content = "I don't know what the point is anymore";
    rows[10].content = "it doesn't matter now";
    await database.insert(messages).values(rows);

    vi.mocked(complete).mockResolvedValueOnce("They talked.");
    expect(await maybeSummarize(thread.id, { user: "Sam", character: "Lucia" })).toBe(true);
    const sent = vi.mocked(complete).mock.calls.at(-1)![0][1].content;
    for (const text of ["kill myself tonight", "988", "pills are on my desk", "are you safe right now", "what the point is", "doesn't matter now"]) {
      expect(sent).not.toContain(text);
    }
    expect(sent).toContain("message 13");
  });

  it("opens the window at a crisis notice, for a crisis message that was refused and never saved", async () => {
    const user = await makeUser("mem-crisis-notice");
    const { thread } = await getOrCreateThread(user, "aiko");
    const start = Date.UTC(2026, 9, 11);
    await addConversation(thread.id, 60, start);
    const database = await db();
    // Between message 4 and message 5, as the route stores it for a refused crisis message.
    await database.insert(messages).values({ threadId: thread.id, role: "notice", content: CRISIS_NOTICE, createdAt: new Date(start + 3500) });

    vi.mocked(complete).mockResolvedValueOnce("They talked.");
    expect(await maybeSummarize(thread.id, { user: "Sam", character: "Aiko" })).toBe(true);
    const sent = vi.mocked(complete).mock.calls.at(-1)![0][1].content;
    expect(sent).toContain("message 4\n");
    for (let n = 5; n <= 10; n++) expect(sent).not.toContain(`message ${n}\n`);
    expect(sent).toContain("message 11\n");
    expect((await threadRow(thread.id)).summarizedCount).toBe(60 - RECENT_WINDOW);
  });

  it("carries a window opened before the batch into it", async () => {
    const user = await makeUser("mem-crisis-before");
    const { thread } = await getOrCreateThread(user, "leo");
    const start = Date.UTC(2026, 9, 12);
    const database = await db();
    await database.insert(messages).values({ threadId: thread.id, role: "notice", content: CRISIS_NOTICE, createdAt: new Date(start - 1000) });
    await addConversation(thread.id, 64, start);
    await database.update(threads).set({ summarizedCount: 2 }).where(eq(threads.id, thread.id));

    vi.mocked(complete).mockResolvedValueOnce("They talked.");
    expect(await maybeSummarize(thread.id, { user: "Sam", character: "Leo" })).toBe(true);
    const sent = vi.mocked(complete).mock.calls.at(-1)![0][1].content;
    for (let n = 3; n <= 6; n++) expect(sent).not.toContain(`message ${n}\n`);
    expect(sent).toContain("message 7\n");
  });

  it("knows a reply opening the batch answers a crisis message that closed the last one", async () => {
    const user = await makeUser("mem-crisis-edge");
    const { thread } = await getOrCreateThread(user, "nadia");
    await addConversation(thread.id, 70, Date.UTC(2026, 9, 6));
    const database = await db();
    const rows = await database.select().from(messages).where(eq(messages.threadId, thread.id));
    const byContent = new Map(rows.map((row) => [row.content, row.id]));
    await database.update(messages).set({ content: "I keep thinking about suicide." }).where(eq(messages.id, byContent.get("message 11")!));
    await database.update(messages).set({ content: "Please call or text 988." }).where(eq(messages.id, byContent.get("message 12")!));
    await database.update(threads).set({ summarizedCount: 11 }).where(eq(threads.id, thread.id));

    vi.mocked(complete).mockResolvedValueOnce("They talked some more.");
    expect(await maybeSummarize(thread.id, { user: "Sam", character: "Nadia" })).toBe(true);
    const sent = vi.mocked(complete).mock.calls.at(-1)![0][1].content;
    expect(sent).not.toContain("988");
    expect(sent).not.toContain("suicide");
    // The batch opens at 12, inside the window that 11 opened: it runs to 18.
    for (let n = 13; n <= 18; n++) expect(sent).not.toContain(`message ${n}\n`);
    expect(sent).toContain("message 19");
    expect((await threadRow(thread.id)).summarizedCount).toBe(70 - RECENT_WINDOW);
  });

  it("advances past a batch of nothing but crisis messages without a model call", async () => {
    const user = await makeUser("mem-crisis-only");
    const { thread } = await getOrCreateThread(user, "leo");
    const database = await db();
    await database.insert(messages).values(
      Array.from({ length: 56 }, (_, i) => ({
        threadId: thread.id,
        role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
        content: i % 2 === 0 ? "I want to die." : "I'm here. Please call 988.",
        createdAt: new Date(Date.UTC(2026, 9, 7) + i * 1000),
      })),
    );
    expect(await maybeSummarize(thread.id, { user: "Sam", character: "Leo" })).toBe(true);
    expect(complete).not.toHaveBeenCalled();
    const after = await threadRow(thread.id);
    expect(after.summary).toBe("");
    expect(after.summarizedCount).toBe(56 - RECENT_WINDOW);
  });
});

describe("screening what memory writes", () => {
  it("writes nothing when the classifier can't check a summary, so it's tried again", async () => {
    const user = await makeUser("mem-screen-down");
    const { thread } = await getOrCreateThread(user, "aiko");
    await addConversation(thread.id, 60, Date.UTC(2026, 9, 8));
    classifier(() => new Error("classifier timed out"));
    vi.mocked(complete).mockResolvedValueOnce("They planned a trip.");
    expect(await maybeSummarize(thread.id, { user: "Sam", character: "Aiko" })).toBe(false);
    const after = await threadRow(thread.id);
    expect(after.summary).toBe("");
    expect(after.summarizedCount).toBe(0);

    classifier(() => "ALLOW");
    vi.mocked(complete).mockResolvedValueOnce("They planned a trip.");
    expect(await maybeSummarize(thread.id, { user: "Sam", character: "Aiko" })).toBe(true);
    expect((await threadRow(thread.id)).summary).toBe("They planned a trip.");
  });

  it("drops a summary the classifier blocks, and logs it", async () => {
    const user = await makeUser("mem-screen-block");
    const { thread } = await getOrCreateThread(user, "jonah");
    await addConversation(thread.id, 60, Date.UTC(2026, 9, 9));
    classifier(() => "BLOCK:minor");
    vi.mocked(complete).mockResolvedValueOnce("A summary that slipped past the blocklist.");
    expect(await maybeSummarize(thread.id, { user: "Sam", character: "Jonah" })).toBe(true);
    const after = await threadRow(thread.id);
    expect(after.summary).toBe("");
    expect(after.summarizedCount).toBe(60 - RECENT_WINDOW);
    const database = await db();
    const logged = await database.select().from(moderationEvents).where(eq(moderationEvents.userId, user.id));
    expect(logged.map((event) => [event.category, event.action, event.targetId])).toEqual([["minor", "blocked", thread.id]]);
  });

  it("stores only extracted memories the classifier allows, and still deletes", async () => {
    const user = await makeUser("mem-screen-ops");
    await addMemory(user, "mira", "Has a cat.");
    classifier((text) =>
      text.includes("fifteen-ish") ? "BLOCK:minor" : text.includes("Denver") ? new Error("classifier timed out") : "ALLOW",
    );
    vi.mocked(complete).mockImplementationOnce(async (sent: ChatMessage[]) => {
      const alias = sent[1].content.match(/(m\d+) \[[^\]]+\] Has a cat\./)?.[1];
      return JSON.stringify({
        ops: [
          { op: "add", kind: "fact", content: "Is fifteen-ish at heart." },
          { op: "add", kind: "fact", content: "Lives in Denver." },
          { op: "add", kind: "preference", content: "Likes slow mornings." },
          { op: "delete", id: alias },
        ],
      });
    });
    const result = await extractMemories({
      userId: user.id,
      characterId: "mira",
      userName: "Sam",
      characterName: "Mira",
      userText: "The cat went with my ex. I'm in Denver now and slow mornings are my thing.",
      replyText: "Denver suits you.",
    });
    expect(result).toEqual({ added: 1, updated: 0, deleted: 1 });
    expect((await memoriesOf(user, "mira")).map((row) => row.content)).toEqual(["Likes slow mornings."]);
  });
});

describe("crisis turns and facts", () => {
  // Saves a user message (and the notice the route stores for a crisis) and
  // returns its id.
  async function say(threadId: string, content: string, at: number, crisis = false) {
    const database = await db();
    const [row] = await database
      .insert(messages)
      .values({ threadId, role: "user", content, createdAt: new Date(at) })
      .returning();
    if (crisis) {
      await database.insert(messages).values({ threadId, role: "notice", content: CRISIS_NOTICE, createdAt: new Date(at + 1) });
    }
    await database.insert(messages).values({ threadId, role: "assistant", content: "I'm here.", createdAt: new Date(at + 2) });
    return row.id;
  }

  function turn(user: User, threadId: string, userText: string, sourceMessageId: string) {
    return rememberTurn({
      threadId,
      userId: user.id,
      characterId: "mira",
      userName: "Sam",
      characterName: "Mira",
      userText,
      replyText: "I'm here.",
      sourceMessageId,
    });
  }

  it("skips fact extraction for the turns after a crisis, then resumes", async () => {
    const user = await makeUser("mem-crisis-facts");
    const { thread } = await getOrCreateThread(user, "mira");
    const start = Date.UTC(2026, 9, 13);
    await say(thread.id, "I want to kill myself tonight.", start, true);

    const followUps = [
      "I already wrote the note and the pills are on my desk.",
      "I don't know what the point is anymore. it doesn't matter now",
      "I don't know anymore.",
    ];
    for (const [index, text] of followUps.entries()) {
      const id = await say(thread.id, text, start + (index + 1) * 10);
      expect(await afterCrisis(thread.id, id)).toBe(true);
      await turn(user, thread.id, text, id);
    }
    expect(complete).not.toHaveBeenCalled();

    const later = "I adopted a dog named Biscuit.";
    const id = await say(thread.id, later, start + (CRISIS_TURNS + 1) * 10);
    expect(await afterCrisis(thread.id, id)).toBe(false);
    vi.mocked(complete).mockResolvedValueOnce('{"ops":[{"op":"add","kind":"fact","content":"Has a dog named Biscuit."}]}');
    await turn(user, thread.id, later, id);
    expect((await memoriesOf(user, "mira")).map((row) => row.content)).toEqual(["Has a dog named Biscuit."]);
  });

  it("counts a refused crisis message, known only by its notice", async () => {
    const user = await makeUser("mem-crisis-refused");
    const { thread } = await getOrCreateThread(user, "nadia");
    const start = Date.UTC(2026, 9, 14);
    const database = await db();
    await database.insert(messages).values({ threadId: thread.id, role: "notice", content: CRISIS_NOTICE, createdAt: new Date(start) });
    const id = await say(thread.id, "the pills are on my desk", start + 10);
    expect(await afterCrisis(thread.id, id)).toBe(true);
  });
});

describe("what memory keeps out", () => {
  it("never stores bare ages, school years or self-harm, even with no classifier", async () => {
    const user = await makeUser("mem-keep-out");
    const refused = [
      "Is 15.",
      "Is 15 years.",
      "User is 15.",
      "Age: 15.",
      "Is 14 and a half.",
      "Turns 16 next month.",
      "Turns 16 soon.",
      "Is only fifteen.",
      "Is a junior in high school.",
      "Is a high school sophomore.",
      "Is in year 10 at school.",
      "Is in 10th grade.",
      "Cut their wrists last night.",
      "Has thought about suicide.",
    ];
    const kept = ["Is 34 and works as a nurse.", "Is 5 minutes from work.", "Has two kids.", "Turns 30 in May."];
    // At most 12 ops a turn, so over three turns.
    let added = 0;
    for (const batch of [refused.slice(0, 7), refused.slice(7), kept]) {
      vi.mocked(complete).mockResolvedValueOnce(JSON.stringify({ ops: batch.map((content) => ({ op: "add", kind: "fact", content })) }));
      const result = await extractMemories({
        userId: user.id,
        characterId: "aiko",
        userName: "Sam",
        characterName: "Aiko",
        userText: "Tell you about me.",
        replyText: "Please do.",
      });
      added += result.added;
    }
    expect(added).toBe(kept.length);
    expect((await memoriesOf(user, "aiko")).map((row) => row.content).sort()).toEqual([...kept].sort());
  });

  it("never stores the ages, birth years, schools and minor status the extractor phrased its own way", async () => {
    const user = await makeUser("mem-keep-out-r3");
    const refused = [
      "Is 12yo.",
      "Is 13½.",
      "Is 13 1/2.",
      "Was born in 2012.",
      "Birthday is May 3, 2011.",
      "Is a minor.",
      "Is legally a child.",
      "Is not an adult yet.",
      "Is not yet an adult.",
      "Is in high school.",
      "Is still in school.",
      "Goes to high school.",
      "Attends Lincoln High.",
      "Is a junior at Lincoln High.",
      "Is a sophomore at Lincoln High School.",
      "Started high school this year.",
      "Will graduate high school in 2030.",
      "Is a year 9 student.",
      "Has a 9pm curfew set by their parents.",
      "Is a 15 year old girl.",
      "Has a ten year old body.",
    ];
    const kept = [
      "Has a son in college.",
      "Is a kid at heart.",
      "Is a child psychologist.",
      "Is a minor league umpire.",
      "Teaches high school chemistry.",
      "Goes to the gym after work.",
      "Is 6 1/2 feet tall.",
      "Birthday is May 3.",
      "Was born in 1990.",
      "Is in school for nursing.",
    ];
    let added = 0;
    for (let index = 0; index < refused.length; index += 12) {
      const batch = refused.slice(index, index + 12);
      vi.mocked(complete).mockResolvedValueOnce(JSON.stringify({ ops: batch.map((content) => ({ op: "add", kind: "fact", content })) }));
      added += (await extractMemories({ userId: user.id, characterId: "aiko", userName: "Sam", characterName: "Aiko", userText: "Tell you about me.", replyText: "Please do." })).added;
    }
    expect((await memoriesOf(user, "aiko")).map((row) => row.content)).toEqual([]);
    expect(added).toBe(0);
    vi.mocked(complete).mockResolvedValueOnce(JSON.stringify({ ops: kept.map((content) => ({ op: "add", kind: "fact", content })) }));
    added += (await extractMemories({ userId: user.id, characterId: "aiko", userName: "Sam", characterName: "Aiko", userText: "Tell you about me.", replyText: "Please do." })).added;
    expect((await memoriesOf(user, "aiko")).map((row) => row.content).sort()).toEqual([...kept].sort());
    expect(added).toBe(kept.length);
  });

  it("drops a summary that mentions self-harm without logging it, and asks the summarizer to leave it out", async () => {
    const user = await makeUser("mem-self-harm-summary");
    const { thread } = await getOrCreateThread(user, "leo");
    await addConversation(thread.id, 60, Date.UTC(2026, 9, 15));
    classifier(() => "BLOCK:self_harm");
    vi.mocked(complete).mockResolvedValueOnce("They talked about how hard things have been for Sam lately.");
    expect(await maybeSummarize(thread.id, { user: "Sam", character: "Leo" })).toBe(true);
    expect(vi.mocked(complete).mock.calls.at(-1)![0][0].content).toContain("Leave out health details");
    const [, request] = vi.mocked(fetch).mock.calls[0];
    expect((JSON.parse(String(request?.body)) as { messages: { content: string }[] }).messages[0].content).toContain("self_harm");
    const after = await threadRow(thread.id);
    expect(after.summary).toBe("");
    expect(after.summarizedCount).toBe(60 - RECENT_WINDOW);
    const database = await db();
    expect(await database.select().from(moderationEvents).where(eq(moderationEvents.userId, user.id))).toHaveLength(0);
  });

  it("drops a summary the classifier answers unreadably, rather than retrying it every turn", async () => {
    const user = await makeUser("mem-unreadable-summary");
    const { thread } = await getOrCreateThread(user, "nadia");
    await addConversation(thread.id, 60, Date.UTC(2026, 9, 16));
    classifier(() => "I'd rather not say.");
    vi.mocked(complete).mockResolvedValueOnce("They planned a trip.");
    expect(await maybeSummarize(thread.id, { user: "Sam", character: "Nadia" })).toBe(true);
    const after = await threadRow(thread.id);
    expect(after.summary).toBe("");
    expect(after.summarizedCount).toBe(60 - RECENT_WINDOW);
  });
});

describe("slow embeddings", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.mocked(embed).mockReset();
  });

  it("stop waiting after 10 s and fall back, before and after the reply", async () => {
    const user = await makeUser("mem-embed-slow");
    for (let i = 0; i < 3; i++) await addMemory(user, "jonah", `Fact ${i}`);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.mocked(embed).mockImplementation(() => new Promise(() => {}));

    const retrieved = retrieveMemories(user.id, "jonah", "hey");
    await vi.advanceTimersByTimeAsync(10_000);
    expect((await retrieved).relevant).toHaveLength(3);

    vi.mocked(complete).mockResolvedValueOnce('{"ops":[{"op":"add","kind":"fact","content":"Plays bass in a band."}]}');
    const extracted = extractMemories({
      userId: user.id,
      characterId: "jonah",
      userName: "Sam",
      characterName: "Jonah",
      userText: "I play bass in a band.",
      replyText: "Of course you do.",
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect((await extracted).added).toBe(1);
    expect((await memoriesOf(user, "jonah")).find((row) => row.content === "Plays bass in a band.")?.embedding).toBeNull();
  });
});
