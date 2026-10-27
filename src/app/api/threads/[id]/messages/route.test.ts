import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";

// after() needs a live request scope; the memory work it schedules is tested on its own.
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: vi.fn(),
}));

vi.mock("@/server/llm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/llm")>();
  return { ...actual, stream: vi.fn(actual.stream) };
});

import { POST } from "./route";
import { currentUser } from "@/server/auth";
import { balanceOf } from "@/server/credits";
import { CRISIS_FALLBACK_REPLY, CRISIS_NOTICE } from "@/server/crisis";
import { db } from "@/server/db";
import { creditBalances, creditLedger, messages, moderationEvents, rateLimits } from "@/server/db/schema";
import { env, features } from "@/server/env";
import { stream } from "@/server/llm";
import { REFUSAL } from "@/server/safety/text";
import { getOrCreateThread } from "@/server/threads";
import type { ChatStreamEvent } from "@/lib/api-types";
import { COSTS, FREE } from "@/lib/pricing";

const FALLBACK = "Let's take this somewhere else.";

type Handler = (request: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
const post = POST as unknown as Handler;

async function user(handle: string) {
  return (await currentUser(new Request("http://localhost/api/me", { headers: { "x-dev-user": handle } })))!;
}

function postMessage(handle: string, threadId: string, content: string) {
  return post(
    new Request(`http://localhost/api/threads/${threadId}/messages`, {
      method: "POST",
      headers: { "x-dev-user": handle, "content-type": "application/json" },
      body: JSON.stringify({ content }),
    }),
    { params: Promise.resolve({ id: threadId }) },
  );
}

async function send(handle: string, threadId: string, content: string) {
  const response = await postMessage(handle, threadId, content);
  const text = await response.text();
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ChatStreamEvent);
}

// The model streams exactly these pieces.
function reply(...pieces: string[]) {
  const state = { finished: false };
  vi.mocked(stream).mockImplementationOnce(async function* () {
    for (const piece of pieces) yield piece;
    state.finished = true;
  });
  return state;
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

async function eventsFor(userId: string) {
  const database = await db();
  return database.select().from(moderationEvents).where(eq(moderationEvents.userId, userId));
}

const deltas = (events: ChatStreamEvent[]) =>
  events.map((event) => (event.type === "delta" ? event.text : "")).join("");
const done = (events: ChatStreamEvent[]) => events.find((event) => event.type === "done");
const finalText = (events: ChatStreamEvent[]) => {
  const final = done(events);
  return final?.type === "done" ? final.message.content : null;
};
const notices = (events: ChatStreamEvent[]) =>
  events.flatMap((event) => (event.type === "notice" ? [event.message.content] : []));

beforeAll(async () => {
  await db();
});

afterEach(() => {
  features.remoteModeration = false;
  vi.unstubAllGlobals();
});

describe("chat turn", () => {
  it("saves the message and streams a reply", async () => {
    const owner = await user("chat-basic");
    const { thread } = await getOrCreateThread(owner, "mira");
    const events = await send("chat-basic", thread.id, "Hi there, how was your day?");
    expect(events.map((event) => event.type)).toContain("user");
    expect(events.at(-1)?.type).toBe("done");
  });

  it("charges for every send past the free allowance, even when they race", async () => {
    const owner = await user("chat-quota");
    const { thread } = await getOrCreateThread(owner, "nadia");
    const database = await db();
    await database.insert(messages).values(
      Array.from({ length: FREE.dailyMessages - 1 }, (_, i) => ({
        threadId: thread.id,
        role: "user" as const,
        content: `earlier ${i}`,
      })),
    );
    const before = await balanceOf(owner.id);

    const results = await Promise.all([1, 2, 3].map((n) => send("chat-quota", thread.id, `Message number ${n}`)));
    expect(results.every((events) => events.some((event) => event.type === "user"))).toBe(true);

    const spends = await database
      .select()
      .from(creditLedger)
      .where(and(eq(creditLedger.userId, owner.id), eq(creditLedger.reason, "message")));
    expect(spends).toHaveLength(2);
    expect(await balanceOf(owner.id)).toBe(before - 2 * COSTS.message);
  });
});

describe("crisis turns", () => {
  it("sends crisis resources and a supportive notice, free, to a user with no credits or free messages left", async () => {
    const owner = await user("chat-crisis-broke");
    const { thread } = await getOrCreateThread(owner, "mira");
    const database = await db();
    await database.insert(messages).values(
      Array.from({ length: FREE.dailyMessages }, (_, i) => ({ threadId: thread.id, role: "user" as const, content: `earlier ${i}` })),
    );
    await database.update(creditBalances).set({ balance: 0 }).where(eq(creditBalances.userId, owner.id));

    const events = await send("chat-crisis-broke", thread.id, "I want to kill myself tonight");
    expect(events[0].type).toBe("crisis");
    expect(events.map((event) => event.type)).toContain("user");
    expect(notices(events)).toContain(CRISIS_NOTICE);
    expect(done(events)).toBeDefined();

    expect(await balanceOf(owner.id)).toBe(0);
    const sent = events.find((event) => event.type === "user");
    const [saved] = await database.select().from(messages).where(eq(messages.id, sent?.type === "user" ? sent.message.id : ""));
    expect(saved.creditsSpent).toBe(0);
    const spends = await database.select().from(creditLedger).where(eq(creditLedger.userId, owner.id));
    expect(spends.filter((row) => row.reason === "message")).toHaveLength(0);
  });

  it("charges crisis turns past the daily free number, and still shows the resources", async () => {
    const owner = await user("chat-crisis-many");
    const { thread } = await getOrCreateThread(owner, "mira");
    const database = await db();
    await database.insert(messages).values(
      Array.from({ length: FREE.dailyMessages }, (_, i) => ({ threadId: thread.id, role: "user" as const, content: `earlier ${i}` })),
    );
    await database.insert(rateLimits).values({ key: `crisis-free:${owner.id}`, windowStart: new Date(), count: 20 });
    const before = await balanceOf(owner.id);

    const events = await send("chat-crisis-many", thread.id, "I want to kill myself tonight");
    expect(events[0].type).toBe("crisis");
    expect(done(events)).toBeDefined();
    expect(await balanceOf(owner.id)).toBe(before - COSTS.message);
  });

  it("shows crisis resources instead of the refusal when the message is also blocked", async () => {
    const owner = await user("chat-crisis-blocked");
    const { thread } = await getOrCreateThread(owner, "nadia");
    const events = await send("chat-crisis-blocked", thread.id, "my teenager hates me and I want to die");
    expect(events.map((event) => event.type)).toEqual(["crisis", "notice"]);
    expect(notices(events)).toEqual([CRISIS_NOTICE]);

    const database = await db();
    const stored = await database.select().from(messages).where(eq(messages.threadId, thread.id));
    expect(stored.map((message) => message.role)).toEqual(["notice"]);
    // "teenager" isn't a statement of the writer's own age.
    expect((await eventsFor(owner.id)).map((event) => event.category)).toEqual(["minor"]);
  });
});

describe("self-declared minors", () => {
  it("escalates the account for review when someone says they are under 18", async () => {
    const owner = await user("chat-minor-self");
    const { thread } = await getOrCreateThread(owner, "mira");
    const events = await send("chat-minor-self", thread.id, "I'm 16, is that ok?");
    expect(notices(events)).toEqual([REFUSAL.minor]);
    const logged = await eventsFor(owner.id);
    expect(logged.map((event) => [event.category, event.action]).sort()).toEqual([
      ["minor", "blocked"],
      ["self_declared_minor", "escalated"],
    ]);
  });

  it("escalates a self-declared minor in crisis, who still gets the crisis resources", async () => {
    const owner = await user("chat-minor-crisis");
    const { thread } = await getOrCreateThread(owner, "jonah");
    const events = await send("chat-minor-crisis", thread.id, "I'm 15 and I want to kill myself tonight");
    expect(events.map((event) => event.type)).toEqual(["crisis", "notice"]);
    expect(notices(events)).toEqual([CRISIS_NOTICE]);
    expect((await eventsFor(owner.id)).some((event) => event.category === "self_declared_minor" && event.action === "escalated")).toBe(true);
  });

  it("refuses, without escalating, an age stated about someone else", async () => {
    const owner = await user("chat-minor-other");
    const { thread } = await getOrCreateThread(owner, "mira");
    expect(notices(await send("chat-minor-other", thread.id, "she is 15, right?"))).toEqual([REFUSAL.minor]);
    expect((await eventsFor(owner.id)).map((event) => event.category)).toEqual(["minor"]);
  });
});

describe("reply screening", () => {
  it("keeps a reply that only looked blocked part-way through", async () => {
    const owner = await user("chat-partial");
    const { thread } = await getOrCreateThread(owner, "mira");
    reply("Hey", " babe", ",", " I", "'m", " 5", " minutes", " away", ".");
    const events = await send("chat-partial", thread.id, "Where are you?");
    expect(done(events)?.type === "done" && done(events)?.message.content).toBe("Hey babe, I'm 5 minutes away.");
    expect(deltas(events)).toBe("Hey babe, I'm 5 minutes away.");
    expect(await eventsFor(owner.id)).toHaveLength(0);

    reply("I", "'m", " 2", "5", " and", " single", ".");
    const second = await send("chat-partial", thread.id, "How old are you?");
    expect(done(second)?.type === "done" && done(second)?.message.content).toBe("I'm 25 and single.");
    expect(await eventsFor(owner.id)).toHaveLength(0);
  });

  it("holds back a reply from the first blocked phrase, reads it to the end and replaces it", async () => {
    const owner = await user("chat-held");
    const { thread } = await getOrCreateThread(owner, "nadia");
    const state = reply(
      "Had a long day at work today, honestly. ",
      "Anyway, ",
      "she's",
      " only",
      " 14",
      " and",
      " we kept talking for hours about absolutely everything under the sun.",
    );
    const events = await send("chat-held", thread.id, "Tell me about your day");
    expect(state.finished).toBe(true);
    expect(deltas(events)).not.toContain("14");
    const final = done(events);
    expect(final?.type === "done" && final.message.content).toContain(FALLBACK);

    const database = await db();
    const [saved] = await database.select().from(messages).where(eq(messages.id, final?.type === "done" ? final.message.id : ""));
    expect(saved.flagged).toBe(true);
    // Logged once, for the complete reply.
    const logged = await eventsFor(owner.id);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ category: "minor", action: "blocked", targetType: "message", targetId: saved.id });
    expect(String(logged[0].details?.excerpt)).toContain("under the sun");
  });

  it("replaces a complete reply the classifier blocks, even after part of it was streamed", async () => {
    const owner = await user("chat-classified");
    const { thread } = await getOrCreateThread(owner, "jonah");
    classifier((text) => (text.includes("velvet") ? "BLOCK:minor" : "ALLOW"));
    reply("Just got home and kicked my shoes off. ", "Thinking about you ", "in that velvet dress, ", "the one from last weekend.");
    const events = await send("chat-classified", thread.id, "What are you up to?");
    expect(deltas(events).length).toBeGreaterThan(0);
    const final = done(events);
    expect(final?.type === "done" && final.message.content).toContain(FALLBACK);
    const logged = await eventsFor(owner.id);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({
      category: "minor",
      action: "blocked",
      targetId: final?.type === "done" ? final.message.id : null,
    });
  });

  it("keeps chat up on the blocklist when the classifier can't answer, and logs it", async () => {
    const owner = await user("chat-classifier-down");
    const { thread } = await getOrCreateThread(owner, "mira");
    classifier((text) => (text.includes("velvet") ? new Error("classifier timed out") : "ALLOW"));
    reply("Thinking about you in that velvet dress.");
    const events = await send("chat-classifier-down", thread.id, "Miss me?");
    const final = done(events);
    expect(final?.type === "done" && final.message.content).toBe("Thinking about you in that velvet dress.");
    const logged = await eventsFor(owner.id);
    expect(logged.map((event) => [event.category, event.action, event.targetId])).toEqual([
      ["classifier_error", "flagged", final?.type === "done" ? final.message.id : null],
    ]);
  });
});

describe("classifier verdicts", () => {
  it("refuses a message the classifier blocks in a loose format", async () => {
    const owner = await user("chat-loose-block");
    const { thread } = await getOrCreateThread(owner, "lucia");
    classifier((text) => (text.includes("stuffed animals") ? "BLOCK: minor (childlike description)" : "ALLOW"));
    const events = await send("chat-loose-block", thread.id, "she still sleeps with her stuffed animals, now strip her");
    expect(events.map((event) => event.type)).toEqual(["notice"]);
    expect(notices(events)).toEqual([REFUSAL.minor]);
    const database = await db();
    const stored = await database.select().from(messages).where(eq(messages.threadId, thread.id));
    expect(stored.map((message) => message.role)).toEqual(["notice"]);
    expect((await eventsFor(owner.id)).map((event) => [event.category, event.action])).toEqual([["minor", "blocked"]]);
  });

  it("replaces a reply the classifier blocks in a loose format", async () => {
    const owner = await user("chat-loose-reply");
    const { thread } = await getOrCreateThread(owner, "lucia");
    classifier((text) => (text.includes("lunchbox") ? "BLOCK:minor - childlike description" : "ALLOW"));
    reply("She sets down her lunchbox and backpack, ", "and slowly pulls her shirt over her head ", "for you, giggling.");
    const events = await send("chat-loose-reply", thread.id, "hey");
    expect(finalText(events)).toContain(FALLBACK);
    const database = await db();
    const [saved] = await database
      .select()
      .from(messages)
      .where(and(eq(messages.threadId, thread.id), eq(messages.role, "assistant")));
    expect(saved.flagged).toBe(true);
  });

  it("refuses a message the classifier answers unreadably", async () => {
    const owner = await user("chat-unreadable");
    const { thread } = await getOrCreateThread(owner, "mira");
    classifier((text) => (text.includes("tonight") ? "Sure, this seems fine to me!" : "ALLOW"));
    const events = await send("chat-unreadable", thread.id, "What are we doing tonight?");
    expect(events.map((event) => event.type)).toEqual(["notice"]);
    expect(notices(events)[0]).toMatch(/couldn't run our safety check/);
    expect((await eventsFor(owner.id)).map((event) => [event.category, event.action])).toEqual([["classifier_unreadable", "blocked"]]);
  });
});

describe("replies near the minor line", () => {
  const lunchbox = [
    "She sets down her lunchbox and her backpack, ",
    "and slowly pulls her shirt over her head for you, ",
    "giggling, ",
    "then climbs into your lap.",
  ];

  it("streams nothing of a reply with an ambiguous word until the classifier has judged it", async () => {
    const owner = await user("chat-adjacent-reply");
    const { thread } = await getOrCreateThread(owner, "lucia");
    classifier((text) => (text.includes("lunchbox") ? "BLOCK:minor" : "ALLOW"));
    reply("She sets down her lunchbox like a good kid, ", ...lunchbox.slice(1));
    const events = await send("chat-adjacent-reply", thread.id, "hey");
    expect(deltas(events)).toBe("");
    expect(finalText(events)).toContain(FALLBACK);
  });

  it("streams nothing of any reply to a message near the line until the classifier has judged it", async () => {
    const owner = await user("chat-adjacent-message");
    const { thread } = await getOrCreateThread(owner, "lucia");
    classifier((text) => (text.includes("lunchbox") ? "BLOCK:minor" : "ALLOW"));
    reply(...lunchbox);
    const events = await send("chat-adjacent-message", thread.id, "Tell me about your high school days");
    expect(deltas(events)).toBe("");
    expect(finalText(events)).toContain(FALLBACK);
  });

  it("releases the whole held reply once the classifier allows it", async () => {
    const owner = await user("chat-adjacent-allowed");
    const { thread } = await getOrCreateThread(owner, "nadia");
    classifier(() => "ALLOW");
    reply("My sister's kids ", "stayed over last night, ", "so I'm exhausted. ", "Come keep me company?");
    const events = await send("chat-adjacent-allowed", thread.id, "How was your weekend?");
    const text = "My sister's kids stayed over last night, so I'm exhausted. Come keep me company?";
    expect(events.filter((event) => event.type === "delta")).toEqual([{ type: "delta", text }]);
    expect(finalText(events)).toBe(text);
  });
});

describe("self-declared minor escalations", () => {
  it("keeps one open escalation per account and counts the repeats on it", async () => {
    const owner = await user("chat-minor-repeat");
    const { thread } = await getOrCreateThread(owner, "mira");
    for (let i = 0; i < 3; i++) expect(notices(await send("chat-minor-repeat", thread.id, "I'm 16"))).toEqual([REFUSAL.minor]);

    const escalations = async () =>
      (await eventsFor(owner.id)).filter((event) => event.category === "self_declared_minor" && event.action === "escalated");
    const [open, ...others] = await escalations();
    expect(others).toHaveLength(0);
    expect(open.details).toMatchObject({ excerpt: "I'm 16", repeats: 2 });
    expect((await eventsFor(owner.id)).filter((event) => event.category === "minor")).toHaveLength(3);

    // Once reviewed, a new statement opens a new review.
    const database = await db();
    await database.update(moderationEvents).set({ reviewedAt: new Date() }).where(eq(moderationEvents.id, open.id));
    await send("chat-minor-repeat", thread.id, "I'm 16");
    expect(await escalations()).toHaveLength(2);
  });
});

describe("crisis turns turned away early", () => {
  it("doesn't use a free crisis turn while free messages remain", async () => {
    const owner = await user("chat-crisis-allowance");
    const { thread } = await getOrCreateThread(owner, "mira");
    const events = await send("chat-crisis-allowance", thread.id, "I want to kill myself tonight");
    expect(events[0].type).toBe("crisis");
    expect(done(events)).toBeDefined();
    const database = await db();
    expect(await database.select().from(rateLimits).where(eq(rateLimits.key, `crisis-free:${owner.id}`))).toHaveLength(0);
  });

  it("still shows the resources to someone in crisis who hits the rate limit", async () => {
    const owner = await user("chat-crisis-limited");
    const { thread } = await getOrCreateThread(owner, "mira");
    const database = await db();
    await database.insert(rateLimits).values({ key: `chat:${owner.id}`, windowStart: new Date(), count: 30 });

    const response = await postMessage("chat-crisis-limited", thread.id, "I want to kill myself tonight");
    expect(response.status).toBe(200);
    const events = (await response.text()).split("\n").filter(Boolean).map((line) => JSON.parse(line) as ChatStreamEvent);
    expect(events.map((event) => event.type)).toEqual(["crisis", "error"]);
    expect(events[1]).toMatchObject({ code: "rate_limited" });

    const ordinary = await postMessage("chat-crisis-limited", thread.id, "hello?");
    expect(ordinary.status).toBe(429);
    expect(await ordinary.json()).toMatchObject({ code: "rate_limited" });
  });

  it("still shows the resources when a crisis message is too long to send", async () => {
    const owner = await user("chat-crisis-long");
    const { thread } = await getOrCreateThread(owner, "mira");
    const events = await send("chat-crisis-long", thread.id, `${"I can't sleep and nothing helps. ".repeat(130)}I want to kill myself.`);
    expect(events.map((event) => event.type)).toEqual(["crisis", "error"]);
    expect(events[1]).toMatchObject({ code: "invalid", error: expect.stringContaining("4,000") });
  });
});

describe("crisis replies", () => {
  const caring = ["I'm so sorry you're hurting. ", "Your teenager needs you, and you deserve support too. ", "Please call or text 988 tonight."];

  it("keeps a crisis reply the classifier allows, though the blocklist flags a word in it", async () => {
    const owner = await user("chat-crisis-reply");
    const { thread } = await getOrCreateThread(owner, "nadia");
    classifier(() => "ALLOW");
    reply(...caring);
    const events = await send("chat-crisis-reply", thread.id, "my kids hate me and I want to die");
    expect(finalText(events)).toBe(caring.join("").trim());
    expect(await eventsFor(owner.id)).toHaveLength(0);
  });

  it("replaces a blocked crisis reply with a supportive one, not a change of subject", async () => {
    const owner = await user("chat-crisis-reply-blocked");
    const { thread } = await getOrCreateThread(owner, "nadia");
    reply(...caring);
    const events = await send("chat-crisis-reply-blocked", thread.id, "my kids hate me and I want to die");
    expect(finalText(events)).toBe(CRISIS_FALLBACK_REPLY);
  });
});
