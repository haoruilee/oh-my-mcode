#!/usr/bin/env node
/** Geometric M + gold chevron, readable at 32px. No extra deps. */
import { deflateSync } from "node:zlib";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SIZE = 256;
const pixels = Buffer.alloc(SIZE * SIZE * 4);

function setPx(x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const i = (y * SIZE + x) * 4;
  pixels[i] = r;
  pixels[i + 1] = g;
  pixels[i + 2] = b;
  pixels[i + 3] = a;
}

function fill(r, g, b) {
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) setPx(x, y, r, g, b);
  }
}

function roundedRectMask(radius) {
  const inside = (x, y) => {
    const xr = x < radius ? radius - x : x >= SIZE - radius ? x - (SIZE - 1 - radius) : 0;
    const yr = y < radius ? radius - y : y >= SIZE - radius ? y - (SIZE - 1 - radius) : 0;
    if (xr && yr) return xr * xr + yr * yr <= radius * radius;
    return true;
  };
  return inside;
}

function rect(x0, y0, x1, y1, r, g, b) {
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) setPx(x, y, r, g, b);
  }
}

function pillar(x0, x1, y0, y1, slantIn, r, g, b) {
  const mid = (x0 + x1) / 2;
  for (let y = y0; y <= y1; y += 1) {
    const t = (y - y0) / Math.max(1, y1 - y0);
    const inset = Math.round((1 - t) * slantIn);
    const left = x0 + (mid < SIZE / 2 ? inset : 0);
    const right = x1 - (mid > SIZE / 2 ? inset : 0);
    for (let x = left; x <= right; x += 1) setPx(x, y, r, g, b);
  }
}

function chevron(cx, cy, halfW, halfH, thickness, r, g, b) {
  for (let y = cy - halfH; y <= cy + halfH; y += 1) {
    for (let x = cx - halfW; x <= cx + halfW; x += 1) {
      const nx = (x - cx) / halfW;
      const ny = (y - cy) / halfH;
      const dist = Math.abs(ny - Math.abs(nx));
      if (dist * halfH <= thickness) setPx(x, y, r, g, b);
    }
  }
}

const inRound = roundedRectMask(36);
fill(6, 16, 18);
for (let y = 0; y < SIZE; y += 1) {
  for (let x = 0; x < SIZE; x += 1) {
    if (!inRound(x, y)) setPx(x, y, 6, 16, 18, 0);
  }
}

// Outer pillars (inward-slanted tops) + center stem
pillar(42, 86, 48, 208, 18, 245, 248, 250);
pillar(170, 214, 48, 208, 18, 245, 248, 250);
rect(118, 118, 138, 208, 245, 248, 250);
chevron(128, 86, 46, 28, 8, 212, 160, 62);

function crc32(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
for (let y = 0; y < SIZE; y += 1) {
  raw[y * (SIZE * 4 + 1)] = 0;
  pixels.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8;
ihdr[9] = 6;

const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw)),
  chunk("IEND", Buffer.alloc(0)),
]);

const dest = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "icon.png");
createWriteStream(dest).end(png);
process.stdout.write(`wrote ${dest}\n`);
