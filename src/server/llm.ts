import "server-only";
import { env, features } from "@/server/env";

// One client for any OpenAI-compatible endpoint: DeepInfra, Featherless,
// OpenRouter, or a self-hosted vLLM. Switching provider is an env change, so a
// provider that drops adult content can be replaced within hours.

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type ChatOptions = {
  tier?: "default" | "premium" | "utility";
  temperature?: number;
  maxTokens?: number;
  json?: boolean;
  signal?: AbortSignal;
};

function modelFor(tier: ChatOptions["tier"] = "default") {
  if (tier === "premium") return env.llmPremiumModel ?? env.llmModel;
  if (tier === "utility") return env.llmUtilityModel ?? env.llmModel;
  return env.llmModel;
}

// Optional provider-specific fields, e.g. for OpenRouter:
// LLM_EXTRA_BODY={"provider":{"only":["deepinfra"],"allow_fallbacks":false,"data_collection":"deny"}}
function extraBody(): Record<string, unknown> {
  const raw = process.env.LLM_EXTRA_BODY;
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    console.warn("LLM_EXTRA_BODY is not valid JSON; ignoring it.");
    return {};
  }
}

function request(messages: ChatMessage[], options: ChatOptions, stream: boolean) {
  return fetch(`${env.llmBaseUrl!.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.llmApiKey}`,
    },
    body: JSON.stringify({
      ...extraBody(),
      model: modelFor(options.tier),
      messages,
      stream,
      temperature: options.temperature ?? 0.85,
      max_tokens: options.maxTokens ?? 400,
      ...(options.json ? { response_format: { type: "json_object" } } : {}),
    }),
    signal: options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(stream ? 120_000 : 60_000)])
      : AbortSignal.timeout(stream ? 120_000 : 60_000),
  });
}

export class LlmError extends Error {}

export async function complete(messages: ChatMessage[], options: ChatOptions = {}): Promise<string> {
  if (!features.llm) return mockReply(messages, options);
  const response = await request(messages, options, false);
  if (!response.ok) {
    throw new LlmError(`LLM ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content?.trim() ?? "";
}

// Yields text deltas as they arrive.
export async function* stream(messages: ChatMessage[], options: ChatOptions = {}): AsyncGenerator<string> {
  if (!features.llm) {
    const reply = mockReply(messages, options);
    for (const word of reply.split(/(?<=\s)/)) {
      await new Promise((resolve) => setTimeout(resolve, 18));
      yield word;
    }
    return;
  }

  // Our own controller, so a caller that stops early (a flagged reply, a
  // disconnect) closes the provider connection instead of paying for tokens.
  const controller = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  const response = await request(messages, { ...options, signal }, true);
  if (!response.ok || !response.body) {
    throw new LlmError(`LLM ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") return;
        try {
          const chunk = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] };
          const delta = chunk.choices?.[0]?.delta?.content;
          if (delta) yield delta;
        } catch {
          // Ignore keep-alives and partial frames.
        }
      }
    }
  } finally {
    controller.abort();
    reader.cancel().catch(() => {});
  }
}

// Returns one vector per input, or null when embeddings aren't configured.
// Memory still works without them (recency and pinned facts only).
export async function embed(texts: string[]): Promise<number[][] | null> {
  if (!features.embeddings || texts.length === 0) return null;
  const response = await fetch(`${env.embedBaseUrl!.replace(/\/$/, "")}/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.embedApiKey}` },
    body: JSON.stringify({ model: env.embedModel, input: texts, encoding_format: "float" }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    console.warn(`Embeddings ${response.status}: ${(await response.text()).slice(0, 200)}`);
    return null;
  }
  const data = (await response.json()) as { data?: { embedding: number[]; index: number }[] };
  const vectors = (data.data ?? []).sort((a, b) => a.index - b.index).map((row) => row.embedding);
  if (vectors.length !== texts.length || vectors.some((vector) => vector.length !== 1024)) {
    console.warn("Embedding model must return 1024 dimensions (memories.embedding is vector(1024)).");
    return null;
  }
  return vectors;
}

// Local stand-in so the whole app runs with no LLM account. Never used in
// production (assertProductionConfig refuses to start without LLM_*).
function mockReply(messages: ChatMessage[], options: ChatOptions) {
  if (options.json) return "{}";
  const last = [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
  const system = messages.find((message) => message.role === "system")?.content ?? "";
  const name = system.match(/You are ([^,.\n]+)/)?.[1] ?? "me";
  if (options.tier === "utility") return "";
  return `(${name}, dev reply — no LLM_BASE_URL set) You said: "${last.slice(0, 140)}". Connect a model in .env.local and I'll answer properly.`;
}
