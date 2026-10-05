import https from "node:https";
import { portraitPrompt, portraitRequest } from "@/lib/portrait-prompt";

export const maxDuration = 60;

function fetchPortrait(url: string, redirects = 0): Promise<{ status: number; type: string; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          Referer: "https://pollinations.ai/",
          "User-Agent": "Mozilla/5.0",
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const location = res.headers.location;
        if (status >= 300 && status < 400 && location && redirects < 3) {
          res.resume();
          resolve(fetchPortrait(new URL(location, url).toString(), redirects + 1));
          return;
        }
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () =>
          resolve({
            status,
            type: String(res.headers["content-type"] ?? ""),
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    req.on("error", reject);
    req.setTimeout(45000, () => req.destroy(new Error("Portrait request timed out.")));
  });
}

export async function POST(request: Request) {
  const choice = portraitRequest(await request.json().catch(() => null));
  if (!choice) {
    return Response.json({ error: "Those choices cannot be drawn." }, { status: 400 });
  }

  const prompt = portraitPrompt(choice);
  let image = { status: 0, type: "", body: Buffer.alloc(0) };
  for (let attempt = 0; attempt < 5; attempt++) {
    const seed = Math.floor(Math.random() * 1_000_000_000);
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=768&height=1024&nologo=true&safe=false&enhance=false&seed=${seed}`;
    image = await fetchPortrait(url);
    if (image.status === 200 && image.type.startsWith("image/") && image.body.byteLength >= 1000) break;
    if (attempt === 4) break;
    await new Promise((resolve) => setTimeout(resolve, image.status === 429 ? 2000 : 500));
  }
  if (image.status !== 200 || !image.type.startsWith("image/")) {
    return Response.json({ error: "Portrait could not be generated. Try again." }, { status: 502 });
  }

  const bytes = image.body;
  if (bytes.byteLength < 1000) {
    return Response.json({ error: "Portrait could not be generated. Try again." }, { status: 502 });
  }

  return new Response(bytes, {
    headers: {
      "Content-Type": image.type.startsWith("image/") ? image.type : "image/jpeg",
      "Cache-Control": "no-store",
    },
  });
}
