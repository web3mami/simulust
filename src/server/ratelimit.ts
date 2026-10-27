import "server-only";
import { lt, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { rateLimits } from "@/server/db/schema";
import { HttpError } from "@/server/http";

// Fixed-window limiter stored in Postgres, so it holds across server instances.
export async function rateLimit(key: string, max: number, windowSeconds: number) {
  const database = await db();
  const expired = sql`${rateLimits.windowStart} < now() - make_interval(secs => ${windowSeconds})`;
  const [row] = await database
    .insert(rateLimits)
    .values({ key, windowStart: new Date(), count: 1 })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`case when ${expired} then 1 else ${rateLimits.count} + 1 end`,
        windowStart: sql`case when ${expired} then now() else ${rateLimits.windowStart} end`,
      },
    })
    .returning({ count: rateLimits.count });
  if (row && row.count > max) {
    throw new HttpError(429, "Slow down a little and try again shortly.", "rate_limited");
  }
}

// Windows older than a day are dead weight; the reconcile cron calls this.
export async function pruneRateLimits() {
  const database = await db();
  const removed = await database
    .delete(rateLimits)
    .where(lt(rateLimits.windowStart, new Date(Date.now() - 24 * 60 * 60 * 1000)))
    .returning({ key: rateLimits.key });
  return removed.length;
}
