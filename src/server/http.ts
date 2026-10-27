import "server-only";
import { ZodError, type ZodType } from "zod";
import { env } from "@/server/env";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

export const unauthorized = () => new HttpError(401, "Log in to continue.", "unauthorized");
export const forbidden = (message = "You can't do that.") => new HttpError(403, message, "forbidden");
export const notFound = (message = "Not found.") => new HttpError(404, message, "not_found");

// Wraps a route handler so thrown HttpErrors and validation errors become JSON
// responses, and anything unexpected is logged and hidden from the client.
export function route<Args extends unknown[]>(handler: (...args: Args) => Promise<Response>) {
  return async (...args: Args): Promise<Response> => {
    try {
      return await handler(...args);
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export function errorResponse(error: unknown) {
  if (error instanceof HttpError) {
    return Response.json({ error: error.message, code: error.code }, { status: error.status });
  }
  if (error instanceof ZodError) {
    const first = error.issues[0];
    const where = first?.path.length ? `${first.path.join(".")}: ` : "";
    return Response.json({ error: `${where}${first?.message ?? "Invalid request."}`, code: "invalid" }, { status: 400 });
  }
  console.error(error);
  return Response.json({ error: "Something went wrong. Try again.", code: "server_error" }, { status: 500 });
}

export async function readJson<T>(request: Request, schema: ZodType<T>): Promise<T> {
  const raw = await request.json().catch(() => {
    throw new HttpError(400, "Send a JSON body.", "invalid");
  });
  return schema.parse(raw);
}

// Constant-time string comparison for shared secrets in webhook headers.
export function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
  return diff === 0;
}

// The caller's IP, from the one header the platform in front of the app sets
// (CLIENT_IP_HEADER, see env.ts). Headers a client can set itself are never
// read, so rate limits keyed on this can't be reset by changing a header.
export function clientIp(request: Request) {
  return request.headers.get(env.clientIpHeader)?.split(",")[0]?.trim() || "unknown";
}
