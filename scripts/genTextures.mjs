/**
 * Generate tileable PBR-ish albedo (+ simple normal) maps for WWTP-NA.
 * Pure Node (zlib) — no canvas dependency. Run: node scripts/genTextures.mjs
 */
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '../public/textures');

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : c >>> 1;
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const t = Buffer.from(type);
  const crcBuf = Buffer.concat([t, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcBuf));
  return Buffer.concat([len, t, data, crc]);
}

function writePng(file, w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  fs.writeFileSync(file, png);
  console.log('wrote', path.basename(file), w + 'x' + h, (png.length / 1024).toFixed(1) + 'KB');
}

function hash2(x, y) {
  let n = x * 374761393 + y * 668265263;
  n = (n ^ (n >> 13)) * 1274126177;
  return ((n ^ (n >> 16)) >>> 0) / 4294967296;
}

function smoothNoise(x, y) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = hash2(x0, y0);
  const b = hash2(x0 + 1, y0);
  const c = hash2(x0, y0 + 1);
  const d = hash2(x0 + 1, y0 + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x, y, oct = 5) {
  let a = 0;
  let amp = 0.5;
  let f = 1;
  for (let i = 0; i < oct; i++) {
    a += amp * smoothNoise(x * f, y * f);
    amp *= 0.5;
    f *= 2;
  }
  return a;
}

function setPx(buf, w, x, y, r, g, b, a = 255) {
  const i = (y * w + x) * 4;
  buf[i] = r | 0;
  buf[i + 1] = g | 0;
  buf[i + 2] = b | 0;
  buf[i + 3] = a | 0;
}

function genConcrete(w) {
  const buf = Buffer.alloc(w * w * 4);
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) {
      const n = fbm(x / 32, y / 32, 6);
      const speck = hash2(x, y) > 0.97 ? -18 : hash2(x + 3, y + 7) > 0.985 ? 12 : 0;
      // Fine aggregate
      const fine = (smoothNoise(x / 3.1, y / 3.1) - 0.5) * 14;
      const base = 168 + n * 28 + speck + fine;
      // Subtle weathering streaks
      const streak = Math.sin((x + y * 0.35) * 0.08) * 4 * (n - 0.4);
      const r = Math.max(0, Math.min(255, base + streak - 4));
      const g = Math.max(0, Math.min(255, base + streak - 2));
      const b = Math.max(0, Math.min(255, base + 2));
      setPx(buf, w, x, y, r, g, b);
    }
  }
  return buf;
}

function genWeatheredConcrete(w) {
  const buf = Buffer.alloc(w * w * 4);
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) {
      const n = fbm(x / 28, y / 28, 6);
      const stain = fbm(x / 64 + 10, y / 64, 4);
      const moss = stain > 0.62 ? (stain - 0.62) * 40 : 0;
      const base = 150 + n * 32;
      const r = Math.max(0, Math.min(255, base - moss * 0.6 - 6));
      const g = Math.max(0, Math.min(255, base - moss * 0.1 - 2));
      const b = Math.max(0, Math.min(255, base - moss * 1.2 + 2));
      setPx(buf, w, x, y, r, g, b);
    }
  }
  return buf;
}

function genAsphalt(w) {
  const buf = Buffer.alloc(w * w * 4);
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) {
      const n = fbm(x / 18, y / 18, 5);
      const agg = hash2(x * 2, y * 3) * 22;
      const base = 42 + n * 28 + agg * 0.35;
      // Faint lane wear
      const wear = Math.abs(Math.sin(y * 0.04)) < 0.08 ? 8 : 0;
      const v = Math.max(0, Math.min(255, base + wear));
      setPx(buf, w, x, y, v, v, v + 2);
    }
  }
  return buf;
}

function genGrass(w) {
  const buf = Buffer.alloc(w * w * 4);
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) {
      const n = fbm(x / 22, y / 22, 5);
      const blade = smoothNoise(x / 1.7, y / 4.2);
      const r = Math.max(0, Math.min(255, 48 + n * 30 + blade * 10));
      const g = Math.max(0, Math.min(255, 92 + n * 55 + blade * 28));
      const b = Math.max(0, Math.min(255, 38 + n * 22));
      // Dry patches
      if (n > 0.72) {
        setPx(buf, w, x, y, r + 20, g + 8, b - 5);
      } else {
        setPx(buf, w, x, y, r, g, b);
      }
    }
  }
  return buf;
}

function genWater(w) {
  const buf = Buffer.alloc(w * w * 4);
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) {
      const rip =
        Math.sin(x * 0.12 + Math.sin(y * 0.07) * 2) * 0.5 +
        Math.sin(y * 0.09 + x * 0.05) * 0.35 +
        fbm(x / 40, y / 40, 3) * 0.4;
      const t = (rip + 1.2) / 2.4;
      const r = 28 + t * 40;
      const g = 90 + t * 70;
      const b = 110 + t * 90;
      setPx(buf, w, x, y, r, g, b, 230);
    }
  }
  return buf;
}

function genWaterNormal(w) {
  const buf = Buffer.alloc(w * w * 4);
  const hmap = new Float32Array(w * w);
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) {
      hmap[y * w + x] =
        Math.sin(x * 0.18) * Math.cos(y * 0.14) * 0.5 +
        Math.sin((x + y) * 0.09) * 0.35 +
        fbm(x / 20, y / 20, 3) * 0.4;
    }
  }
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) {
      const hL = hmap[y * w + ((x - 1 + w) % w)];
      const hR = hmap[y * w + ((x + 1) % w)];
      const hD = hmap[((y - 1 + w) % w) * w + x];
      const hU = hmap[((y + 1) % w) * w + x];
      const nx = (hL - hR) * 3;
      const ny = (hD - hU) * 3;
      const nz = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      setPx(buf, w, x, y, ((nx / len) * 0.5 + 0.5) * 255, ((ny / len) * 0.5 + 0.5) * 255, ((nz / len) * 0.5 + 0.5) * 255);
    }
  }
  return buf;
}

function genMetal(w) {
  const buf = Buffer.alloc(w * w * 4);
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) {
      const brush = Math.sin(y * 0.9 + hash2(x, 0) * 0.5) * 8;
      const n = fbm(x / 48, y / 12, 4);
      const rust = fbm(x / 36 + 5, y / 36, 3) > 0.7 ? 18 : 0;
      const base = 140 + n * 40 + brush;
      setPx(
        buf,
        w,
        x,
        y,
        Math.max(0, Math.min(255, base + rust * 0.8)),
        Math.max(0, Math.min(255, base - rust * 0.2)),
        Math.max(0, Math.min(255, base - rust * 0.6 - 8)),
      );
    }
  }
  return buf;
}

function genPaintedMetal(w) {
  const buf = Buffer.alloc(w * w * 4);
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) {
      const n = fbm(x / 40, y / 40, 4);
      const chip = hash2(x, y) > 0.992;
      if (chip) {
        setPx(buf, w, x, y, 120, 118, 110);
      } else {
        // Industrial blue-grey paint
        const r = 70 + n * 25;
        const g = 88 + n * 28;
        const b = 108 + n * 30;
        setPx(buf, w, x, y, r, g, b);
      }
    }
  }
  return buf;
}

fs.mkdirSync(OUT, { recursive: true });
const S = 512;
writePng(path.join(OUT, 'mat-concrete.png'), S, S, genConcrete(S));
writePng(path.join(OUT, 'mat-concrete-weathered.png'), S, S, genWeatheredConcrete(S));
writePng(path.join(OUT, 'mat-asphalt.png'), S, S, genAsphalt(S));
writePng(path.join(OUT, 'terrain-grass.png'), S, S, genGrass(S));
writePng(path.join(OUT, 'mat-water.png'), S, S, genWater(S));
writePng(path.join(OUT, 'mat-water-normal.png'), S, S, genWaterNormal(S));
writePng(path.join(OUT, 'mat-metal.png'), S, S, genMetal(S));
writePng(path.join(OUT, 'mat-metal-painted.png'), S, S, genPaintedMetal(S));
console.log('done');
