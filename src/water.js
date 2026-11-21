// Back Bay / Arabian Sea surface: procedural swell normals, sky + city reflection, glitter, shore foam.
import * as THREE from 'three';
import { U, COMMON, FINISH, mat } from './shade.js';

const VS = /* glsl */`
varying vec3 vP; varying vec4 vClip;
void main(){ vec4 w = modelMatrix*vec4(position,1.); vP = w.xyz; vClip = projectionMatrix*viewMatrix*w; gl_Position = vClip; }`;

const FS = /* glsl */`
${COMMON}
uniform sampler2D uField; uniform vec4 uFieldInfo;
uniform sampler2D uRefl; uniform float uReflOn; uniform mat4 uReflMat;
varying vec3 vP; varying vec4 vClip;

vec2 field(vec2 p){ return texture2D(uField, (p - uFieldInfo.xy)/uFieldInfo.zw).rg; }
// wave normal: sum of directional sines (swell from WSW) + fine ripples
vec3 waveN(vec2 p, float t, float detail){
  vec2 g = vec2(0.);
  float fp = length(fwidth(p));   // metres covered by one pixel: drop waves we cannot resolve (no moire)
  // dir, wavelength, amplitude, speed
  // amplitude varies over the bay (no regular stripes); waves the pixel cannot resolve are dropped
  float var = .55 + .9*vn(p*.004 + vec2(3.1, 7.7));
  #define W(dx,dz,L,A,S) { vec2 d = normalize(vec2(dx,dz)); float k = 6.2831/L; float ph = dot(d,p)*k - t*S*k + vn(p/(L*3.))*2.5; g += d * (A*k*cos(ph)) * var * (1. - smoothstep(L*.06, L*.2, fp)); }
  W(.92,.38, 38., .32, 7.)
  W(.80,.60, 21., .18, 5.6)
  W(.98,-.2, 13., .10, 4.4)
  W(.60,.80, 7.5, .05, 3.4)
  W(.30,.95, 4.1, .03, 2.5)
  W(-.4,.92, 2.3, .015, 1.9)
  float n1 = vn(p*.9 + vec2(t*.35, t*.2)), n2 = vn(p*2.3 - vec2(t*.5, -t*.3));
  g += (vec2(n1, n2) - .5) * .16 * detail * (1. - smoothstep(.15, .6, fp));
  float n3 = vn(p*4.7 + vec2(t*.9, -t*.6)), n4 = vn(p*5.3 - vec2(t*.7, t*.8));
  g += (vec2(n3, n4) - .5) * .12 * detail * (1. - smoothstep(.05, .25, fp));
  return normalize(vec3(-g.x, 1., -g.y));
}
void main(){
  vec3 V = uCam - vP; float dist = length(V); V /= dist;
  vec2 f = field(vP.xz);
  float cd = f.r, beach = f.g;          // cd < 0 at sea (metres from the coast)
  float detail = 1. - smoothstep(200., 1500., dist);
  vec3 N = waveN(vP.xz, uTime, detail);
  N = normalize(mix(vec3(0.,1.,0.), N, mix(.25, 1., detail)));
  // water body colour: murky green-grey in the bay, browner close to shore
  vec3 deep = vec3(.045,.075,.075), shore = vec3(.11,.12,.085);
  vec3 body = mix(shore, deep, smoothstep(-5., -160., cd));
  // lighting of the body (sub-surface)
  float sunUp = max(uSunDir.y, 0.);
  vec3 lit = body * (uSunCol*.25*sunUp + skyAmb(vec3(0.,1.,0.))*.55) + uSkyHor * .035;
  // reflection
  vec3 R = reflect(-V, N);
  R.y = abs(R.y);
  float fres = .05 + .95*pow(1. - max(dot(N, V), 0.), 5.);
  vec3 refl = mix(uSkyHor, uSkyTop, pow(clamp(R.y,0.,1.), .55));
  refl = mix(refl, uFogSun, pow(max(dot(R, uSunDir),0.), 10.)*.8);
  if (uReflOn > .5) {
    vec4 rc = uReflMat * vec4(vP, 1.);
    vec2 ruv = rc.xy/rc.w + N.xz * .012 * (40. / (40. + dist*.15));
    // small blur: four taps spread vertically (reflections stretch on water)
    vec2 px = vec2(0., 1.5/600.);
    vec4 rt = (texture2D(uRefl, ruv) + texture2D(uRefl, ruv + px) + texture2D(uRefl, ruv - px) + texture2D(uRefl, ruv + px*2.5)) * .25;
    refl = mix(refl, min(rt.rgb, vec3(6.)), clamp(rt.a, 0., 1.));
  }
  vec3 col = mix(lit, refl, fres);
  // sun glitter path (sharp + broad)
  vec3 H = normalize(V + uSunDir);
  float ndh = max(dot(N, H), 0.);
  float lowSun = 1. - smoothstep(.15, .6, uSunDir.y);   // the long glitter path belongs to a low sun
  float gl = pow(ndh, 1200.) * 40. * (.4 + .6*lowSun) + pow(ndh, 140.) * .35 * lowSun;
  col += min(uSunCol * gl, vec3(12.)) * smoothstep(-.02, .05, uSunDir.y) * (1. - uNight) * (1. - smoothstep(.6, .95, V.y));
  // foam where the sea meets sea wall / tetrapods (cd close to 0) and rolling waves on the beach
  float wall = (1. - beach) * smoothstep(-9., -1., cd);
  float churn = fbm(vP.xz*.35 + vec2(uTime*.6, -uTime*.4));
  float foamW = wall * smoothstep(.45, .75, churn + .25*sin(uTime*1.3 + vP.x*.05 + vP.z*.07));
  float ph = cd*.32 + uTime*1.15;
  float lines = smoothstep(.75, 1., sin(ph)) * smoothstep(-70., -6., cd) * smoothstep(.0, -2., cd);
  float swash = smoothstep(-6., -1., cd) * (.55 + .45*sin(uTime*.9 + vP.x*.02));
  float foamB = beach * clamp(lines * (.5 + .7*fbm(vP.xz*.2 + uTime*.1)) + swash*.8, 0., 1.);
  float foam = clamp(foamW + foamB, 0., 1.) * (1. - smoothstep(300., 1400., dist));
  vec3 foamC = vec3(.82,.84,.82) * (uSunCol*.3*max(uSunDir.y,0.) + skyAmb(vec3(0.,1.,0.))*.9);
  col = mix(col, foamC, foam*.85);
  // shallow water over the beach is see-through
  float alpha = mix(1., smoothstep(.0, -14., cd)*.85 + .15, beach);
  alpha = max(alpha, foam*.9);
  gl_FragColor = vec4(haze(col, vP), alpha);
  ${FINISH}
}`;

export function buildWater(scene, quality) {
  const reflRT = quality >= 1 ? new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 0 }) : null;
  const m = mat({
    vs: VS, fs: FS, transparent: true,
    uniforms: { uRefl: { value: reflRT ? reflRT.texture : null }, uReflOn: { value: reflRT ? 1 : 0 }, uReflMat: { value: new THREE.Matrix4() } },
  });
  const g = new THREE.PlaneGeometry(30000, 30000, 1, 1); g.rotateX(-Math.PI / 2);
  const water = new THREE.Mesh(g, m); water.name = 'water'; water.renderOrder = 1; water.frustumCulled = false;
  scene.add(water);

  // planar reflection camera (oblique near plane clips everything under the water)
  const rcam = new THREE.PerspectiveCamera();
  const plane = new THREE.Plane(), clip = new THREE.Vector4(), q = new THREE.Vector4();
  const tex = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
  function renderReflection(renderer, sceneR, cam, scale = 0.5) {
    if (!reflRT) return;
    const s = renderer.getDrawingBufferSize(new THREE.Vector2());
    const w = Math.max(64, Math.floor(s.x * scale)), h = Math.max(64, Math.floor(s.y * scale));
    if (reflRT.width !== w || reflRT.height !== h) reflRT.setSize(w, h);
    rcam.copy(cam);
    rcam.position.set(cam.position.x, -cam.position.y, cam.position.z);
    const look = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion); look.y = -look.y;
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion); up.y = -up.y;
    rcam.up.copy(up); rcam.lookAt(rcam.position.clone().add(look));
    rcam.updateMatrixWorld(); rcam.projectionMatrix.copy(cam.projectionMatrix);
    m.uniforms.uReflMat.value.multiplyMatrices(tex, rcam.projectionMatrix).multiply(rcam.matrixWorldInverse);
    // oblique clip plane y = 0.05 (in camera space)
    plane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0.05, 0));
    plane.applyMatrix4(rcam.matrixWorldInverse);
    clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    const P = rcam.projectionMatrix;
    q.x = (Math.sign(clip.x) + P.elements[8]) / P.elements[0];
    q.y = (Math.sign(clip.y) + P.elements[9]) / P.elements[5];
    q.z = -1.0; q.w = (1.0 + P.elements[10]) / P.elements[14];
    clip.multiplyScalar(2.0 / clip.dot(q));
    P.elements[2] = clip.x; P.elements[6] = clip.y; P.elements[10] = clip.z + 1.0; P.elements[14] = clip.w;
    water.visible = false;
    const old = renderer.getRenderTarget();
    renderer.setRenderTarget(reflRT); renderer.setClearColor(0x000000, 0); renderer.clear();
    renderer.render(sceneR, rcam);
    renderer.setRenderTarget(old);
    water.visible = true;
  }
  return { water, material: m, renderReflection, rcam };
}
