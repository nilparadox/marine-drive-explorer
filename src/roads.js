// Road ribbons draped on the terrain: carriageways, footpaths + kerbs, flyovers on pillars.
import * as THREE from 'three';
import { COMMON, FINISH, mat } from './shade.js';
import { groundH, coastDist, hillH, surfaceH } from './geo.js';
// extra lift where the ground is steep, so the coarse terrain never pokes through a road
function slopeLift(x, z) {
  const sx = Math.abs(groundH(x + 3, z) - groundH(x - 3, z)) / 6, sz = Math.abs(groundH(x, z + 3) - groundH(x, z - 3)) / 6;
  return Math.min(0.5, Math.max(sx, sz) * 0.6);
}

export const ROAD_W = [14, 0, 10, 8, 6.2, 4.2, 6, 2.2, 2.2];

export function roadWidth(r) {
  if (r.cls === 1 || r.cls === 0) return r.lanes ? r.lanes * 3.4 + (r.oneway ? 0.8 : 1.6) : (r.oneway ? 8 : 15);
  if (r.cls === 2) return r.lanes ? r.lanes * 3.2 + 0.8 : (r.oneway ? 7 : 11);
  return ROAD_W[r.cls];
}

const VS = /* glsl */`
attribute vec2 aUv; attribute vec4 aInfo;
varying vec3 vP; varying vec2 vUv; varying vec4 vInfo; varying vec3 vN;
void main(){ vP = position; vUv = aUv; vInfo = aInfo; vN = normal.y < 0. ? -normal : normal; gl_Position = projectionMatrix*viewMatrix*vec4(position,1.); }`;

// aInfo: x = half width, y = lanes, z = class, w = flags (1 oneway, 2 concrete, 4 zebra-at-ends, 8 bridge)  vUv: x across (m from centre), y along (m)
const ROAD_FS = /* glsl */`
${COMMON}
varying vec3 vP; varying vec2 vUv; varying vec4 vInfo; varying vec3 vN;
uniform float uLenFade;
void main(){
  float hw = vInfo.x, lanes = vInfo.y, cls = vInfo.z, fl = vInfo.w;
  float x = vUv.x, y = vUv.y;
  float dist = length(uCam - vP);
  float fine = 1. - smoothstep(80., 400., dist);
  bool concrete = mod(floor(fl/2.),2.) > .5;
  vec3 alb;
  if (cls > 6.5) { // footpaths in parks / promenade paths
    alb = vec3(.50,.47,.42) * (.85 + .25*vn(vP.xz*2.));
  } else if (concrete) {
    alb = vec3(.47,.46,.44) * (.9 + .12*fbm(vP.xz*.3));
    float j = smoothstep(.04,.0,abs(fract(y/4.5)-.5)-.47) + smoothstep(.04,.0,abs(fract((x+hw)/3.4)-.5)-.48)*.5;
    alb *= 1. - .25*j*fine;
  } else {
    float n = fbm(vP.xz*.25);
    alb = mix(vec3(.13,.13,.135), vec3(.19,.185,.18), n);
    alb = mix(alb, vec3(.24,.23,.22), smoothstep(.62,.75, fbm(vP.xz*.06+4.))*.6); // patched repairs
    alb *= .9 + .15*vn(vP.xz*5.);
  }
  // wheel wear in the middle of each lane
  float lw = lanes > .5 ? (2.*hw)/lanes : 3.3;
  float lx = fract((x + hw)/lw);
  if (cls < 6.5) alb *= 1. - .06*fine*(smoothstep(.15,.25,lx)*smoothstep(.45,.35,lx) + smoothstep(.55,.65,lx)*smoothstep(.85,.75,lx));
  // markings
  float m = 0.;
  if (cls < 3.5) {
    float edge = step(hw - .45, abs(x)) * step(abs(x), hw - .3);
    m = max(m, edge);
    if (lanes > 1.5) {
      for (float i = 1.; i < 8.; i++) { if (i >= lanes) break;
        float lx2 = -hw + lw*i;
        bool center = mod(fl,2.) < .5 && abs(i - lanes*.5) < .1;
        float dash = center ? 1. : step(.5, fract(y/9.));
        m = max(m, step(abs(x - lx2), center ? .2 : .08) * dash);
      }
    } else if (mod(fl,2.) < .5) m = max(m, step(abs(x), .08)*step(.5, fract(y/9.)));
    // zebra crossings near the ends of the way
    if (mod(floor(fl/4.),2.) > .5) {
      float L = uLenFade; // not used per-vertex; zebra uses v distance from ends packed in vInfo? keep simple: first 3-7 m
      float z1 = step(3., y) * step(y, 7.);
      m = max(m, z1 * step(.5, fract(x/1.1)) * step(abs(x), hw - .5));
    }
  }
  vec3 paint = cls < 1.5 && concrete ? vec3(.92,.88,.62) : vec3(.86,.86,.82);
  alb = mix(alb, paint * (.85+.15*vn(vP.xz*8.)), m * (.75 + .25*fine));
  vec3 N = normalize(vN);
  float sh = shadowAt(vP, N);
  float wetSpec = .12 + uNight*.25;
  vec3 c = shade(alb, N, vP, sh, 1., wetSpec, 50.);
  // warm pools of street light at night along major roads
  c += uNight * vec3(1.,.62,.28) * .16 * (cls < 3.5 ? 1. : .5) * (.55 + .45*sin(y*.21)) * alb * 6.;
  gl_FragColor = vec4(haze(c, vP), 1.);
  ${FINISH}
}`;

// footpath: interlocking pavers, painted kerbs (black and yellow) along the road edge
const WALK_FS = /* glsl */`
${COMMON}
varying vec3 vP; varying vec2 vUv; varying vec4 vInfo; varying vec3 vN;
void main(){
  float hw = vInfo.x, x = abs(vUv.x), y = vUv.y;
  float dist = length(uCam - vP), fine = 1. - smoothstep(30., 200., dist);
  vec2 q = vec2(vUv.x, vUv.y) / vec2(.22, .11);
  float row = floor(q.y); q.x += mod(row,2.)*.5;
  vec2 f = abs(fract(q)-.5);
  float tone = h21(floor(q));
  vec3 alb = mix(vec3(.47,.45,.42), vec3(.52,.36,.30), step(.82, tone)); // grey pavers with some red ones
  alb *= .85 + .2*tone;
  alb *= 1. - .3*fine*smoothstep(.42,.5,max(f.x,f.y));
  alb = mix(alb, vec3(.25,.23,.2), smoothstep(.6,.8,fbm(vP.xz*.15))*.4); // grime
  // kerb band at the inner edge (next to the carriageway)
  float kerb = step(x, vInfo.y + .32);
  float stripe = step(.5, fract(y/1.0));
  vec3 kc = mix(vec3(.06), vec3(.86,.68,.12), stripe);
  alb = mix(alb, kc*(.8+.2*vn(vP.xz*5.)), kerb*vInfo.z);
  alb = mix(alb, vec3(.55,.54,.5), kerb*(1.-vInfo.z));
  vec3 N = normalize(vN);
  float sh = shadowAt(vP, N);
  vec3 c = shade(alb, N, vP, sh, 1., .05, 20.);
  c += uNight * vec3(1.,.62,.28) * .05 * alb * 6.;
  gl_FragColor = vec4(haze(c, vP), 1.);
  ${FINISH}
}`;

const PIER_FS = /* glsl */`
${COMMON}
varying vec3 vP; varying vec2 vUv; varying vec4 vInfo; varying vec3 vN;
void main(){
  vec3 alb = vec3(.55,.53,.5)*(.85+.2*fbm(vP.xz*.5+vP.y));
  alb = mix(alb, vec3(.3,.29,.27), smoothstep(.6,.9,fbm(vec2(vP.x+vP.z, vP.y*.3)*.4))*.5);
  vec3 N = normalize(vN);
  vec3 c = shade(alb, N, vP, shadowAt(vP,N), 1., .05, 20.);
  gl_FragColor = vec4(haze(c, vP), 1.);
  ${FINISH}
}`;

function ribbon(out, pts, hw, info, yfn, uOff = 0) {
  // pts: flat xz array; builds a strip with miter joins, uv x = across (m), y = along (m)
  const n = pts.length / 2; if (n < 2) return;
  const base = out.pos.length / 3; let along = 0;
  for (let i = 0; i < n; i++) {
    const x = pts[i * 2], z = pts[i * 2 + 1];
    let dx0 = 0, dz0 = 0, dx1 = 0, dz1 = 0;
    if (i > 0) { dx0 = x - pts[i * 2 - 2]; dz0 = z - pts[i * 2 - 1]; const l = Math.hypot(dx0, dz0) || 1; dx0 /= l; dz0 /= l; }
    if (i < n - 1) { dx1 = pts[i * 2 + 2] - x; dz1 = pts[i * 2 + 3] - z; const l = Math.hypot(dx1, dz1) || 1; dx1 /= l; dz1 /= l; }
    if (i === 0) { dx0 = dx1; dz0 = dz1; } if (i === n - 1) { dx1 = dx0; dz1 = dz0; }
    let tx = dx0 + dx1, tz = dz0 + dz1; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
    const nx = -tz, nz = tx;
    const cosh = Math.max(0.35, nx * -dz1 + nz * dx1 || 1);
    const w = hw / cosh;
    if (i > 0) along += Math.hypot(x - pts[i * 2 - 2], z - pts[i * 2 - 1]);
    const lx = x + nx * w, lz = z + nz * w, rx = x - nx * w, rz = z - nz * w;
    out.pos.push(lx, yfn(lx, lz, along, x, z), lz, rx, yfn(rx, rz, along, x, z), rz);
    out.uv.push(-hw - uOff, along, hw + uOff, along);
    for (let k = 0; k < 2; k++) out.info.push(...info);
    if (i < n - 1) { const a = base + i * 2; out.idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  return along;
}

// a strip running alongside the centreline between two signed offsets (used for the two footpaths)
function strip(out, pts, o0, o1, info, yfn) {
  const n = pts.length / 2; if (n < 2) return;
  const base = out.pos.length / 3; let along = 0;
  for (let i = 0; i < n; i++) {
    const x = pts[i * 2], z = pts[i * 2 + 1];
    let tx = 0, tz = 0;
    if (i < n - 1) { tx += pts[i * 2 + 2] - x; tz += pts[i * 2 + 3] - z; }
    if (i > 0) { tx += x - pts[i * 2 - 2]; tz += z - pts[i * 2 - 1]; along += Math.hypot(x - pts[i * 2 - 2], z - pts[i * 2 - 1]); }
    const l = Math.hypot(tx, tz) || 1, nx = -tz / l, nz = tx / l;
    for (const o of [o1, o0]) { const vx = x + nx * o, vz = z + nz * o; out.pos.push(vx, yfn(vx, vz, along, x, z), vz); out.uv.push(-o, along); out.info.push(...info); }
    if (i < n - 1) { const a = base + i * 2; out.idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
}

function densify(p, step) {
  const o = [p[0], p[1]];
  for (let i = 2; i < p.length; i += 2) {
    const ax = p[i - 2], az = p[i - 1], bx = p[i], bz = p[i + 1], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / step));
    for (let s = 1; s <= n; s++) o.push(ax + (bx - ax) * s / n, az + (bz - az) * s / n);
  }
  return o;
}
const len = p => { let s = 0; for (let i = 2; i < p.length; i += 2) s += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]); return s; };

export function buildRoads(L, scene) {
  const grp = new THREE.Group();
  const R = { pos: [], uv: [], info: [], idx: [] }, W = { pos: [], uv: [], info: [], idx: [] }, P = { pos: [], uv: [], info: [], idx: [] }, F = { pos: [], uv: [], info: [], idx: [] };
  const lanes = [];  // for traffic: {pts, hw, oneway, cls, lanes}
  // break polylines at sharp corners: a mitred join there folds into a spike
  const pieces = [];
  for (const r of L.roads) {
    const P = r.pts, n = P.length / 2; let start = 0;
    for (let i = 1; i < n - 1; i++) {
      const ax = P[i * 2] - P[i * 2 - 2], az = P[i * 2 + 1] - P[i * 2 - 1], bx = P[i * 2 + 2] - P[i * 2], bz = P[i * 2 + 3] - P[i * 2 + 1];
      const c = (ax * bx + az * bz) / ((Math.hypot(ax, az) * Math.hypot(bx, bz)) || 1);
      if (c < 0.5) { pieces.push({ ...r, pts: P.slice(start * 2, i * 2 + 2) }); start = i; }
    }
    pieces.push(start ? { ...r, pts: P.slice(start * 2) } : r);
  }
  for (const r of pieces) {
    if (r.cls > 8 || r.pts.length < 4) continue;
    const hw = roadWidth(r) / 2;
    const onHill = (() => { for (let i = 0; i < r.pts.length; i += 2) if (hillH(r.pts[i], r.pts[i + 1]) > 3) return true; return false; })();
    const p = densify(r.pts, r.bridge ? 6 : onHill ? 4 : 10);
    const total = len(p);
    const isMarine = /Marine Drive|Netaji Subhash/i.test(r.name);
    const BR = r.bridge ? (r.cls >= 7 ? 6.8 : 7.0) : 0;
    const ramp = Math.min(60, total * 0.35);
    const yfn = (x, z, a, cx = x, cz = z) => {
      const g = surfaceH(x, z);
      if (!BR) return g + (r.cls >= 6 ? 0.16 : 0.14) + slopeLift(cx, cz);
      // elevated deck: footbridges stay up (stairs at ends), road flyovers ramp down
      const t = r.cls >= 7 ? 1 : Math.min(1, Math.min(a, total - a) / ramp);
      return g + 0.12 + BR * (t * t * (3 - 2 * t));
    };
    const flags = (r.oneway ? 1 : 0) | (isMarine ? 2 : 0) | (r.cls <= 3 && total > 40 && !r.bridge ? 4 : 0) | (BR ? 8 : 0);
    if (r.cls === 6 || r.cls >= 7) { ribbon(F, p, hw, [hw, 0, r.cls, flags], yfn); }
    else ribbon(R, p, hw, [hw, r.lanes, r.cls, flags], yfn);
    // footpaths along streets (not on flyovers, not on service lanes)
    if (r.cls <= 4 && !BR) {
      const sw = r.cls <= 2 ? 3.2 : 2.2;
      const fy = (x, z, a, cx, cz) => surfaceH(x, z) + 0.07 + slopeLift(cx, cz);
      const info = [hw + sw, hw, r.cls <= 3 ? 1 : 0, 0];
      strip(W, p, hw - 0.15, hw + sw, info, fy);
      strip(W, p, -(hw + sw), -(hw - 0.15), info, fy);
    }
    if (BR) { // pillars and parapets for flyovers / foot bridges
      let a = 0;
      for (let i = 2; i < p.length; i += 2) {
        const sx = p[i - 2], sz = p[i - 1], ex = p[i], ez = p[i + 1], sl = Math.hypot(ex - sx, ez - sz);
        const steps = Math.floor((a + sl) / 24) - Math.floor(a / 24);
        for (let s = 1; s <= steps; s++) {
          const d = (Math.floor(a / 24) + s) * 24 - a, t = d / sl, x = sx + (ex - sx) * t, z = sz + (ez - sz) * t;
          const top = yfn(x, z, a + d) - 0.6, bot = Math.max(groundH(x, z), 0) - 0.2;
          if (top - bot > 1.5) pillar(P, x, z, bot, top, r.cls >= 7 ? 0.35 : 1.1, (ez - sz) / sl, -(ex - sx) / sl, hw);
        }
        a += sl;
      }
      // parapet walls on both sides
      for (const side of [-1, 1]) wallStrip(P, p, hw, side, yfn);
    }
    if (r.cls <= 5 && !BR) lanes.push({ pts: r.pts, hw, oneway: r.oneway, cls: r.cls, lanes: r.lanes, name: r.name, total });
  }
  const make = (D, fs, po, name) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(D.pos, 3));
    g.setAttribute('aUv', new THREE.Float32BufferAttribute(D.uv, 2));
    g.setAttribute('aInfo', new THREE.Float32BufferAttribute(D.info, 4));
    g.setIndex(D.idx); g.computeVertexNormals();
    const m = mat({ vs: VS, fs, po, side: THREE.DoubleSide, uniforms: { uLenFade: { value: 0 } } });
    const mesh = new THREE.Mesh(g, m); mesh.name = name; mesh.userData.receive = true;
    grp.add(mesh); return mesh;
  };
  make(W, WALK_FS, [-2, -4], 'footpaths');
  make(F, ROAD_FS, [-3, -6], 'paths');
  make(R, ROAD_FS, [-4, -8], 'roads');
  if (P.pos.length) { const m = make(P, PIER_FS, null, 'flyover-structure'); m.userData.cast = true; }
  scene.add(grp);
  return { group: grp, lanes };
}

function pillar(D, x, z, y0, y1, r, dx, dz, hw) {
  // a hammerhead pier: column + cap beam across the deck
  box(D, x, z, y0, y1 - 0.6, r, r, dx, dz);
  box(D, x, z, y1 - 0.6, y1, Math.min(hw * 0.9, r * 4), r * 1.2, dx, dz);
}
function box(D, cx, cz, y0, y1, hx, hz, dx, dz) {
  // oriented box: hx along (dx,dz) normal direction across the road
  const ax = dx, az = dz, bx = -dz, bz = dx;
  const c = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => [cx + ax * u * hx + bx * v * hz, cz + az * u * hx + bz * v * hz]);
  for (let i = 0; i < 4; i++) {
    const a = c[i], b = c[(i + 1) % 4], base = D.pos.length / 3;
    D.pos.push(a[0], y0, a[1], b[0], y0, b[1], b[0], y1, b[1], a[0], y1, a[1]);
    D.uv.push(0, 0, 1, 0, 1, 1, 0, 1); for (let k = 0; k < 4; k++) D.info.push(0, 0, 0, 0);
    D.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const base = D.pos.length / 3;
  for (const p of c) { D.pos.push(p[0], y1, p[1]); D.uv.push(0, 0); D.info.push(0, 0, 0, 0); }
  D.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
}
function wallStrip(D, p, hw, side, yfn) {
  let a = 0;
  for (let i = 0; i < p.length / 2; i++) {
    const x = p[i * 2], z = p[i * 2 + 1];
    if (i) a += Math.hypot(x - p[i * 2 - 2], z - p[i * 2 - 1]);
    let tx, tz; if (i < p.length / 2 - 1) { tx = p[i * 2 + 2] - x; tz = p[i * 2 + 3] - z; } else { tx = x - p[i * 2 - 2]; tz = z - p[i * 2 - 1]; }
    const l = Math.hypot(tx, tz) || 1; const nx = -tz / l * side, nz = tx / l * side;
    const ox = x + nx * hw, oz = z + nz * hw, y = yfn(ox, oz, a);
    const base = D.pos.length / 3;
    D.pos.push(ox, y - 0.9, oz, ox, y + 0.9, oz);
    D.uv.push(0, 0, 0, 1); D.info.push(0, 0, 0, 0, 0, 0, 0, 0);
    if (i) { const b = base - 2; D.idx.push(b, base, b + 1, b + 1, base, base + 1, b, b + 1, base, b + 1, base + 1, base); }
  }
}
