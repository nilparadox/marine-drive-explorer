// Sky dome, sun path for Mumbai, light/haze palette over the day, clouds and stars.
import * as THREE from 'three';
import { U, NOISE, mat } from './shade.js';

const LAT = 18.94 * Math.PI / 180;
const DAY = 325; // 21 November
const DECL = -23.44 * Math.PI / 180 * Math.cos(2 * Math.PI / 365 * (DAY + 10));
const NOON = 12.42; // IST solar noon in Mumbai in late November

export function sunDir(hours, out = new THREE.Vector3()) {
  const H = (hours - NOON) * 15 * Math.PI / 180;
  const sinEl = Math.sin(LAT) * Math.sin(DECL) + Math.cos(LAT) * Math.cos(DECL) * Math.cos(H);
  const el = Math.asin(sinEl);
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(LAT) - Math.tan(DECL) * Math.cos(LAT)) + Math.PI; // from north, clockwise
  out.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
  return out;
}

// palette keyed by sun elevation in degrees (linear colours are derived from these sRGB picks)
const K = [
  // el,  skyTop,   skyHorizon, sunColour, sunPower, ambGround, fog,      fogSun,   fogDensity
  [-18, '#060b1e', '#162040', '#000000', 0.0, '#151418', '#12172a', '#161a2c', 0.00030],
  [-9, '#142450', '#3a4266', '#000000', 0.0, '#1c1b22', '#2c3044', '#3c3648', 0.00030],
  [-4, '#34497a', '#bc8a70', '#ff7a4a', 0.05, '#2a2a36', '#7c6c68', '#b07c62', 0.00030],
  [-0.5, '#56709f', '#e2aa82', '#ffa868', 0.6, '#463e44', '#c0a08c', '#eea474', 0.00029],
  [3, '#7088ab', '#ecc49a', '#ffcf94', 1.4, '#5a5048', '#d2b89c', '#f5c48e', 0.00027],
  [9, '#7896bf', '#e2d6c2', '#ffe0b4', 2.0, '#655c4e', '#d2cabb', '#f2d8b0', 0.00025],
  [22, '#86a6cc', '#dde3e5', '#ffeedd', 2.75, '#6b675c', '#c6ced3', '#efe6d8', 0.00022],
  [60, '#7fa2cc', '#d6dfe4', '#fff4e6', 2.85, '#6a665c', '#bccad5', '#ecebe4', 0.00020],
];
const tmp = new THREE.Color(), tmp2 = new THREE.Color();
function lerpC(a, b, t, out) { tmp.set(a).convertSRGBToLinear(); tmp2.set(b).convertSRGBToLinear(); return out.copy(tmp).lerp(tmp2, t); }

export function applySun(hours) {
  const d = sunDir(hours, U.uSunDir.value);
  const el = Math.asin(d.y) * 180 / Math.PI;
  let i = 0; while (i < K.length - 2 && el > K[i + 1][0]) i++;
  const a = K[i], b = K[i + 1], t = THREE.MathUtils.clamp((el - a[0]) / (b[0] - a[0]), 0, 1);
  lerpC(a[1], b[1], t, U.uSkyTop.value);
  lerpC(a[2], b[2], t, U.uSkyHor.value);
  lerpC(a[3], b[3], t, U.uSunCol.value).multiplyScalar(a[4] + (b[4] - a[4]) * t);
  lerpC(a[5], b[5], t, U.uGroundAmb.value);
  lerpC(a[6], b[6], t, U.uFogCol.value);
  lerpC(a[7], b[7], t, U.uFogSun.value);
  U.uFogDen.value = a[8] + (b[8] - a[8]) * t;
  U.uNight.value = THREE.MathUtils.smoothstep(-el, -1.5, 5.5);  // lights come on through dusk
  // below the horizon the "sun" light becomes faint moonlight from high up so shapes still read
  if (d.y < 0) {
    const m = THREE.MathUtils.smoothstep(-d.y, 0.02, 0.2);
    d.set(-0.35, 0.75, 0.55).normalize().lerp(d.clone().setY(Math.max(d.y, 0.05)).normalize(), 1 - m).normalize();
    U.uSunCol.value.lerp(tmp.set(0x6a7fae).convertSRGBToLinear().multiplyScalar(0.18), m);
  }
  return el;
}

export function makeSky() {
  const m = mat({
    uniforms: { uRealSun: { value: new THREE.Vector3() }, uClouds: { value: 0.3 } },
    side: THREE.BackSide, depthWrite: false,
    vs: /* glsl */`varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.); gl_Position = p.xyww; }`,
    fs: /* glsl */`
uniform float uTime; uniform vec3 uSkyTop, uSkyHor, uSunCol, uFogCol, uFogSun, uRealSun; uniform float uNight, uExposure, uClouds;
varying vec3 vDir;
${NOISE}
float cloudField(vec2 p){
  float c = fbm(p*0.00055 + vec2(uTime*0.0015, 0.));
  c += 0.5*fbm(p*0.0021 - vec2(0., uTime*0.002));
  return smoothstep(1.0 - uClouds*0.9, 1.25 - uClouds*0.6, c);
}
void main(){
  vec3 v = normalize(vDir);
  vec3 s = normalize(uRealSun);
  float y = v.y;
  float sunH = s.y;
  // base gradient; the horizon band is thicker and warmer on the sun side
  float side = pow(max(dot(normalize(v.xz+1e-4), normalize(s.xz+1e-4)), 0.)*.5+.5, 2.);
  float band = exp(-max(y,0.)*mix(5.5, 3.2, side*smoothstep(.35,-.05,sunH)));
  vec3 col = mix(uSkyTop, uSkyHor, band);
  // below the horizon: haze colour (the far sea meets the sky softly)
  col = mix(col, uFogCol*.92, smoothstep(0., -.06, y));
  // sun glow (mie) and disk
  float cs = max(dot(v, s), 0.);
  vec3 glowC = uFogSun;
  col += glowC * (pow(cs, 10.)*.22 + pow(cs, 90.)*.45) * (0.5 + 0.6*smoothstep(.4, .0, sunH)) * smoothstep(-.12, .0, sunH);
  float disk = smoothstep(.99985, .99993, cs);
  float lowSun = smoothstep(.25, -.02, sunH);
  vec3 diskC = mix(vec3(18., 16., 13.), vec3(9., 3.6, 1.2), lowSun);
  col += diskC * disk * smoothstep(-.012, .004, v.y) * smoothstep(-.02, .01, sunH);
  // clouds on a plane at 1.6 km
  if (y > 0.005) {
    vec2 p = v.xz / y * 1600.;
    float c = cloudField(p);
    float c2 = cloudField(p + s.xz*60.);
    float lit = clamp(.55 + (c - c2)*2.2, 0., 1.3);
    vec3 shadowC = mix(uSkyTop, uSkyHor, .55) * .8;
    vec3 litC = mix(uSkyHor, vec3(1.), .25) * (.55 + .2*min(uSunCol.r, 3.)/3.);
    vec3 cc = mix(shadowC, litC, lit*.8);
    cc += uFogSun * pow(cs, 5.) * .55 * lowSun;     // undersides glow near the setting sun
    cc = mix(cc, vec3(.02,.025,.04) + uFogCol*.3, uNight*.85);
    float fade = smoothstep(.005, .15, y);
    col = mix(col, cc, c * fade * .7);
  }
  // stars, and the orange city glow of Mumbai on the horizon at night
  if (uNight > .01) {
    vec3 sv = v * 380.; vec3 cell = floor(sv); float r = h21(cell.xy + cell.z*7.13);
    float st = step(.9965, r) * smoothstep(.5, .0, length(fract(sv)-.5)) * h11(r*91.);
    col += vec3(.9,.95,1.) * st * smoothstep(.6, 1., uNight) * smoothstep(.05, .3, y) * .9;
    col += vec3(.5,.26,.1) * exp(-max(y,0.)*14.) * uNight * .22;
  }
  gl_FragColor = vec4(mix(vec3(dot(col, vec3(.2126,.7152,.0722))), col, .88), 1.);
  gl_FragColor.rgb *= uExposure;
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
  });
  const g = new THREE.SphereGeometry(9000, 48, 24);
  const sky = new THREE.Mesh(g, m);
  sky.frustumCulled = false; sky.renderOrder = -10;
  sky.onBeforeRender = (r, s, cam) => sky.position.copy(cam.position);
  return sky;
}
