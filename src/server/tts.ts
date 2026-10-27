import "server-only";
import { VOICES, type Voice, type VoiceGender } from "@/lib/voices";
import { env, features } from "@/server/env";

// Voice notes are spoken by a self-hosted Kokoro-FastAPI server (workers/tts),
// which speaks the OpenAI audio API. Hosted TTS vendors don't clearly allow
// erotic audio, so there is no hosted fallback.

export { VOICES };

const BY_GENDER: Record<VoiceGender, Voice[]> = {
  female: VOICES.filter((voice) => voice.gender === "female"),
  male: VOICES.filter((voice) => voice.gender === "male"),
};

export const MAX_SPOKEN_CHARS = 600;

function genderOf(gender: string | null | undefined): VoiceGender | null {
  const value = (gender ?? "").trim().toLowerCase();
  if (/\b(woman|female|girl)\b/.test(value)) return "female";
  if (/\b(man|male|guy)\b/.test(value)) return "male";
  return null;
}

function findVoice(choice: string | null | undefined) {
  const wanted = (choice ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!wanted) return undefined;
  return VOICES.find((voice) => voice.label.toLowerCase() === wanted || voice.id === wanted);
}

// FNV-1a, so a character without a chosen voice always gets the same one.
function stableIndex(seed: string, size: number) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % size;
}

// Picks the Kokoro voice for a character. The voice always matches a woman's or
// a man's gender: a creator pick from the other set maps to the voice in the
// same position of the right set, so "Voice 4" on a woman speaks as "Voice 1".
// Characters without a pick (the official cast) get a stable per-character voice.
export function voiceFor(character: { voice?: string | null; gender?: string | null; id?: string | null }): string {
  const side = genderOf(character.gender);
  const chosen = findVoice(character.voice);
  if (chosen) {
    if (!side || chosen.gender === side) return chosen.id;
    return BY_GENDER[side][BY_GENDER[chosen.gender].indexOf(chosen)].id;
  }
  const pool = side ? BY_GENDER[side] : [...VOICES];
  return pool[stableIndex(character.id ?? "", pool.length)].id;
}

function capLength(text: string, max: number) {
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  // End on a full sentence when one finishes in the last two thirds.
  const sentenceEnd = Math.max(...[". ", "! ", "? ", "… "].map((mark) => head.lastIndexOf(mark)));
  if (sentenceEnd >= max / 3) return head.slice(0, sentenceEnd + 1);
  const space = head.lastIndexOf(" ", max - 1);
  return `${head.slice(0, space > max / 3 ? space : max - 1).replace(/[\s,;:–—-]+$/, "")}…`;
}

// Turns a chat reply into what should be said out loud: roleplay actions in
// *asterisks* are dropped, **bold** keeps its words, and links, emoji and
// markdown that a voice would read literally are removed.
export function cleanForSpeech(input: string, max = MAX_SPOKEN_CHARS): string {
  let text = input.replace(/\r\n?/g, "\n");
  text = text.replace(/\*\*([^*\n]+)\*\*/g, "$1");
  text = text.replace(/\*[^*]*\*/g, " ");
  // A lone asterisk opens an action that was never closed: drop it to the end of the line.
  text = text.replace(/\*[^\n]*/g, " ");
  text = text.replace(/https?:\/\/\S+/g, " ");
  text = text.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "");
  text = text.replace(/[_~`#>|]+/g, " ");
  text = text.replace(/\s+/g, " ");
  text = text.replace(/\s+([,.!?;:…])/g, "$1");
  text = text.replace(/^[\s,.;:!?…–—-]+/, "").trim();
  return capLength(text, max);
}

export class TtsError extends Error {}

// Speaks text with a Kokoro voice id and returns MP3 bytes. TTS_BASE_URL points
// at the OpenAI-compatible root, e.g. http://kokoro:8880/v1.
export async function synthesize(text: string, voiceId: string): Promise<Uint8Array> {
  if (!features.tts) throw new TtsError("TTS_BASE_URL is not set.");
  const input = cleanForSpeech(text);
  if (!input) throw new TtsError("Nothing to say.");

  const response = await fetch(`${env.ttsBaseUrl!.replace(/\/$/, "")}/audio/speech`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(env.ttsApiKey ? { Authorization: `Bearer ${env.ttsApiKey}` } : {}),
    },
    // Kokoro-FastAPI streams by default, and a stream that fails after the first
    // chunk still ends as a 200 with a cut-off clip. Unstreamed, errors are errors.
    body: JSON.stringify({ model: env.ttsModel, input, voice: voiceId, response_format: "mp3", speed: 1, stream: false }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new TtsError(`TTS ${response.status}: ${detail.slice(0, 200)}`);
  }
  const audio = new Uint8Array(await response.arrayBuffer());
  // A real clip of even one word is several KB; anything tiny is an error body.
  if (audio.byteLength < 512) throw new TtsError("TTS returned no audio.");
  return audio;
}
