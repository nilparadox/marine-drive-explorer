// Trees made from code: rain tree, false ashoka, coconut palm, banyan, Indian almond, shrubs. Instanced in tiles with a far LOD.
import * as THREE from 'three';
import { COMMON, FINISH, mat, U } from './shade.js';
import { groundH, coastDist, pointInPoly, rng, hillH, beachAt } from './geo.js';
import { roadWidth } from './roads.js';

export const T = { RAIN: 0, ASHOKA: 1, PALM: 2, BANYAN: 3, ALMOND: 4, SHRUB: 5 };

// ------------------------------------------------------------------ geometry builders
class GB {
  constructor() { this.pos = []; this.nor = []; this.uv = []; this.part = []; this.idx = []; }
  get n() { return this.pos.length / 3; }
  // tapered cylinder between a and b
  limb(a, b, r0, r1, seg = 6) {
    const d = new THREE.Vector3().subVectors(b, a), L = d.length(); d.normalize();
    const t = Math.abs(d.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const u = new THREE.Vector3().crossVectors(d, t).normalize(), v = new THREE.Vector3().crossVectors(d, u);
    const base = this.n;
    for (let k = 0; k <= 1; k++) for (let i = 0; i <= seg; i++) {
      const ang = i / seg * Math.PI * 2, c = Math.cos(ang), s = Math.sin(ang), r = k ? r1 : r0;
      const nrm = u.clone().multiplyScalar(c).addScaledVector(v, s);
      const p = (k ? b : a).clone().addScaledVector(nrm, r);
      this.pos.push(p.x, p.y, p.z); this.nor.push(nrm.x, nrm.y, nrm.z); this.uv.push(i / seg * r0 * 6.28, k * L); this.part.push(0);
    }
    for (let i = 0; i < seg; i++) { const a0 = base + i, b0 = base + i + 1, a1 = base + seg + 1 + i, b1 = a1 + 1; this.idx.push(a0, b0, a1, b0, b1, a1); }
  }
  // leaf card: centre c, normal-ish direction n (for shading), size w,h, orientation by axes
  card(c, ax, ay, w, h, shadeN, kind = 1) {
    const base = this.n;
    for (const [s, t] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const p = c.clone().addScaledVector(ax, s * w / 2).addScaledVector(ay, t * h / 2);
      this.pos.push(p.x, p.y, p.z); this.nor.push(shadeN.x, shadeN.y, shadeN.z); this.uv.push((s + 1) / 2, (t + 1) / 2); this.part.push(kind);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  geo() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aPart', new THREE.Float32BufferAttribute(this.part, 1));
    g.setIndex(this.idx); g.computeBoundingSphere();
    return g;
  }
}
const V = (x, y, z) => new THREE.Vector3(x, y, z);
function randUnit(R) { const u = R() * 2 - 1, a = R() * Math.PI * 2, s = Math.sqrt(1 - u * u); return V(s * Math.cos(a), u, s * Math.sin(a)); }
function canopyCards(g, R, centre, rx, ry, count, size, kind = 1, flat = 0) {
  for (let i = 0; i < count; i++) {
    let d = randUnit(R); d.y = Math.abs(d.y) * (1 - flat) + d.y * flat;
    const rr = Math.pow(R(), 0.35);
    const p = V(centre.x + d.x * rx * rr, centre.y + d.y * ry * rr, centre.z + d.z * rx * rr);
    const sn = V((p.x - centre.x) / rx, (p.y - centre.y) / ry + 0.25, (p.z - centre.z) / rx).normalize();
    const a = R() * Math.PI;
    const ax = V(Math.cos(a), (R() - 0.5) * 0.6, Math.sin(a)).normalize();
    const ay = new THREE.Vector3().crossVectors(ax, randUnit(R)).normalize();
    if (Math.abs(ay.y) < 0.3) ay.y += 0.5, ay.normalize();
    const s = size * (0.75 + R() * 0.5);
    g.card(p, ax, ay, s, s, sn, kind);
  }
}

// curved limb made of several tapered segments; returns the tip
function curvedLimb(g, R, from, dir, len, r0, r1, segs, bend, sides) {
  let p = from.clone(), d = dir.clone().normalize();
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs, t1 = (i + 1) / segs;
    d.add(V((R() - 0.5) * bend, bend * 0.35 * (R() - 0.3), (R() - 0.5) * bend)).normalize();
    const q = p.clone().addScaledVector(d, len / segs);
    g.limb(p, q, r0 + (r1 - r0) * t0, r0 + (r1 - r0) * t1, sides);
    p = q;
  }
  return { tip: p, dir: d };
}
// leaf clusters around a branch tip: many small cards, mostly facing up (umbrella crowns)
function cluster(g, R, c, rad, n, size, kind, flatten, centre) {
  for (let i = 0; i < n; i++) {
    const d = randUnit(R); d.y *= flatten;
    const p = c.clone().addScaledVector(d, rad * Math.pow(R(), 0.5));
    const sn = p.clone().sub(centre).normalize(); sn.y += 0.35; sn.normalize();
    const a = R() * Math.PI * 2;
    const ax = V(Math.cos(a), (R() - 0.5) * 0.5, Math.sin(a)).normalize();
    const tilt = 0.25 + R() * 0.6;
    const ay = new THREE.Vector3().crossVectors(ax, V(0, 1, 0)).normalize().multiplyScalar(Math.cos(tilt)).add(V(0, Math.sin(tilt), 0)).normalize();
    const s = size * (0.7 + R() * 0.6);
    g.card(p, ax, ay, s, s * (0.8 + R() * 0.4), sn, kind);
  }
}
function rainTree(R, big = 1) {
  const g = new GB(), h = 3.8 * big;
  // trunk with a root flare
  g.limb(V(0, -0.6, 0), V(0, 0.4, 0), 0.62 * big, 0.42 * big, 9);
  g.limb(V(0, 0.4, 0), V(0, h, 0), 0.42 * big, 0.34 * big, 9);
  const top = V(0, h, 0), centre = V(0, h + 6 * big, 0);
  const nb = 5 + Math.floor(R() * 2);
  for (let i = 0; i < nb; i++) {
    const a = i / nb * Math.PI * 2 + R() * 0.6;
    const dir = V(Math.cos(a), 0.9 + R() * 0.4, Math.sin(a));
    const L1 = curvedLimb(g, R, top, dir, (5.5 + R() * 2) * big, 0.28 * big, 0.14 * big, 3, 0.35, 6);
    const nsub = 2 + Math.floor(R() * 2);
    for (let k = 0; k < nsub; k++) {
      const sd = L1.dir.clone().add(V((R() - 0.5) * 1.4, 0.1 + R() * 0.3, (R() - 0.5) * 1.4));
      const L2 = curvedLimb(g, R, L1.tip, sd, (3 + R() * 2.5) * big, 0.13 * big, 0.04 * big, 2, 0.4, 5);
      cluster(g, R, L2.tip.clone().add(V(0, 0.6 * big, 0)), 2.6 * big, 13, 1.9 * big, 1, 0.45, centre);
    }
    cluster(g, R, L1.tip.clone().add(V(0, 0.5 * big, 0)), 2.2 * big, 8, 1.8 * big, 1, 0.5, centre);
  }
  // fill the umbrella crown so it reads as one mass from afar
  for (let i = 0; i < 26; i++) {
    const a = R() * Math.PI * 2, r = Math.sqrt(R()) * 8.5 * big;
    cluster(g, R, V(Math.cos(a) * r, h + (4.6 + R() * 2.2 - r * 0.12) * big, Math.sin(a) * r), 1.6 * big, 3, 2.0 * big, 1, 0.4, centre);
  }
  return g.geo();
}
function ashoka(R) {
  const g = new GB(), h = 13;
  g.limb(V(0, -0.5, 0), V(0, h, 0), 0.22, 0.05, 6);
  for (let i = 0; i < 70; i++) {
    const y = 1.5 + Math.pow(R(), 0.8) * (h - 1);
    const r = (1 - (y - 1.5) / (h - 0.5)) * 1.7 + 0.25, a = R() * Math.PI * 2;
    const p = V(Math.cos(a) * r * R(), y, Math.sin(a) * r * R());
    const sn = V(Math.cos(a), 0.3, Math.sin(a)).normalize();
    const ax = V(-Math.sin(a), 0, Math.cos(a)), ay = V(Math.cos(a) * 0.35, -1, Math.sin(a) * 0.35).normalize(); // drooping
    g.card(p, ax, ay, 1.3, 1.7, sn, 2);
  }
  return g.geo();
}
function palm(R) {
  const g = new GB(), h = 12 + R() * 4, lean = (R() - 0.5) * 0.12;
  let prev = V(0, -0.5, 0);
  for (let i = 1; i <= 6; i++) {
    const t = i / 6, p = V(Math.sin(t * 1.6) * h * lean, t * h, t * t * h * lean * 0.5);
    g.limb(prev, p, 0.24 - 0.05 * (i - 1) / 6, 0.22 - 0.05 * i / 6, 7); prev = p;
  }
  const crown = prev;
  // coconuts
  for (let i = 0; i < 5; i++) { const a = R() * 6.28; g.limb(crown.clone().add(V(Math.cos(a) * 0.35, -0.5, Math.sin(a) * 0.35)), crown.clone().add(V(Math.cos(a) * 0.4, -0.15, Math.sin(a) * 0.4)), 0.17, 0.17, 5); }
  // fronds: arched strips, the leaflets are cut by the shader
  const nf = 15;
  for (let f = 0; f < nf; f++) {
    const a = f / nf * Math.PI * 2 + R() * 0.3, up = 0.55 - (f % 3) * 0.35 - R() * 0.2;
    const dir = V(Math.cos(a), 0, Math.sin(a)), side = V(-Math.sin(a), 0, Math.cos(a));
    const L = 4.6 + R() * 1.2, seg = 6;
    const base = g.n;
    for (let s = 0; s <= seg; s++) {
      const t = s / seg, droop = up * t * 3.2 - t * t * 3.0;
      const c = crown.clone().addScaledVector(dir, t * L).add(V(0, droop, 0));
      const w = Math.sin(Math.min(1, t * 1.25) * Math.PI) * 1.0 + 0.08;
      const sn = V(dir.x * 0.3, 1, dir.z * 0.3).normalize();
      for (const sd of [-1, 1]) {
        const p = c.clone().addScaledVector(side, sd * w).add(V(0, -Math.abs(sd) * w * 0.35, 0));
        g.pos.push(p.x, p.y, p.z); g.nor.push(sn.x, sn.y, sn.z); g.uv.push((sd + 1) / 2, t); g.part.push(3);
      }
      if (s < seg) { const q = base + s * 2; g.idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); }
    }
  }
  return g.geo();
}
function banyan(R) {
  const g = new GB(), h = 5;
  g.limb(V(0, -0.5, 0), V(0, h, 0), 1.0, 0.8, 9);
  for (let i = 0; i < 7; i++) {
    const a = i / 7 * Math.PI * 2 + R() * 0.4, out = 9 + R() * 4;
    const mid = V(Math.cos(a) * out * 0.5, h + 3 + R() * 2, Math.sin(a) * out * 0.5), tip = V(Math.cos(a) * out, h + 6 + R() * 3, Math.sin(a) * out);
    g.limb(V(0, h, 0), mid, 0.5, 0.32, 6); g.limb(mid, tip, 0.32, 0.1, 5);
    // aerial roots hanging from the limbs
    if (R() < 0.5) { const p = mid.clone().lerp(tip, 0.25 + R() * 0.3); if (p.y < 9) g.limb(V(p.x, -0.3, p.z), p, 0.12 + R() * 0.08, 0.05, 5); }
  }
  const centre = V(0, h + 8, 0);
  for (let i = 0; i < 46; i++) { const a = R() * 6.28, r = Math.sqrt(R()) * 12; cluster(g, R, V(Math.cos(a) * r, h + 5 + R() * 6 - r * 0.15, Math.sin(a) * r), 2.4, 5, 2.3, 1, 0.6, centre); }
  return g.geo();
}
function almond(R) {
  const g = new GB(), h = 10;
  g.limb(V(0, -0.5, 0), V(0, h, 0), 0.3, 0.12, 6);
  for (let tier = 0; tier < 4; tier++) {
    const y = 4 + tier * 2.2, r = 5.5 - tier * 1.1;
    for (let i = 0; i < 5; i++) { const a = i / 5 * 6.28 + tier; g.limb(V(0, y, 0), V(Math.cos(a) * r, y + 0.4, Math.sin(a) * r), 0.12, 0.04, 4); }
    for (let i = 0; i < 30; i++) {
      const a = R() * 6.28, rr = r * (0.3 + R() * 0.75);
      const p = V(Math.cos(a) * rr, y + 0.5 + R() * 0.4, Math.sin(a) * rr);
      const sn = V(Math.cos(a) * 0.5, 1, Math.sin(a) * 0.5).normalize();
      g.card(p, V(Math.cos(a), 0.15, Math.sin(a)), V(-Math.sin(a), 0, Math.cos(a)), 1.7, 1.7, sn, 4);
    }
  }
  return g.geo();
}
function shrub(R) {
  const g = new GB();
  canopyCards(g, R, V(0, 0.7, 0), 1.3, 0.8, 16, 1.2, 5, 0.6);
  return g.geo();
}
// far LOD: a lumpy blob
function blob(kind) {
  const g = new THREE.IcosahedronGeometry(1, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); const n = 1 + 0.12 * Math.sin(x * 5 + z * 3) * Math.cos(y * 4); p.setXYZ(i, x * n, y * n, z * n); }
  g.computeVertexNormals();
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(new Float32Array(p.count).fill(9), 1));
  return g;
}

// ------------------------------------------------------------------ material
const VS = /* glsl */`
attribute float aPart; attribute vec4 aTint;
uniform float uTime; uniform float uWind;
varying vec3 vP; varying vec3 vN; varying vec2 vUv; varying float vPart; varying vec4 vTint; varying vec3 vLocal;
void main(){
  vec3 p = position;
  vec4 wp0 = modelMatrix * instanceMatrix * vec4(0.,0.,0.,1.);
  float ph = wp0.x*.13 + wp0.z*.07;
  float hgt = max(p.y, 0.);
  // trunk sway grows with height, leaves flutter
  float sway = sin(uTime*1.1 + ph) * .5 + sin(uTime*2.3 + ph*1.7)*.25;
  p.x += sway * hgt*hgt * .0016 * uWind;
  p.z += cos(uTime*.9 + ph) * hgt*hgt * .0011 * uWind;
  if (aPart > .5 && aPart < 8.5) {
    float fl = sin(uTime*4.5 + dot(p, vec3(3.1,1.7,2.3)) + ph) * .07 * uWind;
    p += normal * fl;
    if (aPart > 2.5 && aPart < 3.5) p.y += sin(uTime*2.1 + ph + uv.y*3.) * .18 * uv.y * uWind; // palm fronds bob
  }
  vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.);
  vP = wp.xyz; vUv = uv; vPart = aPart; vTint = aTint; vLocal = position;
  vN = normalize(mat3(modelMatrix * instanceMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const FS = /* glsl */`
${COMMON}
varying vec3 vP; varying vec3 vN; varying vec2 vUv; varying float vPart; varying vec4 vTint; varying vec3 vLocal;
vec2 gLeafId = vec2(0.);
float leafMask(vec2 uv, float kind, float dist){
  // a card holds a clump of small leaves; far away the clump fills in (less shimmer)
  float fill = smoothstep(35., 220., dist);
  vec2 c = uv - .5; float r = length(c);
  float clump = smoothstep(.5, .32 - fill*.12, r + (vn(uv*4. + vTint.w*30.) - .5)*.38);
  if (kind > 2.5 && kind < 3.5) { // palm frond: leaflets cut across the strip
    float lf = fract(uv.y*34.);
    float leaflet = step(abs(uv.x - .5)*2., .95) * smoothstep(.0, .25, lf) * smoothstep(1., .55, lf);
    float rib = step(abs(uv.x - .5), .03);
    gLeafId = vec2(floor(uv.y*34.), step(.5, uv.x));
    return max(max(leaflet, fill), rib);
  }
  vec2 cells = kind > 1.5 && kind < 2.5 ? vec2(4.,7.) : kind > 3.5 && kind < 4.5 ? vec2(4.,4.) : vec2(8.,8.);
  vec2 g = uv * cells;
  vec2 id = floor(g), f = fract(g) - .5;
  gLeafId = id;
  vec2 o = h22(id + vTint.w*17.) - .5;
  float a = h21(id*1.3)*6.28;
  vec2 q = mat2(cos(a), -sin(a), sin(a), cos(a)) * (f - o*.3);
  vec2 sh = kind > 1.5 && kind < 2.5 ? vec2(.22, .5) : kind > 3.5 && kind < 4.5 ? vec2(.3, .48) : vec2(.46, .26);
  float leaf = step(length(q / sh), 1.);
  // second, offset layer so the clump is dense
  vec2 g2 = uv * cells + .5; vec2 id2 = floor(g2), f2 = fract(g2) - .5;
  float a2 = h21(id2*2.1)*6.28;
  vec2 q2 = mat2(cos(a2), -sin(a2), sin(a2), cos(a2)) * (f2 - (h22(id2+5.)-.5)*.3);
  float leaf2 = step(length(q2 / sh), 1.) * step(.35, h21(id2+9.));
  if (leaf2 > leaf) gLeafId = id2 + 100.;
  return clump * max(max(leaf, leaf2), fill*.95 + smoothstep(.6,.95, h21(id+3.)));
}
void main(){
  float k = floor(vPart + .5);
  float dist = length(uCam - vP);
  vec3 N = normalize(vN);
  vec3 V = normalize(uCam - vP);
  vec3 alb; float trans = 0.;
  if (k < .5) { // bark with vertical fissures
    float n = fbm(vec2(vUv.x*2.5, vUv.y*.5));
    float fis = smoothstep(.55, .75, vn(vec2(vUv.x*7., vUv.y*.6)));
    alb = mix(vec3(.16,.14,.12), vec3(.30,.27,.23), n) * vTint.rgb;
    alb *= 1. - .45*fis;
    alb = mix(alb, vec3(.30,.33,.22), smoothstep(.65,.85,fbm(vUv*3.))*.35); // lichen
  } else {
    float m = k > 8.5 ? 1. : leafMask(vUv, k, dist);
    if (m < .5) discard;
    vec3 base = k < 1.5 ? vec3(.10,.19,.05) : k < 2.5 ? vec3(.07,.15,.04) : k < 3.5 ? vec3(.22,.28,.08) : k < 4.5 ? vec3(.16,.22,.06) : k < 5.5 ? vec3(.11,.20,.06) : vec3(.10,.18,.05);
    float lv = h21(gLeafId + vTint.w*9.);
    alb = base * vTint.rgb * (.72 + .5*lv);
    alb = mix(alb, alb*vec3(1.25,1.2,.7), step(.88, lv)*.6);   // a few yellowed leaves
    N = normalize(N + (vec3(h21(gLeafId+1.), h21(gLeafId+2.), h21(gLeafId+3.)) - .5) * .7 * (1. - smoothstep(30., 200., dist)));
    if (k > 3.5 && k < 4.5) alb = mix(alb, vec3(.45,.13,.05), step(.93, lv)*.7); // almond: a few red leaves
    trans = 1.;
  }
  #ifdef SHADOW
    gl_FragColor = vec4(1.); return;
  #endif
  float sh = shadowAt(vP, N);
  // self-shadowing inside the crown: lower + inner cards darker
  float ao = k > .5 ? clamp(.45 + .55*dot(N, vec3(0.,1.,0.))*.5 + .3, .35, 1.) : .8;
  vec3 c = shade(alb, N, vP, sh, ao, k > .5 ? .25 : .02, 30.);
  // light through the leaves when the sun is behind them (sunset glow)
  float back = pow(max(dot(-V, uSunDir), 0.), 4.);
  c += alb * uSunCol * back * trans * sh * 1.6 * vec3(1.,1.05,.6);
  gl_FragColor = vec4(haze(c, vP), 1.);
  ${FINISH}
}`;

// ------------------------------------------------------------------ placement + instancing
export function buildTrees(L, scene, bld, roads, quality) {
  const R = rng(777);
  const geos = [rainTree(rng(1)), ashoka(rng(2)), palm(rng(3)), banyan(rng(4)), almond(rng(5)), shrub(rng(6))];
  const geos2 = [rainTree(rng(11), 0.8), null, palm(rng(13)), null, null, shrub(rng(16))];
  const far = blob();
  const list = []; // [type, x, z, scale, rot, tint r g b, seed]
  const inBuilding = (x, z) => { for (const i of bld.grid.query(x, z)) { const m = bld.meta[i]; if (pointInPoly(x, z, m.p)) return true; } return false; };
  const nearBuilding = (x, z, r) => { for (const [dx, dz] of [[r, 0], [-r, 0], [0, r], [0, -r]]) if (inBuilding(x + dx, z + dz)) return true; return false; };
  const roadGrid = new Map(); // coarse occupancy of carriageways so trees stay off roads
  const RG = 6;
  for (const r of L.roads) {
    if (r.cls > 5) continue; const hw = roadWidth(r) / 2 + 0.6;
    const p = r.pts;
    for (let i = 2; i < p.length; i += 2) {
      const ax = p[i - 2], az = p[i - 1], bx = p[i], bz = p[i + 1], l = Math.hypot(bx - ax, bz - az), n = Math.ceil(l / 2);
      for (let s = 0; s <= n; s++) {
        const x = ax + (bx - ax) * s / n, z = az + (bz - az) * s / n;
        for (let ox = -hw; ox <= hw; ox += RG) for (let oz = -hw; oz <= hw; oz += RG) if (ox * ox + oz * oz <= hw * hw) roadGrid.set(Math.floor((x + ox) / RG) + ',' + Math.floor((z + oz) / RG), 1);
      }
    }
  }
  const onRoad = (x, z) => roadGrid.has(Math.floor(x / RG) + ',' + Math.floor(z / RG));
  const ok = (x, z, clear = 2) => coastDist(x, z) > 3 && !onRoad(x, z) && !inBuilding(x, z) && !nearBuilding(x, z, clear);
  const tint = (t) => { const v = 0.85 + R() * 0.3; return [v * (0.95 + R() * 0.1), v * (0.95 + R() * 0.12), v * (0.9 + R() * 0.1)]; };
  const add = (type, x, z, s) => list.push([type, x, z, s, R() * Math.PI * 2, ...tint(type), R()]);
  const pick = (x, z, w) => {
    const r = R(), hill = hillH(x, z) > 10;
    if (beachAt(x, z) > 0.2) return T.PALM;
    if (w === 'street') return r < 0.38 ? T.RAIN : r < 0.6 ? T.ASHOKA : r < 0.72 ? T.ALMOND : r < 0.8 ? T.BANYAN : r < 0.9 ? T.PALM : T.RAIN;
    if (w === 'wood') return r < 0.45 ? T.RAIN : r < 0.6 ? T.BANYAN : r < 0.75 ? T.ALMOND : r < 0.85 ? T.ASHOKA : T.PALM;
    if (hill) return r < 0.3 ? T.RAIN : r < 0.5 ? T.PALM : r < 0.7 ? T.ASHOKA : r < 0.8 ? T.BANYAN : T.ALMOND;
    return r < 0.35 ? T.RAIN : r < 0.55 ? T.ASHOKA : r < 0.7 ? T.PALM : r < 0.82 ? T.ALMOND : T.BANYAN;
  };
  // 1. mapped trees
  for (let i = 0; i < L.trees.length; i += 2) { const x = L.trees[i], z = L.trees[i + 1]; if (!inBuilding(x, z)) add(pick(x, z, 'mapped'), x, z, 0.7 + R() * 0.5); }
  // 2. street trees along the footpaths
  for (const r of L.roads) {
    if (r.cls < 1 || r.cls > 4 || r.bridge) continue;
    const isMarine = /Marine Drive|Netaji Subhash/i.test(r.name);
    const hw = roadWidth(r) / 2 + (r.cls <= 2 ? 1.8 : 1.2), p = r.pts;
    let acc = R() * 10;
    for (let i = 2; i < p.length; i += 2) {
      const ax = p[i - 2], az = p[i - 1], bx = p[i], bz = p[i + 1], l = Math.hypot(bx - ax, bz - az);
      const nx = -(bz - az) / l, nz = (bx - ax) / l;
      while (acc < l) {
        const t = acc / l, x = ax + (bx - ax) * t, z = az + (bz - az) * t;
        for (const sd of [-1, 1]) {
          const tx = x + nx * hw * sd, tz = z + nz * hw * sd;
          const zoneP = hillH(tx, tz) > 8 ? 0.75 : tx > 900 ? 0.6 : tz < -400 ? 0.28 : 0.5;
          if (isMarine && coastDist(tx, tz) < 25) continue; // promenade side: lamps, no trees
          if (R() < zoneP && ok(tx, tz, 1.2)) add(isMarine ? (R() < 0.5 ? T.PALM : T.RAIN) : pick(tx, tz, 'street'), tx, tz, 0.65 + R() * 0.45);
        }
        acc += 11 + R() * 8;
      }
      acc -= l;
    }
  }
  // 3. parks, gardens, woods, maidan edges
  for (const a of L.areas) {
    const k = a.k; if (![1, 2, 6, 13, 16, 3, 4, 5].includes(k)) continue;
    const p = a.pts; let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
    for (let i = 0; i < p.length; i += 2) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); z0 = Math.min(z0, p[i + 1]); z1 = Math.max(z1, p[i + 1]); }
    if (k === 16 || k === 3 || k === 4) { // open grounds: trees only around the edge
      for (let i = 0; i < p.length; i += 2) {
        const j = (i + 2) % p.length, l = Math.hypot(p[j] - p[i], p[j + 1] - p[i + 1]);
        for (let s = 0; s < l; s += 14 + R() * 6) {
          const t = s / l, x = p[i] + (p[j] - p[i]) * t, z = p[i + 1] + (p[j + 1] - p[i + 1]) * t;
          if (R() < 0.7 && ok(x, z)) add(R() < 0.6 ? T.RAIN : R() < 0.5 ? T.BANYAN : T.ALMOND, x, z, 0.8 + R() * 0.4);
        }
      }
      continue;
    }
    if (k === 5) { // beach: palms along the back of the sand
      for (let i = 0; i < 260; i++) { const x = x0 + R() * (x1 - x0), z = z0 + R() * (z1 - z0); if (pointInPoly(x, z, p) && coastDist(x, z) > 45 && ok(x, z)) add(T.PALM, x, z, 0.8 + R() * 0.4); }
      continue;
    }
    const dens = k === 6 ? 1 / 70 : k === 2 ? 1 / 160 : 1 / 220;
    const n = Math.min(4000, Math.round((x1 - x0) * (z1 - z0) * dens));
    for (let i = 0; i < n; i++) {
      const x = x0 + R() * (x1 - x0), z = z0 + R() * (z1 - z0);
      if (!pointInPoly(x, z, p) || !ok(x, z, 1)) continue;
      if (R() < 0.25) add(T.SHRUB, x, z, 0.7 + R() * 0.8); else add(pick(x, z, k === 6 ? 'wood' : 'park'), x, z, 0.65 + R() * 0.5);
    }
  }
  // 4. compounds on Malabar Hill and around the Oval: fill free land with greenery
  for (let i = 0; i < 26000; i++) {
    const x = L.bounds.x0 + R() * (L.bounds.x1 - L.bounds.x0), z = L.bounds.z0 + R() * (L.bounds.z1 - L.bounds.z0);
    const hill = hillH(x, z);
    const p = hill > 8 ? 0.55 : x > 700 && z > -300 && z < 1600 ? 0.12 : 0.05;
    if (R() > p) continue;
    if (!ok(x, z, 2.5)) continue;
    add(R() < 0.25 ? T.SHRUB : pick(x, z, hill > 8 ? 'wood' : 'park'), x, z, 0.6 + R() * 0.5);
  }

  // ---- instancing in tiles (near detail) + far blobs
  const TILE = 500;
  const tiles = new Map();
  for (const t of list) {
    const k = Math.floor(t[1] / TILE) + ',' + Math.floor(t[2] / TILE);
    let a = tiles.get(k); if (!a) tiles.set(k, a = { items: [], cx: (Math.floor(t[1] / TILE) + 0.5) * TILE, cz: (Math.floor(t[2] / TILE) + 0.5) * TILE }); a.items.push(t);
  }
  const material = mat({ vs: VS, fs: FS, side: THREE.DoubleSide, uniforms: { uWind: U.uWind } });
  const shadowMat = mat({ vs: VS, fs: FS, side: THREE.DoubleSide, defines: { SHADOW: 1 } });
  if (quality >= 2) material.alphaToCoverage = true;
  const grp = new THREE.Group(); grp.name = 'trees';
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s3 = new THREE.Vector3(), p3 = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const tileObjs = [];
  const farScale = [[9, 4.5, 9, 9.5], [1.6, 6.5, 1.6, 7.5], [3.5, 2.2, 3.5, 13], [12, 6, 12, 12.5], [5.5, 4.5, 5.5, 9], [1.3, 0.9, 1.3, 0.8]];
  for (const [k, tile] of tiles) {
    const byType = new Map();
    for (const t of tile.items) { let a = byType.get(t[0]); if (!a) byType.set(t[0], a = []); a.push(t); }
    const near = new THREE.Group(); near.userData.tile = tile;
    for (const [type, items] of byType) {
      for (let variant = 0; variant < 2; variant++) {
        const vi = items.filter((_, i) => (geos2[type] ? i % 2 : 0) === variant);
        if (!vi.length) continue;
        const geo = variant && geos2[type] ? geos2[type] : geos[type];
        const im = new THREE.InstancedMesh(geo, material, vi.length);
        const tintA = new Float32Array(vi.length * 4);
        vi.forEach((t, i) => {
          const y = groundH(t[1], t[2]);
          q.setFromAxisAngle(up, t[4]); s3.setScalar(t[3]); p3.set(t[1], y, t[2]);
          im.setMatrixAt(i, m4.compose(p3, q, s3));
          tintA.set([t[5], t[6], t[7], t[8]], i * 4);
        });
        im.geometry = geo;
        im.instanceMatrix.needsUpdate = true;
        im.geometry = geo.clone(); im.geometry.setAttribute('aTint', new THREE.InstancedBufferAttribute(tintA, 4));
        im.computeBoundingSphere();
        im.userData.cast = true; im.userData.shadowMat = shadowMat;
        near.add(im);
      }
    }
    // far LOD: blobs for every tree in this tile
    const fm = new THREE.InstancedMesh(far, material, tile.items.length);
    const tintF = new Float32Array(tile.items.length * 4);
    tile.items.forEach((t, i) => {
      const fs = farScale[t[0]], y = groundH(t[1], t[2]);
      q.setFromAxisAngle(up, t[4]); s3.set(fs[0] * t[3], fs[1] * t[3], fs[2] * t[3]); p3.set(t[1], y + fs[3] * t[3], t[2]);
      fm.setMatrixAt(i, m4.compose(p3, q, s3));
      tintF.set([t[5] * 0.8, t[6] * 0.8, t[7] * 0.8, t[8]], i * 4);
    });
    fm.geometry = far.clone(); fm.geometry.setAttribute('aTint', new THREE.InstancedBufferAttribute(tintF, 4));
    fm.computeBoundingSphere();
    grp.add(near); grp.add(fm);
    tileObjs.push({ near, far: fm, cx: tile.cx, cz: tile.cz });
  }
  scene.add(grp);
  let nearDist = quality >= 2 ? 420 : quality >= 1 ? 320 : 220;
  function update(cam) {
    for (const t of tileObjs) {
      const d = Math.hypot(Math.max(0, Math.hypot(cam.position.x - t.cx, cam.position.z - t.cz) - TILE * 0.7), cam.position.y);
      const isNear = d < nearDist;
      t.near.visible = isNear; t.far.visible = !isNear;
    }
  }
  return { group: grp, update, count: list.length, list, setNear: d => nearDist = d };
}
