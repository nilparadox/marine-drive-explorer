// Bakes OpenStreetMap data (_raw/osm.json) into src/data.js: compact varint+base64 streams.
// Layout only (where things are). Every visual is made by code at runtime.
import fs from 'node:fs';

const LAT0 = 18.9405, LON0 = 72.817;
const KX = 111320 * Math.cos(LAT0 * Math.PI / 180), KZ = 110574;
const S = 18.915, W = 72.792, N = 18.966, E = 72.842;
const X0 = (W - LON0) * KX, X1 = (E - LON0) * KX, Z0 = -(N - LAT0) * KZ, Z1 = -(S - LAT0) * KZ;
const P = (lon, lat) => [(lon - LON0) * KX, -(lat - LAT0) * KZ];
const Q = 4; // 0.25 m units

const raw = JSON.parse(fs.readFileSync(new URL('../_raw/osm.json', import.meta.url)));
const els = raw.elements;

// ---------------------------------------------------------------- encoding
const bytes = [];
function vu(n) { n = Math.round(n); if (n < 0) throw new Error('neg ' + n); do { let b = n & 127; n = Math.floor(n / 128); if (n) b |= 128; bytes.push(b); } while (n); }
const vs = n => { n = Math.round(n); vu(n < 0 ? -2 * n - 1 : 2 * n); };
function flush() { const b = Buffer.from(bytes); bytes.length = 0; return b.toString('base64'); }
function putLine(pts, closed) { // count, then zigzag deltas in 0.25 m
  vu(pts.length); let px = 0, pz = 0;
  for (const [x, z] of pts) { const qx = Math.round(x * Q), qz = Math.round(z * Q); vs(qx - px); vs(qz - pz); px = qx; pz = qz; }
}

// ---------------------------------------------------------------- geometry helpers
const inside = ([x, z], m = 0) => x >= X0 - m && x <= X1 + m && z >= Z0 - m && z <= Z1 + m;
function clipSeg(a, b, m) { // Liang-Barsky against bbox grown by m; returns [t0,t1] or null
  let t0 = 0, t1 = 1; const dx = b[0] - a[0], dz = b[1] - a[1];
  const p = [-dx, dx, -dz, dz], q = [a[0] - (X0 - m), X1 + m - a[0], a[1] - (Z0 - m), Z1 + m - a[1]];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) { if (q[i] < 0) return null; continue; }
    const r = q[i] / p[i];
    if (p[i] < 0) { if (r > t1) return null; if (r > t0) t0 = r; } else { if (r < t0) return null; if (r < t1) t1 = r; }
  }
  return [t0, t1];
}
const lerp2 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
function clipLine(pts, m = 0) { // -> list of pieces inside bbox+m
  const out = []; let cur = null;
  for (let i = 0; i < pts.length - 1; i++) {
    const c = clipSeg(pts[i], pts[i + 1], m);
    if (!c) { if (cur) { out.push(cur); cur = null; } continue; }
    const a = lerp2(pts[i], pts[i + 1], c[0]), b = lerp2(pts[i], pts[i + 1], c[1]);
    if (!cur) cur = [a];
    cur.push(b);
    if (c[1] < 1) { out.push(cur); cur = null; }
  }
  if (cur) out.push(cur);
  return out.filter(p => p.length > 1);
}
function simplify(pts, tol) { // Douglas-Peucker
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const st = [[0, pts.length - 1]];
  while (st.length) {
    const [a, b] = st.pop(); let md = 0, mi = -1;
    const [ax, az] = pts[a], [bx, bz] = pts[b], dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz) || 1e-9;
    for (let i = a + 1; i < b; i++) { const d = Math.abs((pts[i][0] - ax) * dz - (pts[i][1] - az) * dx) / L; if (d > md) { md = d; mi = i; } }
    if (md > tol) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
function simplifyRing(r, tol) { // closed ring (no repeated end point)
  if (r.length < 4) return r;
  let fi = 0, fd = -1; for (let i = 1; i < r.length; i++) { const d = Math.hypot(r[i][0] - r[0][0], r[i][1] - r[0][1]); if (d > fd) { fd = d; fi = i; } }
  const a = simplify(r.slice(0, fi + 1), tol), b = simplify(r.slice(fi).concat([r[0]]), tol);
  return a.slice(0, -1).concat(b.slice(0, -1));
}
const area = r => { let s = 0; for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; };
function ringOf(geom) { let r = geom.map(g => P(g.lon, g.lat)); if (r.length > 1 && r[0][0] === r.at(-1)[0] && r[0][1] === r.at(-1)[1]) r.pop(); return r; }
function clipPoly(r) { // Sutherland-Hodgman against bbox
  const edges = [[0, X0, 1], [0, X1, -1], [1, Z0, 1], [1, Z1, -1]];
  for (const [ax, v, s] of edges) {
    const o = []; if (!r.length) return r;
    for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length], ia = (a[ax] - v) * s >= 0, ib = (b[ax] - v) * s >= 0;
      if (ia) o.push(a);
      if (ia !== ib) { const t = (v - a[ax]) / (b[ax] - a[ax]); o.push(lerp2(a, b, t)); }
    }
    r = o;
  }
  return r;
}
function outerRings(e) { // way or multipolygon relation -> outer rings (assembled)
  if (e.type === 'way') return e.geometry ? [ringOf(e.geometry)] : [];
  const segs = (e.members || []).filter(m => m.type === 'way' && m.role !== 'inner' && m.geometry).map(m => m.geometry.map(g => P(g.lon, g.lat)));
  const rings = [];
  const key = p => p[0].toFixed(3) + ',' + p[1].toFixed(3);
  while (segs.length) {
    let r = segs.shift();
    let guard = 0;
    while (key(r[0]) !== key(r.at(-1)) && guard++ < 500) {
      const i = segs.findIndex(s => key(s[0]) === key(r.at(-1)) || key(s.at(-1)) === key(r.at(-1)));
      if (i < 0) break;
      let s = segs.splice(i, 1)[0]; if (key(s[0]) !== key(r.at(-1))) s = s.slice().reverse();
      r = r.concat(s.slice(1));
    }
    if (key(r[0]) === key(r.at(-1))) r.pop();
    if (r.length > 2) rings.push(r);
  }
  return rings;
}

// ---------------------------------------------------------------- 1. land polygon from coastline
const coast = els.filter(e => e.type === 'way' && e.tags?.natural === 'coastline');
let chains = coast.map(e => ({ ids: e.nodes.slice(), pts: e.geometry.map(g => P(g.lon, g.lat)) }));
let merged = true;
while (merged) {
  merged = false;
  for (let i = 0; i < chains.length && !merged; i++) for (let j = 0; j < chains.length && !merged; j++) {
    if (i === j) continue;
    const a = chains[i], b = chains[j];
    if (a.ids.at(-1) === b.ids[0] && a.ids[0] !== a.ids.at(-1)) {
      a.ids = a.ids.concat(b.ids.slice(1)); a.pts = a.pts.concat(b.pts.slice(1)); chains.splice(j, 1); merged = true;
    }
  }
}
// pieces that cross the bbox; closed rings fully inside are islands
const pieces = [], islands = [];
for (const c of chains) {
  if (c.ids[0] === c.ids.at(-1)) { const r = c.pts.slice(0, -1); const cl = clipPoly(r); if (cl.length > 2) islands.push(cl); continue; }
  for (const p of clipLine(c.pts, 0)) pieces.push(p);
}
// perimeter parameter, counter-clockwise when viewed with north up (x east, z south => go: bottom edge east, right edge north, top edge west, left edge south)
const PW = X1 - X0, PH = Z1 - Z0;
function perim([x, z]) {
  const e = 0.01;
  if (Math.abs(z - Z1) < e) return x - X0;                 // south edge, going east
  if (Math.abs(x - X1) < e) return PW + (Z1 - z);          // east edge, going north
  if (Math.abs(z - Z0) < e) return PW + PH + (X1 - x);     // north edge, going west
  if (Math.abs(x - X0) < e) return 2 * PW + PH + (z - Z0); // west edge, going south
  return null;
}
const corner = t => { t = ((t % (2 * PW + 2 * PH)) + 2 * PW + 2 * PH) % (2 * PW + 2 * PH);
  if (t <= PW) return [X0 + t, Z1]; t -= PW; if (t <= PH) return [X1, Z1 - t]; t -= PH; if (t <= PW) return [X1 - t, Z0]; t -= PW; return [X0, Z0 + t]; };
const open = pieces.filter(p => perim(p[0]) != null && perim(p.at(-1)) != null);
console.log('coast pieces', pieces.length, 'open', open.length, 'islands', islands.length);
// OSM coastline: land on the LEFT when walking. In x-east/z-south coords, "left" when viewed north-up is the same as math-left with y=-z.
// Land polygon traced CCW (north-up): follow piece, then walk the boundary CCW from its exit to the next entry.
const LAND = [];
const used = new Set(), T = 2 * PW + 2 * PH;
for (let s = 0; s < open.length; s++) {
  if (used.has(s)) continue;
  let ring = [], k = s, guard = 0;
  while (!used.has(k) && guard++ < 50) {
    used.add(k); ring.push(...open[k]);
    const te = perim(open[k].at(-1));
    let best = -1, bd = 1e18;
    for (let j = 0; j < open.length; j++) { const ts = perim(open[j][0]); const d = ((ts - te) % T + T) % T; if (d < bd) { bd = d; best = j; } }
    // add bbox corners passed on the way
    const cs = [PW, PW + PH, 2 * PW + PH, T];
    const steps = [];
    for (const c of cs) for (const cc of [c, c + T]) { const d = cc - te; if (d > 0 && d < bd) steps.push(d); }
    steps.sort((a, b) => a - b).forEach(d => ring.push(corner(te + d)));
    k = best;
  }
  LAND.push(ring);
}
for (const r of islands) LAND.push(r);
LAND.forEach((r, i) => console.log('land ring', i, r.length, 'area km2', (area(r) / 1e6).toFixed(2)));

// ---------------------------------------------------------------- 2. roads
const HW = { motorway: 0, trunk: 0, primary: 1, primary_link: 1, secondary: 2, secondary_link: 2, tertiary: 3, tertiary_link: 3, unclassified: 4, residential: 4, living_street: 5, service: 5, pedestrian: 6, footway: 7, path: 7, steps: 8, cycleway: 7, track: 7 };
const roadNames = []; const nameIdx = n => { if (!n) return 0; let i = roadNames.indexOf(n); if (i < 0) { roadNames.push(n); i = roadNames.length - 1; } return i + 1; };
let nRoad = 0;
const roadStream = (() => {
  const list = [];
  for (const e of els) {
    if (e.type !== 'way' || !e.tags?.highway || !e.geometry) continue;
    const t = e.tags, cls = HW[t.highway]; if (cls === undefined) continue;
    if (t.tunnel === 'yes' || t.tunnel === 'building_passage' || t.area === 'yes') continue;
    if (t.indoor === 'yes' || t.level) continue;
    const pts = e.geometry.map(g => P(g.lon, g.lat));
    for (const piece of clipLine(pts, 30)) {
      const sp = simplify(piece, 0.25);
      list.push({ cls, lanes: Math.min(15, +(t.lanes || 0) | 0), oneway: t.oneway === 'yes' ? 1 : 0, bridge: t.bridge && t.bridge !== 'no' ? 1 : 0, layer: Math.max(0, Math.min(3, +(t.layer || 0) | 0)), name: cls <= 3 ? nameIdx(t.name) : 0, pts: sp, id: e.id });
    }
  }
  list.sort((a, b) => a.cls - b.cls);
  for (const r of list) {
    vu(r.cls); vu(r.lanes); vu(r.oneway | r.bridge << 1 | r.layer << 2); vu(r.name); putLine(r.pts); nRoad++;
  }
  return flush();
})();

// ---------------------------------------------------------------- 3. buildings
const BT = { yes: 0, apartments: 1, residential: 1, house: 1, commercial: 2, office: 2, retail: 2, hotel: 3, college: 4, school: 4, university: 4, public: 4, government: 4, hospital: 4, train_station: 5, mosque: 6, temple: 6, church: 6, religious: 6, industrial: 7, warehouse: 7, roof: 8, construction: 9, garage: 7, shed: 8, kiosk: 8, bungalow: 10, villa: 10 };
const landmarkIds = { 107602114: 'churchgate', 753875938: 'trident', 753875937: 'oberoi', 54929165: 'intercontinental', 28845634: 'gateway', 28846517: 'taj', 356173966: 'express', 130535596: 'mantralaya', 206808197: 'jehangir', 46717574: 'metro', 46717569: 'liberty', 54224655: 'regal' };
let nB = 0; const bNames = [];
const bStream = (() => {
  const list = [];
  for (const e of els) {
    const t = e.tags; if (!t?.building || t.building === 'no') continue;
    if (t.location === 'underground' || t.layer && +t.layer < 0) continue;
    for (let r of outerRings(e)) {
      r = clipPoly(r); if (r.length < 3) continue;
      if (area(r) < 0) r.reverse(); // CCW north-up
      r = simplifyRing(r, 0.2);
      if (r.length < 3) continue;
      const A = area(r); if (A < 8) continue;
      let lv = +(t['building:levels'] || 0) || 0; let h = parseFloat(t.height || '') || 0;
      const mh = parseFloat(t.min_height || '') || 0;
      let type = BT[t.building] ?? 0;
      if (t.amenity === 'place_of_worship') type = 6;
      if (t.historic || t.tourism === 'museum') type = 11;
      const lm = landmarkIds[e.id]; let nm = 0;
      if (lm) { bNames.push(lm); nm = bNames.length; }
      list.push({ r, lv: Math.min(120, lv | 0), h: Math.min(400, h), mh, type, nm });
    }
  }
  for (const b of list) {
    vu(b.type); vu(b.lv); vu(Math.round(b.h * 2)); vu(b.nm); putLine(b.r); nB++;
  }
  return flush();
})();

// ---------------------------------------------------------------- 4. areas (ground cover)
// kinds: 1 grass/park 2 garden 3 pitch 4 stadium 5 beach 6 wood 7 water 8 railway 9 parking 10 playground 11 pool 12 construction 13 cemetery 14 track 15 plaza(pedestrian area) 16 recreation ground (maidan) 17 platform
function areaKind(t) {
  if (t.natural === 'beach' || t.tourism === 'attraction' && /beach/i.test(t.name || '')) return 5;
  if (t.natural === 'wood' || t.landuse === 'forest') return 6;
  if (t.natural === 'water' || t.leisure === 'swimming_pool') return t.leisure ? 11 : 7;
  if (t.leisure === 'pitch') return 3;
  if (t.leisure === 'stadium') return 4;
  if (t.leisure === 'track') return 14;
  if (t.leisure === 'playground') return 10;
  if (t.leisure === 'park' || t.landuse === 'grass' || t.leisure === 'common') return 1;
  if (t.leisure === 'garden') return 2;
  if (t.landuse === 'recreation_ground') return 16;
  if (t.landuse === 'railway') return 8;
  if (t.amenity === 'parking') return 9;
  if (t.landuse === 'construction') return 12;
  if (t.landuse === 'cemetery') return 13;
  if (t.highway === 'pedestrian' && t.area === 'yes') return 15;
  if (t.railway === 'platform') return 17;
  return 0;
}
let nA = 0;
const aStream = (() => {
  const list = [];
  for (const e of els) {
    const t = e.tags; if (!t || t.building) continue;
    const k = areaKind(t); if (!k) continue;
    if (e.type === 'way' && (!e.geometry || e.nodes[0] !== e.nodes.at(-1))) continue;
    for (let r of outerRings(e)) {
      r = clipPoly(r); if (r.length < 3) continue;
      if (area(r) < 0) r.reverse();
      r = simplifyRing(r, 0.3); if (r.length < 3) continue;
      const A = area(r); if (A < 20) continue;
      list.push({ k, r, A });
    }
  }
  list.sort((a, b) => b.A - a.A); // big first, small on top
  for (const a of list) { vu(a.k); putLine(a.r); nA++; }
  return flush();
})();

// ---------------------------------------------------------------- 5. railways (tracks) and platforms as lines
let nR = 0;
const rStream = (() => {
  for (const e of els) {
    const t = e.tags; if (e.type !== 'way' || !t || !e.geometry) continue;
    let k = 0;
    if (t.railway === 'rail' && !t.service) k = 1; else if (t.railway === 'rail') k = 2; else if (t.railway === 'platform' && e.nodes[0] !== e.nodes.at(-1)) k = 3;
    if (!k || t.tunnel === 'yes') continue;
    for (const piece of clipLine(e.geometry.map(g => P(g.lon, g.lat)), 20)) { vu(k); putLine(simplify(piece, 0.15)); nR++; }
  }
  return flush();
})();

// ---------------------------------------------------------------- 6. mapped trees + misc points
let nT = 0;
const tStream = (() => {
  const pts = [];
  for (const e of els) if (e.type === 'node' && e.tags?.natural === 'tree') { const p = P(e.lon, e.lat); if (inside(p)) pts.push(p); }
  pts.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  putLine(pts); nT = pts.length; return flush();
})();
// barriers along the sea (walls) are useful for the promenade line
let nW = 0;
const wStream = (() => {
  for (const e of els) {
    const t = e.tags; if (e.type !== 'way' || !t || !e.geometry) continue;
    const k = t.barrier === 'wall' || t.barrier === 'retaining_wall' ? 1 : t.man_made === 'breakwater' || t.man_made === 'groyne' ? 2 : t.man_made === 'pier' ? 3 : t.natural === 'cliff' ? 4 : 0;
    if (!k) continue;
    for (const piece of clipLine(e.geometry.map(g => P(g.lon, g.lat)), 0)) { vu(k); putLine(simplify(piece, 0.2)); nW++; }
  }
  return flush();
})();

let landS; { for (const r of LAND) putLine(simplifyRing(r, 0.15)); landS = flush(); }

const out = `// Generated by tools/bake.mjs from OpenStreetMap (c) OpenStreetMap contributors, ODbL. Layout only.
export const BOUNDS = ${JSON.stringify({ x0: +X0.toFixed(2), x1: +X1.toFixed(2), z0: +Z0.toFixed(2), z1: +Z1.toFixed(2), lat0: LAT0, lon0: LON0, kx: +KX.toFixed(3), kz: KZ })};
export const COUNTS = ${JSON.stringify({ land: LAND.length, roads: nRoad, buildings: nB, areas: nA, rails: nR, trees: nT, walls: nW })};
export const ROAD_NAMES = ${JSON.stringify(roadNames)};
export const LANDMARKS = ${JSON.stringify(bNames)};
export const LAND = "${landS}";
export const ROADS = "${roadStream}";
export const BUILDINGS = "${bStream}";
export const AREAS = "${aStream}";
export const RAILS = "${rStream}";
export const TREES = "${tStream}";
export const WALLS = "${wStream}";
`;
fs.writeFileSync(new URL('../src/data.js', import.meta.url), out);
console.log({ nRoad, nB, nA, nR, nT, nW, names: roadNames.length, kb: (out.length / 1024).toFixed(1) });
