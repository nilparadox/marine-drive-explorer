// Land surface (clipped exactly to the coastline), parks/beach/pitches, sea wall, near-shore seabed.
import * as THREE from 'three';
import { U, COMMON, FINISH, mat } from './shade.js';
import { B, groundH, coastDist, seabedH, LAND_Y, MARGIN, polyBox, triUp } from './geo.js';

const TRI = (contour) => THREE.ShapeUtils.triangulateShape(contour, []);

// clip polygon (flat xz array) to an axis-aligned cell (Sutherland-Hodgman)
function clipCell(poly, x0, z0, x1, z1) {
  let p = poly;
  const planes = [[0, x0, 1], [0, x1, -1], [1, z0, 1], [1, z1, -1]];
  for (const [ax, v, s] of planes) {
    const o = [], n = p.length / 2; if (!n) return o;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, a0 = p[i * 2], a1 = p[i * 2 + 1], b0 = p[j * 2], b1 = p[j * 2 + 1];
      const ia = ((ax ? a1 : a0) - v) * s >= 0, ib = ((ax ? b1 : b0) - v) * s >= 0;
      if (ia) o.push(a0, a1);
      if (ia !== ib) { const t = (v - (ax ? a1 : a0)) / ((ax ? b1 : b0) - (ax ? a1 : a0)); o.push(a0 + (b0 - a0) * t, a1 + (b1 - a1) * t); }
    }
    p = o;
  }
  return p;
}

const GROUND_VS = /* glsl */`
attribute float aKind;
varying vec3 vP; varying vec3 vN; varying float vKind;
void main(){ vP = (modelMatrix*vec4(position,1.)).xyz; vN = normal; vKind = aKind;
  gl_Position = projectionMatrix * viewMatrix * vec4(vP,1.); }`;

// kinds: 0 urban ground, 1 grass/park, 2 garden, 3 pitch, 4 stadium, 5 beach, 6 wood, 7 water, 8 rail ballast, 9 parking,
// 10 playground, 11 pool, 12 construction, 13 cemetery, 14 track, 15 plaza, 16 maidan, 17 platform, 20 outside-city ground
const GROUND_FS = /* glsl */`
${COMMON}
uniform sampler2D uField; uniform vec4 uFieldInfo;
varying vec3 vP; varying vec3 vN; varying float vKind;
float coastD(vec2 p){ vec2 uv = (p - uFieldInfo.xy)/uFieldInfo.zw; return texture2D(uField, uv).r; }
vec3 grass(vec2 p, float lush){
  float n = fbm(p*.11), m = fbm(p*.9+3.1), f = vn(p*6.);
  vec3 dry = vec3(.36,.36,.17), green = vec3(.16,.30,.08), deep = vec3(.09,.2,.06);
  vec3 c = mix(dry, green, smoothstep(.25,.75, n*.7 + lush*.5));
  c = mix(c, deep, smoothstep(.55,.8,m)*.5);
  c *= .85 + .3*f;
  // worn earth patches
  c = mix(c, vec3(.42,.33,.22), smoothstep(.66,.8, fbm(p*.05+7.))*(1.-lush)*.8);
  return c;
}
void main(){
  vec2 p = vP.xz; float k = floor(vKind+.5);
  // bare ground inside the beach area (between the mapped beach outline and the waterline) is sand too
  if (k < .5 && texture2D(uField, (p - uFieldInfo.xy)/uFieldInfo.zw).g > .08 && vP.y < 2.4) k = 5.;
  vec3 N = normalize(vN);
  vec3 alb; float spec = .04, gloss = 20., ao = 1., lampPool = 0.;
  float dist = length(uCam - vP);
  float fine = 1. - smoothstep(60., 260., dist);
  float cdh = k < .5 ? coastD(p) : 99.;
  if (k < .5 && cdh < 24. && cdh > -1. && vP.y > 1.2) {   // sea-face promenade: big pale concrete tiles
    vec2 g = abs(fract(p/1.5)-.5);
    vec2 id = floor(p/1.5);
    alb = vec3(.60,.58,.54) * (.88 + .12*h21(id)) * (.92 + .1*fbm(p*.4));
    alb *= 1. - fine*.18*smoothstep(.46,.5,max(g.x,g.y));
    alb = mix(alb, vec3(.42,.40,.37), smoothstep(.62,.85,fbm(p*.12))*.35); // salt + footfall stains
    spec = .08; gloss = 30.;
    lampPool = 1.;
  } else if (k < .5 || k > 19.5) {           // compacted earth / old paving between buildings
    float n = fbm(p*.07), t = vn(p*1.3);
    alb = mix(vec3(.33,.32,.30), vec3(.27,.26,.24), n);
    alb = mix(alb, grass(p, .7)*.85, smoothstep(9., 20., vP.y) * smoothstep(.3, .6, fbm(p*.03)));   // Malabar Hill: vegetated slopes
    alb = mix(alb, vec3(.22,.24,.15), smoothstep(.62,.8,fbm(p*.04+2.))*.6); // weeds
    // paving joints
    vec2 g = abs(fract(p/vec2(1.2,.6))-.5);
    alb *= 1. - fine*.12*smoothstep(.46,.5,max(g.x,g.y));
    alb *= .9 + .2*t;
    if (k > 19.5) alb = mix(alb, vec3(.33,.31,.28), .5);
  } else if (k < 1.5 || k > 15.5 && k < 16.5) { // park grass, maidan
    alb = grass(p, k < 1.5 ? .6 : .25);
    if (k > 15.5) { // maidans: dusty with many cricket pitches
      vec2 q = p / vec2(22., 30.); vec2 id = floor(q); vec2 f = fract(q);
      float has = step(.45, h21(id));
      float pitch = has * step(abs(f.x-.5), .07) * step(abs(f.y-.5), .34);
      alb = mix(alb, vec3(.55,.45,.32), pitch*.9);
    }
  } else if (k < 2.5) { alb = grass(p, .85); alb *= .95;
  } else if (k < 3.5 || k < 4.5) {    // pitch / stadium field: mown outfield, worn patches, clay strips
    alb = grass(p, k > 3.5 ? .9 : .5);
    float stripe = step(.5, fract(dot(p, vec2(.7071,.7071))/9.));
    alb *= .94 + .08*stripe;
    alb = mix(alb, vec3(.47,.40,.28), smoothstep(.6,.8,fbm(p*.05+3.))*.55);
    vec2 q = p / vec2(26., 34.); vec2 f = fract(q);
    alb = mix(alb, vec3(.56,.46,.33), step(abs(f.x-.5), .055) * step(abs(f.y-.5), .3) * step(.4, h21(floor(q))));
  } else if (k < 5.5) {               // beach sand, wetter near the water
    float cd = coastD(p);
    vec3 dry = vec3(.53,.49,.42), wet = vec3(.30,.27,.23);
    float rip = vn(vec2(dot(p,vec2(.8,.6))*1.6, dot(p,vec2(-.6,.8))*.25));
    alb = mix(wet, dry, smoothstep(2., 26., cd + rip*3.));
    alb *= .92 + .14*fbm(p*.6) + fine*.06*rip;
    spec = mix(.5, .02, smoothstep(2., 14., cd)); gloss = 60.;
    // footprints / scuffs
    alb *= 1. - fine*.08*smoothstep(.6,.9,vn(p*3.1));
  } else if (k < 6.5) { alb = mix(vec3(.10,.17,.07), vec3(.20,.22,.12), fbm(p*.2)); // woodland floor
  } else if (k < 7.5 || (k > 10.5 && k < 11.5)) { // pond / pool
    vec3 V = normalize(uCam - vP);
    alb = k > 10.5 ? vec3(.12,.45,.55) : vec3(.10,.16,.12);
    spec = .9; gloss = 200.;
    N = normalize(vec3(sin(p.x*3.+uTime)*.02, 1., cos(p.y*3.1+uTime*1.3)*.02));
  } else if (k < 8.5) {               // railway ballast
    alb = vec3(.30,.27,.24) * (.75 + .5*vn(p*4.)) ;
    alb = mix(alb, vec3(.36,.25,.17), .3*fbm(p*.3));
  } else if (k < 9.5) {               // parking: asphalt
    alb = vec3(.16,.16,.17) * (.85+.3*vn(p*3.));
    vec2 g = abs(fract(p/vec2(2.6,5.))-.5);
    alb = mix(alb, vec3(.7), fine*.6*step(.47, g.x)*step(g.y,.42));
  } else if (k < 10.5) { alb = vec3(.55,.44,.32)*(.85+.3*vn(p*2.)); // playground sand
  } else if (k < 12.5) { alb = vec3(.45,.36,.26)*(.8+.4*fbm(p*.5)); // construction dirt
  } else if (k < 13.5) { alb = grass(p, .4)*.9;
  } else if (k < 14.5) { alb = vec3(.50,.20,.12)*(.85+.3*vn(p*2.)); // cinder track
    float lane = smoothstep(.04, .0, abs(fract(length(p - floor(p/200.)*200.)/1.22) - .5) - .46);
  } else if (k < 15.5) {               // plaza paving (stone)
    vec2 g = abs(fract(p/vec2(.9,.9))-.5);
    alb = vec3(.55,.52,.47)*(.85+.25*vn(floor(p/.9)*13.));
    alb *= 1. - fine*.15*smoothstep(.45,.5,max(g.x,g.y));
  } else { alb = vec3(.45,.44,.42); } // platform concrete
  float sh = shadowAt(vP, N);
  vec3 c = shade(alb, N, vP, sh, ao, spec, gloss);
  // promenade under the Queen's Necklace lamps (pools every ~30 m along the sea face)
  if (lampPool > .5) { float pool = .35 + .65*pow(.5 + .5*sin((p.x*.6 + p.y*.8)*.2094), 3.); c += uNight * vec3(1.,.62,.26) * alb * pool * 1.1; }
  gl_FragColor = vec4(haze(c, vP), 1.);
  ${FINISH}
}`;

export function buildGround(L, scene) {
  const out = new THREE.Group();
  const groundMat = mat({ vs: GROUND_VS, fs: GROUND_FS, uniforms: {}, po: [1, 1] });
  // ---- land grid clipped to the land polygon(s)
  const pos = [], kind = [], idx = [];
  const S = 16;
  const land = L.land;
  const boxes = land.map(polyBox);
  const x0 = B.x0, z0 = B.z0, nx = Math.ceil((B.x1 - B.x0) / S), nz = Math.ceil((B.z1 - B.z0) / S);
  const vmap = new Map();
  const vtx = (x, z, k) => {
    const key = Math.round(x * 20) + ',' + Math.round(z * 20);
    let i = vmap.get(key); if (i !== undefined) return i;
    i = pos.length / 3; pos.push(x, groundH(x, z), z); kind.push(k); vmap.set(key, i); return i;
  };
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const cx0 = x0 + i * S, cz0 = z0 + j * S, cx1 = Math.min(B.x1, cx0 + S), cz1 = Math.min(B.z1, cz0 + S);
    const c = coastDist((cx0 + cx1) / 2, (cz0 + cz1) / 2);
    if (c > S) { // fully land
      const a = vtx(cx0, cz0, 0), b = vtx(cx1, cz0, 0), cc = vtx(cx1, cz1, 0), d = vtx(cx0, cz1, 0);
      idx.push(a, d, b, b, d, cc);
    } else if (c > -S * 1.5) { // boundary: clip each land polygon to this cell
      for (let r = 0; r < land.length; r++) {
        const bb = boxes[r]; if (bb[2] < cx0 || bb[0] > cx1 || bb[3] < cz0 || bb[1] > cz1) continue;
        const p = clipCell(land[r], cx0, cz0, cx1, cz1); if (p.length < 6) continue;
        const contour = []; for (let q = 0; q < p.length; q += 2) contour.push(new THREE.Vector2(p[q], p[q + 1]));
        const tris = TRI(contour);
        const ids = contour.map(v => vtx(v.x, v.y, 0));
        for (const t of tris) triUp(idx, pos, ids[t[0]], ids[t[1]], ids[t[2]]);
      }
    }
  }
  // ---- ground beyond the mapped box (the city continues): coarse flat land wherever the field says land
  const S2 = 48;
  for (let z = B.z0 - MARGIN; z < B.z1 + MARGIN; z += S2) for (let x = B.x0 - MARGIN; x < B.x1 + MARGIN; x += S2) {
    const cx = x + S2 / 2, cz = z + S2 / 2;
    if (cx > B.x0 && cx < B.x1 && cz > B.z0 && cz < B.z1) continue;
    if (coastDist(cx, cz) < -S2) continue;
    const base = pos.length / 3;
    for (const [px, pz] of [[x, z], [x + S2, z], [x + S2, z + S2], [x, z + S2]]) {
      const inside = px > B.x0 && px < B.x1 && pz > B.z0 && pz < B.z1;
      pos.push(px, inside ? groundH(px, pz) : Math.max(-3, Math.min(LAND_Y, coastDist(px, pz) * 0.3 + LAND_Y)) - 0.05, pz); kind.push(20);
    }
    idx.push(base, base + 3, base + 1, base + 1, base + 3, base + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aKind', new THREE.Float32BufferAttribute(kind, 1));
  g.setIndex(idx); g.computeVertexNormals();
  const landMesh = new THREE.Mesh(g, groundMat); landMesh.name = 'land';
  landMesh.userData.receive = true;
  out.add(landMesh);

  // ---- area overlays (parks, beach, pitches...) draped on the terrain
  const ap = [], ak = [], ai = [];
  // overlays are cut into the same 16 m grid as the land so they hug the terrain
  for (const a of L.areas) {
    const p = a.pts; if (p.length < 6) continue;
    const [bx0, bz0, bx1, bz1] = polyBox(p);
    const lift = a.k === 5 ? 0.03 : 0.06;
    const amap = new Map();
    const av = (x, z) => {
      const key = Math.round(x * 20) + ',' + Math.round(z * 20);
      let i = amap.get(key); if (i !== undefined) return i;
      i = ap.length / 3; ap.push(x, Math.max(a.k === 5 ? -1.5 : 0, groundH(x, z)) + lift, z); ak.push(a.k); amap.set(key, i); return i;
    };
    for (let cz = Math.floor((bz0 - z0) / S) * S + z0; cz < bz1; cz += S) for (let cx = Math.floor((bx0 - x0) / S) * S + x0; cx < bx1; cx += S) {
      const q = clipCell(p, cx, cz, cx + S, cz + S); if (q.length < 6) continue;
      const contour = []; for (let k = 0; k < q.length; k += 2) contour.push(new THREE.Vector2(q[k], q[k + 1]));
      let tris; try { tris = TRI(contour); } catch (e) { continue; }
      const ids = contour.map(v => av(v.x, v.y));
      for (const t of tris) triUp(ai, ap, ids[t[0]], ids[t[1]], ids[t[2]]);
    }
  }
  const ag = new THREE.BufferGeometry();
  ag.setAttribute('position', new THREE.Float32BufferAttribute(ap, 3));
  ag.setAttribute('aKind', new THREE.Float32BufferAttribute(ak, 1));
  ag.setIndex(ai); ag.computeVertexNormals();
  const areaMat = mat({ vs: GROUND_VS, fs: GROUND_FS, po: [-1, -2] });
  const areaMesh = new THREE.Mesh(ag, areaMat); areaMesh.name = 'areas'; areaMesh.userData.receive = true;
  out.add(areaMesh);

  out.add(buildSeaWall(L));
  out.add(buildSeabed());
  scene.add(out);
  return out;
}

// vertical wall + capping along the coastline (the stone/concrete sea wall of Marine Drive and the harbour)
const WALL_VS = /* glsl */`
varying vec3 vP; varying vec3 vN; varying vec2 vUv;
void main(){ vP = position; vN = normal; vUv = uv; gl_Position = projectionMatrix*viewMatrix*vec4(position,1.); }`;
const WALL_FS = /* glsl */`
${COMMON}
varying vec3 vP; varying vec3 vN; varying vec2 vUv;
void main(){
  vec2 b = vec2(vUv.x/1.4, vP.y/0.7);
  float row = floor(b.y); b.x += mod(row, 2.)*.5;
  vec2 f = abs(fract(b)-.5);
  vec3 alb = mix(vec3(.42,.40,.36), vec3(.34,.33,.31), h21(floor(b)));
  alb *= 1. - .25*smoothstep(.44,.5,max(f.x*1.,f.y));
  // wet / algae band near the water line
  float wet = smoothstep(1.6, -.2, vP.y + sin(vUv.x*.3+uTime*.6)*.15);
  alb = mix(alb, vec3(.12,.14,.10), wet*.85);
  vec3 N = normalize(vN);
  float sh = shadowAt(vP, N);
  vec3 c = shade(alb, N, vP, sh, 1., .1 + wet*.5, 40.);
  gl_FragColor = vec4(haze(c, vP), 1.);
  ${FINISH}
}`;
function buildSeaWall(L) {
  const pos = [], nor = [], uv = [], idx = [];
  const e = 0.5;
  for (const r of L.land) {
    const n = r.length / 2; let u = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = r[i * 2], az = r[i * 2 + 1], bx = r[j * 2], bz = r[j * 2 + 1];
      // skip bbox edges (not coast)
      const onEdge = (x, z) => Math.abs(x - B.x0) < e || Math.abs(x - B.x1) < e || Math.abs(z - B.z0) < e || Math.abs(z - B.z1) < e;
      const len = Math.hypot(bx - ax, bz - az);
      if (onEdge(ax, az) && onEdge(bx, bz)) { u += len; continue; }
      const segs = Math.max(1, Math.ceil(len / 6));
      // outward normal (sea side): land ring is CCW in north-up view => right-hand side in x/z is the sea
      let nx = bz - az, nz = -(bx - ax); const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
      // which side is sea? test
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      if (coastDist(mx + nx * 6, mz + nz * 6) > coastDist(mx - nx * 6, mz - nz * 6)) { nx = -nx; nz = -nz; }
      for (let s = 0; s < segs; s++) {
        const t0 = s / segs, t1 = (s + 1) / segs;
        const x0 = ax + (bx - ax) * t0, z0 = az + (bz - az) * t0, x1 = ax + (bx - ax) * t1, z1 = az + (bz - az) * t1;
        const y0 = groundH(x0 - nx * 0.6, z0 - nz * 0.6), y1 = groundH(x1 - nx * 0.6, z1 - nz * 0.6);
        if (y0 < 0.8 && y1 < 0.8) continue; // beach: no wall
        const base = pos.length / 3, bot = -4;
        pos.push(x0, y0, z0, x1, y1, z1, x1, bot, z1, x0, bot, z0);
        for (let q = 0; q < 4; q++) nor.push(nx, 0, nz);
        const ua = u + len * t0, ub = u + len * t1;
        uv.push(ua, 0, ub, 0, ub, 1, ua, 1);
        idx.push(base, base + 3, base + 1, base + 1, base + 3, base + 2);
      }
      u += len;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  const m = mat({ vs: WALL_VS, fs: WALL_FS, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(g, m); mesh.name = 'seawall'; mesh.userData.receive = true;
  return mesh;
}

// seabed strip near the shore (seen through shallow water and at the beach)
const BED_FS = /* glsl */`
${COMMON}
varying vec3 vP; varying vec3 vN; varying vec2 vUv;
void main(){
  vec3 alb = mix(vec3(.30,.26,.19), vec3(.20,.19,.15), fbm(vP.xz*.08));
  vec3 c = shade(alb, normalize(vN), vP, 1., 1., .05, 20.);
  gl_FragColor = vec4(haze(c, vP), 1.);
  ${FINISH}
}`;
function buildSeabed() {
  const S = 10, pos = [], idx = [];
  const map = new Map();
  const v = (i, j) => { const k = i * 100000 + j; let q = map.get(k); if (q !== undefined) return q; q = pos.length / 3; const x = B.x0 - 400 + i * S, z = B.z0 - 400 + j * S; const cd = coastDist(x, z); pos.push(x, cd > 0 ? Math.min(groundH(x, z), 1.2) - 0.4 : seabedH(x, z, cd), z); map.set(k, q); return q; };
  const nx = Math.ceil((B.x1 - B.x0 + 800) / S), nz = Math.ceil((B.z1 - B.z0 + 800) / S);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const cx = B.x0 - 400 + (i + 0.5) * S, cz = B.z0 - 400 + (j + 0.5) * S;
    const cd = coastDist(cx, cz); if (cd > 12 || cd < -140) continue;
    idx.push(v(i, j), v(i, j + 1), v(i + 1, j), v(i + 1, j), v(i, j + 1), v(i + 1, j + 1));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3 * 2), 2));
  g.setIndex(idx); g.computeVertexNormals();
  const m = mat({ vs: WALL_VS, fs: BED_FS });
  const mesh = new THREE.Mesh(g, m); mesh.name = 'seabed';
  return mesh;
}
