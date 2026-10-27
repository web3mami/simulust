import "server-only";
import https from "node:https";
import { env, isProduction } from "@/server/env";

// Image generation behind one function, chosen by IMAGE_PROVIDER:
// - worker: our self-hosted GPU worker (workers/media). The only production option.
// - pollinations: a free public endpoint for trying real images locally. Dev only:
//   it is a third party we have no agreement with and it ignores our safety prompts.
// - mock: a deterministic SVG so the whole app works offline.
//
// Worker contract (implemented in workers/media/app.py):
//   POST {IMAGE_API_URL}/v1/images
//   Authorization: Bearer {IMAGE_API_KEY}
//   { prompt, negative_prompt, width, height, seed, lora, style }
//   200 -> image bytes (image/png | image/jpeg | image/webp), X-Seed header
//   422 -> { error: "blocked", reason } when the worker's own safety check refuses
//   4xx/5xx -> { error }, or FastAPI's { detail } for a request it can't validate (also 422)

export type ImageStyle = "realistic" | "anime";

export type ImageRequest = {
  prompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  seed?: number;
  loraId?: string | null;
  style: ImageStyle;
  // Shown on mock images so a developer can tell them apart.
  label?: string;
};

export type GeneratedImage = {
  bytes: Uint8Array;
  mimeType: string;
  provider: "worker" | "pollinations" | "mock";
  seed: number | null;
};

export class ImageGenerationError extends Error {
  constructor(
    message: string,
    // The worker refused on safety grounds: treat like a moderation block.
    public blocked = false,
    // The worker's reason for a block, e.g. "minor:teen".
    public reason: string | null = null,
  ) {
    super(message);
  }
}

// An error response from the media worker (images and video). The body is read
// once, as text: it is usually our JSON, but FastAPI's validation errors are
// also 422s, and a proxy in front may answer with HTML.
export async function readWorkerError(response: Response): Promise<{ detail: string; blockedReason: string | null }> {
  const text = await response.text().catch(() => "");
  const body = parseJson(text) as { error?: unknown; reason?: unknown } | null;
  const blocked = response.status === 422 && body?.error === "blocked";
  return {
    detail: text.slice(0, 300),
    blockedReason: blocked ? (typeof body?.reason === "string" && body.reason ? body.reason : "safety") : null,
  };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// The moderation category for a worker refusal. Its reasons start with what
// was found: "minor:teen" (a rule the worker shares with checkText), "apparent
// minor: loli:0.91" (its anime tagger), "real_person:deepfake". "term:kid" is
// one of its image-only words ("a minor tilt of the head"), which says nothing
// about anyone, so it stays a plain worker refusal.
export function workerRefusalCategory(reason: string) {
  if (/^(?:minor:|apparent minor\b)/i.test(reason)) return "minor";
  if (/^real_person\b/i.test(reason)) return "real_person";
  return "worker_refused";
}

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MIN_IMAGE_BYTES = 1000;

export async function generateImage(request: ImageRequest): Promise<GeneratedImage> {
  const width = clampSize(request.width);
  const height = clampSize(request.height);
  const seed = request.seed ?? Math.floor(Math.random() * 2_147_483_647);
  const normalized = { ...request, width, height, seed };

  switch (env.imageProvider) {
    case "worker":
      return fromWorker(normalized);
    case "pollinations":
      if (isProduction) throw new ImageGenerationError("IMAGE_PROVIDER=pollinations is for local development only.");
      return fromPollinations(normalized);
    case "mock":
      if (isProduction) throw new ImageGenerationError("IMAGE_PROVIDER=mock is for local development only.");
      return { bytes: mockImage({ ...normalized, seed: request.seed }), mimeType: "image/svg+xml", provider: "mock", seed };
    default:
      throw new ImageGenerationError(`Unknown IMAGE_PROVIDER "${String(env.imageProvider)}".`);
  }
}

// Diffusion models want multiples of 16 and fall apart far outside ~1MP.
function clampSize(value: number) {
  const size = Number.isFinite(value) ? Math.round(value) : 1024;
  return Math.min(1536, Math.max(256, Math.round(size / 16) * 16));
}

type Normalized = ImageRequest & { width: number; height: number; seed: number };

async function fromWorker(request: Normalized): Promise<GeneratedImage> {
  if (!env.imageApiUrl) throw new ImageGenerationError("IMAGE_PROVIDER=worker needs IMAGE_API_URL.");
  const lora = request.loraId && /^[a-z0-9_-]{1,64}$/i.test(request.loraId) ? request.loraId : null;
  let response: Response;
  try {
    response = await fetch(`${env.imageApiUrl.replace(/\/$/, "")}/v1/images`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(env.imageApiKey ? { Authorization: `Bearer ${env.imageApiKey}` } : {}),
      },
      body: JSON.stringify({
        prompt: request.prompt,
        negative_prompt: request.negativePrompt,
        width: request.width,
        height: request.height,
        seed: request.seed,
        lora,
        style: request.style,
      }),
      // Cold starts load a model onto the GPU; warm generations take seconds.
      signal: AbortSignal.timeout(110_000),
    });
  } catch (error) {
    throw new ImageGenerationError(`Image worker unreachable: ${String(error)}`);
  }

  if (!response.ok) {
    const failure = await readWorkerError(response);
    if (failure.blockedReason !== null) {
      throw new ImageGenerationError(`Image worker refused: ${failure.blockedReason}`, true, failure.blockedReason);
    }
    throw new ImageGenerationError(`Image worker ${response.status}: ${failure.detail}`);
  }

  const mimeType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!IMAGE_TYPES.includes(mimeType) || bytes.byteLength < MIN_IMAGE_BYTES) {
    throw new ImageGenerationError(`Image worker returned ${mimeType || "no type"} (${bytes.byteLength} bytes).`);
  }
  const returnedSeed = Number(response.headers.get("x-seed"));
  return { bytes, mimeType, provider: "worker", seed: Number.isFinite(returnedSeed) ? returnedSeed : request.seed };
}

type Fetched = { status: number; type: string; body: Buffer };

// Plain https.get rather than fetch: pollinations answers fetch's default
// headers with 403s and redirects that fetch handles poorly.
function fetchPollinations(url: string, redirects = 0): Promise<Fetched> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { Referer: "https://pollinations.ai/", "User-Agent": "Mozilla/5.0" } }, (res) => {
      const status = res.statusCode ?? 0;
      const location = res.headers.location;
      if (status >= 300 && status < 400 && location && redirects < 3) {
        res.resume();
        resolve(fetchPollinations(new URL(location, url).toString(), redirects + 1));
        return;
      }
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => resolve({ status, type: String(res.headers["content-type"] ?? ""), body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    req.setTimeout(45_000, () => req.destroy(new Error("Pollinations timed out.")));
  });
}

async function fromPollinations(request: Normalized): Promise<GeneratedImage> {
  let seed = request.seed;
  for (let attempt = 0; attempt < 3; attempt++) {
    const url =
      `https://image.pollinations.ai/prompt/${encodeURIComponent(request.prompt)}` +
      `?width=${request.width}&height=${request.height}&nologo=true&enhance=false&seed=${seed}` +
      `&negative_prompt=${encodeURIComponent(request.negativePrompt.slice(0, 500))}`;
    const image = await fetchPollinations(url).catch((error: unknown) => ({ status: 0, type: "", body: Buffer.from(String(error)) }));
    const mimeType = image.type.split(";")[0].trim().toLowerCase();
    if (image.status === 200 && IMAGE_TYPES.includes(mimeType) && image.body.byteLength >= MIN_IMAGE_BYTES) {
      return { bytes: new Uint8Array(image.body), mimeType, provider: "pollinations", seed };
    }
    seed = (seed + 1) % 2_147_483_647;
    await new Promise((resolve) => setTimeout(resolve, image.status === 429 ? 2000 : 500));
  }
  throw new ImageGenerationError("Pollinations didn't return an image.");
}

function hash(text: string) {
  let value = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 0x01000193);
  }
  return value >>> 0;
}

function escapeXml(text: string) {
  return text.replace(/[<>&"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

// Same request, same picture: handy for tests and for spotting regenerations.
export function mockImage(request: Pick<ImageRequest, "prompt" | "width" | "height" | "style" | "label"> & { seed?: number }) {
  const key = hash(`${request.label ?? ""}|${request.prompt}|${request.seed ?? 0}`);
  const hue = key % 360;
  const second = (hue + 40 + (key >> 9) % 80) % 360;
  const { width, height } = request;
  const name = escapeXml((request.label ?? "Simulust").slice(0, 40));
  const style = request.style === "anime" ? "anime" : "realistic";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="hsl(${hue} 45% 34%)"/><stop offset="1" stop-color="hsl(${second} 35% 12%)"/>
</linearGradient></defs>
<rect width="100%" height="100%" fill="url(#g)"/>
<circle cx="${width / 2}" cy="${height * 0.38}" r="${Math.min(width, height) * 0.16}" fill="#f3efe6" fill-opacity="0.14"/>
<rect x="${width * 0.28}" y="${height * 0.56}" width="${width * 0.44}" height="${height * 0.3}" rx="${width * 0.12}" fill="#f3efe6" fill-opacity="0.1"/>
<text x="50%" y="${height * 0.9}" text-anchor="middle" font-family="Georgia, serif" font-size="${Math.round(width / 14)}" fill="#f3efe6">${name}</text>
<text x="50%" y="${height * 0.95}" text-anchor="middle" font-family="sans-serif" font-size="${Math.round(width / 32)}" fill="#c6a15b">dev image · ${style}</text>
</svg>`;
  return new TextEncoder().encode(svg);
}
