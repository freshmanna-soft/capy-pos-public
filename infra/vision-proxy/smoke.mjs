/**
 * End-to-end smoke test for the vision proxy.
 *
 * Draws a synthetic product photo with no dependencies (a hand-rolled PNG
 * encoder — zlib is in Node), posts it twice with the same catalog, and prints
 * what came back. Two calls rather than one on purpose: the second is the only
 * way to see whether the prompt cache is actually being read, which is the one
 * failure mode that costs money without changing any behaviour.
 *
 *   PORT=8788 node smoke.mjs
 */
import { deflateSync } from 'node:zlib';

const PORT = Number(process.env.PORT ?? 8788);
const W = 384;
const H = 384;

// ─── A tiny PNG encoder ───────────────────────────────────────────────────────

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** @param {(x: number, y: number) => [number, number, number]} shade */
function png(width, height, shade) {
  const raw = Buffer.alloc(height * (1 + width * 3));
  let at = 0;
  for (let y = 0; y < height; y++) {
    raw[at++] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const [r, g, b] = shade(x, y);
      raw[at++] = r;
      raw[at++] = g;
      raw[at++] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ─── The "product": a banana, drawn as a crescent ─────────────────────────────

function banana(x, y) {
  const cx = W / 2;
  const cy = H / 2;
  // Two offset circles: the region inside one and outside the other is a crescent.
  const outer = Math.hypot(x - cx, (y - cy) * 1.05) < 150;
  const inner = Math.hypot(x - cx + 30, (y - cy) * 1.05 + 62) < 128;
  if (outer && !inner) {
    // A little vertical shading so it doesn't read as flat vector art.
    const shade = 1 - Math.abs(y - cy) / 420;
    return [Math.round(232 * shade), Math.round(196 * shade), Math.round(48 * shade)];
  }
  // Tips darken, like a real banana.
  if (outer && inner && Math.hypot(x - cx - 96, y - cy + 96) < 26) return [92, 66, 30];
  return [246, 244, 240];
}

const CATALOG = [
  { id: 'p-ban', name: 'Banana', sku: 'FRT-BAN', category: 'Produce', emoji: '🍌' },
  { id: 'p-avo', name: 'Avocado', sku: 'FRT-AVO', category: 'Produce', emoji: '🥑' },
  { id: 'p-cuc', name: 'Cucumber', sku: 'VEG-CUC', category: 'Produce', emoji: '🥒' },
  { id: 'p-oat', name: 'Oat Milk 1L', sku: 'DRY-OAT', category: 'Dairy', emoji: '🥛' },
  { id: 'p-soy', name: 'Soy Milk 1L', sku: 'DRY-SOY', category: 'Dairy', emoji: '🥛' },
];

const image = png(W, H, banana).toString('base64');
console.log(`frame: ${W}x${H} png, ${image.length} base64 chars`);

for (const attempt of [1, 2]) {
  const started = Date.now();
  const response = await fetch(`http://127.0.0.1:${PORT}/vision/identify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image, mediaType: 'image/png', catalog: CATALOG }),
  });
  const body = await response.text();
  console.log(`call ${attempt}: HTTP ${response.status} in ${Date.now() - started}ms`);
  console.log(body);
}
