#!/usr/bin/env node
/** Geometric mark, readable at 32px. No extra deps. */
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

function rect(x0, y0, x1, y1, r, g, b) {
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) setPx(x, y, r, g, b);
  }
}

function disc(cx, cy, rad, r, g, b) {
  const r2 = rad * rad;
  for (let y = cy - rad; y <= cy + rad; y += 1) {
    for (let x = cx - rad; x <= cx + rad; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r2) setPx(x, y, r, g, b);
    }
  }
}

fill(11, 18, 32);
rect(18, 18, SIZE - 19, 32, 245, 185, 66);
rect(18, SIZE - 33, SIZE - 19, SIZE - 19, 245, 185, 66);
rect(18, 18, 32, SIZE - 19, 245, 185, 66);
rect(SIZE - 33, 18, SIZE - 19, SIZE - 19, 245, 185, 66);
disc(128, 120, 58, 245, 185, 66);
disc(128, 120, 42, 11, 18, 32);

// Check mark
for (let t = 0; t <= 1; t += 0.002) {
  const x = Math.round(88 + t * 28);
  const y = Math.round(120 + t * 28);
  for (let k = -7; k <= 7; k += 1) setPx(x + k, y, 245, 185, 66);
}
for (let t = 0; t <= 1; t += 0.002) {
  const x = Math.round(116 + t * 52);
  const y = Math.round(148 - t * 52);
  for (let k = -7; k <= 7; k += 1) setPx(x + k, y, 245, 185, 66);
}

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
