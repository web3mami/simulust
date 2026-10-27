import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { media } from "@/server/db/schema";
import { env } from "@/server/env";
import { HttpError, readJson, route, safeEqual } from "@/server/http";
import { completeVideoJob, videoJobResult } from "@/server/video";

// Finishing a job moderates every sampled frame before storing the clip.
export const maxDuration = 120;

// The GPU worker calls this when a video job finishes or fails, with the same
// key the app uses to call the worker. Errors make the worker retry; the status
// route's polling is the backstop if every retry fails.
export const POST = route(async (request: Request) => {
  if (!env.videoApiKey) throw new HttpError(503, "Video webhooks aren't configured.", "not_configured");
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1] ?? "";
  if (!safeEqual(token, env.videoApiKey)) throw new HttpError(401, "Unauthorized.", "unauthorized");

  const result = await readJson(request, videoJobResult);
  const database = await db();
  const [byJob] = await database.select().from(media).where(eq(media.jobId, result.job_id)).limit(1);
  // We send our media id as the job id, so a worker that echoes it back still matches.
  const row =
    byJob ??
    (z.uuid().safeParse(result.job_id).success
      ? (await database.select().from(media).where(eq(media.id, result.job_id)).limit(1))[0]
      : undefined);
  if (!row || row.kind !== "video") throw new HttpError(404, "Unknown job.", "unknown_job");

  const updated = await completeVideoJob(row, result);
  const finished = result.status === "succeeded" || result.status === "failed";
  if (finished && updated.status === "pending") {
    // Another request is finishing this job right now; have the worker retry later.
    return Response.json({ error: "Job is being processed. Retry later.", code: "busy" }, { status: 409 });
  }
  return Response.json({ ok: true, status: updated.status });
});
