import type { NextRequest } from "next/server";
import { z } from "zod";
import { currentUser } from "@/server/auth";
import { notFound, route } from "@/server/http";
import { canView, getMedia } from "@/server/media";
import { readLocalObject, signedUrl, usesS3 } from "@/server/storage";

// Media is private: only its owner (or an admin) gets the bytes. <img> and
// <video> tags authenticate with the privy-token cookie. Anything that isn't
// visible is a plain 404, so ids can't be probed for existence.
const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  // Development placeholders are SVG; never let a media URL run script.
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  "Cross-Origin-Resource-Policy": "same-origin",
};

// Short, private caching: a takedown should stop showing within minutes even in
// the owner's own browser.
const CACHE = "private, max-age=300";

function parseRange(header: string, size: number): { start: number; end: number } | "invalid" | null {
  const match = header.match(/^bytes=(\d*)-(\d*)$/);
  if (!match || (!match[1] && !match[2])) return null;
  let start: number;
  let end: number;
  if (!match[1]) {
    // Suffix range: the last N bytes.
    const length = Number(match[2]);
    if (length === 0) return "invalid";
    start = Math.max(0, size - length);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  }
  if (start >= size || start > end) return "invalid";
  return { start, end };
}

export const GET = route(async (request: NextRequest, ctx: RouteContext<"/api/media/[id]">) => {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) throw notFound();
  const user = await currentUser(request);
  const row = await getMedia(id);
  if (!row || !canView(user, row) || row.status !== "ready" || !row.storageKey) throw notFound();

  if (usesS3()) {
    return new Response(null, {
      status: 302,
      headers: { Location: await signedUrl(row.storageKey, 300), "Cache-Control": "private, max-age=240" },
    });
  }

  const object = await readLocalObject(row.storageKey);
  if (!object) throw notFound();
  const size = object.body.byteLength;
  const headers: Record<string, string> = {
    ...SECURITY_HEADERS,
    "Content-Type": row.mimeType ?? object.contentType,
    "Cache-Control": CACHE,
    "Accept-Ranges": "bytes",
  };

  const rangeHeader = request.headers.get("range");
  const range = rangeHeader ? parseRange(rangeHeader, size) : null;
  if (range === "invalid") {
    return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
  }
  if (range) {
    const slice = object.body.subarray(range.start, range.end + 1);
    return new Response(new Uint8Array(slice), {
      status: 206,
      headers: {
        ...headers,
        "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
        "Content-Length": String(slice.byteLength),
      },
    });
  }
  return new Response(new Uint8Array(object.body), {
    headers: { ...headers, "Content-Length": String(size) },
  });
});
