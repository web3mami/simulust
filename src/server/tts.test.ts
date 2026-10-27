import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanForSpeech, MAX_SPOKEN_CHARS, VOICES, voiceFor } from "@/server/tts";

const genderOfId = (id: string) => VOICES.find((voice) => voice.id === id)?.gender;

describe("voiceFor", () => {
  it("maps creator labels to Kokoro voices", () => {
    expect(voiceFor({ voice: "Voice 1", gender: "Woman" })).toBe("af_heart");
    expect(voiceFor({ voice: "Voice 3", gender: "Woman" })).toBe("af_nicole");
    expect(voiceFor({ voice: "Voice 4", gender: "Man" })).toBe("am_michael");
    expect(voiceFor({ voice: "Voice 6", gender: "Man" })).toBe("am_puck");
  });

  it("accepts labels loosely and raw voice ids", () => {
    expect(voiceFor({ voice: "  voice   2 ", gender: "Woman" })).toBe("af_bella");
    expect(voiceFor({ voice: "am_fenrir", gender: "Man" })).toBe("am_fenrir");
  });

  it("keeps the voice on the character's gender", () => {
    expect(voiceFor({ voice: "Voice 4", gender: "Woman" })).toBe("af_heart");
    expect(voiceFor({ voice: "Voice 6", gender: "Woman" })).toBe("af_nicole");
    expect(voiceFor({ voice: "Voice 2", gender: "Man" })).toBe("am_fenrir");
    expect(voiceFor({ voice: "Voice 1", gender: "Trans man" })).toBe("am_michael");
  });

  it("lets non-binary characters use any voice they picked", () => {
    expect(voiceFor({ voice: "Voice 5", gender: "Non-binary" })).toBe("am_fenrir");
    expect(voiceFor({ voice: "Voice 2", gender: "Non-binary" })).toBe("af_bella");
  });

  it("gives characters without a pick a stable voice of their gender", () => {
    for (const id of ["mira", "nadia", "lucia", "ren", "vesper", "kiko"]) {
      const voice = voiceFor({ id, gender: "Woman" });
      expect(genderOfId(voice)).toBe("female");
      expect(voiceFor({ id, gender: "Woman", voice: null })).toBe(voice);
    }
    for (const id of ["jonah", "leo", "mateo", "andre", "kai", "orion"]) {
      expect(genderOfId(voiceFor({ id, gender: "Man", voice: "" }))).toBe("male");
    }
    expect(VOICES.map((voice) => voice.id)).toContain(voiceFor({ id: "sable", gender: "Non-binary" }));
  });

  it("spreads the official cast across voices", () => {
    const picks = new Set(["mira", "aiko", "nadia", "amara", "lucia", "noor", "june", "ren", "yuna"].map((id) => voiceFor({ id, gender: "Woman" })));
    expect(picks.size).toBeGreaterThan(1);
  });

  it("ignores unknown labels", () => {
    expect(genderOfId(voiceFor({ voice: "Voice 9", gender: "Man", id: "x" }))).toBe("male");
  });
});

describe("cleanForSpeech", () => {
  it("drops roleplay actions", () => {
    expect(cleanForSpeech("*leans closer* Hey you. *bites lip* Missed me?")).toBe("Hey you. Missed me?");
  });

  it("drops actions that span lines and keeps bold words", () => {
    expect(cleanForSpeech("*pulls you in,\nslowly* I **really** want you.")).toBe("I really want you.");
  });

  it("drops an action that was never closed", () => {
    expect(cleanForSpeech("Come here. *takes your hand and")).toBe("Come here.");
    expect(cleanForSpeech("Hi.\n*smiles\nStill there?")).toBe("Hi. Still there?");
  });

  it("removes links, emoji and markdown", () => {
    expect(cleanForSpeech("Look 😘🔥 at this https://example.com/x _now_ ~please~")).toBe("Look at this now please");
  });

  it("tidies punctuation left behind", () => {
    expect(cleanForSpeech("*sighs*, fine *laughs* .")).toBe("fine.");
  });

  it("returns nothing when the reply is only actions", () => {
    expect(cleanForSpeech("*smiles* *waves*")).toBe("");
    expect(cleanForSpeech("   ")).toBe("");
  });

  it("caps long replies at a sentence end", () => {
    const sentence = "This is a sentence that keeps going for a while. ";
    const text = cleanForSpeech(sentence.repeat(40));
    expect(text.length).toBeLessThanOrEqual(MAX_SPOKEN_CHARS);
    expect(text.length).toBeGreaterThan(MAX_SPOKEN_CHARS / 2);
    expect(text.endsWith("while.")).toBe(true);
  });

  it("caps long replies without sentences at a word", () => {
    const text = cleanForSpeech("word ".repeat(300));
    expect(text.length).toBeLessThanOrEqual(MAX_SPOKEN_CHARS);
    expect(text.endsWith("word…")).toBe(true);
  });

  it("is stable when run twice", () => {
    const once = cleanForSpeech(`*grins* ${"Okay, listen to me. ".repeat(50)}`);
    expect(cleanForSpeech(once)).toBe(once);
  });
});

describe("synthesize", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("refuses to run without TTS_BASE_URL", async () => {
    vi.stubEnv("TTS_BASE_URL", "");
    vi.resetModules();
    const { synthesize } = await import("@/server/tts");
    await expect(synthesize("Hello", "af_heart")).rejects.toThrow(/TTS_BASE_URL/);
  });

  it("posts cleaned text to the OpenAI-compatible speech endpoint", async () => {
    vi.stubEnv("TTS_BASE_URL", "http://kokoro.test/v1/");
    vi.stubEnv("TTS_API_KEY", "secret");
    vi.resetModules();
    const fetchMock = vi.fn(async () => new Response(new Uint8Array(4096), { headers: { "Content-Type": "audio/mpeg" } }));
    vi.stubGlobal("fetch", fetchMock);
    const { synthesize } = await import("@/server/tts");

    const audio = await synthesize("*smiles* Hi there.", "af_bella");

    expect(audio.byteLength).toBe(4096);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://kokoro.test/v1/audio/speech");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer secret");
    expect(JSON.parse(String(init.body))).toEqual({
      model: "kokoro",
      input: "Hi there.",
      voice: "af_bella",
      response_format: "mp3",
      speed: 1,
      // A streamed clip that breaks halfway would still arrive as a 200.
      stream: false,
    });
  });

  it("fails on an error response", async () => {
    vi.stubEnv("TTS_BASE_URL", "http://kokoro.test/v1");
    vi.resetModules();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("voice not found", { status: 400 })));
    const { synthesize } = await import("@/server/tts");
    await expect(synthesize("Hello", "af_nope")).rejects.toThrow(/TTS 400/);
  });
});
