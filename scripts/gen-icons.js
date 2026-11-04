// Gera os ícones PNG do PWA sem dependências (zlib nativo). Uso: node scripts/gen-icons.js
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// Glifo "IA" em coordenadas normalizadas (0..1), dentro da zona segura maskable (círculo de 80%)
const inQuad = (x, y, q) => { // polígono convexo
  let sign = 0;
  for (let i = 0; i < q.length; i++) {
    const [ax, ay] = q[i], [bx, by] = q[(i + 1) % q.length];
    const s = Math.sign((bx - ax) * (y - ay) - (by - ay) * (x - ax));
    if (s && sign && s !== sign) return false;
    if (s) sign = s;
  }
  return true;
};
const T = 0.30, B = 0.70, W = 0.085; // topo, base, espessura
const shapes = [
  [[0.25, T], [0.25 + W, T], [0.25 + W, B], [0.25, B]],                       // I
  [[0.555, T], [0.555 + W, T], [0.44 + W * 0.2, B], [0.44 - W * 0.8, B]].map(([x, y]) => [x + 0.03, y]), // A perna esq.
  [[0.555, T], [0.555 + W, T], [0.76, B], [0.76 - W, B]].map(([x, y]) => [x + 0.03, y]),               // A perna dir.
  [[0.49, 0.565], [0.70, 0.565], [0.70, 0.565 + W * 0.85], [0.49, 0.565 + W * 0.85]]                  // A travessa
];
const glyph = (x, y) => shapes.some((s) => inQuad(x, y, s));

function render(size) {
  const out = Buffer.alloc(size * size * 4);
  const SS = 4;
  const top = [16, 185, 129], bot = [13, 148, 136], ink = [12, 14, 18]; // esmeralda -> teal, ardósia
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    let cov = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) if (glyph((px + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size)) cov++;
    cov /= SS * SS;
    const t = (px + py) / (2 * size);
    const i = (py * size + px) * 4;
    for (let c = 0; c < 3; c++) { const bg = top[c] + (bot[c] - top[c]) * t; out[i + c] = Math.round(bg + (ink[c] - bg) * cov); }
    out[i + 3] = 255; // full-bleed para maskable
  }
  return png(size, out);
}

const dir = path.join(__dirname, '..', 'public');
for (const s of [192, 512, 180]) {
  const name = s === 180 ? 'apple-touch-icon.png' : `icon-${s}.png`;
  fs.writeFileSync(path.join(dir, name), render(s));
  console.log('gerado', name);
}
