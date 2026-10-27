import { env } from "@/server/env";
import { safeEqual } from "@/server/http";
import { abandonedMedia, failAbandoned } from "@/server/media";
import { pruneRateLimits } from "@/server/ratelimit";
import { reconcile } from "@/server/solana/reconcile";
import { refreshVideo, stuckVideos } from "@/server/video";

// Run every minute: vercel.json schedules it and Vercel Cron sends
// Authorization: Bearer $CRON_SECRET (self-hosting: see docs/SETUP.md).
// Webhooks can be late, duplicated or switched off; this settles whatever they
// missed, expires abandoned checkouts and marks confirmed payments finalized.
// It also fails and refunds media whose request died (nobody may be polling it).
export const maxDuration = 120;

async function sweepMedia() {
  let failed = 0;
  for (const row of await abandonedMedia()) {
    const after = await failAbandoned(row).catch((error) => {
      console.error("Failing abandoned media failed", row.id, error);
      return row;
    });
    if (after.status === "failed") failed += 1;
  }
  // In parallel: each poll of the worker can take up to its own timeout.
  const refreshed = await Promise.all(
    (await stuckVideos()).map((row) =>
      refreshVideo(row).catch((error) => {
        console.error("Refreshing a stuck video failed", row.id, error);
        return row;
      }),
    ),
  );
  return { abandonedMedia: failed, settledVideos: refreshed.filter((row) => row.status !== "pending").length };
}

export async function GET(request: Request) {
  const secret = env.cronSecret;
  const header = request.headers.get("authorization") ?? "";
  if (!secret || !safeEqual(header, `Bearer ${secret}`)) {
    return Response.json({ error: "Unauthorized.", code: "unauthorized" }, { status: 401 });
  }
  // Side by side, so a slow chain can't keep abandoned media from being
  // refunded. reconcile stops reading the chain once its time budget is spent.
  const [payments, prunedRateLimits, media] = await Promise.allSettled([reconcile(), pruneRateLimits(), sweepMedia()]);
  if (payments.status === "rejected" || prunedRateLimits.status === "rejected" || media.status === "rejected") {
    for (const result of [payments, prunedRateLimits, media]) {
      if (result.status === "rejected") console.error("Reconcile failed", result.reason);
    }
    return Response.json({ error: "Reconcile failed.", code: "server_error" }, { status: 500 });
  }
  return Response.json({ ...payments.value, prunedRateLimits: prunedRateLimits.value, ...media.value });
}
