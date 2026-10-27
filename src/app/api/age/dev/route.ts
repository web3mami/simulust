import { z } from "zod";
import { requireUser } from "@/server/auth";
import { env } from "@/server/env";
import { notFound, readJson, route } from "@/server/http";
import { toMe } from "@/server/me";
import { recordDevCheck } from "@/server/veriff";

const body = z.object({ outcome: z.enum(["approved", "declined"]) });

// Development stand-in for Veriff. Never reachable in production.
export const POST = route(async (request: Request) => {
  if (!env.allowDevAgeCheck) throw notFound();
  const user = await requireUser(request);
  const { outcome } = await readJson(request, body);
  const updated = await recordDevCheck(user, outcome);
  return Response.json({ me: await toMe(updated) });
});
