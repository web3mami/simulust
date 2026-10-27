import { env } from "@/server/env";
import { safeEqual } from "@/server/http";
import { processWebhook } from "@/server/solana/reconcile";

// Helius webhook on the treasury address. Helius sends the webhook's authHeader
// value verbatim in Authorization. The payload only tells us where to look:
// every payment is re-read from our own RPC before anything is credited.
// It's processed before we answer: on a 5xx Helius delivers it again, and
// settlement is idempotent, so a retry never credits twice. Whatever the
// delivery had no time or chain reads left for gets a 503 too; the redelivery
// passes quickly over what was already dealt with and reads on from there.
export const maxDuration = 60;

export async function POST(request: Request) {
  const secret = env.heliusWebhookSecret;
  const header = request.headers.get("authorization") ?? "";
  if (!secret || !safeEqual(header, secret)) {
    return Response.json({ error: "Unauthorized.", code: "unauthorized" }, { status: 401 });
  }
  const payload = await request.json().catch(() => null);
  if (!Array.isArray(payload)) {
    return Response.json({ error: "Expected an array of transactions.", code: "invalid" }, { status: 400 });
  }
  try {
    const { failed } = await processWebhook(payload);
    if (failed) {
      return Response.json({ error: "Some transactions couldn't be checked yet.", code: "retry" }, { status: 503 });
    }
  } catch (error) {
    console.error("Helius webhook processing failed", error);
    return Response.json({ error: "Webhook processing failed.", code: "server_error" }, { status: 500 });
  }
  return Response.json({ ok: true });
}
