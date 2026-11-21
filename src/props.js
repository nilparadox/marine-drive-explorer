// Marine Drive props: tetrapods, promenade parapet, Queen's Necklace lamps, roof tanks, stadiums, clock tower, shrine tops.
import * as THREE from 'three';
import { COMMON, FINISH, mat, U } from './shade.js';
import { B, groundH, coastDist, hillH, beachAt, rng, polyBox } from './geo.js';
import { ST } from './buildings.js';

// generic lit material for code-built props; colour from vertex colour, optional emissive by aEmit
const VS = /* glsl */`
attribute vec3 color; attribute float aEmit;
varying vec3 vP; varying vec3 vN; varying vec3 vC; varying float vE; varying vec3 vL;
void main(){
  mat4 M = modelMatrix;
  #ifdef USE_INSTANCING
    M = modelMatrix * instanceMatrix;
  #endif
  vec4 w = M * vec4(position,1.); vP = w.xyz; vL = position;
  vN = normalize(mat3(M) * normal); vC = color; vE = aEmit;
  #ifdef USE_INSTANCING_COLOR
    vC *= instanceColor;
  #endif
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const FS = /* glsl */`
${COMMON}
varying vec3 vP; varying vec3 vN; varying vec3 vC; varying float vE; varying vec3 vL;
uniform float uConcrete;
void main(){
  vec3 N = normalize(vN);
  if (dot(N, uCam - vP) < 0.) N = -N;
  vec3 alb = vC;
  float spec = .06, gloss = 30.;
  if (uConcrete > .5) {
    float n = fbm(vP.xz*1.3 + vP.y*.7);
    alb *= .78 + .35*n;
    // wet + algae below the high-tide line, barnacle speckles
    float wet = smoothstep(.6, -.4, vP.y + sin(vP.x*.2 + uTime*.8)*.15);
    alb = mix(alb, vec3(.16,.17,.13), wet*.75);
    alb *= 1. - .25*step(.86, h21(floor(vP.xz*9.) + floor(vP.y*9.)))*wet;
    spec = .05 + wet*.6; gloss = 60.;
  }
  float sh = shadowAt(vP, N);
  vec3 c = shade(alb, N, vP, sh, 1., spec, gloss);
  c += vC * vE * uNight * 6.;
  gl_FragColor = vec4(haze(c, vP), 1.);
  ${FINISH}
}`;
export function propMat(concrete = 0) {
  const m = mat({ vs: VS, fs: FS, side: THREE.DoubleSide, uniforms: { uConcrete: { value: concrete } } });
  return m;
}

// ------------------------------------------------------------------ small geometry helpers (with vertex colours)
class GB {
  constructor() { this.pos = []; this.nor = []; this.col = []; this.em = []; this.idx = []; }
  get n() { return this.pos.length / 3; }
  add(geo, matrix, color, emit = 0, flat = false) {
    let g = geo.clone(); g.applyMatrix4(matrix);
    if (flat && g.index) g = g.toNonIndexed();
    if (!g.attributes.normal || flat) g.computeVertexNormals();
    const p = g.attributes.position, nn = g.attributes.normal, base = this.n;
    for (let i = 0; i < p.count; i++) { this.pos.push(p.getX(i), p.getY(i), p.getZ(i)); this.nor.push(nn.getX(i), nn.getY(i), nn.getZ(i)); this.col.push(color.r, color.g, color.b); this.em.push(emit); }
    if (g.index) for (let i = 0; i < g.index.count; i++) this.idx.push(base + g.index.getX(i)); else for (let i = 0; i < p.count; i++) this.idx.push(base + i);
  }
  geo() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aEmit', new THREE.Float32BufferAttribute(this.em, 1));
    g.setIndex(this.idx); g.computeBoundingSphere(); return g;
  }
}
const C = (h) => new THREE.Color(h).convertSRGBToLinear();
const M4 = (x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));

function tetrapodGeo(lo = false) {
  const g = new GB(), col = C('#a29f97'), seg = lo ? 4 : 7;
  const dirs = [[0, 1, 0], [0.9428, -0.3333, 0], [-0.4714, -0.3333, 0.8165], [-0.4714, -0.3333, -0.8165]];
  for (const d of dirs) {
    const v = new THREE.Vector3(...d);
    const cone = new THREE.CylinderGeometry(0.31, 0.5, 1.4, seg, 1, true);
    cone.translate(0, 0.72, 0);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), v);
    g.add(cone, new THREE.Matrix4().makeRotationFromQuaternion(q), col);
    if (!lo) { const cap = new THREE.SphereGeometry(0.31, seg, 2, 0, Math.PI * 2, 0, Math.PI / 2); cap.scale(1, 0.4, 1); cap.translate(0, 1.4, 0); g.add(cap, new THREE.Matrix4().makeRotationFromQuaternion(q), col); }
  }
  g.add(new THREE.IcosahedronGeometry(0.52, 0), new THREE.Matrix4(), col);
  return g.geo();
}

function lampGeo(tall = 1) {
  // Marine Drive style: slim tapered pole, curved arm, flat lamp head (warm LED)
  const g = new GB(), pole = C('#3b4340'), head = C('#2a2f2e'), glass = C('#ffd9a0');
  const h = 10 * tall;
  g.add(new THREE.CylinderGeometry(0.07, 0.13, h, 8), M4(0, h / 2, 0), pole);
  g.add(new THREE.CylinderGeometry(0.2, 0.22, 0.7, 8), M4(0, 0.35, 0), pole);
  // arm: three segments curving out over the road (+x)
  const pts = [[0, h - 0.6], [0.6, h + 0.05], [1.4, h + 0.25], [2.1, h + 0.2]];
  for (let i = 0; i < 3; i++) {
    const a = new THREE.Vector3(pts[i][0], pts[i][1], 0), b = new THREE.Vector3(pts[i + 1][0], pts[i + 1][1], 0);
    const d = b.clone().sub(a), L = d.length();
    const cyl = new THREE.CylinderGeometry(0.045, 0.05, L, 6); cyl.translate(0, L / 2, 0);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    g.add(cyl, new THREE.Matrix4().compose(a, q, new THREE.Vector3(1, 1, 1)), pole);
  }
  g.add(new THREE.BoxGeometry(0.9, 0.16, 0.36), M4(2.2, h + 0.17, 0), head);
  g.add(new THREE.BoxGeometry(0.78, 0.04, 0.28), M4(2.2, h + 0.07, 0), glass, 1);
  return { geo: g.geo(), head: new THREE.Vector3(2.2, h + 0.02, 0) };
}

function tankGeo() {
  // black ribbed plastic water tank (very common on Mumbai roofs) on a small stand
  const g = new GB(), black = C('#151515'), stand = C('#6a665e');
  const body = new THREE.CylinderGeometry(0.62, 0.64, 1.3, 9, 2, true);
  const p = body.attributes.position;
  for (let i = 0; i < p.count; i++) { const y = p.getY(i); const s = 1 + 0.04 * Math.cos(y * 4.8); p.setX(i, p.getX(i) * s); p.setZ(i, p.getZ(i) * s); }
  g.add(body, M4(0, 1.15, 0), black);
  g.add(new THREE.ConeGeometry(0.64, 0.32, 9, 1, true), M4(0, 1.96, 0), black);
  g.add(new THREE.BoxGeometry(1.4, 0.5, 1.4), M4(0, 0.25, 0), stand);
  return g.geo();
}
function liftRoomGeo() {
  const g = new GB(), wall = C('#b8b0a2'), door = C('#3a3530');
  g.add(new THREE.BoxGeometry(3.4, 3, 3.6), M4(0, 1.5, 0), wall);
  g.add(new THREE.BoxGeometry(3.6, 0.15, 3.8), M4(0, 3.05, 0), C('#8f887c'));
  g.add(new THREE.BoxGeometry(0.9, 2, 0.06), M4(0.6, 1, 1.81), door);
  return g.geo();
}

// ------------------------------------------------------------------ glow points (street lights, lamps, signals)
const GLOW_VS = /* glsl */`
attribute float aSize; attribute vec3 aCol;
uniform float uNight; uniform float uPx;
varying vec3 vCol; varying float vA;
void main(){
  vec4 mv = viewMatrix * modelMatrix * vec4(position, 1.);
  gl_Position = projectionMatrix * mv;
  float d = -mv.z;
  gl_PointSize = clamp(aSize * uPx / d, 1.5, 70.);
  vCol = aCol; vA = uNight * (1. - smoothstep(600., 4000., d)) * (.25 + .75*smoothstep(4., 45., d));
}`;
const GLOW_FS = /* glsl */`
varying vec3 vCol; varying float vA;
uniform float uExposure;
void main(){
  vec2 c = gl_PointCoord - .5; float r = length(c)*2.;
  float core = exp(-r*r*22.), halo = exp(-r*4.)*.22;
  float a = (core + halo) * vA;
  if (a < .002) discard;
  gl_FragColor = vec4(vCol * a * uExposure, 1.);
}`;
export function glowPoints(positions, colors, sizes) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('aCol', new THREE.Float32BufferAttribute(colors, 3));
  g.setAttribute('aSize', new THREE.Float32BufferAttribute(sizes, 1));
  const m = new THREE.ShaderMaterial({ vertexShader: GLOW_VS, fragmentShader: GLOW_FS, uniforms: { uNight: U.uNight, uPx: { value: 800 }, uExposure: U.uExposure }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const p = new THREE.Points(g, m); p.frustumCulled = false; p.renderOrder = 5;
  return p;
}

// ------------------------------------------------------------------ build
export function buildProps(L, scene, bld, quality) {
  const grp = new THREE.Group(); grp.name = 'props';
  const R = rng(4242);
  const md = [];
  for (const r of L.roads) if (/Marine Drive|Netaji Subhash|Chowpatty Sea Face|Purandare/i.test(r.name)) md.push(r);
  const mdDist = (x, z) => { let d = 1e9; for (const r of md) for (let i = 0; i < r.pts.length; i += 2) d = Math.min(d, Math.hypot(x - r.pts[i], z - r.pts[i + 1])); return d; };
  // coast edges (skip the mapped-box border)
  const e = 0.5, onEdge = (x, z) => Math.abs(x - B.x0) < e || Math.abs(x - B.x1) < e || Math.abs(z - B.z0) < e || Math.abs(z - B.z1) < e;
  const coastSegs = [];
  for (const r of L.land) {
    const n = r.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, ax = r[i * 2], az = r[i * 2 + 1], bx = r[j * 2], bz = r[j * 2 + 1];
      if (onEdge(ax, az) && onEdge(bx, bz)) continue;
      const L0 = Math.hypot(bx - ax, bz - az); if (L0 < 0.1) continue;
      let nx = (bz - az) / L0, nz = -(bx - ax) / L0; // sea side
      if (coastDist((ax + bx) / 2 + nx * 6, (az + bz) / 2 + nz * 6) > coastDist((ax + bx) / 2 - nx * 6, (az + bz) / 2 - nz * 6)) { nx = -nx; nz = -nz; }
      const pieces = Math.max(1, Math.ceil(L0 / 8));
      for (let k = 0; k < pieces; k++) {
        const t0 = k / pieces, t1 = (k + 1) / pieces;
        const sx = ax + (bx - ax) * t0, sz = az + (bz - az) * t0, ex = ax + (bx - ax) * t1, ez = az + (bz - az) * t1;
        const mx = (sx + ex) / 2, mz = (sz + ez) / 2, l = L0 / pieces;
        coastSegs.push({ ax: sx, az: sz, bx: ex, bz: ez, l, nx, nz, md: mdDist(mx, mz), beach: beachAt(mx, mz), hill: hillH(mx, mz), mx, mz });
      }
    }
  }

  // ---- tetrapods along Marine Drive and the Nariman Point sea face
  const tetra = tetrapodGeo(), tetraLo = tetrapodGeo(true);
  const tps = [];
  const rows = quality >= 2 ? 6 : quality >= 1 ? 4 : 3;
  for (const s of coastSegs) {
    const isMD = s.md < 70 || (s.mz > 1500 && s.mx < 600 && s.mx > -200);
    if (!isMD || s.beach > 0.15 || s.hill > 6) continue;
    for (let d = 0; d < s.l; d += quality >= 2 ? 1.15 : quality >= 1 ? 1.45 : 2.0) {
      const t = d / s.l, x = s.ax + (s.bx - s.ax) * t, z = s.az + (s.bz - s.az) * t;
      for (let r = 0; r < rows; r++) {
        // a sloping heap from just under the wall top down into the water
        const out = 0.9 + r * 1.1 + (R() - 0.5) * 0.7;
        const y = 1.6 - r * 0.45 + (R() - 0.5) * 0.45;
        tps.push(x + s.nx * out + (R() - 0.5) * 0.8, y, z + s.nz * out + (R() - 0.5) * 0.8, R() * 6.28, R() * 6.28, R() * 6.28, 0.72 + R() * 0.12);
      }
    }
  }
  // chunks of ~150 m so off-screen and far chunks are skipped
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), eu = new THREE.Euler(), v3 = new THREE.Vector3(), s3 = new THREE.Vector3();
  const chunks = new Map(), tmat = propMat(1);
  for (let i = 0; i < tps.length / 7; i++) { const k = Math.floor(tps[i * 7] / 150) + ',' + Math.floor(tps[i * 7 + 2] / 150); let a = chunks.get(k); if (!a) chunks.set(k, a = []); a.push(i); }
  const tetraGroup = new THREE.Group(); tetraGroup.name = 'tetrapods';
  const tetraChunks = [];
  for (const [, ids] of chunks) {
    const tm = new THREE.InstancedMesh(tetra, tmat, ids.length), tl = new THREE.InstancedMesh(tetraLo, tmat, ids.length);
    let cx = 0, cz = 0;
    ids.forEach((i, j) => {
      const o = i * 7; cx += tps[o]; cz += tps[o + 2];
      q.setFromEuler(eu.set(tps[o + 3], tps[o + 4], tps[o + 5])); s3.setScalar(tps[o + 6]);
      m4.compose(v3.set(tps[o], tps[o + 1], tps[o + 2]), q, s3); tm.setMatrixAt(j, m4); tl.setMatrixAt(j, m4);
    });
    tm.computeBoundingSphere(); tl.computeBoundingSphere(); tm.userData.cast = true;
    tm.userData.c = tl.userData.c = [cx / ids.length, cz / ids.length];
    tetraGroup.add(tm, tl); tetraChunks.push([tm, tl]);
  }
  grp.add(tetraGroup);

  // ---- promenade parapet (the wall everybody sits on) on every built sea face
  const pg = new GB(), pc = C('#b8b5ad'), pcTop = C('#cfccc4');
  for (const s of coastSegs) {
    if (s.beach > 0.1 || s.hill > 8) continue;
    const y = groundH(s.mx - s.nx * 4, s.mz - s.nz * 4);
    if (y < 1.2) continue;
    const ang = Math.atan2(s.bx - s.ax, s.bz - s.az);
    const len = s.l + 0.06, cx = s.mx - s.nx * 0.35, cz = s.mz - s.nz * 0.35;
    pg.add(new THREE.BoxGeometry(0.6, 0.42, len), M4(cx - s.nx * 0.02, y + 0.21, cz - s.nz * 0.02, 0, ang, 0), pc);
    const cop = new THREE.CylinderGeometry(0.34, 0.34, len, 8, 1, false, 0, Math.PI); cop.rotateZ(Math.PI / 2); cop.rotateY(Math.PI / 2); cop.scale(1, 0.45, 1);
    pg.add(cop, M4(cx - s.nx * 0.02, y + 0.42, cz - s.nz * 0.02, 0, ang, 0), pcTop);
  }
  const pm = new THREE.Mesh(pg.geo(), propMat(0)); pm.userData.cast = true; pm.userData.receive = true; pm.name = 'parapet';
  grp.add(pm);

  // ---- Queen's Necklace: lamps along Marine Drive (sea side) + glow points on all main roads
  const lamp = lampGeo(1);
  const lampPos = [];
  const glowP = [], glowC = [], glowS = [];
  const warm = [1.0, 0.64, 0.26];
  // dense samples of every Marine Drive carriageway, to tell the seaward one from the landward one
  const mdS = new Set();
  for (const r of md) { const p = r.pts; for (let i = 2; i < p.length; i += 2) { const l = Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]), n = Math.ceil(l / 3); for (let k = 0; k <= n; k++) mdS.add(Math.round((p[i - 2] + (p[i] - p[i - 2]) * k / n) / 4) + ',' + Math.round((p[i - 1] + (p[i + 1] - p[i - 1]) * k / n) / 4)); } }
  const onMD = (x, z) => mdS.has(Math.round(x / 4) + ',' + Math.round(z / 4));
  for (const r of md) {
    const p = r.pts;
    // choose the carriageway nearer the sea, lamps on its sea edge
    let acc = 12;
    for (let i = 2; i < p.length; i += 2) {
      const ax = p[i - 2], az = p[i - 1], bx = p[i], bz = p[i + 1], l = Math.hypot(bx - ax, bz - az);
      let nx = -(bz - az) / l, nz = (bx - ax) / l;
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      if (coastDist(mx + nx * 15, mz + nz * 15) > coastDist(mx - nx * 15, mz - nz * 15)) { nx = -nx; nz = -nz; }
      const seaSide = coastDist(mx, mz) < 260;
      while (acc < l) {
        const t = acc / l, x = ax + (bx - ax) * t, z = az + (bz - az) * t;
        const off = 6.4;
        const lx = x + nx * off, lz = z + nz * off;
        let blocked = false; for (let d2 = 6; d2 <= 26; d2 += 4) if (onMD(lx + nx * d2, lz + nz * d2)) blocked = true;
        if (seaSide && !blocked && coastDist(lx, lz) > 1) {
          lampPos.push([lx, lz, Math.atan2(-nz, nx)]);
        }
        acc += 30;
      }
      acc -= l;
    }
  }
  const lmp = new THREE.InstancedMesh(lamp.geo, propMat(0), lampPos.length);
  lampPos.forEach(([x, z, a], i) => {
    const y = groundH(x, z);
    q.setFromAxisAngle(v3.set(0, 1, 0), a);
    lmp.setMatrixAt(i, m4.compose(v3.set(x, y, z), q, s3.setScalar(1)));
    const hx = x + Math.cos(a) * lamp.head.x, hz = z - Math.sin(a) * lamp.head.x;
    glowP.push(hx, y + lamp.head.y, hz); glowC.push(...warm.map(c => c * 2.4)); glowS.push(22);
  });
  lmp.computeBoundingSphere(); lmp.userData.cast = true; lmp.name = 'lamps';
  grp.add(lmp);
  // other streets: glow only, both sides, staggered
  for (const r of L.roads) {
    if (r.cls < 1 || r.cls > 4 || r.bridge || /Marine Drive|Netaji Subhash|Chowpatty Sea Face|Purandare/i.test(r.name)) continue;
    const p = r.pts; let acc = R() * 20; const sp = r.cls <= 2 ? 28 : 36;
    for (let i = 2; i < p.length; i += 2) {
      const ax = p[i - 2], az = p[i - 1], bx = p[i], bz = p[i + 1], l = Math.hypot(bx - ax, bz - az);
      const nx = -(bz - az) / l, nz = (bx - ax) / l;
      while (acc < l) {
        const t = acc / l, sd = Math.floor(acc / sp) % 2 ? 1 : -1;
        const x = ax + (bx - ax) * t + nx * sd * 5, z = az + (bz - az) * t + nz * sd * 5;
        const tone = R() < 0.25 ? [0.9, 0.95, 1.0] : warm;
        glowP.push(x, groundH(x, z) + 8, z); glowC.push(...tone.map(c => c * 1.4)); glowS.push(r.cls <= 2 ? 15 : 11);
        acc += sp;
      }
      acc -= l;
    }
  }

  // ---- roof clutter: water tanks + lift machine rooms
  const tankG = tankGeo(), liftG = liftRoomGeo();
  const tanks = [], lifts = [];
  for (const s of bld.roofSpots) {
    const r = rng(Math.floor(s.seed * 1e6));
    const nt = s.A > 600 ? 2 + Math.floor(r() * 4) : s.A > 150 ? 1 + Math.floor(r() * 2) : r() < 0.5 ? 1 : 0;
    const [x0, z0, x1, z1] = polyBox(s.p);
    for (let i = 0; i < nt; i++) {
      for (let tries = 0; tries < 6; tries++) {
        const x = x0 + 1.5 + r() * (x1 - x0 - 3), z = z0 + 1.5 + r() * (z1 - z0 - 3);
        if (pip(x, z, s.p) && pip(x + 1, z, s.p) && pip(x - 1, z, s.p) && pip(x, z + 1, s.p) && pip(x, z - 1, s.p)) { tanks.push([x, s.y, z, r() * 6, 0.8 + r() * 0.5]); break; }
      }
    }
    if (s.H > 13 && s.A > 160 && s.style !== ST.GLASS) {
      for (let tries = 0; tries < 6; tries++) {
        const x = x0 + 3 + r() * (x1 - x0 - 6), z = z0 + 3 + r() * (z1 - z0 - 6);
        if (pip(x + 2, z + 2, s.p) && pip(x - 2, z - 2, s.p) && pip(x + 2, z - 2, s.p) && pip(x - 2, z + 2, s.p)) { lifts.push([x, s.y, z, r() * 0.3]); break; }
      }
    }
  }
  const roofChunks = [], roofFar = quality >= 2 ? 900 : quality >= 1 ? 650 : 420, pmat = propMat(0);
  const mkInst = (geo, arr, name, sc = true) => {
    const tiles = new Map();
    for (const a of arr) { const k = Math.floor(a[0] / 300) + ',' + Math.floor(a[2] / 300); let t = tiles.get(k); if (!t) tiles.set(k, t = []); t.push(a); }
    const g2 = new THREE.Group(); g2.name = name;
    for (const [, list] of tiles) {
      const im = new THREE.InstancedMesh(geo, pmat, list.length); let cx = 0, cz = 0;
      list.forEach((a, i) => { cx += a[0]; cz += a[2]; q.setFromAxisAngle(v3.set(0, 1, 0), a[3]); im.setMatrixAt(i, m4.compose(v3.set(a[0], a[1], a[2]), q, s3.setScalar(a[4] || 1))); });
      im.computeBoundingSphere(); im.userData.cast = sc; im.userData.c = [cx / list.length, cz / list.length];
      g2.add(im); roofChunks.push(im);
    }
    grp.add(g2); return g2;
  };
  mkInst(tankG, tanks, 'tanks');
  mkInst(liftG, lifts, 'liftrooms');

  // ---- stadium bowls (Wankhede, Brabourne, University ground) + floodlight towers
  const sg = new GB();
  for (const a of L.areas) {
    if (a.k !== 4) continue;
    const p = a.pts; const [x0, z0, x1, z1] = polyBox(p);
    const w = x1 - x0, d = z1 - z0; if (w < 80 || d < 80) continue;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const big = w * d > 25000;
    stadium(sg, p, cx, cz, big ? 26 : 9, big, glowP, glowC, glowS);
  }
  if (sg.n) { const sm = new THREE.Mesh(sg.geo(), propMat(0)); sm.userData.cast = true; sm.userData.receive = true; sm.name = 'stadiums'; grp.add(sm); }

  // ---- Art Deco detail in 3D: eyebrow ledges, sea-facing balconies, crown + flagpole
  const dg = new GB();
  for (const m of bld.meta) if (m.style === ST.DECO && m.H > 9) decoDetails(dg, m);
  if (dg.n) { const dm = new THREE.Mesh(dg.geo(), propMat(0)); dm.userData.cast = true; dm.userData.receive = true; dm.name = 'deco'; grp.add(dm); }

  // ---- Rajabai Clock Tower (University of Mumbai, 1878) at its mapped spot
  const ct = new GB();
  clockTower(ct, 1367.6, 1204);
  for (const m of bld.meta) if (m.style === ST.SHRINE && m.A > 40) shrineTop(ct, m, R);
  const cm = new THREE.Mesh(ct.geo(), propMat(0)); cm.userData.cast = true; cm.name = 'landmarks';
  grp.add(cm);

  // ---- Chowpatty food stalls (bhel puri, kulfi) along the back of the beach, striped awnings, a bulb each
  const st = new GB(), awn = [['#c8302a', '#f2efe6'], ['#2a5aa8', '#f2efe6'], ['#e0a21a', '#7a2a18'], ['#2e8a4a', '#f2efe6']];
  let ns = 0;
  for (const a of L.areas) {
    if (a.k !== 5) continue;
    const [x0, z0, x1, z1] = polyBox(a.pts);
    for (let i = 0; i < 2400 && ns < 34; i++) {
      const x = x0 + R() * (x1 - x0), z = z0 + R() * (z1 - z0);
      const cd = coastDist(x, z);
      if (beachAt(x, z) < 0.7 || cd < 70 || cd > 98) continue;
      // face the sea: direction of falling coast distance
      const gx = coastDist(x + 2, z) - coastDist(x - 2, z), gz = coastDist(x, z + 2) - coastDist(x, z - 2);
      const ang = Math.atan2(-gx, -gz), y = groundH(x, z);
      const [c1, c2] = awn[ns % 4];
      st.add(new THREE.BoxGeometry(2.6, 1.0, 1.6), M4(x, y + 0.5, z, 0, ang, 0), C('#8a6a48'));                 // counter
      st.add(new THREE.BoxGeometry(2.4, 0.08, 1.4), M4(x, y + 1.04, z, 0, ang, 0), C('#d8d2c4'));               // steel top
      for (const [sx, sz] of [[-1.2, -0.7], [1.2, -0.7], [-1.2, 0.7], [1.2, 0.7]]) {
        const ca = Math.cos(ang), sa = Math.sin(ang);
        st.add(new THREE.CylinderGeometry(0.04, 0.04, 2.4, 5), M4(x + sx * ca + sz * sa, y + 1.2, z - sx * sa + sz * ca), C('#5a5a58'));
      }
      for (let k = 0; k < 6; k++) { // awning stripes
        const off = -1.25 + k * 0.5 + 0.25, ca = Math.cos(ang), sa = Math.sin(ang);
        st.add(new THREE.BoxGeometry(0.5, 0.05, 2.0), M4(x + off * ca + 0.25 * sa, y + 2.45, z - off * sa + 0.25 * ca, 0.18, ang, 0), C(k % 2 ? c1 : c2));
      }
      glowP.push(x, y + 2.25, z); glowC.push(1.6, 1.25, 0.8); glowS.push(5);
      ns++;
    }
  }
  if (st.n) { const sm = new THREE.Mesh(st.geo(), propMat(0)); sm.userData.cast = true; sm.name = 'stalls'; grp.add(sm); }

  const glow = glowPoints(glowP, glowC, glowS); glow.name = 'glow';
  grp.add(glow);
  scene.add(grp);
  const farTetra = quality >= 2 ? 1400 : quality >= 1 ? 900 : 600;
  function update(cam) {
    for (const [hi, lo] of tetraChunks) {
      const d = Math.hypot(cam.position.x - hi.userData.c[0], cam.position.z - hi.userData.c[1], cam.position.y);
      hi.visible = d < 220; lo.visible = !hi.visible && d < farTetra;
    }
    for (const t of roofChunks) { const d = Math.hypot(cam.position.x - t.userData.c[0], cam.position.z - t.userData.c[1], cam.position.y); t.visible = d < roofFar; }
  }
  return { group: grp, glow, lampCount: lampPos.length, tetrapods: tps.length / 7, update, noReflect: [tetraGroup, pm, ...grp.children.filter(o => ['tanks', 'liftrooms', 'stadiums'].includes(o.name))] };
}
const pip = (x, z, p) => { let c = false; for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) { const xi = p[i], zi = p[i + 1], xj = p[j], zj = p[j + 1]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };

// same colour pick as the facade shader for art deco walls
const fract = x => x - Math.floor(x);
function h11(p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
const DECO = [[.86, .77, .58], [.84, .56, .42], [.80, .62, .30], [.64, .77, .66], [.84, .62, .57], [.62, .68, .70]];
function decoDetails(g, m) {
  const k = h11(m.seed * 13.7), base = DECO[Math.min(5, Math.floor(k * 5.99))];
  const wall = new THREE.Color(base[0] * .8, base[1] * .8, base[2] * .8), rail = new THREE.Color(Math.min(1, base[0] * .95 + .06), Math.min(1, base[1] * .95 + .06), Math.min(1, base[2] * .95 + .06));
  const p = m.p, n = p.length / 2, fh = m.fh, gH = m.shops ? Math.max(fh * 1.25, 4) : fh;
  const floors = Math.max(1, Math.round((m.yTop - m.y0 - gH) / fh));
  let bestLen = 0, bestI = -1;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, ax = p[i * 2], az = p[i * 2 + 1], bx = p[j * 2], bz = p[j * 2 + 1], el = Math.hypot(bx - ax, bz - az);
    if (el < 6) continue;
    const tx = (bx - ax) / el, tz = (bz - az) / el, nx = tz, nz = -tx;
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    const seaward = coastDist(mx + nx * 25, mz + nz * 25) < coastDist(mx - nx * 25, mz - nz * 25) - 10;
    if (seaward && el > bestLen) { bestLen = el; bestI = i; }
    const ang = Math.atan2(tx, tz);
    // eyebrow ledges over every window row
    for (let f = 0; f <= floors; f++) {
      const v = f === 0 ? gH * 0.86 : gH + (f - 1) * fh + fh * 0.86;
      if (m.y0 + v > m.yTop - 1) break;
      g.add(new THREE.BoxGeometry(0.8, 0.14, el - 0.3), M4(mx + nx * 0.4, m.y0 + v, mz + nz * 0.4, 0, ang, 0), rail);
    }
    // balconies on the sea face
    if (seaward) {
      const bw = el * 0.5;
      for (let f = 1; f < floors; f++) {
        const v = gH + (f - 1) * fh;
        if (m.y0 + v + 1.1 > m.yTop - 1) break;
        g.add(new THREE.BoxGeometry(1.15, 0.18, bw), M4(mx + nx * 0.575, m.y0 + v + 0.09, mz + nz * 0.575, 0, ang, 0), wall);
        g.add(new THREE.BoxGeometry(0.14, 0.95, bw), M4(mx + nx * 1.1, m.y0 + v + 0.62, mz + nz * 1.1, 0, ang, 0), rail);
        for (const sd of [-1, 1]) g.add(new THREE.CylinderGeometry(0.55, 0.55, 0.95, 10, 1, false, 0, Math.PI), M4(mx + nx * 0.58 + tx * sd * bw / 2, m.y0 + v + 0.62, mz + nz * 0.58 + tz * sd * bw / 2, 0, ang + (sd > 0 ? 0 : Math.PI), 0), rail);
      }
    }
  }
  if (bestI >= 0) { // raised crown in the middle of the sea face, with a flagpole
    const i = bestI, j = (i + 1) % n, ax = p[i * 2], az = p[i * 2 + 1], bx = p[j * 2], bz = p[j * 2 + 1], el = Math.hypot(bx - ax, bz - az);
    const tx = (bx - ax) / el, tz = (bz - az) / el, nx = tz, nz = -tx, mx = (ax + bx) / 2, mz = (az + bz) / 2, ang = Math.atan2(tx, tz);
    g.add(new THREE.BoxGeometry(0.5, 2.6, Math.min(5, el * 0.3)), M4(mx - nx * 0.2, m.yTop + 1.0, mz - nz * 0.2, 0, ang, 0), wall);
    g.add(new THREE.BoxGeometry(0.5, 1.3, Math.min(8, el * 0.48)), M4(mx - nx * 0.2, m.yTop + 0.35, mz - nz * 0.2, 0, ang, 0), wall);     // ziggurat step
    for (const sd of [-0.42, 0.42]) g.add(new THREE.BoxGeometry(0.55, m.yTop - m.y0 - 3, 0.35), M4(mx + nx * 0.27 + tx * sd * el, (m.yTop + m.y0) / 2 + 1.5, mz + nz * 0.27 + tz * sd * el, 0, ang, 0), rail); // vertical fins
    g.add(new THREE.BoxGeometry(0.6, 0.25, Math.min(5.4, el * 0.32)), M4(mx - nx * 0.2, m.yTop + 2.35, mz - nz * 0.2, 0, ang, 0), rail);
    for (const sd of [-0.18, 0, 0.18]) g.add(new THREE.BoxGeometry(0.62, 3.2, 0.22), M4(mx - nx * 0.15 + tx * sd * Math.min(5, el * 0.3), m.yTop + 0.8, mz - nz * 0.15 + tz * sd * Math.min(5, el * 0.3), 0, ang, 0), rail);
    g.add(new THREE.CylinderGeometry(0.04, 0.05, 5, 5), M4(mx - nx * 0.6, m.yTop + 4.6, mz - nz * 0.6), C('#5a5a5a'));
    // bronze name plaque on the crown (the building names in Deco lettering)
    g.add(new THREE.BoxGeometry(0.08, 0.7, Math.min(3.6, el * 0.22)), M4(mx + nx * 0.07, m.yTop + 1.2, mz + nz * 0.07, 0, ang, 0), C('#6b4a2a'), 0.08);
  }
}

function stadium(g, p, cx, cz, H, big, glowP, glowC, glowS) {
  // stands: slope from the field edge (inset) up to the outer wall; roof canopy over the top part
  const seat = C('#8a8f96'), wall = C('#d8d4cc'), roof = C('#e8e8e8'), seatB = C('#3a5a8a');
  const n = p.length / 2, y0 = groundH(cx, cz);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = p[i * 2], az = p[i * 2 + 1], bx = p[j * 2], bz = p[j * 2 + 1];
    const inset = (x, z, f) => [cx + (x - cx) * f, cz + (z - cz) * f];
    const [ix, iz] = inset(ax, az, 0.78), [jx, jz] = inset(bx, bz, 0.78);
    const quad = (a, b, c2, d, col) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c2, ...a, ...c2, ...d], 3));
      g.add(geo, new THREE.Matrix4(), col);
    };
    const steps = big ? 3 : 2;
    for (let s = 0; s < steps; s++) {
      const f0 = s / steps, f1 = (s + 1) / steps;
      const P = (t, f) => { const x0 = ix + (ax - ix) * f, z0 = iz + (az - iz) * f, x1 = jx + (bx - jx) * f, z1 = jz + (bz - jz) * f; return [x0 + (x1 - x0) * t, z0 + (z1 - z0) * t]; };
      const a = P(0, f0), b = P(1, f0), c2 = P(1, f1), d = P(0, f1);
      quad([a[0], y0 + 1 + H * f0, a[1]], [b[0], y0 + 1 + H * f0, b[1]], [c2[0], y0 + 1 + H * f1, c2[1]], [d[0], y0 + 1 + H * f1, d[1]], s % 2 ? seat : seatB);
    }
    quad([ax, y0, az], [bx, y0, bz], [bx, y0 + H + 2, bz], [ax, y0 + H + 2, az], wall);
    if (big) { // cantilevered roof over the upper tier
      const [rx, rz] = inset(ax, az, 0.86), [sx, sz] = inset(bx, bz, 0.86);
      quad([ax, y0 + H + 6, az], [bx, y0 + H + 6, bz], [sx, y0 + H + 4.5, sz], [rx, y0 + H + 4.5, rz], roof);
    }
  }
  // floodlight towers
  const nT = big ? 6 : 4;
  for (let k = 0; k < nT; k++) {
    const i = Math.floor(k / nT * n), x = p[i * 2], z = p[i * 2 + 1];
    const hx = cx + (x - cx) * 1.02, hz = cz + (z - cz) * 1.02, th = big ? 60 : 38;
    g.add(new THREE.CylinderGeometry(0.5, 1.1, th, 6), M4(hx, y0 + th / 2, hz), C('#cfcfcf'));
    const ang = Math.atan2(cx - hx, cz - hz);
    g.add(new THREE.BoxGeometry(7, 4.5, 0.6), M4(hx, y0 + th + 2, hz, -0.35, ang, 0), C('#ffffff'), 0.04);
  }
}

function clockTower(g, x, z) {
  // Rajabai Clock Tower (1878, Gothic Revival in buff Kurla stone, ~85 m): square shaft with corner buttresses,
  // stone bands, clock stage, an octagonal open lantern ringed by pinnacles and a slender spire.
  const stone = C('#d6c7a6'), band = C('#b4a282'), dark = C('#5f574c'), face = C('#f1ead8'), blue = C('#8a8e92');
  const y = groundH(x, z);
  const shaft = [[10, 0, 20], [9, 20, 16], [8.2, 36, 14]];
  for (const [w, y0, h] of shaft) {
    g.add(new THREE.BoxGeometry(w, h, w), M4(x, y + y0 + h / 2, z), stone);
    for (let k = 1; k < 4; k++) g.add(new THREE.BoxGeometry(w + 0.25, 0.35, w + 0.25), M4(x, y + y0 + h * k / 4, z), k === 2 ? blue : band);
    g.add(new THREE.BoxGeometry(w + 0.9, 0.7, w + 0.9), M4(x, y + y0 + h, z), band);
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      g.add(new THREE.BoxGeometry(1.4, h, 1.4), M4(x + sx * (w / 2 - 0.2), y + y0 + h / 2, z + sz * (w / 2 - 0.2)), stone);   // buttresses
      g.add(new THREE.ConeGeometry(0.55, 3.4, 4), M4(x + sx * (w / 2 - 0.2), y + y0 + h + 1.7, z + sz * (w / 2 - 0.2), 0, Math.PI / 4, 0), stone);
    }
    // tall pointed windows (dark recesses) on each face
    for (let f = 0; f < 4; f++) {
      const a = f * Math.PI / 2, ox = Math.sin(a) * (w / 2 + 0.02), oz = Math.cos(a) * (w / 2 + 0.02);
      for (const off of [-w * 0.2, w * 0.2]) {
        const px = x + ox + Math.cos(a) * off, pz = z + oz - Math.sin(a) * off;
        g.add(new THREE.BoxGeometry(1.1, h * 0.45, 0.12), M4(px, y + y0 + h * 0.5, pz, 0, a, 0), dark);
        g.add(new THREE.ConeGeometry(0.78, 1.2, 4), M4(px, y + y0 + h * 0.5 + h * 0.225 + 0.5, pz, 0, a + Math.PI / 4, 0, 1, 1, 0.12), dark);
      }
    }
  }
  // clock stage
  g.add(new THREE.BoxGeometry(7.6, 9, 7.6), M4(x, y + 54.5, z), stone);
  for (let k = 0; k < 4; k++) {
    const a = k * Math.PI / 2;
    g.add(new THREE.CircleGeometry(2.0, 24), M4(x + Math.sin(a) * 3.82, y + 55, z + Math.cos(a) * 3.82, 0, a, 0), face, 0.3);
    g.add(new THREE.BoxGeometry(0.12, 1.6, 0.05), M4(x + Math.sin(a) * 3.86, y + 55.5, z + Math.cos(a) * 3.86, 0, a, 0.5), dark);
    g.add(new THREE.BoxGeometry(0.1, 1.1, 0.05), M4(x + Math.sin(a) * 3.87, y + 54.8, z + Math.cos(a) * 3.87, 0, a, -1.2), dark);
  }
  g.add(new THREE.BoxGeometry(8.4, 0.8, 8.4), M4(x, y + 59.4, z), band);
  // octagonal open lantern: eight slender piers with arches, ringed by pinnacles
  for (let k = 0; k < 8; k++) {
    const a = k / 8 * Math.PI * 2, r = 3.2;
    g.add(new THREE.BoxGeometry(0.7, 9, 0.7), M4(x + Math.cos(a) * r, y + 64.3, z + Math.sin(a) * r, 0, -a, 0), stone);
    g.add(new THREE.ConeGeometry(0.4, 3, 4), M4(x + Math.cos(a) * (r + 0.5), y + 70.2, z + Math.sin(a) * (r + 0.5)), stone);
  }
  g.add(new THREE.CylinderGeometry(2.2, 2.2, 9, 8), M4(x, y + 64.3, z), dark);
  g.add(new THREE.CylinderGeometry(3.7, 3.7, 0.8, 8), M4(x, y + 69.2, z), band);
  g.add(new THREE.ConeGeometry(3.1, 14, 8), M4(x, y + 76.6, z), stone);
  for (let k = 0; k < 4; k++) g.add(new THREE.BoxGeometry(0.15, 14, 2.2), M4(x, y + 76, z, 0, k * Math.PI / 4, 0, 1, 1, 1), band);
  g.add(new THREE.ConeGeometry(0.22, 3.2, 6), M4(x, y + 85, z), dark);
}

function shrineTop(g, m, R) {
  const [x0, z0, x1, z1] = polyBox(m.p), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, r = Math.min(x1 - x0, z1 - z0) * 0.32;
  if (r < 1.2) return;
  if (R() < 0.5) { // dome (mosque / agiary style roof)
    g.add(new THREE.SphereGeometry(r, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), M4(cx, m.yTop - 0.2, cz), C('#eae6dc'));
    g.add(new THREE.ConeGeometry(0.15, 1.6, 6), M4(cx, m.yTop + r + 0.6, cz), C('#c9a640'));
  } else {     // shikhara (temple spire): stacked, ribbed, tapering
    const h = r * 3.2;
    const sh = new THREE.CylinderGeometry(0.15 * r, r, h, 12, 6);
    const p = sh.attributes.position;
    for (let i = 0; i < p.count; i++) { const a = Math.atan2(p.getZ(i), p.getX(i)); const k = 1 + 0.08 * Math.cos(a * 12); const yy = p.getY(i) / h + 0.5; const bulge = 1 + 0.25 * Math.sin(yy * Math.PI); p.setX(i, p.getX(i) * k * bulge); p.setZ(i, p.getZ(i) * k * bulge); }
    g.add(sh, M4(cx, m.yTop + h / 2, cz), C('#e8dcc4'));
    g.add(new THREE.SphereGeometry(0.3 * r, 10, 6), M4(cx, m.yTop + h + 0.15 * r, cz, 0, 0, 0, 1, 0.5, 1), C('#d9b24a'));
    g.add(new THREE.ConeGeometry(0.05 * r + 0.05, 0.9, 5), M4(cx, m.yTop + h + 0.6, cz), C('#c03020'));
  }
}
