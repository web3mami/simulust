import { crc32, deflateSync } from "node:zlib";

// The icon Solana Pay wallets show next to "Simulust". The spec only accepts
// SVG, PNG or WebP at an absolute URL, and mobile wallets render PNG most
// reliably, so the mark is drawn here: a gold ring with a spark on a dark tile.
const SIZE = 192;
const SAMPLES = 4;
const BG = [0x12, 0x11, 0x0f];
const GOLD = [0xc6, 0xa1, 0x5b];

function coverage(x: number, y: number): { tile: boolean; gold: boolean } {
  const u = x / SIZE - 0.5;
  const v = y / SIZE - 0.5;
  const corner = 0.22;
  const dx = Math.max(Math.abs(u) - (0.5 - corner), 0);
  const dy = Math.max(Math.abs(v) - (0.5 - corner), 0);
  const tile = dx * dx + dy * dy <= corner * corner;
  const r = Math.hypot(u + 0.03, v - 0.03);
  const ring = r <= 0.3 && r >= 0.21;
  const spark = Math.hypot(u - 0.235, v + 0.235) <= 0.065;
  return { tile, gold: tile && (ring || spark) };
}

function render(): Uint8Array {
  const rows = new Uint8Array(SIZE * (SIZE * 4 + 1));
  for (let y = 0; y < SIZE; y++) {
    const row = y * (SIZE * 4 + 1);
    rows[row] = 0;
    for (let x = 0; x < SIZE; x++) {
      let tile = 0;
      let gold = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const hit = coverage(x + (sx + 0.5) / SAMPLES, y + (sy + 0.5) / SAMPLES);
          if (hit.tile) tile++;
          if (hit.gold) gold++;
        }
      }
      const alpha = tile / (SAMPLES * SAMPLES);
      const mix = tile ? gold / tile : 0;
      const at = row + 1 + x * 4;
      for (let c = 0; c < 3; c++) rows[at + c] = Math.round(BG[c] + (GOLD[c] - BG[c]) * mix);
      rows[at + 3] = Math.round(alpha * 255);
    }
  }
  return rows;
}

function chunk(type: string, data: Uint8Array) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  out.set(data, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)) >>> 0, 8 + data.length);
  return out;
}

let png: Buffer | undefined;

function encode() {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(SIZE, 0);
  header.writeUInt32BE(SIZE, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(render())),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

export async function GET() {
  png ??= encode();
  return new Response(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=86400, immutable",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
