import { and, eq, isNull } from "drizzle-orm";
import { after, type NextRequest } from "next/server";
import { z } from "zod";
import { isMember, requireUser } from "@/server/auth";
import { balanceOf, chargeForMessage, freeMessagesLeft, lockUser, refund } from "@/server/credits";
import { db } from "@/server/db";
import { moderationEvents } from "@/server/db/schema";
import { CRISIS_FALLBACK_REPLY, CRISIS_NOTICE, crisisResources } from "@/server/crisis";
import { errorResponse, HttpError, route } from "@/server/http";
import { stream } from "@/server/llm";
import { rememberTurn, type TurnInput } from "@/server/memory";
import { buildChatPrompt } from "@/server/prompts";
import { rateLimit } from "@/server/ratelimit";
import { moderateText } from "@/server/safety/moderation";
import { checkText, declaresMinorAge, detectCrisis, minorAdjacent, REFUSAL } from "@/server/safety/text";
import { addMessage, deleteMessage, discloseIfDue, requireThread, toMessageDTO, touchThread } from "@/server/threads";
import type { ChatStreamEvent } from "@/lib/api-types";

// Every call at its timeout has to fit: moderating the message (15 s), the
// embedding that picks memories for the prompt (10 s), the reply stream (120 s),
// moderating the reply (15 s), then the memory work in after(), where
// extraction is the longest branch: an embedding to pick the memories it
// reconciles (10 s), the model (60 s), screening what it wrote (15 s) and
// embedding that (10 s). 255 s in all.
export const maxDuration = 300;

const body = z.object({
  content: z.string().trim().min(1, "Write something first.").max(4000, "Keep messages under 4,000 characters."),
});

// The blocklist needs a few characters past a word to see its boundary, and no
// blocked phrase is longer than this, so text is only streamed once this much
// newer text has arrived and been checked with it. The classifier only sees the
// complete reply, so a turn near the minor line isn't streamed at all until it
// has (see `held`). When it blocks any other reply, the client swaps what was
// streamed for the fallback saved in its place.
const HOLD_BACK = 48;
// How many of the latest history messages (both sides) can put a reply on hold.
const RECENT_TURNS_HELD = 4;

// Crisis turns are free so nobody is turned away mid-crisis, up to a daily
// number well past any real conversation. Only a turn that would otherwise be
// charged or capped uses one. Beyond them, crisis turns are charged like any
// other (the resources still show), so a crisis phrase isn't a way to chat for
// free.
const FREE_CRISIS_TURNS = 20;

async function freeCrisisTurn(userId: string) {
  try {
    await rateLimit(`crisis-free:${userId}`, FREE_CRISIS_TURNS, 24 * 60 * 60);
    return true;
  } catch (error) {
    if (error instanceof HttpError && error.status === 429) return false;
    throw error;
  }
}

const FALLBACK_REPLY = "Let's take this somewhere else. Tell me what's on your mind.";

const NDJSON = {
  "Content-Type": "application/x-ndjson; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Accel-Buffering": "no",
};

// A crisis turn turned away before it starts: the resources, then the error the
// client would have got. A stream, since that's where the chat page looks for them.
function turnedAway(failure: { error: string; code?: string }) {
  const events: ChatStreamEvent[] = [{ type: "crisis", resources: crisisResources() }, { type: "error", ...failure }];
  return new Response(events.map((event) => `${JSON.stringify(event)}\n`).join(""), { headers: NDJSON });
}

// Someone who says they're under 18 may well be: a person reviews the account
// (nothing is banned automatically). One open review per account, with repeats
// counted on it, so one account can't bury the rest of the queue.
async function escalateMinor(userId: string, threadId: string, content: string) {
  try {
    const database = await db();
    await database.transaction(async (tx) => {
      await lockUser(tx, userId);
      const [open] = await tx
        .select({ id: moderationEvents.id, details: moderationEvents.details })
        .from(moderationEvents)
        .where(
          and(
            eq(moderationEvents.userId, userId),
            eq(moderationEvents.category, "self_declared_minor"),
            eq(moderationEvents.action, "escalated"),
            isNull(moderationEvents.reviewedAt),
          ),
        )
        .limit(1);
      if (open) {
        const repeats = Number(open.details?.repeats ?? 0) + 1;
        await tx
          .update(moderationEvents)
          .set({ details: { ...open.details, repeats, lastAt: new Date().toISOString() } })
          .where(eq(moderationEvents.id, open.id));
        return;
      }
      await tx.insert(moderationEvents).values({
        userId,
        targetType: "message",
        targetId: threadId,
        category: "self_declared_minor",
        action: "escalated",
        details: { excerpt: content.slice(0, 280) },
      });
    });
  } catch (error) {
    console.error("Failed to escalate a self-declared minor", error);
  }
}

type Job = TurnInput & { threadId: string; skipFacts: boolean };

export const POST = route(async (request: NextRequest, ctx: RouteContext<"/api/threads/[id]/messages">) => {
  const { id } = await ctx.params;
  const user = await requireUser(request);
  const { thread, character } = await requireThread(user, id);
  const input: unknown = await request.json().catch(() => {
    throw new HttpError(400, "Send a JSON body.", "invalid");
  });
  // Checked before the rate limit and the length limit, so someone in crisis
  // who runs into either still sees where to get help. Only the start of an
  // oversized message is read.
  const raw = (input as { content?: unknown } | null)?.content;
  const crisis = typeof raw === "string" && detectCrisis(raw.slice(0, 20_000));
  let content: string;
  try {
    await rateLimit(`chat:${user.id}`, 30, 60);
    ({ content } = body.parse(input));
  } catch (error) {
    if (!crisis) throw error;
    return turnedAway(await errorResponse(error).json());
  }

  // Registered now, while the request scope exists; it waits for the stream to
  // hand over the finished turn, then updates memory after the response ends.
  let finish: (job: Job | null) => void = () => {};
  const finished = new Promise<Job | null>((resolve) => (finish = resolve));
  after(async () => {
    const job = await finished;
    if (!job) return;
    try {
      await rememberTurn(job);
    } catch (error) {
      console.error("Memory update failed", error);
    }
  });

  const encoder = new TextEncoder();
  const output = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (event: ChatStreamEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          // The client went away. Keep going so a paid reply is still saved.
          open = false;
        }
      };
      let job: Job | null = null;
      let userName = "the user";

      try {
        // Crisis resources go out before anything that could stop the turn:
        // moderation, credits, the daily cap.
        if (crisis) send({ type: "crisis", resources: crisisResources() });

        const verdict = await moderateText(content, { userId: user.id, targetType: "message", targetId: thread.id });
        if (!verdict.ok) {
          if ("category" in verdict && verdict.category === "minor" && declaresMinorAge(content)) {
            await escalateMinor(user.id, thread.id, content);
          }
          // The user's text is not stored; only the notice is. Someone in crisis
          // gets the supportive notice instead of a refusal.
          const notice = await addMessage({
            threadId: thread.id,
            role: "notice",
            content: crisis
              ? CRISIS_NOTICE
              : "category" in verdict
                ? REFUSAL[verdict.category]
                : "We couldn't run our safety check just now. Try again in a moment.",
          });
          send({ type: "notice", message: toMessageDTO(notice) });
          return;
        }

        // Charging and saving the message are one transaction under a per-user
        // lock: concurrent sends queue up, and each counts the one before it
        // against today's free allowance. A crisis turn isn't charged or turned
        // away for credits (up to FREE_CRISIS_TURNS a day). Whether it would be
        // charged is read before the lock, so a send racing it for the last
        // free message can still leave it charged.
        const userMessageId = crypto.randomUUID();
        let charged = 0;
        let userMessage;
        try {
          const free = crisis && (await freeMessagesLeft(user)) === 0 && (await freeCrisisTurn(user.id));
          const database = await db();
          ({ charged, userMessage } = await database.transaction(async (tx) => {
            await lockUser(tx, user.id);
            const cost = free ? 0 : await chargeForMessage(user, userMessageId, tx);
            const saved = await addMessage(
              { id: userMessageId, threadId: thread.id, role: "user", content, creditsSpent: cost },
              tx,
            );
            return { charged: cost, userMessage: saved };
          }));
        } catch (error) {
          if (error instanceof HttpError) {
            send({ type: "error", error: error.message, code: error.code });
            return;
          }
          throw error;
        }
        send({ type: "user", message: toMessageDTO(userMessage) });

        // Model failure: undo the turn as if it never happened, refund included.
        // The summary still gets a chance to catch up, since a history too long
        // for the model is one way a turn fails.
        const fail = async (error?: unknown) => {
          if (error) console.error("Chat model failed", error);
          await deleteMessage(userMessageId).catch((cause) => console.error("Failed to remove unanswered message", cause));
          if (charged) await refund(user.id, charged, userMessageId);
          send({
            type: "error",
            error: `${character.name} couldn't reply just now, and you weren't charged. Try sending it again.`,
            code: "model_error",
          });
          job = {
            threadId: thread.id,
            userId: user.id,
            characterId: character.id,
            userName,
            characterName: character.name,
            userText: "",
            replyText: "",
            skipFacts: true,
          };
        };

        try {
          if (crisis) {
            const notice = await addMessage({ threadId: thread.id, role: "notice", content: CRISIS_NOTICE });
            send({ type: "notice", message: toMessageDTO(notice) });
          }
          const disclosure = await discloseIfDue(thread, character.name);
          if (disclosure) send({ type: "notice", message: toMessageDTO(disclosure) });
        } catch (error) {
          await fail(error);
          return;
        }

        let reply = "";
        let shown = 0;
        // Near the minor line (an ambiguous word, a school, a young age in the
        // last few turns or the reply so far), nothing more goes out until the
        // classifier has judged the whole reply. Earlier turns count because a
        // reply can carry on a scene set up before the latest message.
        let held = minorAdjacent(content);
        try {
          const prompt = await buildChatPrompt({ user, character, thread, latest: content, crisis });
          userName = prompt.userName;
          held ||= prompt.messages.slice(-RECENT_TURNS_HELD).some((message) => message.role !== "system" && minorAdjacent(message.content));
          for await (const delta of stream(prompt.messages, { tier: isMember(user) ? "premium" : "default", maxTokens: 500 })) {
            reply += delta;
            held ||= minorAdjacent(reply);
            // A blocklist hit holds text back but doesn't end the turn: it may be
            // a reply cut mid-phrase ("I'm 5" before " minutes"). The complete
            // reply decides below.
            if (held || !checkText(reply).ok) continue;
            const safeEnd = reply.length - HOLD_BACK;
            if (safeEnd > shown) {
              send({ type: "delta", text: reply.slice(shown, safeEnd) });
              shown = safeEnd;
            }
          }
        } catch (error) {
          await fail(error);
          return;
        }
        const text = reply.trim();
        if (!text) {
          await fail(new Error("Empty reply from model"));
          return;
        }

        // The complete reply gets the full check (blocklist, then the
        // classifier) before it is saved or the rest of it shown. A classifier
        // outage keeps chat up on the blocklist alone, and is logged. A reply to
        // someone in crisis is the classifier's call: the blocklist would swap
        // "your teenager" for a change of subject.
        const assistantId = crypto.randomUUID();
        const replyVerdict = await moderateText(
          text,
          { userId: user.id, targetType: "message", targetId: assistantId, details: { source: "model_output" } },
          { classifierDecides: crisis },
        );
        const flagged = !replyVerdict.ok;
        const finalText = flagged ? (crisis ? CRISIS_FALLBACK_REPLY : FALLBACK_REPLY) : text;
        if (!flagged && reply.length > shown) send({ type: "delta", text: reply.slice(shown) });

        let assistant;
        try {
          assistant = await addMessage({ id: assistantId, threadId: thread.id, role: "assistant", content: finalText, flagged });
        } catch (error) {
          await fail(error);
          return;
        }
        await touchThread(thread.id, finalText).catch((error) => console.error("Updating the thread preview failed", error));

        send({
          type: "done",
          message: toMessageDTO(assistant),
          balance: await balanceOf(user.id),
          freeMessagesLeft: await freeMessagesLeft(user),
        });

        job = {
          threadId: thread.id,
          userId: user.id,
          characterId: character.id,
          userName,
          characterName: character.name,
          userText: content,
          replyText: flagged ? "" : finalText,
          sourceMessageId: userMessageId,
          memoryEpoch: thread.memoryEpoch,
          // Self-harm disclosures are health data; don't turn them into memories
          // (rememberTurn also skips the turns after one).
          skipFacts: crisis,
        };
      } catch (error) {
        console.error("Chat turn failed", error);
        send({ type: "error", error: "Something went wrong. Try again.", code: "server_error" });
      } finally {
        finish(job);
        if (open) {
          try {
            controller.close();
          } catch {
            // Already closed by the client.
          }
        }
      }
    },
  });

  return new Response(output, { headers: NDJSON });
});
