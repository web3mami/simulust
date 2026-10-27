import "server-only";
import { and, eq, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { explicitAllowed } from "@/server/auth";
import { refund } from "@/server/credits";
import { db } from "@/server/db";
import { characters, media, users, type Media } from "@/server/db/schema";
import { env, isProduction } from "@/server/env";
import { moderateFrames } from "@/server/image-moderation";
import { readWorkerError, workerRefusalCategory, type ImageStyle } from "@/server/images";
import { failMedia, getMedia, storeMedia } from "@/server/media";
import { logModeration } from "@/server/safety/moderation";
import { readLocalObject, signedUrl, usesS3 } from "@/server/storage";
import { COSTS } from "@/lib/pricing";

// Image-to-video with Wan 2.2 TI2V-5B on our GPU worker (workers/media). The
// source is always an image that already passed moderation, so identity and
// apparent age carry over; the frames are checked again anyway.
//
// Worker contract:
//   POST {VIDEO_API_URL}/v1/videos (Bearer VIDEO_API_KEY)
//     { job_id, image: base64, image_mime_type, prompt, negative_prompt, seconds, style, callback_url }
//     -> 202 { job_id, status }, or 422 { error: "blocked", reason } when its prompt checks refuse
//   GET {VIDEO_API_URL}/v1/videos/{job_id} -> VideoJobResult, 404 if unknown
//   When done the worker POSTs the same VideoJobResult to callback_url with
//   "Authorization: Bearer VIDEO_API_KEY", leaving out video_base64 and frames
//   when the body would be too big; the app then GETs the job. The webhook is
//   the fast path; the status route polls when a job has been pending for more
//   than two minutes. A job the worker's own checks refused (a source image or
//   frames that look underage) ends "failed" with error "blocked: <reason>".

export const VIDEO_SECONDS = 5;
const POLL_AFTER_MS = 2 * 60_000;
const POLL_EVERY_MS = 15_000;
const GIVE_UP_AFTER_MS = 20 * 60_000;
const MOCK_READY_AFTER_MS = 4_000;
// A crashed attempt at finishing a job stops blocking others after this long.
const CLAIM_TTL = "5 minutes";

export const videoJobResult = z.object({
  job_id: z.string().min(1).max(200),
  status: z.enum(["queued", "running", "succeeded", "failed"]),
  video_base64: z.string().optional(),
  mime_type: z.string().max(40).optional(),
  frames: z.array(z.string()).max(32).optional(),
  error: z.string().max(2000).optional(),
});

export type VideoJobResult = z.infer<typeof videoJobResult>;

export class VideoUnavailable extends Error {}

// The worker's safety checks refused the job when it was submitted.
export class VideoBlocked extends Error {
  constructor(public reason: string) {
    super(`Video worker refused: ${reason}`);
  }
}

// "mock" plays a short placeholder clip so the whole animate flow works on a
// laptop, matching publicFeatures().video. With real images but no worker
// (pollinations), video is off and the route says so before charging anyone.
export function videoMode(): "worker" | "mock" | "off" {
  if (env.videoApiUrl) return "worker";
  if (!isProduction && env.imageProvider === "mock") return "mock";
  return "off";
}

function workerUrl(path: string) {
  return `${env.videoApiUrl!.replace(/\/$/, "")}${path}`;
}

function authHeaders(): Record<string, string> {
  return env.videoApiKey ? { Authorization: `Bearer ${env.videoApiKey}` } : {};
}

const DEFAULT_MOTION = "subtle natural movement: slow breathing, a soft smile, hair moving gently, a slight turn of the head";
const SAME_ADULT = "The same adult from the photo, same face and body, natural realistic motion, steady camera, consistent lighting.";

export function videoPrompt(request?: string) {
  const motion = request?.trim() || DEFAULT_MOTION;
  return {
    prompt: `${motion}. ${SAME_ADULT}`,
    negativePrompt:
      "child, teen, underage, childlike, young-looking, school uniform, face morphing, identity change, extra limbs, distorted hands, flicker, jitter, blurry, low quality, text, watermark",
  };
}

// Bytes of a stored image, for sending to the worker.
export async function readMediaBytes(row: Media): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
  if (!row.storageKey) return null;
  if (usesS3()) {
    const response = await fetch(await signedUrl(row.storageKey, 60), { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) return null;
    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      mimeType: row.mimeType ?? response.headers.get("content-type") ?? "application/octet-stream",
    };
  }
  const local = await readLocalObject(row.storageKey);
  return local ? { bytes: new Uint8Array(local.body), mimeType: local.contentType } : null;
}

async function setJob(id: string, jobId: string) {
  const database = await db();
  const [row] = await database.update(media).set({ jobId, updatedAt: new Date() }).where(eq(media.id, id)).returning();
  return row;
}

// The style the worker logs with the job. Its drawn-face age check runs on every
// source and clip whatever this says, since a caller could declare anything.
// The style comes from the source's character and from the image itself when
// it was recorded; unknown or mixed is sent as anime.
async function sourceStyle(source: Media): Promise<ImageStyle> {
  const recorded = source.moderation?.style;
  const known: unknown[] = [recorded].filter(Boolean);
  if (source.characterId) {
    const database = await db();
    const [character] = await database
      .select({ style: characters.style })
      .from(characters)
      .where(eq(characters.id, source.characterId))
      .limit(1);
    if (character) known.push(character.style);
  }
  return known.length && known.every((style) => style === "realistic") ? "realistic" : "anime";
}

// Hands the job to the worker, or to the local placeholder. Throws when the
// worker can't take it, VideoBlocked when it refuses the prompt; the caller
// refunds.
export async function startVideoJob(
  row: Media,
  source: Media,
  prompt: { prompt: string; negativePrompt: string },
): Promise<Media> {
  const mode = videoMode();
  if (mode === "off") throw new VideoUnavailable("No video worker configured.");
  if (mode === "mock") return setJob(row.id, `mock:${row.id}`);

  const image = await readMediaBytes(source);
  if (!image) throw new Error("Source image bytes are missing.");
  if (!["image/jpeg", "image/png", "image/webp"].includes(image.mimeType)) {
    throw new Error(`Can't animate ${image.mimeType}.`);
  }
  const response = await fetch(workerUrl("/v1/videos"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({
      job_id: row.id,
      image: Buffer.from(image.bytes).toString("base64"),
      image_mime_type: image.mimeType,
      prompt: prompt.prompt,
      negative_prompt: prompt.negativePrompt,
      seconds: VIDEO_SECONDS,
      style: await sourceStyle(source),
      callback_url: `${env.appUrl.replace(/\/$/, "")}/api/webhooks/video`,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    const failure = await readWorkerError(response);
    if (failure.blockedReason !== null) throw new VideoBlocked(failure.blockedReason);
    throw new Error(`Video worker ${response.status}: ${failure.detail}`);
  }
  const body = (await response.json().catch(() => ({}))) as { job_id?: unknown };
  return setJob(row.id, typeof body.job_id === "string" && body.job_id ? body.job_id : row.id);
}

class JobNotFound extends Error {}

export async function pollVideoJob(jobId: string): Promise<VideoJobResult> {
  const response = await fetch(workerUrl(`/v1/videos/${encodeURIComponent(jobId)}`), {
    headers: authHeaders(),
    // Leaves room for frame moderation inside the 120 s of the status route and
    // the cron that call this.
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status === 404) throw new JobNotFound(jobId);
  if (!response.ok) throw new Error(`Video worker ${response.status}: ${(await response.text()).slice(0, 300)}`);
  return videoJobResult.parse(await response.json());
}

// Webhook and poll can race on the same job. Whoever claims the pending row
// finishes it; the other returns the row as it is.
async function claim(id: string): Promise<Media | null> {
  const database = await db();
  const [row] = await database
    .update(media)
    .set({ moderation: { processingAt: new Date().toISOString() }, updatedAt: new Date() })
    .where(
      and(
        eq(media.id, id),
        eq(media.status, "pending"),
        or(
          isNull(media.moderation),
          sql`(${media.moderation}->>'processingAt') is null`,
          sql`(${media.moderation}->>'processingAt')::timestamptz < now() - interval '${sql.raw(CLAIM_TTL)}'`,
        ),
      ),
    )
    .returning();
  return row ?? null;
}

// Fails and refunds a job that is still pending. If the webhook finished it (or
// a takedown blocked it) in the meantime, that result stands and nothing is refunded.
async function giveUp(row: Media, reason: string, details: Record<string, unknown> = {}) {
  const failed = await failMedia(row.id, "failed", "The video didn't render. Your credits are back.", { reason, ...details }, {
    pendingOnly: true,
  });
  if (!failed) return (await getMedia(row.id)) ?? row;
  if (row.userId) await refund(row.userId, row.creditsSpent || COSTS.video, row.id);
  return failed;
}

// The motion the user wrote into a video's prompt, or null for the default one.
function writtenMotion(row: Media) {
  const suffix = `. ${SAME_ADULT}`;
  const motion = row.prompt?.endsWith(suffix) ? row.prompt.slice(0, -suffix.length) : row.prompt;
  return motion && motion !== DEFAULT_MOTION ? motion : null;
}

// The worker's tagger said a stored photo, or a clip made from it, looks like a
// minor; its reason doesn't say which, so the photo is treated as flagged. It
// and every other video made from it stop being served, their files kept for
// review. The event holds up the owner's account deletion until an admin
// reviews it (underReview in /api/me/account), and makes a report on the photo
// keep its files by default.
async function flagSource(row: Media, reason: string) {
  const sourceId = row.sourceMediaId!;
  const flag = { videoId: row.id, reason: reason.slice(0, 300), at: new Date().toISOString() };
  const database = await db();
  await database
    .update(media)
    .set({
      status: "blocked",
      error: "Blocked: our safety check flagged it.",
      moderation: sql`coalesce(${media.moderation}, '{}'::jsonb) || ${JSON.stringify({ workerFlag: flag })}::jsonb`,
      updatedAt: new Date(),
    })
    .where(
      and(
        or(eq(media.id, sourceId), eq(media.sourceMediaId, sourceId)),
        ne(media.id, row.id),
        inArray(media.status, ["pending", "ready"]),
      ),
    );
  await logModeration({ userId: row.userId, targetType: "image", targetId: sourceId }, "minor", "blocked", {
    source: "video_worker",
    videoId: row.id,
    reason: flag.reason,
  });
}

// Blocks a video the worker's own safety checks refused, logs it for review and
// refunds. "prompt" is the animate route's: the worker's prompt screen refused
// the motion at submission, a verdict on what the user wrote, so it records
// what matched like our own text checks do and holds up account deletion the
// same way. "render" is a finished job its tagger refused, a verdict on the
// source photo or the clip (see flagSource).
export async function blockVideo(row: Media, reason: string, stage: "prompt" | "render" = "prompt") {
  const category = workerRefusalCategory(reason);
  const motion = stage === "prompt" && category !== "worker_refused" ? writtenMotion(row) : null;
  const details = {
    categories: [category],
    reason: reason.slice(0, 300),
    ...(motion ? { matched: reason.replace(/^[a-z_]+:\s*/i, "").slice(0, 100) || category, excerpt: motion.slice(0, 280) } : {}),
  };
  await logModeration({ userId: row.userId, targetType: "video", targetId: row.id }, category, "blocked", details);
  // A hit on the rendered frames may be the clip drifting younger, not the
  // photo; only a hit on the source itself (or an older worker's unlabelled one)
  // blocks the photo.
  if (stage === "render" && category === "minor" && row.sourceMediaId && !/^apparent minor \(frames\)/i.test(reason)) {
    await flagSource(row, reason);
  }
  const failed = await failMedia(row.id, "blocked", "Blocked by the video worker.", details, { pendingOnly: true });
  if (!failed) return (await getMedia(row.id)) ?? row;
  if (row.userId) await refund(row.userId, row.creditsSpent || COSTS.video, row.id);
  return failed;
}

// A failed job's error reads "blocked: <reason>" when the worker refused it.
function workerRefusal(result: VideoJobResult) {
  const match = result.status === "failed" ? /^blocked:\s*([\s\S]*)$/.exec(result.error ?? "") : null;
  return match ? match[1].trim() || "safety" : null;
}

function frameType(base64: string) {
  if (base64.startsWith("iVBOR")) return "image/png";
  if (base64.startsWith("UklGR")) return "image/webp";
  return "image/jpeg";
}

async function ownerAllowsExplicit(userId: string | null) {
  if (!userId) return false;
  const database = await db();
  const [owner] = await database.select().from(users).where(eq(users.id, userId)).limit(1);
  return owner ? explicitAllowed(owner) : false;
}

// Applies a finished (or failed) worker result: moderate the frames, then store
// the clip or fail and refund. Safe to call more than once for the same job.
export async function completeVideoJob(row: Media, result: VideoJobResult): Promise<Media> {
  if (result.status === "queued" || result.status === "running") return row;
  // A clip too big for the host's request limit (4.5 MB on Vercel) comes as a
  // callback without it; the worker keeps the result for an hour. Fetched once,
  // before the claim, so a failed fetch leaves the job to the worker's retry or
  // the poll; a result that still has no clip fails below.
  if (result.status === "succeeded" && !result.video_base64) result = await pollVideoJob(row.jobId ?? result.job_id);
  const claimed = await claim(row.id);
  if (!claimed) return (await getMedia(row.id)) ?? row;

  const refused = workerRefusal(result);
  if (refused !== null) return blockVideo(claimed, refused, "render");
  if (result.status === "failed" || !result.video_base64) {
    return giveUp(claimed, "worker_failed", { workerError: result.error?.slice(0, 500) ?? null });
  }
  const video = new Uint8Array(Buffer.from(result.video_base64, "base64"));
  if (video.byteLength < 1000) return giveUp(claimed, "empty_video");
  const mimeType = result.mime_type === "video/webm" ? "video/webm" : "video/mp4";

  const frames = (result.frames ?? []).map((frame) => ({
    bytes: new Uint8Array(Buffer.from(frame, "base64")),
    mimeType: frameType(frame),
  }));
  const moderation = await moderateFrames(frames, {
    userId: claimed.userId,
    targetType: "video",
    targetId: claimed.id,
    allowExplicit: await ownerAllowsExplicit(claimed.userId),
  });
  if (!moderation.ok) {
    const blocked = !moderation.unavailable;
    const failed = await failMedia(
      claimed.id,
      blocked ? "blocked" : "failed",
      blocked ? `Blocked: ${moderation.categories.join(", ")}` : "Couldn't safety-check the video. Your credits are back.",
      { categories: moderation.categories, result: moderation.raw },
      { pendingOnly: true },
    );
    if (!failed) return (await getMedia(claimed.id)) ?? claimed;
    if (claimed.userId) await refund(claimed.userId, claimed.creditsSpent || COSTS.video, claimed.id);
    return failed;
  }
  return storeMedia(claimed, video, mimeType, {
    provider: "wan2.2-ti2v-5b",
    frames: frames.length,
    categories: [],
    result: moderation.raw,
  });
}

const lastPolled = new Map<string, number>();

function pollDue(id: string) {
  const now = Date.now();
  if (lastPolled.size > 5_000) {
    for (const [key, at] of lastPolled) if (now - at > POLL_EVERY_MS) lastPolled.delete(key);
  }
  if (now - (lastPolled.get(id) ?? 0) < POLL_EVERY_MS) return false;
  lastPolled.set(id, now);
  return true;
}

// Called by the status route. Moves a pending video along when the webhook is
// late or lost: placeholder clips finish here, stuck jobs are polled, and jobs
// that never finish are failed and refunded.
export async function refreshVideo(row: Media): Promise<Media> {
  if (row.kind !== "video" || row.status !== "pending") return row;
  const age = Date.now() - row.createdAt.getTime();

  if (row.jobId?.startsWith("mock:")) {
    if (age < MOCK_READY_AFTER_MS || isProduction) return row;
    const claimed = await claim(row.id);
    if (!claimed) return (await getMedia(row.id)) ?? row;
    // Our own placeholder clip, development only: nothing to moderate.
    return storeMedia(claimed, placeholderVideo(), "video/mp4", { provider: "mock", skipped: "development placeholder" });
  }

  // Never reached the worker (crash between charging and submitting).
  if (!row.jobId) return age > POLL_AFTER_MS ? giveUp(row, "never_submitted") : row;
  if (age < POLL_AFTER_MS || videoMode() !== "worker" || !pollDue(row.id)) return row;

  try {
    const result = await pollVideoJob(row.jobId);
    if ((result.status === "queued" || result.status === "running") && age > GIVE_UP_AFTER_MS) {
      return giveUp(row, "timed_out");
    }
    return completeVideoJob(row, result);
  } catch (error) {
    if (error instanceof JobNotFound) return giveUp(row, "job_lost");
    console.warn("Video poll failed", error);
    return age > GIVE_UP_AFTER_MS ? giveUp(row, "timed_out") : row;
  }
}

// For the cron: videos old enough that refreshVideo would poll or give up on
// them, oldest first. A few per run; the worker poll can be slow.
export async function stuckVideos(limit = 10) {
  const database = await db();
  return database
    .select()
    .from(media)
    .where(
      and(
        eq(media.kind, "video"),
        eq(media.status, "pending"),
        lt(media.createdAt, new Date(Date.now() - POLL_AFTER_MS)),
      ),
    )
    .orderBy(media.createdAt)
    .limit(limit);
}

export function placeholderVideo() {
  return new Uint8Array(Buffer.from(PLACEHOLDER_MP4.join(""), "base64"));
}

// 2 s, 144x192 H.264 "dev video" clip (made with AVFoundation, moov first) so
// <video> elements have something real to play without a GPU worker.
const PLACEHOLDER_MP4 = [
  "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",
];
