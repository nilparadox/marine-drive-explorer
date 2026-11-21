// Buildings: real footprints extruded; heights and styles by neighbourhood; facades drawn in a shader.
import * as THREE from 'three';
import { COMMON, FINISH, mat } from './shade.js';
import { groundH, hillH, polyArea, polyBox, rng, Grid, coastDist, triUp } from './geo.js';

// styles
export const ST = { DECO: 0, GOTHIC: 1, GLASS: 2, TOWER: 3, CHAWL: 4, BUNGALOW: 5, SHRINE: 6, SHED: 7, PLAIN: 8 };

const VS = /* glsl */`
attribute vec4 aFac; attribute vec4 aB;
varying vec3 vP; varying vec3 vN; varying vec4 vFac; varying vec4 vB;
void main(){ vP = position; vN = normal; vFac = aFac; vB = aB; gl_Position = projectionMatrix*viewMatrix*vec4(position,1.); }`;

// aFac: x = metres along this wall edge, y = metres above base, z = edge length, w = building height (walls) / roof kind
// aB:   x = style, y = seed 0..1, z = floor height, w = flags (1 shops at street level, 2 hero detail, 4 roof surface)
const FS = /* glsl */`
${COMMON}
varying vec3 vP; varying vec3 vN; varying vec4 vFac; varying vec4 vB;
uniform sampler2D uSigns;

vec3 pal0(float s, float k);
vec3 pal(float s, float k){ return pal0(s, k) * .84; }
vec3 pal0(float s, float k){
  // facade colour per style
  if (s < .5) { // art deco pastels
    vec3 a[6]; a[0]=vec3(.86,.77,.58); a[1]=vec3(.84,.56,.42); a[2]=vec3(.80,.62,.30); a[3]=vec3(.64,.77,.66); a[4]=vec3(.84,.62,.57); a[5]=vec3(.62,.68,.70);
    int i = int(floor(k*5.99)); vec3 c = a[0]; for(int j=0;j<6;j++) if (j==i) c = a[j]; return c; }
  if (s < 1.5) return mix(vec3(.66,.57,.42), vec3(.58,.52,.44), k);           // buff basalt / Kurla stone
  if (s < 2.5) return mix(vec3(.20,.27,.32), vec3(.30,.34,.36), k);           // glass towers (spandrel tone)
  if (s < 3.5) { vec3 a[8]; a[0]=vec3(.80,.76,.68); a[1]=vec3(.74,.68,.58); a[2]=vec3(.68,.68,.66); a[3]=vec3(.82,.72,.62); a[4]=vec3(.64,.62,.58);
    a[5]=vec3(.70,.72,.74); a[6]=vec3(.78,.74,.62); a[7]=vec3(.72,.62,.56);
    int i = int(floor(k*7.99)); vec3 c = a[0]; for(int j=0;j<8;j++) if (j==i) c = a[j]; return c; }
  if (s < 4.5) { vec3 a[6]; a[0]=vec3(.62,.70,.74); a[1]=vec3(.78,.70,.46); a[2]=vec3(.60,.70,.56); a[3]=vec3(.74,.60,.52); a[4]=vec3(.70,.68,.64); a[5]=vec3(.56,.62,.70);
    int i = int(floor(k*5.99)); vec3 c = a[0]; for(int j=0;j<6;j++) if (j==i) c = a[j]; return c*.88; }
  if (s < 5.5) return mix(vec3(.88,.86,.80), vec3(.84,.80,.70), k);
  if (s < 6.5) return mix(vec3(.90,.88,.82), vec3(.86,.78,.60), k);
  if (s < 7.5) return mix(vec3(.45,.47,.48), vec3(.40,.44,.50), k);
  return mix(vec3(.70,.67,.62), vec3(.62,.60,.56), k);
}

vec3 lc_far(float seed, float fl, float ci){
  return vec3(1.,.74,.45) * (.15 + .6*h11(seed*3.)) * step(.25, h11(seed*5.7));
}
void main(){
  float style = vB.x, seed = vB.y, fh = vB.z, flags = vB.w;
  vec3 N = normalize(vN);
  if (dot(N, uCam - vP) < 0.) N = -N;
  float dist = length(uCam - vP);
  float fine = 1. - smoothstep(120., 700., dist);
  float far = smoothstep(500., 1800., dist);
  vec3 alb; float spec = .03, gloss = 16., ao = 1.;
  vec3 emit = vec3(0.);
  bool roof = mod(floor(flags/4.),2.) > .5;
  if (roof) {
    float rk = vFac.w; // 0 flat, 1 tiled
    if (rk > .5) { // Mangalore tile roof
      vec2 q = vec2(vFac.x/.32, vFac.y/.42);
      float row = floor(q.y);
      alb = mix(vec3(.52,.24,.15), vec3(.40,.20,.14), h21(vec2(floor(q.x+mod(row,2.)*.5), row)));
      alb *= .8 + .2*smoothstep(0.,.5,fract(q.y)) * (1. - fine*.0);
      alb *= .75 + .35*fbm(vP.xz*.3 + seed*7.);
      alb = mix(alb, vec3(.18,.17,.15), smoothstep(.55,.85,fbm(vP.xz*.12+seed*3.))*.6); // moss and soot
    } else {       // flat terrace: waterproofing, china mosaic, stains
      float n = fbm(vP.xz*.35 + seed*11.);
      alb = mix(vec3(.46,.44,.41), vec3(.62,.60,.56), n);
      if (h11(seed*31.) > .78) { // white china-mosaic terrace
        vec2 g = abs(fract(vP.xz/.25)-.5);
        alb = mix(vec3(.80,.80,.78), vec3(.70,.72,.72), h21(floor(vP.xz/.25)));
        alb *= 1. - .12*fine*smoothstep(.4,.5,max(g.x,g.y));
      }
      alb = mix(alb, vec3(.18,.17,.16), smoothstep(.6,.8,fbm(vP.xz*.08+seed*5.))*.55);
      if (h11(seed*17.) > .82) alb = mix(alb, vec3(.12,.28,.62), smoothstep(.55,.6, fbm(vP.xz*.2+seed))); // blue monsoon tarps
    }
  } else {
    float u = vFac.x, v = vFac.y, el = vFac.z, H = vFac.w;
    vec3 wall = pal(style, h11(seed*13.7));
    // repainted patches / floor-to-floor tone drift
    float gH = mod(flags,2.) > .5 ? max(fh*1.25, 4.) : fh;          // taller ground floor with shops
    float fy = v < gH ? v/gH : (v - gH)/fh;
    float fl = v < gH ? 0. : floor(fy) + 1.;
    float fr = v < gH ? fy : fract(fy);
    wall *= .94 + .1*h11(fl*3.7 + seed*21. + floor(u/9.)*.3*step(3.5, style)*step(style, 4.5));
    float cw = style < .5 ? 3.4 : style < 1.5 ? 2.6 : style < 2.5 ? 1.5 : style < 3.5 ? 3.0 : style < 4.5 ? 2.4 : 3.2;
    cw *= .9 + .3*h11(seed*5.3);
    float nc = max(1., floor(el / cw));
    float cu = u / el * nc; float ci = floor(cu); float cf = fract(cu);
    // how many pixels one window cell covers: fade detail to an average when tiny (no shimmer)
    float px = max(fwidth(cu), fwidth(v/fh));
    float aa = 1. - smoothstep(.18, .5, px);
    float edgeSmall = step(el, 2.2);
    float top = H - .9;
    float isTop = step(top, v);
    float ww = style < 1.5 ? .46 : style < 2.5 ? .92 : style < 3.5 ? .56 : .5;
    float wy0 = .26, wy1 = style < 1.5 ? .86 : .80;
    if (style < .5) { ww = .62; wy0 = .30; wy1 = .78; }
    float wx = (cf - .5) / (ww*.5);                 // -1..1 across the opening
    float wyv = (fr - wy0) / (wy1 - wy0);           // 0..1 up the opening
    float inW = step(abs(wx), 1.) * step(0., wyv) * step(wyv, 1.) * (1. - isTop) * (1. - edgeSmall);
    if (v < gH && mod(flags,2.) < .5) inW *= step(.5, h11(ci + seed*91.));
    bool gothicArch = style > .5 && style < 1.5;
    if (gothicArch) { float ah = (wyv - .82)/.18; inW *= step(ah, 1. - wx*wx*1.1); }
    // frame + sill + lintel around the opening (a little proud of the wall)
    float frameW = .08 / max(ww*cw*.5, .3);
    float inF = step(abs(wx), 1. + frameW) * step(-.06, wyv) * step(wyv, 1.04) * (1. - isTop) * (1. - edgeSmall) * (1. - inW);
    if (v < gH && mod(flags,2.) < .5) inF *= step(.5, h11(ci + seed*91.));
    float sill = step(abs(wx), 1.25) * step(-.1, wyv) * step(wyv, -.02) * (1. - isTop) * (1. - edgeSmall);
    // split AC units hung beside some windows (a very Mumbai detail)
    float acOn = step(.62, h11(ci*7.7 + fl*3.1 + seed*44.)) * step(.5, style) * step(style, 4.5) * step(1., fl);
    float acx = cf - (.5 + ww*.5 + .09);
    float ac = acOn * step(abs(acx), .075) * step(abs(fr - .42), .09) * (1. - inW);
    vec3 alb2; float spec2 = .03, gloss2 = 16., ao2 = 1.;
    float lit = 0.;
    if (inW > .5) {
      vec3 V = normalize(uCam - vP);
      vec3 R = reflect(-V, N);
      float fres = .2 + .8*pow(1. - max(dot(N, V), 0.), 4.);
      vec3 refl = skyAmb(R) * 1.15;
      float cid = ci*7.1 + fl*3.3 + seed*50.;
      vec3 room = mix(vec3(.04,.04,.05), vec3(.14,.12,.10), h11(cid));
      float curtain = step(.55, h11(ci*1.7 + fl*9.1 + seed*20.));
      room = mix(room, mix(vec3(.55,.45,.30), vec3(.35,.40,.50), h11(ci+fl+seed)), curtain*.55);
      // the recess: the top of the opening is shaded by the lintel/chajja, sides darker
      float recess = smoothstep(.75, 1., wyv) * .5 + smoothstep(.8, 1., abs(wx)) * .3;
      // panes: mullion + transom for older styles
      float pane = 0.;
      if (style > 2.5) { pane = step(abs(wx), .04) + step(abs(wyv - .62), .025); }
      if (gothicArch || style < .5) pane = step(abs(fract(wx*1.5+.5)-.5), .05) + step(abs(wyv - .7), .03);
      alb2 = mix(room, refl*.55, fres*(style > 1.5 && style < 2.5 ? 1. : .6));
      alb2 *= 1. - recess*.6;
      alb2 = mix(alb2, wall*.55, clamp(pane,0.,1.)*.8);
      if (style > 3.5 && style < 4.5) alb2 *= 1. - .5*step(.8, fract(wx*3. + .5)); // grille bars
      spec2 = style > 1.5 && style < 2.5 ? .9 : .5; gloss2 = 120.;
      float on = step(1. - (.22 + .24*h11(seed*2.)), h11(ci*3.1 + fl*17.3 + seed*77.));
      float warm = h11(ci*5. + fl*2. + seed*9.);
      vec3 lc = mix(vec3(.95,.97,1.), vec3(1.,.68,.38), step(.35, warm));
      if (warm > .9) lc = vec3(.45,.6,1.);
      if (warm < .12) lc = vec3(1.,.85,.6);
      lit = on * uNight;
      emit = lc * lit * (.45 + .4*h11(ci*11.+fl)) * (1. - curtain*.45) * (1. - recess*.5) * aa;
      ao2 = .75;
    } else {
      alb2 = wall;
      float n = fbm(vP.xz*.5 + vec2(v*.2, seed*9.));
      alb2 *= .9 + .16*n;
      float sunUp = clamp(uSunDir.y*2.5, 0., 1.);
      // chajja (sunshade) band above each window row, with the shadow it throws
      float chajja = step(abs(fr - (wy1 + .05)), .03) * step(abs(wx), 1.35) * (1. - isTop);
      float chShadow = step(wy1 - .1*sunUp - .02, fr) * step(fr, wy1) * step(abs(wx), 1.2) * (1. - isTop);
      if (style < .5) { // art deco: continuous eyebrow bands + rounded vertical fins
        float band = smoothstep(.05,.0,abs(fr - .88));
        alb2 = mix(alb2, alb2*1.14, band);
        alb2 *= 1. - .22*step(.82, fr)*step(fr, .86)*sunUp;
        float fin = step(abs(u - 1.2), .25) + step(abs(el - u - 1.2), .25);
        alb2 = mix(alb2, alb2*1.12, clamp(fin,0.,1.)*(1.-isTop));
        float mid = step(abs(u - el*.5), 1.1) * step(.5, el/14.);
        alb2 = mix(alb2, alb2*.9 + vec3(.05), mid);
        vec3 accentD = mix(vec3(.55,.33,.22), vec3(.30,.45,.42), step(.5, h11(seed*9.1)));
        alb2 = mix(alb2, accentD, step(H - 1.6, v) * step(v, H - 1.1));   // contrasting band under the parapet
      } else if (style > 2.5 && style < 4.5 || style > 7.5) {
        alb2 = mix(alb2, alb2*1.12, chajja);
        alb2 *= 1. - .35*chShadow;
      } else if (gothicArch) {
        alb2 = mix(alb2, vec3(.46,.43,.40), smoothstep(.06,.0,abs(fr-.04))*.8);
        alb2 = mix(alb2, vec3(.33,.34,.36), step(v, 1.2));
        // rubble-stone texture of Kurla basalt
        vec2 st = vec2(u/.6, v/.32); st.x += mod(floor(st.y),2.)*.5;
        alb2 *= .92 + .14*h21(floor(st)) - .1*smoothstep(.42,.5,max(abs(fract(st.x)-.5),abs(fract(st.y)-.5)))*aa;
      }
      if (style > 1.5 && style < 2.5) {
        float mul = step(.92, abs(cf-.5)*2.);
        alb2 = mix(alb2, vec3(.55,.57,.58), mul);
        spec2 = .4; gloss2 = 80.;
      }
      // residential towers: slab edge at every floor, accent fins, stilt parking, balconies
      if (style > 2.5 && style < 3.5) {
        alb2 = mix(alb2, alb2*1.1 + vec3(.03), step(fr, .07) * step(1., fl));
        float accent = step(.6, h11(seed*8.3));
        vec3 acc = mix(vec3(.45,.18,.14), vec3(.25,.33,.45), step(.5, h11(seed*4.1)));
        alb2 = mix(alb2, acc, accent * step(abs(u - el*.5), .5) * step(.5, el/10.) * (1. - isTop));
        if (v < gH && mod(flags,2.) < .5) { // stilt parking: dark open floor with columns
          float col = step(.88, fract(u/5.5));
          alb2 = mix(vec3(.07,.07,.075), alb2*.9, col);
          alb2 *= .7 + .3*smoothstep(0., gH, v);
        }
        float bay = floor(u / 7.);
        float hasB = step(.5, h11(bay*3.3 + seed*61.));
        float bal = hasB * step(fract(u/7.), .55) * (1. - isTop) * step(1., fl);
        float rail = bal * step(fr, .3) * step(.02, fr);
        alb2 = mix(alb2, alb2*.75, bal*step(.3, fr)*.5);
        alb2 = mix(alb2, vec3(.75,.76,.76)*.8, rail*(.5 + .5*step(.5, fract(u*5.))));
      }
      // frame, sill, AC units
      alb2 = mix(alb2, mix(wall*1.12, vec3(.85,.84,.80), .3), inF);
      alb2 = mix(alb2, wall*1.2, sill);
      alb2 *= 1. - .3*sill*0.;
      alb2 = mix(alb2, vec3(.80,.80,.78)*(.85 + .3*step(.5, fract(fr*60.))), ac);
      alb2 = mix(alb2, alb2*.82, isTop*smoothstep(H-.1, H, v));
      // shop shutters / signboards at street level
      if (mod(flags,2.) > .5 && v < gH) {
        float bay = fract(u/4.2), bi = floor(u/4.2);
        float shp = step(.06, bay) * step(bay, .94) * step(v, gH*.72);
        vec3 shutter = vec3(.42,.44,.46) * (.8 + .2*step(.5, fract(v*6.)));
        float open = step(.45, h11(bi*3.7 + seed*40.)) * (1. - uNight*.5);
        vec3 shop = mix(vec3(.12,.10,.08), vec3(.6,.5,.35), h11(bi+seed));
        alb2 = mix(alb2, mix(shutter, shop, open), shp);
        float sign = step(gH*.74, v) * step(v, gH*.96) * step(.03, bay) * step(bay, .97);
        // painted boards from the sign atlas (8 x 4 boards)
        float idx = floor(h11(bi*7.13 + seed*31.) * 32.);
        vec2 suv = vec2(1. - (bay - .03) / .94, (v - gH*.74) / (gH*.22));
        vec2 auv = vec2((mod(idx, 4.) + suv.x) / 4., 1. - (floor(idx / 4.) + 1. - suv.y) / 8.);
        vec3 sc = texture2D(uSigns, auv).rgb;
        sc = sc * sc;  // sRGB-ish board colours to linear albedo
        alb2 = mix(alb2, sc, sign);
        emit += sc * sign * uNight * .9 * step(.3, h11(bi*5.+seed));
        emit += vec3(1.,.8,.55) * open * shp * uNight * .8;
      }
      // monsoon grime: dark streaks from ledges, heavier on older buildings and near the base
      float age = style > 3.5 && style < 4.5 ? 1. : style < .5 ? .55 : gothicArch ? .6 : style > 7.5 ? .7 : .35;
      float streak = fbm(vec2(u*1.3 + seed*30., v*.06)) * smoothstep(1., 0., fr*.6 + .2);
      float grime = smoothstep(.45, .85, streak) * age;
      grime += smoothstep(2.5, 0., v) * .25;
      alb2 *= 1. - .5*clamp(grime, 0., 1.);
      ao2 *= .55 + .45*smoothstep(0., 3., v);
    }
    // distance: columns are too small to draw, but floors still read as window bands with lit stretches
    float glassFrac = ww * (wy1 - wy0) * (1. - edgeSmall);
    float aaF = 1. - smoothstep(.2, .55, fwidth(v/fh));
    float bandW = smoothstep(wy0 - .05, wy0 + .05, fr) * smoothstep(wy1 + .05, wy1 - .05, fr) * (1. - isTop) * (1. - edgeSmall);
    vec3 glassC = vec3(.10,.11,.13) + skyAmb(reflect(-normalize(uCam - vP), N))*.3;
    vec3 avg = mix(wall * .85, glassC, mix(glassFrac * .8, bandW * ww * .9, aaF));
    float seg = h11(floor(u / 6.) * 3.1 + fl * 7.7 + seed * 13.);
    emit += vec3(1.,.78,.5) * uNight * (1. - aa) * aaF * bandW * step(.62, seg) * (.5 + .6*h11(seg*9.));
    alb = mix(avg, alb2, aa);
    spec = mix(.15, spec2, aa); gloss = mix(40., gloss2, aa); ao = mix(.9, ao2, aa);
    emit += lc_far(seed, fl, ci) * uNight * (1. - aa) * (1. - aaF) * glassFrac * 2.6;
  }
  #ifdef FILLER
    alb *= .5; emit *= .55;
  #endif
  float sh = shadowAt(vP, N);
  vec3 c = shade(alb, N, vP, sh, ao, spec, gloss) + emit;
  gl_FragColor = vec4(haze(c, vP), 1.);
  ${FINISH}
}`;

function obb(p) { // min-area rectangle among edge directions
  let best = null;
  for (let i = 0; i < p.length; i += 2) {
    const j = (i + 2) % p.length; let dx = p[j] - p[i], dz = p[j + 1] - p[i + 1]; const l = Math.hypot(dx, dz); if (l < 1) continue; dx /= l; dz /= l;
    let a0 = 1e9, a1 = -1e9, b0 = 1e9, b1 = -1e9;
    for (let k = 0; k < p.length; k += 2) { const a = p[k] * dx + p[k + 1] * dz, b = -p[k] * dz + p[k + 1] * dx; a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b); }
    const A = (a1 - a0) * (b1 - b0);
    if (!best || A < best.A) best = { A, dx, dz, a0, a1, b0, b1 };
  }
  return best;
}

export function classify(L) {
  // Marine Drive polyline points for the art deco belt
  const md = [];
  for (const r of L.roads) if (/Marine Drive|Netaji Subhash/i.test(r.name)) for (let i = 0; i < r.pts.length; i += 2) md.push(r.pts[i], r.pts[i + 1]);
  const ovalCx = 990, ovalCz = 560; // Oval Maidan centre (approx, from data)
  const mdDist = (x, z) => { let d = 1e9; for (let i = 0; i < md.length; i += 2) d = Math.min(d, Math.hypot(x - md[i], z - md[i + 1])); return d; };
  return { mdDist, ovalCx, ovalCz };
}

export function buildBuildings(L, scene, opts = {}) {
  const C = classify(L);
  const TILE = 400;
  const tiles = new Map();
  const grid = new Grid(25);
  const roofSpots = [];   // for water tanks / lift rooms {x,z,y,r,style}
  const meta = [];
  const R = rng(1234);
  const getT = (x, z) => { const k = Math.floor(x / TILE) + ',' + Math.floor(z / TILE); let t = tiles.get(k); if (!t) tiles.set(k, t = { pos: [], nor: [], fac: [], b: [], idx: [] }); return t; };

  for (const b of L.buildings) {
    let p = b.pts, n = p.length / 2;
    const A = Math.abs(polyArea(p));
    let cx = 0, cz = 0; for (let i = 0; i < p.length; i += 2) { cx += p[i]; cz += p[i + 1]; } cx /= n; cz /= n;
    const seed = R();
    const r2 = R(), r3 = R();
    // ---- neighbourhood rules
    const hill = hillH(cx, cz);
    const dMD = C.mdDist(cx, cz);
    let style = ST.PLAIN, floors = 0, fh = 3.1;
    const zone =
      hill > 10 || (cx < -900 && cz < -200) ? 'malabar' :
      cz > 1500 && cx < 1100 ? 'nariman' :
      dMD < 300 && cz > -1300 && cz < 1500 ? 'deco' :
      cx > 1050 && cz > -400 ? 'fort' :
      cz < -300 ? 'girgaon' : 'mixed';
    switch (zone) {
      case 'malabar':
        if (A > 420) { style = ST.TOWER; floors = 12 + Math.floor(r2 * r2 * 26); }
        else if (A > 180) { style = r3 < 0.5 ? ST.TOWER : ST.PLAIN; floors = 4 + Math.floor(r2 * 6); }
        else { style = ST.BUNGALOW; floors = 2 + Math.floor(r2 * 2); }
        break;
      case 'nariman':
        if (A > 900) { style = r3 < 0.55 ? ST.GLASS : ST.TOWER; floors = 14 + Math.floor(r2 * 14); }
        else if (A > 300) { style = ST.TOWER; floors = 6 + Math.floor(r2 * 8); }
        else { style = ST.PLAIN; floors = 3 + Math.floor(r2 * 3); }
        break;
      case 'deco':
        style = ST.DECO; floors = A > 1400 ? 6 + Math.floor(r2 * 3) : 5 + Math.floor(r2 * 2); fh = 3.3;
        if (A < 120) { style = ST.PLAIN; floors = 2; }
        break;
      case 'fort':
        if (cx > 1290 && cx < 1520 && cz > 850 && cz < 1450) { style = ST.GOTHIC; floors = 3 + Math.floor(r2 * 2); fh = 5; break; } // Oval east: High Court, University
        if (b.type === 4 || b.type === 11 || b.type === 5 || A > 2500) { style = ST.GOTHIC; floors = 3 + Math.floor(r2 * 2); fh = 4.6; }
        else if (A > 1500 && r3 < 0.3) { style = ST.TOWER; floors = 8 + Math.floor(r2 * 8); }
        else { style = r3 < 0.55 ? ST.GOTHIC : ST.PLAIN; floors = 3 + Math.floor(r2 * 3); fh = style === ST.GOTHIC ? 4.2 : 3.4; }
        break;
      case 'girgaon':
        if (A > 1100 && r3 < 0.3) { style = ST.TOWER; floors = 12 + Math.floor(r2 * r2 * 26); }
        else if (A > 250) { style = r3 < 0.6 ? ST.CHAWL : ST.PLAIN; floors = 3 + Math.floor(r2 * 3); }
        else { style = ST.CHAWL; floors = 2 + Math.floor(r2 * 3); }
        break;
      default:
        if (A > 1000 && r3 < 0.4) { style = ST.TOWER; floors = 10 + Math.floor(r2 * 14); }
        else { style = r3 < 0.45 ? ST.CHAWL : ST.PLAIN; floors = 3 + Math.floor(r2 * 3); }
    }
    if (b.type === 6) { style = ST.SHRINE; floors = Math.max(1, Math.min(floors, 3)); }
    if (b.type === 7 || (b.type === 8 && A > 60)) { style = ST.SHED; floors = 1; fh = 6; }
    if (b.type === 8 && A <= 60) { style = ST.SHED; floors = 1; fh = 3; }
    if (b.type === 9) { style = ST.PLAIN; floors = Math.max(2, floors - 2); }
    if (b.type === 10) { style = ST.BUNGALOW; floors = 2; }
    let H = floors * fh;
    if (b.lv) H = b.lv * (fh > 4 ? fh : 3.2) + (b.lv > 2 ? 1 : 0);
    if (b.h && !(b.lv && (b.h / b.lv > 6 || b.h / b.lv < 2))) H = b.h; // ignore height tags that disagree with the floor count
    if (A < 25) H = Math.min(H, 4);
    // landmarks
    const lm = b.lm;
    if (lm === 'trident') { H = 117; style = ST.TOWER; }
    if (lm === 'oberoi') { H = 78; style = ST.GLASS; }
    if (lm === 'express') { H = 104; style = ST.GLASS; }
    if (lm === 'intercontinental') { style = ST.DECO; }
    if (lm === 'churchgate') { H = 24; style = ST.GOTHIC; fh = 4.6; }
    if (lm === 'mantralaya') { H = 30; style = ST.TOWER; }
    if (lm === 'taj') { H = 40; style = ST.GOTHIC; fh = 5; }
    if (lm === 'gateway') { H = 26; style = ST.GOTHIC; fh = 26; }
    if (lm === 'regal' || lm === 'liberty' || lm === 'metro') { style = ST.DECO; H = Math.max(H, 18); }
    const shops = (zone === 'girgaon' || zone === 'fort' || zone === 'mixed' || (zone === 'deco' && r3 < 0.25 && dMD > 90)) && style !== ST.GLASS && style !== ST.SHRINE && style !== ST.SHED && A > 80 ? 1 : 0;
    const hero = zone === 'deco' && dMD < 70 ? 2 : 0;
    // Art Deco: round the convex corners (the curved corner bays of the Marine Drive row)
    if (style === ST.DECO && n >= 4 && n < 40) {
      const sgn = Math.sign(polyArea(p)) || 1, q = [];
      for (let i = 0; i < n; i++) {
        const a = (i + n - 1) % n, c = (i + 1) % n;
        const px0 = p[a * 2], pz0 = p[a * 2 + 1], x1 = p[i * 2], z1 = p[i * 2 + 1], x2 = p[c * 2], z2 = p[c * 2 + 1];
        const e1 = Math.hypot(x1 - px0, z1 - pz0), e2 = Math.hypot(x2 - x1, z2 - z1);
        const ux = (x1 - px0) / e1, uz = (z1 - pz0) / e1, vx = (x2 - x1) / e2, vz = (z2 - z1) / e2;
        const cr = ux * vz - uz * vx, dt = ux * vx + uz * vz;
        if (e1 > 5 && e2 > 5 && cr * sgn > 0 && Math.abs(dt) < 0.45) {
          const r = Math.min(3.2, 0.3 * Math.min(e1, e2));
          const ax = x1 - ux * r, az = z1 - uz * r, bx = x1 + vx * r, bz = z1 + vz * r;
          for (let k = 0; k <= 5; k++) { const t = k / 5, w0 = (1 - t) * (1 - t), w1 = 2 * t * (1 - t), w2 = t * t; q.push(ax * w0 + x1 * w1 + bx * w2, az * w0 + z1 * w1 + bz * w2); }
        } else q.push(x1, z1);
      }
      b.pts = new Float32Array(q); p = b.pts; n = p.length / 2;
    }
    // base height: lowest ground under the footprint (sunk a little)
    let gmin = 1e9, gmax = -1e9;
    for (let i = 0; i < p.length; i += 2) { const g = groundH(p[i], p[i + 1]); gmin = Math.min(gmin, g); gmax = Math.max(gmax, g); }
    gmin = Math.max(gmin, 0.4);
    const y0 = gmin - 0.6, yTop = gmax + H;
    const T = getT(cx, cz);
    const fl = shops | hero;
    // ---- walls (+ parapet)
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, ax = p[i * 2], az = p[i * 2 + 1], bx = p[j * 2], bz = p[j * 2 + 1];
      const el = Math.hypot(bx - ax, bz - az); if (el < 0.05) continue;
      // CW in x/z (positive area in bake) -> outward normal
      let nx = (bz - az) / el, nz = -(bx - ax) / el;
      const base = T.pos.length / 3;
      const hh = yTop - y0;
      T.pos.push(ax, y0, az, bx, y0, bz, bx, yTop, bz, ax, yTop, az);
      for (let k = 0; k < 4; k++) { T.nor.push(nx, 0, nz); T.b.push(style, seed, fh, fl); }
      T.fac.push(0, 0, el, hh, el, 0, el, hh, el, hh, el, hh, 0, hh, el, hh);
      T.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }
    // ---- roof
    const box = obb(p);
    const rectFill = box ? A / box.A : 0;
    const pitched = box && (rectFill > 0.82 || style === ST.GOTHIC && rectFill > 0.6) && (style === ST.BUNGALOW || style === ST.GOTHIC && A < 9000 && (r2 < 0.6 || cx > 1290 && cx < 1520 && cz > 850 && cz < 1450) || style === ST.CHAWL && r3 < 0.45 || style === ST.SHED);
    const yr = yTop - 0.9; // terrace level under the parapet
    if (pitched) {
      // hip roof over the min-area rectangle
      const { dx, dz, a0, a1, b0, b1 } = box;
      let L1 = a1 - a0, W1 = b1 - b0; const along = L1 >= W1;
      const pt = (a, b2) => [a * dx - b2 * dz, a * dz + b2 * dx];
      const ov = 0.5, rise = Math.min(W1, L1) * 0.5 * Math.tan(style === ST.SHED ? 0.25 : style === ST.GOTHIC ? 0.8 : 0.5);
      const A0 = a0 - ov, A1 = a1 + ov, B0 = b0 - ov, B1 = b1 + ov;
      const c = [pt(A0, B0), pt(A1, B0), pt(A1, B1), pt(A0, B1)];
      const yb = yTop, yt = yTop + rise;
      let r0, r1;
      if (along) { const m = (B0 + B1) / 2, h = (B1 - B0) / 2; r0 = pt(A0 + h, m); r1 = pt(A1 - h, m); if (A1 - h < A0 + h) { r0 = r1 = pt((A0 + A1) / 2, m); } }
      else { const m = (A0 + A1) / 2, h = (A1 - A0) / 2; r0 = pt(m, B0 + h); r1 = pt(m, B1 - h); if (B1 - h < B0 + h) { r0 = r1 = pt(m, (B0 + B1) / 2); } }
      const faces = along ? [[c[0], c[1], r1, r0], [c[1], c[2], r1], [c[2], c[3], r0, r1], [c[3], c[0], r0]] : [[c[0], c[1], r0], [c[1], c[2], r1, r0], [c[2], c[3], r1], [c[3], c[0], r0, r1]];
      for (const f of faces) {
        const v = f.map((q, k) => [q[0], k < 2 ? yb : yt, q[1]]);
        const e1 = [v[1][0] - v[0][0], v[1][1] - v[0][1], v[1][2] - v[0][2]], e2 = [v[2][0] - v[0][0], v[2][1] - v[0][1], v[2][2] - v[0][2]];
        let nn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        if (nn[1] < 0) nn = nn.map(q => -q);
        const ln = Math.hypot(...nn) || 1; nn = nn.map(q => q / ln);
        const base = T.pos.length / 3;
        const ex = (f[1][0] - f[0][0]), ez = (f[1][1] - f[0][1]), el = Math.hypot(ex, ez) || 1;
        for (const q of v) {
          T.pos.push(q[0], q[1], q[2]); T.nor.push(nn[0], nn[1], nn[2]); T.b.push(style, seed, fh, 4);
          const along2 = ((q[0] - f[0][0]) * ex + (q[2] - f[0][1]) * ez) / el;
          const up = Math.hypot(q[0] - f[0][0] - ex / el * along2, q[2] - f[0][1] - ez / el * along2);
          T.fac.push(along2, up + (q[1] - yb), 0, 1);
        }
        if (v.length === 4) T.idx.push(base, base + 2, base + 1, base, base + 3, base + 2); else T.idx.push(base, base + 2, base + 1);
      }
      // close the top of the walls under the eaves
      capPoly(T, p, yTop - 0.02, style, seed, fh);
    } else {
      capPoly(T, p, yr, style, seed, fh);
      if (A > 60 && H > 7) roofSpots.push({ x: cx, z: cz, y: yr, A, style, seed, p, H });
    }
    // shrine tops (dome or shikhara) are added by props via meta
    meta.push({ cx, cz, y0, yTop, H, style, A, p, lm, zone, seed, fh, shops });
    const bb = polyBox(p);
    grid.add(bb[0], bb[1], bb[2], bb[3], meta.length - 1);
  }
  const material = mat({ vs: VS, fs: FS, side: THREE.DoubleSide, uniforms: { uSigns: { value: opts.signs || null } } });
  const grp = new THREE.Group(); grp.name = 'buildings';
  for (const [k, T] of tiles) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(T.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(T.nor, 3));
    g.setAttribute('aFac', new THREE.Float32BufferAttribute(T.fac, 4));
    g.setAttribute('aB', new THREE.Float32BufferAttribute(T.b, 4));
    g.setIndex(T.idx); g.computeBoundingSphere(); g.computeBoundingBox();
    const m = new THREE.Mesh(g, material); m.userData.cast = true; m.userData.receive = true; m.name = 'bt' + k;
    grp.add(m);
  }
  scene.add(grp);
  return { group: grp, grid, meta, roofSpots, material };
}

function capPoly(T, p, y, style, seed, fh) {
  const contour = []; for (let i = 0; i < p.length; i += 2) contour.push(new THREE.Vector2(p[i], p[i + 1]));
  let tris; try { tris = THREE.ShapeUtils.triangulateShape(contour, []); } catch (e) { return; }
  const base = T.pos.length / 3;
  for (const v of contour) { T.pos.push(v.x, y, v.y); T.nor.push(0, 1, 0); T.fac.push(v.x, v.y, 0, 0); T.b.push(style, seed, fh, 4); }
  for (const t of tris) triUp(T.idx, T.pos, base + t[0], base + t[1], base + t[2]);
}

// a filler city beyond the mapped area (seen from Malabar Hill and from the sea) - simple blocks, same facade shader
export function buildFiller(L, scene, material, B, MARGIN) {
  const T = { pos: [], nor: [], fac: [], b: [], idx: [] };
  const R = rng(99);
  const S = 34;
  for (let z = B.z0 - MARGIN + 200; z < B.z1 + MARGIN - 200; z += S) for (let x = B.x0 - MARGIN + 200; x < B.x1 + MARGIN - 200; x += S) {
    const cx = x + S / 2, cz = z + S / 2;
    if (cx > B.x0 - 30 && cx < B.x1 + 30 && cz > B.z0 - 30 && cz < B.z1 + 30) continue;
    if (coastDist(cx, cz) < 25) continue;
    if (R() < 0.3) continue; // streets / gaps
    const w = 10 + R() * 18, d = 10 + R() * 18, tall = R();
    const north = Math.max(0, (B.z0 - cz) / 2000);   // the towers of Tardeo / Worli rise to the north
    const H = tall > 0.97 - north * 0.07 ? 70 + R() * 120 : tall > 0.88 ? 22 + R() * 30 : 8 + R() * 12;
    const style = H > 45 ? (R() < 0.4 ? ST.GLASS : ST.TOWER) : (R() < 0.5 ? ST.CHAWL : ST.PLAIN);
    const seed = R(), a = R() * 0.3;
    const ca = Math.cos(a), sa = Math.sin(a);
    const pts = [[-w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2], [w / 2, -d / 2]].map(([u, v]) => [cx + u * ca - v * sa, cz + u * sa + v * ca]);
    const p = pts.flat();
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4, ax = p[i * 2], az = p[i * 2 + 1], bx = p[j * 2], bz = p[j * 2 + 1], el = Math.hypot(bx - ax, bz - az);
      const nx = (bz - az) / el, nz = -(bx - ax) / el, base = T.pos.length / 3;
      T.pos.push(ax, 0, az, bx, 0, bz, bx, H, bz, ax, H, az);
      for (let k = 0; k < 4; k++) { T.nor.push(nx, 0, nz); T.b.push(style, seed, 3.2, 0); }
      T.fac.push(0, 0, el, H, el, 0, el, H, el, H, el, H, 0, H, el, H);
      T.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }
    capPoly(T, p, H - 0.9, style, seed, 3.2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(T.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(T.nor, 3));
  g.setAttribute('aFac', new THREE.Float32BufferAttribute(T.fac, 4));
  g.setAttribute('aB', new THREE.Float32BufferAttribute(T.b, 4));
  g.setIndex(T.idx);
  const fm = material.clone(); fm.defines = { FILLER: 1 }; fm.uniforms = material.uniforms; fm.needsUpdate = true;
  const m = new THREE.Mesh(g, fm); m.name = 'filler';
  scene.add(m);
  return m;
}
