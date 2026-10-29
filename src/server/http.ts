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

// The key a per-address rate limit counts an IP under. One IPv6 subscriber is
// usually handed a whole /64, so a limit on the full address could be reset by
// stepping through it; IPv6 counts by its /64 ("2001:db8:0:12::/64"). IPv4,
// and IPv4 written as IPv6 ("::ffff:192.0.2.1"), stays the plain address.
// Anything that doesn't parse is left as it came.
export function ipBucket(ip: string) {
  const address = ip.trim().toLowerCase().replace(/^\[(.*)\]$/, "$1").replace(/%.*$/, "");
  if (!address.includes(":")) return ip.trim();
  const groups = ipv6Groups(address);
  if (!groups) return ip.trim();
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    return [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join(".");
  }
  return `${groups
    .slice(0, 4)
    .map((group) => group.toString(16))
    .join(":")}::/64`;
}

// The eight 16-bit groups of an IPv6 address, or null when it isn't one.
function ipv6Groups(address: string): number[] | null {
  const halves = address.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string, endsAddress: boolean) => {
    if (!part) return [];
    const out: number[] = [];
    const pieces = part.split(":");
    for (const [index, piece] of pieces.entries()) {
      // Dotted IPv4 may only end the address.
      if (endsAddress && index === pieces.length - 1 && piece.includes(".")) {
        const octets = piece.split(".");
        if (octets.length !== 4 || !octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255)) return null;
        const [a, b, c, d] = octets.map(Number);
        out.push((a << 8) | b, (c << 8) | d);
      } else if (/^[0-9a-f]{1,4}$/.test(piece)) {
        out.push(parseInt(piece, 16));
      } else {
        return null;
      }
    }
    return out;
  };
  const head = parse(halves[0], halves.length === 1);
  const tail = halves.length === 2 ? parse(halves[1], true) : [];
  if (!head || !tail) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const missing = 8 - head.length - tail.length;
  return missing >= 1 ? [...head, ...new Array<number>(missing).fill(0), ...tail] : null;
}
