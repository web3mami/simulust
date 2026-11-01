import "server-only";
import { env, isProduction } from "@/server/env";
import { logModeration, type ModerationContext } from "@/server/safety/moderation";

// Every generated image and every sampled video frame passes through here before
// it is stored as ready. Hive's V2 sync API, one project (and key) per model:
//   HIVE_API_KEY              Visual Moderation: nudity, children present, gore
//   HIVE_DEMOGRAPHIC_API_KEY  Demographics: apparent age of each face
//   HIVE_CELEBRITY_API_KEY    Celebrity Recognition: real, identifiable people
// Request: POST https://api.thehive.ai/api/v2/task/sync, "Authorization: Token <key>",
// multipart field "media" (https://docs.thehive.ai/reference/submit-a-task-synchronously).
// Response: status[0].response.output[] with classes [{ class, score }] for
// classification, or bounding_poly[].classes for detection models.
//
// Anything that stops a check from running fails closed, except in development
// with ALLOW_UNMODERATED_IMAGES left on.

export type ImageModerationContext = ModerationContext & {
  targetType: "image" | "video";
  // Nudity is fine for confirmed adults (explicitAllowed). Nothing else on the
  // block list is ever fine.
  allowExplicit?: boolean;
};

export type ImageModerationResult = {
  ok: boolean;
  categories: string[];
  raw: unknown;
  // The check couldn't run (no provider, provider error). The image isn't known
  // to be bad, so callers say "try again" rather than "blocked".
  unavailable?: boolean;
};

type Scores = Record<string, number>;
export type HiveScores = { visual: Scores; demographic?: Scores; celebrity?: Scores };

// Deliberately low for anything involving minors or real people: a false
// positive costs a refund, a false negative is unacceptable.
export const THRESHOLDS = {
  childPresent: 0.2,
  apparentAge: 0.2,
  celebrity: 0.6,
  gore: 0.5,
  prohibited: 0.5,
  explicit: 0.8,
} as const;

const CHILD_CLASSES = ["yes_child_present", "yes_child_safety"];
const UNDERAGE_FACES = ["teenager", "pre_teen", "toddler", "baby"];
const GORE_CLASSES = ["very_bloody", "human_corpse", "animated_corpse", "yes_self_harm", "hanging", "noose"];
const PROHIBITED_CLASSES = ["animal_genitalia_and_human", "animal_genitalia_only", "animated_animal_genitalia", "yes_animal_abuse"];
const EXPLICIT_CLASSES = ["general_nsfw", "yes_sexual_activity", "yes_female_nudity", "yes_male_nudity", "yes_genitals"];
// Celebrity Recognition labels faces with a name; these labels mean "no match".
const NOT_A_CELEBRITY = new Set(["no_celebrity", "not_celebrity", "no_match", "unknown", "other", "none", "no_face"]);

// Most severe first: the first category is the one logged.
const SEVERITY = ["minor", "real_person", "prohibited", "gore", "explicit"];

function over(scores: Scores | undefined, classes: string[], threshold: number) {
  return classes.some((name) => (scores?.[name] ?? 0) >= threshold);
}

export function evaluateHive(scores: HiveScores, policy: { allowExplicit: boolean }): string[] {
  const found = new Set<string>();
  if (over(scores.visual, CHILD_CLASSES, THRESHOLDS.childPresent)) found.add("minor");
  if (over(scores.demographic, UNDERAGE_FACES, THRESHOLDS.apparentAge)) found.add("minor");
  const celebrities = Object.entries(scores.celebrity ?? {}).filter(
    ([name, score]) => !NOT_A_CELEBRITY.has(name.toLowerCase()) && score >= THRESHOLDS.celebrity,
  );
  if (celebrities.length) found.add("real_person");
  if (over(scores.visual, PROHIBITED_CLASSES, THRESHOLDS.prohibited)) found.add("prohibited");
  if (over(scores.visual, GORE_CLASSES, THRESHOLDS.gore)) found.add("gore");
  if (!policy.allowExplicit && over(scores.visual, EXPLICIT_CLASSES, THRESHOLDS.explicit)) found.add("explicit");
  return SEVERITY.filter((category) => found.has(category));
}

// Every { class, score } anywhere in a Hive response, keeping the highest score
// per class. Covers classification output, detection bounding boxes, and video
// timestamps without depending on exactly where Hive nests them.
export function collectScores(value: unknown, into: Scores = {}, depth = 0): Scores {
  if (depth > 12 || value === null || typeof value !== "object") return into;
  if (Array.isArray(value)) {
    for (const item of value) collectScores(item, into, depth + 1);
    return into;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.class === "string" && typeof record.score === "number" && Number.isFinite(record.score)) {
    into[record.class] = Math.max(into[record.class] ?? 0, record.score);
  }
  for (const [key, child] of Object.entries(record)) {
    if (key !== "class" && key !== "score") collectScores(child, into, depth + 1);
  }
  return into;
}

function hiveFailure(body: unknown): string | null {
  const status = (body as { status?: unknown })?.status;
  const entries = Array.isArray(status) ? status : status ? [status] : [];
  for (const entry of entries) {
    const inner = (entry as { status?: { code?: unknown; message?: unknown } })?.status;
    const code = inner?.code === undefined ? undefined : String(inner.code);
    const message = typeof inner?.message === "string" ? inner.message : undefined;
    if ((code && code !== "0" && code !== "200") || (message && /error|fail/i.test(message))) {
      return `${code ?? ""} ${message ?? ""}`.trim();
    }
  }
  return null;
}

const EXTENSIONS: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };

function hiveUrl() {
  return process.env.HIVE_API_URL?.trim() || "https://api.thehive.ai/api/v2/task/sync";
}

async function hiveSync(apiKey: string, bytes: Uint8Array, mimeType: string): Promise<unknown> {
  const form = new FormData();
  form.append("media", new Blob([bytes.slice()], { type: mimeType }), `upload.${EXTENSIONS[mimeType] ?? "jpg"}`);
  const response = await fetch(hiveUrl(), {
    method: "POST",
    headers: { Authorization: `Token ${apiKey}`, Accept: "application/json" },
    body: form,
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Hive ${response.status}: ${(await response.text()).slice(0, 200)}`);
  const body = (await response.json()) as unknown;
  const failure = hiveFailure(body);
  if (failure) throw new Error(`Hive task failed: ${failure}`);
  return body;
}

function hiveKeys() {
  const read = (name: string) => process.env[name]?.trim() || undefined;
  return {
    visual: env.hiveApiKey,
    demographic: read("HIVE_DEMOGRAPHIC_API_KEY"),
    celebrity: read("HIVE_CELEBRITY_API_KEY"),
  };
}

// Only scores that mean something are kept on the media row.
function summarize(scores: HiveScores) {
  const keep = (map?: Scores) =>
    map ? Object.fromEntries(Object.entries(map).filter(([, score]) => score >= 0.05).map(([name, score]) => [name, Math.round(score * 1000) / 1000])) : undefined;
  return { visual: keep(scores.visual), demographic: keep(scores.demographic), celebrity: keep(scores.celebrity) };
}

type Inspection = { categories: string[]; raw: unknown; unavailable?: string };

async function inspect(bytes: Uint8Array, mimeType: string, allowExplicit: boolean): Promise<Inspection> {
  // Only the mock provider makes SVGs, and it can't run in production.
  if (mimeType === "image/svg+xml") {
    if (!isProduction) return { categories: [], raw: { skipped: "development mock image" } };
    return { categories: [], raw: null, unavailable: "unsupported_format" };
  }
  if (!EXTENSIONS[mimeType]) return { categories: [], raw: null, unavailable: "unsupported_format" };

  const keys = hiveKeys();
  if (!keys.visual) {
    if (env.allowUnmoderatedImages) return { categories: [], raw: { skipped: "no HIVE_API_KEY (development)" } };
    return { categories: [], raw: { reason: "HIVE_API_KEY is not set" }, unavailable: "moderation_unavailable" };
  }
  if (isProduction && (!keys.demographic || !keys.celebrity)) {
    return {
      categories: [],
      raw: { reason: "HIVE_DEMOGRAPHIC_API_KEY and HIVE_CELEBRITY_API_KEY are required in production" },
      unavailable: "moderation_unavailable",
    };
  }

  try {
    const [visual, demographic, celebrity] = await Promise.all([
      hiveSync(keys.visual, bytes, mimeType),
      keys.demographic ? hiveSync(keys.demographic, bytes, mimeType) : null,
      keys.celebrity ? hiveSync(keys.celebrity, bytes, mimeType) : null,
    ]);
    const scores: HiveScores = {
      visual: collectScores(visual),
      demographic: demographic ? collectScores(demographic) : undefined,
      celebrity: celebrity ? collectScores(celebrity) : undefined,
    };
    // A visual result with no classes means we checked nothing.
    if (!Object.keys(scores.visual).length) throw new Error("Hive returned no visual classes.");
    return { categories: evaluateHive(scores, { allowExplicit }), raw: { provider: "hive", scores: summarize(scores) } };
  } catch (error) {
    return { categories: [], raw: { provider: "hive", error: String(error).slice(0, 300) }, unavailable: "moderation_error" };
  }
}

async function record(context: ImageModerationContext, inspection: Inspection, extra?: Record<string, unknown>): Promise<ImageModerationResult> {
  if (inspection.unavailable) {
    // An outage is logged as flagged; it isn't a judgement about the image.
    await logModeration(context, inspection.unavailable, "flagged", { ...(inspection.raw as object), ...extra });
    return { ok: false, categories: [inspection.unavailable], raw: inspection.raw, unavailable: true };
  }
  if (inspection.categories.length) {
    await logModeration(context, inspection.categories[0], "blocked", {
      categories: inspection.categories,
      ...(inspection.raw as object),
      ...extra,
    });
    return { ok: false, categories: inspection.categories, raw: inspection.raw };
  }
  return { ok: true, categories: [], raw: inspection.raw };
}

export async function moderateImage(
  bytes: Uint8Array,
  mimeType: string,
  context: ImageModerationContext,
): Promise<ImageModerationResult> {
  return record(context, await inspect(bytes, mimeType, context.allowExplicit === true));
}

// Video frames: every frame must pass, and one block logs one event for the video.
export async function moderateFrames(
  frames: { bytes: Uint8Array; mimeType: string }[],
  context: ImageModerationContext,
): Promise<ImageModerationResult> {
  if (!frames.length) {
    return record(context, { categories: [], raw: { reason: "no frames to check" }, unavailable: "moderation_unavailable" });
  }
  const results: Inspection[] = [];
  // A few at a time keeps Hive's per-project concurrency limit happy.
  for (let i = 0; i < frames.length; i += 3) {
    const batch = frames.slice(i, i + 3);
    results.push(...(await Promise.all(batch.map((frame) => inspect(frame.bytes, frame.mimeType, context.allowExplicit === true)))));
  }
  const unavailable = results.find((result) => result.unavailable);
  if (unavailable) return record(context, unavailable, { frames: frames.length });
  const categories = SEVERITY.filter((category) => results.some((result) => result.categories.includes(category)));
  const raw = { frames: results.map((result) => result.raw) };
  return record(context, { categories, raw }, categories.length ? { frames: frames.length } : undefined);
}
