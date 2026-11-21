// Moving life: cars, black-and-yellow taxis, red BEST buses and scooters on the real roads; Western Railway locals; boats.
import * as THREE from 'three';
import { groundH, surfaceH, rng, coastDist, B } from './geo.js';
import { propMat, glowPoints } from './props.js';

const C = (h) => new THREE.Color(h).convertSRGBToLinear();
function addBox(arr, cx, cy, cz, sx, sy, sz, col, em = 0, taper = 0) {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  if (taper) { const p = g.attributes.position; for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) { p.setX(i, p.getX(i) * (1 - taper)); p.setZ(i, p.getZ(i) * (1 - taper * 0.6)); } }
  g.translate(cx, cy, cz);
  arr.push([g.toNonIndexed(), col, em]);
}
function merge(parts) {
  const pos = [], nor = [], col = [], em = [];
  for (const [g, c, e] of parts) {
    g.computeVertexNormals();
    const p = g.attributes.position, n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) { pos.push(p.getX(i), p.getY(i), p.getZ(i)); nor.push(n.getX(i), n.getY(i), n.getZ(i)); col.push(c.r, c.g, c.b); em.push(e); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aEmit', new THREE.Float32BufferAttribute(em, 1));
  g.computeBoundingSphere();
  return g;
}
// vehicles point along +z (forward), body colour = white so instanceColor tints it; fixed parts use their own colour via a dark/light trick
// extrude a side profile [[along, up], ...] to a body of the given width; forward is +z
function prof(pts, width, bevel = 0.05) {
  const sh = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y)));
  const g = new THREE.ExtrudeGeometry(sh, { depth: width - bevel * 2, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 4 });
  g.translate(0, 0, -(width - bevel * 2) / 2); g.rotateY(-Math.PI / 2);
  return g.toNonIndexed();
}
function wheel(arr, x, z, r = 0.31) {
  const t = new THREE.CylinderGeometry(r, r, 0.22, 12); t.rotateZ(Math.PI / 2); t.translate(x, r, z); arr.push([t.toNonIndexed(), C('#121212'), 0]);
  const h = new THREE.CylinderGeometry(r * 0.55, r * 0.55, 0.23, 10); h.rotateZ(Math.PI / 2); h.translate(x, r, z); arr.push([h.toNonIndexed(), C('#9a9ea2'), 0]);
}
function sedan(bodyC, roofC, sign) {
  const p = [], glass = C('#1a2026');
  p.push([prof([[-2.05, 0.3], [2.05, 0.3], [2.12, 0.55], [2.02, 0.82], [0.95, 0.92], [-1.75, 0.95], [-2.08, 0.9], [-2.12, 0.55]], 1.72, 0.07), bodyC, 0]);
  p.push([prof([[0.9, 0.9], [0.28, 1.36], [-1.02, 1.38], [-1.62, 0.93]], 1.56, 0.03), glass, 0]);
  p.push([prof([[0.3, 1.33], [-1.0, 1.35], [-1.0, 1.43], [0.25, 1.41]], 1.48, 0.03), roofC, 0]);
  for (const [x, z] of [[0.78, 1.32], [-0.78, 1.32], [0.78, -1.3], [-0.78, -1.3]]) wheel(p, x, z);
  addBox(p, 0.6, 0.7, 2.1, 0.32, 0.13, 0.04, C('#fff3d8'), 1); addBox(p, -0.6, 0.7, 2.1, 0.32, 0.13, 0.04, C('#fff3d8'), 1);
  addBox(p, 0.66, 0.76, -2.1, 0.28, 0.12, 0.04, C('#ff2a1a'), 0.6); addBox(p, -0.66, 0.76, -2.1, 0.28, 0.12, 0.04, C('#ff2a1a'), 0.6);
  addBox(p, 0, 0.42, 2.12, 1.6, 0.16, 0.06, C('#2a2a2a')); addBox(p, 0, 0.42, -2.12, 1.6, 0.16, 0.06, C('#2a2a2a'));
  if (sign) { addBox(p, 0, 1.5, 0.0, 0.55, 0.16, 0.22, sign, 0.4); p.push([prof([[2.06, 0.74], [1.0, 0.86], [-1.76, 0.9], [-2.1, 0.86], [-2.1, 0.7], [2.08, 0.62]], 1.76, 0.02), roofC, 0]); }
  return merge(p);
}
function carGeo() { return sedan(C('#ffffff'), C('#ffffff')); }
function taxiGeo() { return sedan(C('#121212'), C('#f2c21a'), C('#f2c21a')); }
function busGeo() { // red BEST double-decker (electric)
  const p = [], red = C('#b8141a'), blk = C('#141414'), glass = C('#20272d'), tyre = C('#0d0d0d'), lightF = C('#fff3d8'), lightR = C('#ff2a1a');
  addBox(p, 0, 2.3, 0, 2.55, 4.0, 11.2, red);
  addBox(p, 0, 1.75, 0, 2.58, 0.95, 11.0, glass);
  addBox(p, 0, 3.6, 0, 2.58, 0.95, 11.0, glass);
  addBox(p, 0, 4.36, 0, 2.4, 0.12, 10.8, blk);
  for (const z of [3.8, -3.6]) for (const x of [1.18, -1.18]) addBox(p, x, 0.5, z, 0.3, 1.0, 1.0, tyre);
  addBox(p, 0.9, 0.9, 5.61, 0.4, 0.2, 0.03, lightF, 1); addBox(p, -0.9, 0.9, 5.61, 0.4, 0.2, 0.03, lightF, 1);
  addBox(p, 0.95, 1.0, -5.61, 0.3, 0.3, 0.03, lightR, 0.6); addBox(p, -0.95, 1.0, -5.61, 0.3, 0.3, 0.03, lightR, 0.6);
  addBox(p, 0, 4.0, 5.6, 1.8, 0.35, 0.04, C('#ffb020'), 0.8); // destination board
  return merge(p);
}
function scooterGeo() {
  const p = [], body = C('#ffffff'), blk = C('#151515'), rider = C('#3a3f4a');
  addBox(p, 0, 0.55, 0, 0.42, 0.5, 1.6, body);
  addBox(p, 0, 0.32, 0.65, 0.12, 0.6, 0.6, blk); addBox(p, 0, 0.32, -0.6, 0.12, 0.6, 0.6, blk);
  addBox(p, 0, 1.25, -0.1, 0.46, 0.75, 0.36, rider);
  addBox(p, 0, 1.78, -0.08, 0.3, 0.3, 0.32, C('#202020'));
  addBox(p, 0, 0.95, 0.82, 0.16, 0.12, 0.04, C('#fff3d8'), 1);
  return merge(p);
}
function trainCarGeo() { // EMU coach: white/cream with maroon/purple band, roof gear
  const p = [], body = C('#e9e4dc'), band = C('#6a2140'), glass = C('#20272d'), roof = C('#8a8d90'), bogie = C('#222222');
  addBox(p, 0, 2.2, 0, 3.6, 2.9, 20.4, body);
  addBox(p, 0, 2.35, 0, 3.66, 0.9, 20.0, glass);
  addBox(p, 0, 1.35, 0, 3.64, 0.5, 20.2, band);
  addBox(p, 0, 3.8, 0, 3.0, 0.4, 20.0, roof);
  for (const z of [-6, -2, 2, 6]) addBox(p, 1.81, 2.0, z, 0.03, 2.2, 1.3, C('#3a3a3a'));
  for (const z of [-6, -2, 2, 6]) addBox(p, -1.81, 2.0, z, 0.03, 2.2, 1.3, C('#3a3a3a'));
  for (const z of [7.5, -7.5]) addBox(p, 0, 0.55, z, 2.6, 0.7, 2.6, bogie);
  addBox(p, 0, 2.4, 10.21, 3.2, 1.0, 0.04, C('#fff0c8'), 0.25);
  return merge(p);
}
function boatGeo() { // small wooden fishing boat with a cabin
  const p = [], hull = C('#2f6fa6'), deck = C('#8a5a3a'), cab = C('#e8e2d2'), stripe = C('#d8402a');
  addBox(p, 0, 0.6, 0, 2.6, 1.2, 9, hull, 0, 0);
  addBox(p, 0, 1.15, 0, 2.7, 0.18, 9.1, stripe);
  addBox(p, 0, 1.3, 0, 2.3, 0.1, 8.4, deck);
  addBox(p, 0, 2.0, -1.5, 1.8, 1.4, 2.6, cab);
  addBox(p, 0, 4.0, 1.5, 0.12, 4.2, 0.12, C('#5a4030'));
  addBox(p, 0, 0.9, 4.6, 1.2, 0.9, 0.6, hull, 0, 0.5);
  return merge(p);
}

// ------------------------------------------------------------------ paths
function pathOf(pts, offset) { // offset polyline (right side positive), returns {x[], z[], s[] cumulative}
  const n = pts.length / 2, X = [], Z = [], S = [];
  let acc = 0;
  for (let i = 0; i < n; i++) {
    let tx = 0, tz = 0;
    if (i < n - 1) { tx += pts[i * 2 + 2] - pts[i * 2]; tz += pts[i * 2 + 3] - pts[i * 2 + 1]; }
    if (i > 0) { tx += pts[i * 2] - pts[i * 2 - 2]; tz += pts[i * 2 + 1] - pts[i * 2 - 1]; }
    const l = Math.hypot(tx, tz) || 1; const nx = tz / l, nz = -tx / l; // right-hand normal (x east, z south)
    const x = pts[i * 2] + nx * offset, z = pts[i * 2 + 1] + nz * offset;
    if (i) acc += Math.hypot(x - X[i - 1], z - Z[i - 1]);
    X.push(x); Z.push(z); S.push(acc);
  }
  return { X, Z, S, len: acc };
}
function sample(path, s, out) {
  const { X, Z, S } = path;
  let lo = 0, hi = S.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m] <= s) lo = m; else hi = m; }
  const t = (s - S[lo]) / Math.max(1e-6, S[hi] - S[lo]);
  out.x = X[lo] + (X[hi] - X[lo]) * t; out.z = Z[lo] + (Z[hi] - Z[lo]) * t;
  out.dx = X[hi] - X[lo]; out.dz = Z[hi] - Z[lo];
  return out;
}

export function buildTraffic(L, scene, roads, quality) {
  const R = rng(55);
  const grp = new THREE.Group(); grp.name = 'traffic';
  const mat = propMat(0);
  const kinds = [
    { geo: carGeo(), w: 0.52, colors: ['#e8e8e8', '#c0c4c8', '#7c8288', '#2b2f34', '#8b1a1a', '#1f3f6a', '#f0f0f0', '#5a5f52'] },
    { geo: taxiGeo(), w: 0.22, colors: ['#ffffff'] },
    { geo: busGeo(), w: 0.05, colors: ['#ffffff'] },
    { geo: scooterGeo(), w: 0.21, colors: ['#d0d0d0', '#2a5aa0', '#a02020', '#202020', '#e0e0e0'] },
  ];
  const lanes = [];
  for (const r of roads.lanes) {
    if (r.cls > (quality >= 2 ? 3 : 2) || r.total < 60) continue;
    const nl = r.lanes || (r.cls <= 2 ? (r.oneway ? 2 : 4) : r.oneway ? 1 : 2);
    const lw = (r.hw * 2) / nl;
    if (r.oneway) { for (let k = 0; k < nl; k++) lanes.push({ path: pathOf(r.pts, -r.hw + lw * (k + 0.5)), dir: 1, cls: r.cls, marine: /Marine Drive|Netaji/.test(r.name) }); }
    else {
      const half = Math.max(1, Math.floor(nl / 2));
      for (let k = 0; k < half; k++) {
        lanes.push({ path: pathOf(r.pts, lw * (k + 0.5)), dir: 1, cls: r.cls });
        lanes.push({ path: pathOf(r.pts, -lw * (k + 0.5)), dir: -1, cls: r.cls });
      }
    }
  }
  // vehicles: density per lane by road class
  const veh = []; // {lane, s, v, kind, inst}
  const dens = quality >= 2 ? 1 : quality >= 1 ? 0.7 : 0.45;
  for (const ln of lanes) {
    const gap = (ln.cls <= 1 ? 34 : ln.cls <= 2 ? 52 : ln.cls <= 3 ? 90 : 150) / dens;
    let s = R() * gap;
    while (s < ln.path.len - 5) {
      const r = R(); let k = 0, acc = 0; for (let i = 0; i < kinds.length; i++) { acc += kinds[i].w; if (r < acc) { k = i; break; } }
      if (k === 2 && ln.cls > 2) k = 0;
      veh.push({ lane: ln, s, v: (ln.marine ? 13 : ln.cls <= 2 ? 10 : 7) * (0.8 + R() * 0.4), kind: k });
      s += gap * (0.6 + R() * 0.9);
    }
  }
  // cap the fleet for the device: keep an even spread
  const cap = quality >= 2 ? 2200 : quality >= 1 ? 1300 : 650;
  if (veh.length > cap) { const keep = cap / veh.length; for (let i = veh.length - 1; i >= 0; i--) if (R() > keep) veh.splice(i, 1); }
  // near (detailed) and far (two boxes) versions; each frame vehicles are sorted into one or the other
  const lowGeo = [
    (() => { const p = []; addBox(p, 0, 0.62, 0, 1.72, 0.62, 4.1, C('#ffffff')); addBox(p, 0, 1.15, -0.2, 1.5, 0.5, 2.1, C('#20262c')); return merge(p); })(),
    (() => { const p = []; addBox(p, 0, 0.62, 0, 1.66, 0.62, 3.9, C('#141414')); addBox(p, 0, 1.15, -0.1, 1.5, 0.5, 2.0, C('#f2c21a')); return merge(p); })(),
    (() => { const p = []; addBox(p, 0, 2.3, 0, 2.55, 4.0, 11.2, C('#b8141a')); return merge(p); })(),
    (() => { const p = []; addBox(p, 0, 0.9, 0, 0.5, 1.3, 1.6, C('#808080')); return merge(p); })(),
  ];
  const meshes = kinds.map((k, i) => {
    const list = veh.filter(v => v.kind === i);
    const n = Math.max(1, list.length);
    const mk = (geo, name) => { const im = new THREE.InstancedMesh(geo, mat, n); im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); im.frustumCulled = false; im.userData.cast = false; im.name = name; im.count = 0; im.setColorAt(0, C('#ffffff')); im.instanceColor.setUsage(THREE.DynamicDrawUsage); grp.add(im); return im; };
    const near = mk(k.geo, 'veh' + i), far = mk(lowGeo[i], 'vehlo' + i);
    list.forEach(v => { v.col = C(k.colors[Math.floor(R() * k.colors.length)]); });
    return { near, far, ni: 0, fi: 0 };
  });
  // headlight / taillight glow points that follow the vehicles
  const nGlow = veh.length * 2;
  const gp = new Float32Array(nGlow * 3), gc = new Float32Array(nGlow * 3), gs = new Float32Array(nGlow);
  const glow = glowPoints(gp, gc, gs); glow.name = 'carlights'; grp.add(glow);
  const gPos = glow.geometry.attributes.position, gCol = glow.geometry.attributes.aCol, gSz = glow.geometry.attributes.aSize;
  gPos.setUsage(THREE.DynamicDrawUsage);

  // ---- Western Railway locals on the main lines (from Churchgate north)
  const train = trainCarGeo();
  const tracks = L.rails.filter(r => r.k === 1).map(r => pathOf(r.pts, 0)).filter(p => p.len > 400).sort((a, b) => b.len - a.len).slice(0, 4);
  const trains = [];
  tracks.forEach((t, i) => trains.push({ path: t, s: R() * t.len, v: 12 + R() * 4, dir: i % 2 ? -1 : 1, cars: 12 }));
  const tm = new THREE.InstancedMesh(train, mat, Math.max(1, trains.length * 12));
  tm.instanceMatrix.setUsage(THREE.DynamicDrawUsage); tm.frustumCulled = false; tm.userData.cast = true; tm.name = 'trains';
  grp.add(tm);

  // ---- boats moored in Back Bay (fishing boats + a few yachts)
  const bg = boatGeo();
  const boats = [];
  for (let i = 0; i < 46; i++) {
    const x = -1200 + R() * 1800, z = -600 + R() * 2700, cd = coastDist(x, z);
    if (cd > -60 || cd < -900) continue;
    boats.push({ x, z, a: R() * 6.28, ph: R() * 6 });
  }
  const bm = new THREE.InstancedMesh(bg, mat, Math.max(1, boats.length)); bm.count = boats.length;
  bm.instanceMatrix.setUsage(THREE.DynamicDrawUsage); bm.frustumCulled = false; bm.name = 'boats';
  boats.forEach((b, i) => bm.setColorAt(i, C(['#ffffff', '#ffe0c0', '#d0e8ff'][i % 3])));
  grp.add(bm);

  // ---- parked cars along the kerbs of side streets (static, in tiles)
  const parkTiles = new Map();
  const PT = 400, pdens = quality >= 2 ? 1 : quality >= 1 ? 0.6 : 0.3;
  for (const r of L.roads) {
    if (r.cls < 2 || r.cls > 4 || r.bridge || /Marine Drive|Netaji/i.test(r.name)) continue;
    const hw = (r.cls === 2 ? (r.lanes ? r.lanes * 3.2 + 0.8 : r.oneway ? 7 : 11) : r.cls === 3 ? 8 : 6.2) / 2;
    const p = r.pts; let acc = 8 + R() * 6, total = 0;
    for (let i = 2; i < p.length; i += 2) total += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
    let run = 0;
    for (let i = 2; i < p.length; i += 2) {
      const ax = p[i - 2], az = p[i - 1], bx = p[i], bz = p[i + 1], l = Math.hypot(bx - ax, bz - az);
      const tx = (bx - ax) / l, tz = (bz - az) / l, nx = tz, nz = -tx;
      while (acc < l) {
        const along = run + acc;
        if (along > 10 && along < total - 10) for (const sd of [-1, 1]) {
          const x = ax + tx * acc + nx * sd * (hw - 1.1), z = az + tz * acc + nz * sd * (hw - 1.1);
          const zoneP = x > 700 ? 0.7 : z < -300 ? 0.6 : 0.45;
          if (R() < zoneP * pdens) {
            const k = Math.floor(x / PT) + ',' + Math.floor(z / PT); let t = parkTiles.get(k); if (!t) parkTiles.set(k, t = []);
            t.push([x, z, Math.atan2(tx, tz) + (R() < 0.5 ? 0 : Math.PI) + (R() - 0.5) * 0.06, R() < 0.3 ? 1 : R() < 0.12 ? 3 : 0]);
          }
        }
        acc += 5.4 + R() * 1.2;
      }
      acc -= l; run += l;
    }
  }
  const parkObjs = [];
  const cols = kinds[0].colors;
  for (const [, list] of parkTiles) {
    let cx = 0, cz = 0; for (const a of list) { cx += a[0]; cz += a[1]; }
    for (const kind of [0, 1, 3]) {
      const items = list.filter(a => a[3] === kind); if (!items.length) continue;
      const im = new THREE.InstancedMesh(kinds[kind].geo, mat, items.length);
      const mm = new THREE.Matrix4(), qq = new THREE.Quaternion(), vv = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), upv = new THREE.Vector3(0, 1, 0);
      items.forEach((a, i) => { qq.setFromAxisAngle(upv, a[2]); im.setMatrixAt(i, mm.compose(vv.set(a[0], surfaceH(a[0], a[1]) + 0.14, a[1]), qq, one)); im.setColorAt(i, C(kind === 0 ? cols[Math.floor(R() * cols.length)] : kinds[kind].colors[Math.floor(R() * kinds[kind].colors.length)])); });
      im.computeBoundingSphere(); im.userData.cast = true; im.userData.c = [cx / list.length, cz / list.length];
      grp.add(im); parkObjs.push(im);
    }
  }
  const parkFar = quality >= 2 ? 700 : quality >= 1 ? 450 : 300;
  scene.add(grp);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v3 = new THREE.Vector3(), s3 = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  const o = {}, o2 = {};
  let frame = 0;
  function update(dt, t, cam) {
    frame++;
    if (frame % 10 === 1) for (const im of parkObjs) im.visible = Math.hypot(cam.position.x - im.userData.c[0], cam.position.z - im.userData.c[1], cam.position.y) < parkFar;
    const cx = cam.position.x, cz = cam.position.z;
    let gi = 0;
    for (const M of meshes) M.ni = M.fi = 0;
    for (const v of veh) {
      const ln = v.lane, P = ln.path;
      v.s += v.v * dt * ln.dir;
      if (v.s > P.len) v.s -= P.len; if (v.s < 0) v.s += P.len;
      sample(P, v.s, o);
      // only update far vehicles every few frames
      const d2 = (o.x - cx) ** 2 + (o.z - cz) ** 2;
      if (d2 > 2400 * 2400) { gi += 2; continue; }
      const a = Math.atan2(o.dx * ln.dir, o.dz * ln.dir);
      if (v.hx === undefined || Math.abs(o.x - v.hx) + Math.abs(o.z - v.hz) > 6) { v.hx = o.x; v.hz = o.z; v.hy = Math.max(groundH(o.x, o.z), 0.3) + 0.25; }
      const y = v.hy;
      q.setFromAxisAngle(up, a);
      const M = meshes[v.kind], useNear = d2 < 250 * 250 + cam.position.y * cam.position.y;
      m4.compose(v3.set(o.x, y, o.z), q, s3);
      if (useNear) { M.near.setMatrixAt(M.ni, m4); M.near.setColorAt(M.ni++, v.col); } else { M.far.setMatrixAt(M.fi, m4); M.far.setColorAt(M.fi++, v.col); }
      const fx = Math.sin(a), fz = Math.cos(a), half = v.kind === 2 ? 5.7 : v.kind === 3 ? 0.9 : 2.1;
      gPos.setXYZ(gi, o.x + fx * half, y + 0.75, o.z + fz * half); gCol.setXYZ(gi, 2.2, 2.0, 1.6); gSz.setX(gi, v.kind === 3 ? 4 : 7); gi++;
      gPos.setXYZ(gi, o.x - fx * half, y + 0.8, o.z - fz * half); gCol.setXYZ(gi, 1.8, 0.12, 0.05); gSz.setX(gi, v.kind === 3 ? 0.01 : 5); gi++;
    }
    for (const M of meshes) { for (const [im, c] of [[M.near, M.ni], [M.far, M.fi]]) { im.count = c; im.instanceMatrix.needsUpdate = true; im.instanceColor.needsUpdate = true; } M.ni = M.fi = 0; }
    gPos.needsUpdate = true; if (frame < 3) { gCol.needsUpdate = true; gSz.needsUpdate = true; } else if (frame % 30 === 0) { gCol.needsUpdate = true; gSz.needsUpdate = true; }
    let k = 0;
    for (const tr of trains) {
      tr.s += tr.v * dt * tr.dir;
      if (tr.s > tr.path.len + 400) tr.s = -400 + (tr.s - tr.path.len - 400);
      if (tr.s < -400) tr.s = tr.path.len + 400 + (tr.s + 400);
      for (let c = 0; c < tr.cars; c++) {
        const s = tr.s - c * 20.8 * tr.dir;
        if (s < 0 || s > tr.path.len) { tm.setMatrixAt(k++, m4.makeScale(0, 0, 0)); continue; }
        sample(tr.path, s, o);
        const a = Math.atan2(o.dx, o.dz);
        q.setFromAxisAngle(up, a);
        tm.setMatrixAt(k++, m4.compose(v3.set(o.x, groundH(o.x, o.z) + 0.45, o.z), q, s3));
      }
    }
    tm.count = k; tm.instanceMatrix.needsUpdate = true;
    boats.forEach((b, i) => {
      const bob = Math.sin(t * 0.9 + b.ph) * 0.12, roll = Math.sin(t * 0.7 + b.ph) * 0.05, pitch = Math.sin(t * 0.6 + b.ph * 2) * 0.03;
      q.setFromEuler(new THREE.Euler(pitch, b.a + Math.sin(t * 0.05 + b.ph) * 0.2, roll));
      bm.setMatrixAt(i, m4.compose(v3.set(b.x, -0.55 + bob, b.z), q, s3));
    });
    bm.instanceMatrix.needsUpdate = true;
  }
  return { group: grp, update, count: veh.length, trains: trains.length, boats: boats.length };
}
