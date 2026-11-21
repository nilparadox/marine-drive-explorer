// Geography helpers: land mask + coast distance field, terrain height, spatial lookups.
import * as THREE from 'three';

export const MARGIN = 2600;           // world extends past the mapped box (sea + filler city)
export const LAND_Y = 2.6;            // general ground level above mean sea
export let B, GX0, GZ0, GW, GH;       // field grid origin and size
export const CELL = 8;                // metres per field cell
let field = null;                     // signed coast distance in metres (+ land, - sea)
let landRaw = null;
let beach = null; // 0..1 mask of sandy beach (Chowpatty etc.)

// Malabar Hill crest, from Ridge Road / Walkeshwar Road (OSM), heights in metres above sea
const RIDGE = [
  [-1003, -2560, 14], [-960, -2189, 30], [-1003, -2026, 40], [-1082, -1962, 46], [-1151, -1870, 50], [-1180, -1764, 52],
  [-1277, -1648, 50], [-1418, -1488, 46], [-1539, -1315, 44], [-1772, -1096, 40], [-1963, -926, 36], [-2076, -810, 30],
  [-2241, -638, 24], [-2370, -333, 26], [-2440, -60, 22], [-2470, 60, 14],
];

export function initGeo(L) {
  B = L.bounds;
  GX0 = B.x0 - MARGIN; GZ0 = B.z0 - MARGIN;
  GW = Math.ceil((B.x1 - B.x0 + 2 * MARGIN) / CELL); GH = Math.ceil((B.z1 - B.z0 + 2 * MARGIN) / CELL);
  // rasterise land polygons (inside the mapped box), then extend edges outward (clamp) so the coast continues
  const c = document.createElement('canvas'); c.width = GW; c.height = GH;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#000'; g.fillRect(0, 0, GW, GH); g.fillStyle = '#fff';
  for (const r of L.land) { g.beginPath(); for (let i = 0; i < r.length; i += 2) g.lineTo((r[i] - GX0) / CELL, (r[i + 1] - GZ0) / CELL); g.closePath(); g.fill(); }
  const img = g.getImageData(0, 0, GW, GH).data;
  landRaw = new Uint8Array(GW * GH);
  const ix0 = Math.ceil((B.x0 - GX0) / CELL) + 1, ix1 = Math.floor((B.x1 - GX0) / CELL) - 1;
  const iz0 = Math.ceil((B.z0 - GZ0) / CELL) + 1, iz1 = Math.floor((B.z1 - GZ0) / CELL) - 1;
  for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
    const ci = Math.min(ix1, Math.max(ix0, i)), cj = Math.min(iz1, Math.max(iz0, j));
    landRaw[j * GW + i] = img[(cj * GW + ci) * 4] > 127 ? 1 : 0;
  }
  field = sdf(landRaw, GW, GH);
  // beach mask: beach polygons grown a little seaward, blurred
  g.fillStyle = '#000'; g.fillRect(0, 0, GW, GH); g.fillStyle = '#fff'; g.strokeStyle = '#fff'; g.lineWidth = 6; g.filter = 'blur(2px)';
  for (const a of L.areas) if (a.k === 5) { const r = a.pts; g.beginPath(); for (let i = 0; i < r.length; i += 2) g.lineTo((r[i] - GX0) / CELL, (r[i + 1] - GZ0) / CELL); g.closePath(); g.fill(); g.stroke(); }
  const bi = g.getImageData(0, 0, GW, GH).data; beach = new Float32Array(GW * GH);
  for (let k = 0; k < GW * GH; k++) beach[k] = bi[k * 4] / 255;
  for (let k = 0; k < field.length; k++) field[k] *= CELL;
}

// two-pass exact-ish distance transform (Felzenszwalb) for land and sea, combined into a signed field
function edt1(f, n, d, v, z) {
  let k = 0; v[0] = 0; z[0] = -1e20; z[1] = 1e20;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = 1e20;
  }
  k = 0; for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
}
function edt(mask, W, H, want) {
  const INF = 1e20, g = new Float64Array(W * H), n = Math.max(W, H);
  const f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let k = 0; k < W * H; k++) g[k] = mask[k] === want ? 0 : INF;
  for (let i = 0; i < W; i++) { for (let j = 0; j < H; j++) f[j] = g[j * W + i]; edt1(f, H, d, v, z); for (let j = 0; j < H; j++) g[j * W + i] = d[j]; }
  for (let j = 0; j < H; j++) { for (let i = 0; i < W; i++) f[i] = g[j * W + i]; edt1(f, W, d, v, z); for (let i = 0; i < W; i++) g[j * W + i] = Math.sqrt(d[i]); }
  return g;
}
function sdf(mask, W, H) {
  const toSea = edt(mask, W, H, 0), toLand = edt(mask, W, H, 1), out = new Float32Array(W * H);
  for (let k = 0; k < W * H; k++) out[k] = mask[k] ? toSea[k] - 0.5 : -(toLand[k] - 0.5);
  return out;
}

// bilinear signed distance to coast (metres, + on land)
export function coastDist(x, z) {
  let fx = (x - GX0) / CELL - 0.5, fz = (z - GZ0) / CELL - 0.5;
  fx = Math.min(GW - 1.001, Math.max(0, fx)); fz = Math.min(GH - 1.001, Math.max(0, fz));
  const i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j, k = j * GW + i;
  return (field[k] * (1 - tx) + field[k + 1] * tx) * (1 - tz) + (field[k + GW] * (1 - tx) + field[k + GW + 1] * tx) * tz;
}
export function beachAt(x, z) {
  let fx = (x - GX0) / CELL - 0.5, fz = (z - GZ0) / CELL - 0.5;
  fx = Math.min(GW - 1.001, Math.max(0, fx)); fz = Math.min(GH - 1.001, Math.max(0, fz));
  const i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j, k = j * GW + i;
  return (beach[k] * (1 - tx) + beach[k + 1] * tx) * (1 - tz) + (beach[k + GW] * (1 - tx) + beach[k + GW + 1] * tx) * tz;
}
export const isLand = (x, z) => coastDist(x, z) > 0;

function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
  let t = l2 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0; t = Math.max(0, Math.min(1, t));
  return [Math.hypot(px - ax - dx * t, pz - az - dz * t), t];
}
const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function hash2(x, z) { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); }
function vnoise(x, z) {
  const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j, u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash2(i, j), b = hash2(i + 1, j), c = hash2(i, j + 1), d = hash2(i + 1, j + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// terrain height (land), metres above mean sea level
export function hillH(x, z) {
  let best = 0;
  for (let i = 0; i < RIDGE.length - 1; i++) {
    const a = RIDGE[i], b = RIDGE[i + 1];
    const [d, t] = segDist(x, z, a[0], a[1], b[0], b[1]);
    const h = a[2] + (b[2] - a[2]) * t;
    const w = 300 + 80 * Math.sin(i * 1.7);
    const v = h * Math.exp(-(d * d) / (w * w));
    if (v > best) best = v;
  }
  return best;
}
export function groundH(x, z) {
  const cd = coastDist(x, z);
  if (cd < 0) return seabedH(x, z, cd);
  const hill = hillH(x, z);
  const n = (vnoise(x * 0.004, z * 0.004) - 0.5) * 1.2;
  // the hill meets the sea steeply (rocky shore); the reclaimed flats sit at LAND_Y right up to the sea wall
  const edge = ss(0, hill > 6 ? 45 : 14, cd);
  const bch = beachAt(x, z);
  const base = LAND_Y + (Math.min(LAND_Y, 0.15 + cd * 0.03) - LAND_Y) * bch;
  return base + (hill + n * ss(0, 200, cd)) * edge;
}
export function seabedH(x, z, cd = coastDist(x, z)) {
  // shallow Back Bay: about 3-6 m deep, deeper offshore
  const d = -cd, bch = beachAt(x, z);
  if (bch > 0.05) return Math.min(0.15 + cd * 0.03, -0.3 + cd * 0.01) * bch + (1 - bch) * (-1.5 - d * 0.035);
  return -Math.min(1.5 + d * 0.035, 7 + d * 0.004) - (vnoise(x * 0.01, z * 0.01) - 0.5) * 1.2;
}

// coarse spatial hash for "is this spot free" queries (buildings, roads)
export class Grid {
  constructor(cell = 20) { this.c = cell; this.m = new Map(); }
  key(i, j) { return i * 100003 + j; }
  add(x0, z0, x1, z1, item) {
    const c = this.c;
    for (let i = Math.floor(x0 / c); i <= Math.floor(x1 / c); i++) for (let j = Math.floor(z0 / c); j <= Math.floor(z1 / c); j++) {
      const k = this.key(i, j); let a = this.m.get(k); if (!a) this.m.set(k, a = []); a.push(item);
    }
  }
  query(x, z) { return this.m.get(this.key(Math.floor(x / this.c), Math.floor(z / this.c))) || []; }
}
export function pointInPoly(x, z, p) {
  let c = false;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const xi = p[i], zi = p[i + 1], xj = p[j], zj = p[j + 1];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c;
  }
  return c;
}
export function polyArea(p) { let s = 0; for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) s += p[j] * p[i + 1] - p[i] * p[j + 1]; return s / 2; }
export function polyBox(p) { let a = 1e9, b = 1e9, c = -1e9, d = -1e9; for (let i = 0; i < p.length; i += 2) { a = Math.min(a, p[i]); b = Math.min(b, p[i + 1]); c = Math.max(c, p[i]); d = Math.max(d, p[i + 1]); } return [a, b, c, d]; }

// seeded random
export function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
export const hash = hash2;

// field as a texture for shaders (coast distance, R channel, metres)
export function fieldTexture() {
  // RG half float (filterable on phones): R = signed coast distance (m), G = beach mask
  const d = new Uint16Array(GW * GH * 2), h = THREE.DataUtils.toHalfFloat;
  for (let k = 0; k < GW * GH; k++) { d[k * 2] = h(Math.max(-6e4, Math.min(6e4, field[k]))); d[k * 2 + 1] = h(beach[k]); }
  const t = new THREE.DataTexture(d, GW, GH, THREE.RGFormat, THREE.HalfFloatType);
  t.magFilter = t.minFilter = THREE.LinearFilter; t.needsUpdate = true;
  return t;
}
export const fieldInfo = () => new THREE.Vector4(GX0, GZ0, GW * CELL, GH * CELL);

// push triangle (vertex indices into a flat xyz array) so that it faces up (+y)
export function triUp(idx, pos, a, b, c) {
  const ax = pos[a * 3], az = pos[a * 3 + 2], bx = pos[b * 3], bz = pos[b * 3 + 2], cx = pos[c * 3], cz = pos[c * 3 + 2];
  if ((bz - az) * (cx - ax) - (bx - ax) * (cz - az) >= 0) idx.push(a, b, c); else idx.push(a, c, b);
}
