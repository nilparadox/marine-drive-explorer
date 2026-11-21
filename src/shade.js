// Shared uniforms + GLSL used by every custom material (light, haze, shadows, noise).
import * as THREE from 'three';

export const U = {
  uTime: { value: 0 },
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uSunCol: { value: new THREE.Color(1, 1, 1) },
  uSkyTop: { value: new THREE.Color() },
  uSkyHor: { value: new THREE.Color() },
  uGroundAmb: { value: new THREE.Color() },
  uFogCol: { value: new THREE.Color() },
  uFogSun: { value: new THREE.Color() },
  uFogDen: { value: 0.00035 },
  uNight: { value: 0 },        // 0 day .. 1 full night (window lights, lamps)
  uCam: { value: new THREE.Vector3() },
  uShadowMap: { value: null },
  uShadowMat: { value: new THREE.Matrix4() },
  uShadowOn: { value: 0 },
  uShadowTexel: { value: 1 / 2048 },
  uWind: { value: 1 },
  uField: { value: null },      // coast distance field
  uFieldInfo: { value: new THREE.Vector4() },
  uExposure: { value: 1 },
  uQuality: { value: 2 },
};

export const NOISE = /* glsl */`
float h11(float p){ p = fract(p*.1031); p *= p+33.33; p *= p+p; return fract(p); }
float h21(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*.1031); p3 += dot(p3, p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
vec2 h22(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*vec3(.1031,.1030,.0973)); p3 += dot(p3, p3.yzx+33.33); return fract((p3.xx+p3.yz)*p3.zy); }
float vn(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.-2.*f);
  return mix(mix(h21(i),h21(i+vec2(1,0)),u.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),u.x), u.y); }
float fbm(vec2 p){ float s=0., a=.5; for(int i=0;i<4;i++){ s+=a*vn(p); p=p*2.03+vec2(1.7,9.2); a*=.5; } return s; }
float fbm2(vec2 p){ float s=0., a=.5; for(int i=0;i<2;i++){ s+=a*vn(p); p=p*2.03+vec2(1.7,9.2); a*=.5; } return s/.75; }
`;

export const COMMON = /* glsl */`
uniform float uTime; uniform vec3 uSunDir; uniform vec3 uSunCol; uniform vec3 uSkyTop; uniform vec3 uSkyHor; uniform vec3 uGroundAmb;
uniform vec3 uFogCol; uniform vec3 uFogSun; uniform float uFogDen; uniform float uNight; uniform vec3 uCam;
uniform sampler2D uShadowMap; uniform mat4 uShadowMat; uniform float uShadowOn; uniform float uShadowTexel; uniform float uExposure;
${NOISE}
float shadowAt(vec3 P, vec3 N){
  if (uShadowOn < .5) return 1.;
  vec4 s = uShadowMat * vec4(P + N*0.2, 1.);
  vec3 c = s.xyz/s.w*.5+.5;
  if (c.x<0.||c.x>1.||c.y<0.||c.y>1.||c.z>1.) return 1.;
  float b = c.z - 0.0009, r = 0.;
  vec2 o = vec2(uShadowTexel);
  // rotated 8-tap disc, rotation per pixel to turn banding into fine noise
  float ang = h21(gl_FragCoord.xy) * 6.2831;
  mat2 rot = mat2(cos(ang), -sin(ang), sin(ang), cos(ang));
  vec2 k[8];
  k[0]=vec2(-.94,-.40); k[1]=vec2(.95,-.29); k[2]=vec2(-.09,-.93); k[3]=vec2(.34,.94);
  k[4]=vec2(-.81,.59); k[5]=vec2(.54,.38); k[6]=vec2(-.32,.12); k[7]=vec2(.18,-.45);
  for (int i = 0; i < 8; i++) r += step(b, texture2D(uShadowMap, c.xy + rot*k[i]*o*1.6).r);
  float edge = smoothstep(0., .06, min(min(c.x,c.y),min(1.-c.x,1.-c.y)));
  return mix(1., r/8., edge);
}
vec3 skyAmb(vec3 N){
  float u = N.y*.5+.5;
  return mix(uGroundAmb, mix(uSkyHor, uSkyTop, clamp(N.y,0.,1.)), smoothstep(0.,1.,u));
}
// sun + sky light. spec: strength, gloss: exponent
vec3 shade(vec3 alb, vec3 N, vec3 P, float sh, float ao, float spec, float gloss){
  vec3 V = normalize(uCam - P);
  float ndl = max(dot(N, uSunDir), 0.);
  float wrap = max(dot(N, uSunDir)*.5+.5, 0.);
  vec3 amb = skyAmb(N);
  amb = mix(vec3(dot(amb, vec3(.333))), amb, .3);   // keep shadows neutral, not blue or mauve
  amb += vec3(.07,.06,.05) * uNight;                 // orange city glow bouncing around at night
  vec3 c = alb * (uSunCol * ndl * sh + amb * ao * 1.25 + uSunCol * wrap * .03 * ao);
  vec3 H = normalize(V + uSunDir);
  float sp = pow(max(dot(N, H), 0.), gloss) * spec * sh * smoothstep(0., .2, ndl);
  float fr = pow(1. - max(dot(N, V), 0.), 5.);
  c += uSunCol * sp + skyAmb(reflect(-V, N)) * fr * spec * .6 * ao;
  return c;
}
// height fog with sun in-scattering (haze over the bay)
vec3 haze(vec3 col, vec3 P){
  vec3 d = P - uCam; float L = length(d); vec3 v = d / max(L, 1e-3);
  float H = 90.;
  float y0 = max(uCam.y, 0.), y1 = max(P.y, 0.);
  float k = abs(y1-y0) < .1 ? exp(-y0/H) : H*(exp(-y0/H)-exp(-y1/H))/(y1-y0);
  float f = 1. - exp(-L * uFogDen * (0.3 + k));
  float sunAmt = pow(max(dot(v, uSunDir), 0.), 8.) * .8;
  vec3 fc = mix(uFogCol, uFogSun, sunAmt);
  return mix(col, fc, clamp(f, 0., 1.));
}
`;

// finish fragment: exposure + three's tone mapping + colour space
export const FINISH = /* glsl */`
  gl_FragColor.rgb = mix(vec3(dot(gl_FragColor.rgb, vec3(.2126,.7152,.0722))), gl_FragColor.rgb, .88) * uExposure;
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
`;

// standard vertex prelude that handles instancing
export const VHEAD = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
`;

export function mat(o) {
  const m = new THREE.ShaderMaterial({
    uniforms: { ...U, ...(o.uniforms || {}) },
    vertexShader: o.vs, fragmentShader: o.fs,
    side: o.side ?? THREE.FrontSide, transparent: !!o.transparent, depthWrite: o.depthWrite ?? true,
    blending: o.blending ?? THREE.NormalBlending, extensions: {}, defines: o.defines || {},
    polygonOffset: !!o.po, polygonOffsetFactor: o.po ? o.po[0] : 0, polygonOffsetUnits: o.po ? o.po[1] : 0,
  });
  m.toneMapped = true;
  return m;
}
