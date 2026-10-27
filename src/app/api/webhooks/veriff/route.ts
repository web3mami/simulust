import { features } from "@/server/env";
import { HttpError, notFound, route } from "@/server/http";
import { handleDecision, verifySignature } from "@/server/veriff";

// Veriff decision and event webhooks. Veriff retries anything but a 200 for up
// to a week, so ignored payloads still get a 200; only a bad signature or a
// failure on our side asks for a retry.
export const POST = route(async (request: Request) => {
  if (!features.veriff) throw notFound();
  // The signature covers the exact bytes sent, so read text before parsing.
  const raw = await request.text();
  if (!verifySignature(raw, request.headers)) {
    throw new HttpError(401, "Invalid signature.", "bad_signature");
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new HttpError(400, "Invalid JSON.", "invalid");
  }
  const result = await handleDecision(payload);
  return Response.json({ ok: true, applied: result.applied });
});
