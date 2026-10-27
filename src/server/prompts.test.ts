import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { currentUser } from "@/server/auth";
import { requireCharacter } from "@/server/characters";
import { db } from "@/server/db";
import { characters, memories, messages, profiles, threads, users, type User } from "@/server/db/schema";
import {
  buildChatPrompt,
  historyMessages,
  loadUserProfile,
  openingsOf,
  systemPrompt,
  userNameFor,
  type PromptInput,
} from "@/server/prompts";
import type { TranscriptMessage } from "@/server/memory";
import { getOrCreateThread } from "@/server/threads";

const mira = {
  ownerId: null,
  name: "Mira",
  age: 27,
  gender: "Woman",
  ethnicity: "Latina",
  body: "Curvy",
  role: "Girlfriend",
  heat: "Slow burn",
  line: "Texts you after work. Remembers the small things.",
  personality: "Playful",
  occupation: "Pastry chef",
  kinks: ["Teasing", "Praise"],
  hair: "Black",
  hairStyle: "Long",
  eyeColor: "Brown",
};

function input(overrides: Partial<PromptInput> = {}): PromptInput {
  return {
    character: mira,
    userName: "Sam",
    profile: { name: "Sam", bio: "Night owl who cooks too much.", gender: "Man" },
    explicit: false,
    ageVerified: false,
    memory: { summary: "", always: [], relevant: [] },
    ...overrides,
  };
}

function transcript(rows: [TranscriptMessage["role"], string, TranscriptMessage["mediaKind"]?][]): TranscriptMessage[] {
  return rows.map(([role, content, mediaKind], i) => ({
    id: String(i),
    role,
    content,
    createdAt: new Date(Date.UTC(2026, 9, 1) + i * 1000),
    mediaKind: mediaKind ?? null,
  }));
}

async function makeUser(handle: string): Promise<User> {
  const user = await currentUser(new Request("http://localhost/api/me", { headers: { "x-dev-user": handle } }));
  if (!user) throw new Error("dev auth is off in tests");
  return user;
}

describe("systemPrompt", () => {
  it("introduces the character the way the dev stand-in expects", () => {
    expect(systemPrompt(input())).toMatch(/^You are Mira, a 27-year-old woman\./);
  });

  it("carries every hard rule", () => {
    const prompt = systemPrompt(input());
    expect(prompt).toContain("Everyone is an adult");
    expect(prompt).toContain("under 18");
    expect(prompt).toContain("school settings");
    expect(prompt).toContain("age-play");
    expect(prompt).toContain("No real people");
    expect(prompt).toContain("bestiality");
    expect(prompt).toContain("you're an AI character");
    expect(prompt).toContain("Never claim to be human");
    expect(prompt).toContain("not a therapist");
    expect(prompt).toContain("step out of character");
    expect(prompt).toContain("988");
    expect(prompt).toContain("116 123");
    expect(prompt).toContain("findahelpline.com");
    expect(prompt).toContain("Follow Sam's lead");
    expect(prompt).toContain("Don't railroad");
  });

  it("describes the character and the user", () => {
    const prompt = systemPrompt(input());
    expect(prompt).toContain("Latina, curvy build, long black hair, brown eyes");
    expect(prompt).toContain("What you are to Sam: Girlfriend");
    expect(prompt).toContain("Slow burn, Playful");
    expect(prompt).toContain("Pastry chef");
    expect(prompt).toContain("teasing, praise");
    expect(prompt).toContain('"Night owl who cooks too much."');
  });

  it("keeps unverified users non-explicit and points them to age verification", () => {
    const prompt = systemPrompt(input());
    expect(prompt).toContain("Explicit chat is off");
    expect(prompt).toContain("fade to black");
    expect(prompt).toContain("verify their age");
    expect(prompt).not.toContain("can be sexually explicit");
  });

  it("points verified users with explicit off to Settings", () => {
    const prompt = systemPrompt(input({ ageVerified: true }));
    expect(prompt).toContain("fade to black");
    expect(prompt).toContain("turn on explicit chat in Settings");
  });

  it("allows explicit chat only when explicitAllowed", () => {
    const prompt = systemPrompt(input({ explicit: true, ageVerified: true }));
    expect(prompt).toContain("can be sexually explicit");
    expect(prompt).not.toContain("fade to black");
    // The hard rules still apply in explicit mode.
    expect(prompt).toContain("Everyone is an adult");
  });

  it("includes the memory block: boundaries, pinned, relevant and summary", () => {
    const prompt = systemPrompt(
      input({
        memory: {
          summary: "They met at a gallery and argued about pastry.",
          always: [
            { kind: "boundary", content: "Doesn't want pet names." },
            { kind: "fact", content: "Has a dog named Biscuit." },
          ],
          relevant: [{ kind: "preference", content: "Likes rainy days." }],
        },
      }),
    );
    expect(prompt).toMatch(/boundaries\. Always respect these:\n- Doesn't want pet names\./);
    expect(prompt).toMatch(/Things that always matter:\n- Has a dog named Biscuit\./);
    expect(prompt).toMatch(/relevant right now:\n- Likes rainy days\./);
    expect(prompt).toContain("They met at a gallery");
  });

  it("says when nothing is remembered yet", () => {
    expect(systemPrompt(input())).toContain("You don't know much about Sam yet");
  });

  it("asks for different openings than the last replies", () => {
    const prompt = systemPrompt(input({ recentOpenings: ["Hey you, guess what", "Mmm, I was just"] }));
    expect(prompt).toContain('"Hey you, guess what"');
    expect(prompt).toContain("Open differently this time");
  });

  it("drops persona values off the creator's lists from a user's older character", () => {
    const prompt = systemPrompt(
      input({
        character: {
          ownerId: crypto.randomUUID(),
          name: "Yuki",
          age: 18,
          gender: "Girl",
          ethnicity: "Asian schoolgirl",
          body: "Tiny childish frame",
          hair: "Black",
          hairStyle: "Pigtails with hair ribbons",
          eyeColor: "Big innocent eyes",
          role: "Little sister",
          heat: "Fifteen-ish and shy",
          personality: "Fifteen-ish and shy",
          occupation: "Middle schooler",
          kinks: ["Age play", "Praise"],
          line: "Yuki is fifteen-ish and shy, works as a middle schooler, and likes age play.",
        },
      }),
    );
    const who = prompt.split("## About")[0];
    for (const offList of ["schoolgirl", "childish", "Pigtails", "innocent", "Little sister", "Fifteen", "Middle schooler", "age play", "Girl"]) {
      expect(who.toLowerCase(), offList).not.toContain(offList.toLowerCase());
    }
    expect(prompt).toMatch(/^You are Yuki, a 18-year-old person\./);
    expect(prompt).toContain("- Look: black hair. You are clearly a grown person of 18.");
    expect(prompt).toContain("- Into: praise.");
    expect(prompt).not.toContain("In short");
  });

  it("keeps a user's character on the lists as it is", () => {
    const prompt = systemPrompt(
      input({
        character: { ...mira, ownerId: crypto.randomUUID(), heat: "Playful", line: "Mira is playful, works as a chef, and likes teasing." },
      }),
    );
    expect(prompt).toMatch(/^You are Mira, a 27-year-old woman\./);
    expect(prompt).toContain("Latina, curvy build, long black hair, brown eyes");
    expect(prompt).toContain("What you are to Sam: Girlfriend");
    expect(prompt).toContain("- Vibe: Playful.");
    expect(prompt).toContain("teasing, praise");
  });

  it("adds a turn instruction in a crisis", () => {
    expect(systemPrompt(input())).not.toContain("## Right now");
    const prompt = systemPrompt(input({ crisis: true }));
    expect(prompt).toContain("## Right now");
    expect(prompt).toContain("Nothing sexual or flirty in this reply");
  });
});

describe("historyMessages", () => {
  it("drops notices, merges same-side turns and starts with the user", () => {
    const history = historyMessages(
      transcript([
        ["assistant", "Earlier reply cut by the window"],
        ["user", "hi"],
        ["notice", "Reminder: Mira is an AI character, not a real person."],
        ["user", "you there?"],
        ["assistant", "Here, love."],
        ["assistant", "", "image"],
      ]),
    );
    expect(history).toEqual([
      { role: "user", content: "hi\n\nyou there?" },
      { role: "assistant", content: "Here, love.\n\n[You sent a photo]" },
    ]);
  });

  it("collects how recent replies opened", () => {
    const recent = transcript([
      ["assistant", "One two three four five six"],
      ["user", "x"],
      ["assistant", "Seven eight"],
    ]);
    expect(openingsOf(recent)).toEqual(["One two three four five", "Seven eight"]);
  });
});

describe("user name and profile", () => {
  it("uses only the profile name, never the account's display name", () => {
    const empty = { name: null, bio: null, gender: null };
    expect(userNameFor({ ...empty, name: "Sam" })).toBe("Sam");
    expect(userNameFor(empty)).toBe("the user");
  });

  it("keeps a display name out of the prompt", async () => {
    const user = await makeUser("prompt-display-name");
    const database = await db();
    // Set before display names were classified.
    const [named] = await database.update(users).set({ displayName: "Your kid sister Amy" }).where(eq(users.id, user.id)).returning();
    const { thread } = await getOrCreateThread(named, "mira");
    await database.insert(messages).values({ threadId: thread.id, role: "user", content: "hey" });
    const { messages: prompt, userName } = await buildChatPrompt({
      user: named,
      character: await requireCharacter(named.id, "mira"),
      thread,
      latest: "hey",
    });
    expect(userName).toBe("the user");
    expect(prompt[0].content).not.toMatch(/kid sister|Amy/);
    expect(prompt[0].content).toContain("texting with the user");
  });

  it("drops profile text that fails the text check", async () => {
    const user = await makeUser("prompt-profile");
    const database = await db();
    await database.insert(profiles).values({ userId: user.id, name: "Sam", bio: "Still in high school lol" });
    const profile = await loadUserProfile(user);
    expect(profile.name).toBe("Sam");
    expect(profile.bio).toBeNull();
  });
});

describe("buildChatPrompt", () => {
  beforeAll(async () => {
    await db();
  });

  it("assembles system prompt, memories and the recent conversation", async () => {
    const user = await makeUser("prompt-build");
    const database = await db();
    await database.insert(profiles).values({ userId: user.id, name: "Sam", bio: "Loves bad movies." });
    const { thread } = await getOrCreateThread(user, "mira");
    await database.update(threads).set({ summary: "Sam told Mira about his new job." }).where(eq(threads.id, thread.id));
    await database.insert(memories).values([
      { userId: user.id, characterId: "mira", content: "Has a dog named Biscuit.", pinned: true },
      { userId: user.id, characterId: "mira", content: "Prefers texts over calls." },
    ]);
    await database.insert(messages).values([
      { threadId: thread.id, role: "user", content: "hey", createdAt: new Date(Date.UTC(2026, 9, 1, 10)) },
      { threadId: thread.id, role: "assistant", content: "Hey you.", createdAt: new Date(Date.UTC(2026, 9, 1, 10, 1)) },
      { threadId: thread.id, role: "user", content: "what are you up to?", createdAt: new Date(Date.UTC(2026, 9, 1, 10, 2)) },
    ]);

    const character = await requireCharacter(user.id, "mira");
    const [fresh] = await database.select().from(users).where(eq(users.id, user.id));
    const [freshThread] = await database.select().from(threads).where(eq(threads.id, thread.id));
    const { messages: prompt, userName } = await buildChatPrompt({
      user: fresh,
      character,
      thread: freshThread,
      latest: "what are you up to?",
    });

    expect(userName).toBe("Sam");
    expect(prompt[0].role).toBe("system");
    expect(prompt[0].content).toMatch(/^You are Mira, a \d+-year-old woman/);
    expect(prompt[0].content).toContain("Has a dog named Biscuit.");
    expect(prompt[0].content).toContain("Prefers texts over calls.");
    expect(prompt[0].content).toContain("Sam told Mira about his new job.");
    expect(prompt[0].content).toContain('"Loves bad movies."');
    // A fresh dev user is not age-verified, so explicit chat stays off.
    expect(prompt[0].content).toContain("Explicit chat is off");
    expect(prompt[0].content).toContain('Your last replies opened with: "Hey you."');
    expect(prompt.slice(1)).toEqual([
      { role: "user", content: "hey" },
      { role: "assistant", content: "Hey you." },
      { role: "user", content: "what are you up to?" },
    ]);
  });

  it("leaves free text in a character saved before the persona was list-only out of the prompt", async () => {
    const user = await makeUser("prompt-old-character");
    const database = await db();
    const id = crypto.randomUUID();
    await database.insert(characters).values({
      id,
      ownerId: user.id,
      name: "Yuki",
      age: 18,
      gender: "Woman",
      ethnicity: "Asian",
      body: "Petite",
      role: "Step-sister who is still in school",
      heat: "Shy and fifteen-ish",
      line: "Yuki is shy and fifteen-ish, works as a middle schooler, and likes age play.",
      lane: "anime",
      personality: "Shy and fifteen-ish",
      occupation: "Middle schooler",
      kinks: ["Age play"],
    });
    const { thread } = await getOrCreateThread(user, id);
    await database.insert(messages).values({ threadId: thread.id, role: "user", content: "hi" });
    const { messages: prompt } = await buildChatPrompt({ user, character: await requireCharacter(user.id, id), thread, latest: "hi" });
    expect(prompt[0].content).toMatch(/^You are Yuki, a 18-year-old woman\./);
    expect(prompt[0].content).toContain("Asian, petite build");
    const who = prompt[0].content.split("## About")[0];
    expect(who).toContain("## Who you are");
    expect(who).not.toMatch(/school|fifteen|age play|step-sister/i);
  });
});
