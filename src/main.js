// Marine Drive Explorer - renderer, camera, controls, time of day, quality, UI glue.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { decode } from './decode.js';
import { U } from './shade.js';
import { initGeo, groundH, coastDist, fieldTexture, fieldInfo, B, MARGIN, pointInPoly, beachAt } from './geo.js';
import { makeSky, applySun, sunDir } from './sky.js';
import { buildGround } from './ground.js';
import { buildRoads } from './roads.js';
import { buildBuildings, buildFiller } from './buildings.js';
import { buildWater } from './water.js';
import { buildTrees } from './trees.js';
import { buildProps } from './props.js';
import { buildTraffic } from './traffic.js';
import { PLACES } from './places.js';
import { makeSignAtlas } from './signs.js';
import { makeAudio } from './audio.js';
const audio = makeAudio();

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.hash.slice(1).replace(/&/g, '&'));
const isTouch = matchMedia('(pointer: coarse)').matches;

// ------------------------------------------------------------------ quality tier
function pickQuality() {
  const saved = (() => { try { return localStorage.getItem('md_quality'); } catch (e) { return null; } })();
  if (params.get('q')) return +params.get('q');
  if (saved != null) return +saved;
  const mem = navigator.deviceMemory || 8;
  if (isTouch) return mem >= 8 ? 1 : 0;
  return mem <= 4 ? 1 : 2;
}
const Q = pickQuality();
U.uQuality.value = Q;

// ------------------------------------------------------------------ renderer
const canvas = $('#c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.info.autoReset = false;
let pixelRatio = Math.min(window.devicePixelRatio || 1, Q >= 2 ? 1.5 : Q >= 1 ? 1.25 : 1);
if (params.get('dpr')) pixelRatio = +params.get('dpr');
renderer.setPixelRatio(pixelRatio);
renderer.setSize(innerWidth, innerHeight, false);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.4, 14000);
camera.rotation.order = 'YXZ';

// post: bloom for the sun, lamps and lit windows
let composer = null, bloom = null;
if (Q >= 1) {
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: Q >= 2 ? 4 : 0 });
  composer = new EffectComposer(renderer, rt);
  composer.setPixelRatio(pixelRatio);
  composer.addPass(new RenderPass(scene, camera));
  bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.35, 0.4, 1.1);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  composer.setSize(innerWidth, innerHeight);
}

// ------------------------------------------------------------------ shadow map that follows the camera
const SHADOW = Q >= 2 ? 2048 : Q >= 1 ? 1536 : 1024;
const shadowRT = new THREE.WebGLRenderTarget(SHADOW, SHADOW, { depthBuffer: true });
shadowRT.depthTexture = new THREE.DepthTexture(SHADOW, SHADOW, THREE.UnsignedIntType);
shadowRT.depthTexture.minFilter = shadowRT.depthTexture.magFilter = THREE.NearestFilter;
const shadowCam = new THREE.OrthographicCamera(-200, 200, 200, -200, 1, 5000);
const depthMat = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide });
U.uShadowMap.value = shadowRT.depthTexture;
U.uShadowTexel.value = 1.2 / SHADOW;
let casters = [], others = [];
function collectCasters() {
  casters = []; others = [];
  scene.traverse(o => { if (o.isMesh || o.isPoints) { (o.userData.cast ? casters : others).push(o); } });
}
const _v = new THREE.Vector3(), _f = new THREE.Vector3();
function renderShadow() {
  const night = U.uNight.value;
  if (night > 0.97) { U.uShadowOn.value = 0; return; }
  U.uShadowOn.value = 1;
  const h = Math.max(2, camera.position.y);
  const ext = Math.min(1400, 90 + h * 1.4);
  camera.getWorldDirection(_f); _f.y = 0; _f.normalize();
  const c = _v.copy(camera.position).addScaledVector(_f, ext * 0.55); c.y = 0;
  const sd = U.uSunDir.value;
  // snap to texels to stop shimmering
  const texel = (2 * ext) / SHADOW;
  shadowCam.position.copy(c).addScaledVector(sd, 2500);
  shadowCam.lookAt(c);
  shadowCam.updateMatrixWorld();
  const ls = c.clone().applyMatrix4(shadowCam.matrixWorldInverse);
  const sx = Math.round(ls.x / texel) * texel - ls.x, sy = Math.round(ls.y / texel) * texel - ls.y;
  shadowCam.left = -ext + sx; shadowCam.right = ext + sx; shadowCam.top = ext + sy; shadowCam.bottom = -ext + sy;
  shadowCam.near = 2000; shadowCam.far = 3200;
  shadowCam.updateProjectionMatrix();
  U.uShadowMat.value.multiplyMatrices(shadowCam.projectionMatrix, shadowCam.matrixWorldInverse);
  for (const o of others) { o.userData._v = o.visible; o.visible = false; }
  for (const o of casters) { o.userData._m = o.material; o.material = o.userData.shadowMat || depthMat; }
  const oldOn = U.uShadowOn.value; U.uShadowOn.value = 0;
  renderer.setRenderTarget(shadowRT); renderer.clear(); renderer.render(scene, shadowCam); renderer.setRenderTarget(null);
  U.uShadowOn.value = oldOn;
  for (const o of others) o.visible = o.userData._v;
  for (const o of casters) o.material = o.userData._m;
}

// ------------------------------------------------------------------ world build (staged so the loading bar moves)
const W = {};
const step = (label, frac) => new Promise(r => { $('#loadtxt').textContent = label; $('#bar').style.width = (frac * 100).toFixed(0) + '%'; requestAnimationFrame(() => setTimeout(r, 0)); });
async function build() {
  await step('Reading the map of South Mumbai', 0.04);
  const L = decode(); W.L = L;
  await step('Shaping the coast and Malabar Hill', 0.1);
  initGeo(L);
  U.uField.value = fieldTexture(); U.uFieldInfo.value.copy(fieldInfo());
  scene.add(W.sky = makeSky());
  await step('Laying the ground, beach and maidans', 0.22);
  W.ground = buildGround(L, scene);
  await step('Laying the roads and footpaths', 0.34);
  W.roads = buildRoads(L, scene);
  await step('Raising ' + L.buildings.length.toLocaleString() + ' buildings', 0.46);
  W.bld = buildBuildings(L, scene, { signs: makeSignAtlas().tex });
  W.filler = buildFiller(L, scene, W.bld.material, B, MARGIN);
  await step('Filling the Arabian Sea', 0.6);
  W.water = buildWater(scene, Q);
  await step('Planting trees', 0.7);
  W.trees = buildTrees(L, scene, W.bld, W.roads, Q);
  await step("Tetrapods, lamps and the Queen's Necklace", 0.82);
  W.props = buildProps(L, scene, W.bld, Q);
  await step('Traffic, trains and boats', 0.92);
  W.traffic = buildTraffic(L, scene, W.roads, Q);
  collectCasters();
  await step('Ready', 1);
}

// ------------------------------------------------------------------ controls
const state = { mode: 'walk', yaw: 0, pitch: 0, pos: new THREE.Vector3(), vel: new THREE.Vector3(), time: 17.6, playing: false, speed: 1 };
const keys = {};
addEventListener('keydown', e => {
  keys[e.code] = true;
  if (e.code === 'KeyF') setMode(state.mode === 'walk' ? 'fly' : 'walk');
  if (e.code === 'KeyH') $('#stats').hidden = !$('#stats').hidden;
  if (e.code === 'KeyM') $('#soundBtn').click();
  if (e.code === 'KeyP') $('#play').click();
  if (/^Digit[0-9]$/.test(e.code)) { const p = PLACES[(+e.code.slice(5) + 9) % 10]; if (p) { goto(resolvePlace(p)); if (p.time) setTime(p.time); } }
});
addEventListener('keyup', e => { keys[e.code] = false; });
let drag = null;
canvas.addEventListener('pointerdown', e => {
  if (e.pointerType === 'touch' && joy.id === e.pointerId) return;
  drag = { id: e.pointerId, x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', e => {
  if (!drag || drag.id !== e.pointerId) return;
  const k = e.pointerType === 'touch' ? 0.0065 : 0.0042;
  state.yaw -= (e.clientX - drag.x) * k; state.pitch -= (e.clientY - drag.y) * k;
  state.pitch = Math.max(-1.45, Math.min(1.35, state.pitch));
  drag.x = e.clientX; drag.y = e.clientY;
});
const endDrag = e => { if (drag && drag.id === e.pointerId) drag = null; };
canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('wheel', e => { if (state.mode === 'fly') state.pos.y = Math.max(8, Math.min(1800, state.pos.y * (1 + Math.sign(e.deltaY) * 0.08))); }, { passive: true });
// joystick (touch)
const joy = { id: null, x: 0, y: 0, dx: 0, dy: 0 };
const jb = $('#joy'), jk = $('#knob');
jb.addEventListener('pointerdown', e => { joy.id = e.pointerId; const r = jb.getBoundingClientRect(); joy.x = r.left + r.width / 2; joy.y = r.top + r.height / 2; jb.setPointerCapture(e.pointerId); moveJoy(e); e.stopPropagation(); });
jb.addEventListener('pointermove', e => { if (e.pointerId === joy.id) moveJoy(e); });
const endJoy = e => { if (e.pointerId === joy.id) { joy.id = null; joy.dx = joy.dy = 0; jk.style.transform = ''; } };
jb.addEventListener('pointerup', endJoy); jb.addEventListener('pointercancel', endJoy);
function moveJoy(e) {
  let dx = e.clientX - joy.x, dy = e.clientY - joy.y; const l = Math.hypot(dx, dy), m = 46;
  if (l > m) { dx *= m / l; dy *= m / l; }
  joy.dx = dx / m; joy.dy = dy / m; jk.style.transform = `translate(${dx}px,${dy}px)`;
}
const hold = (el, fn) => { el.addEventListener('pointerdown', e => { fn(true); e.stopPropagation(); }); for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) el.addEventListener(ev, () => fn(false)); };
let upHeld = 0, downHeld = 0;
hold($('#up'), v => upHeld = v); hold($('#down'), v => downHeld = v);

function setMode(m) {
  state.mode = m;
  document.body.dataset.mode = m;
  $('#modeBtn').textContent = m === 'walk' ? 'Fly' : 'Walk';
  $('#modeBtn').setAttribute('aria-label', m === 'walk' ? 'Switch to flying' : 'Switch to walking');
  if (m === 'walk') { const g = Math.max(groundH(state.pos.x, state.pos.z), 0); state.pos.y = g + 1.65; if (coastDist(state.pos.x, state.pos.z) < 0.5 || insideBuilding(state.pos.x, state.pos.z)) toLand(); state.pitch = Math.max(-0.5, state.pitch); }
  else if (state.pos.y < 40) state.pos.y = 60;
}
function toLand() { // step back onto land if a jump left us in the sea
  for (let r = 2; r < 400; r += 2) for (let a = 0; a < 6.28; a += 0.4) { const x = state.pos.x + Math.cos(a) * r, z = state.pos.z + Math.sin(a) * r; if (coastDist(x, z) > 1.5 && !insideBuilding(x, z)) { state.pos.x = x; state.pos.z = z; state.pos.y = groundH(x, z) + 1.65; return; } }
}
function insideBuilding(x, z) {
  if (!W.bld) return false;
  for (const i of W.bld.grid.query(x, z)) { const m = W.bld.meta[i]; if (pointInPoly(x, z, m.p)) return true; }
  return false;
}
function goto(p) {
  state.pos.set(p.x, p.y, p.z); state.yaw = p.yaw; state.pitch = p.pitch; setMode(p.mode);
  if (p.mode === 'fly') state.pos.y = p.y;
  state.vel.set(0, 0, 0);
  $('#place').textContent = p.name;
}
function updateControls(dt) {
  const fwd = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0) - joy.dy;
  const str = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0) + joy.dx;
  if (keys.KeyQ) state.yaw += dt * 1.6; if (keys.KeyE) state.yaw -= dt * 1.6;
  const fast = keys.ShiftLeft || keys.ShiftRight;
  const sy = Math.sin(state.yaw), cy = Math.cos(state.yaw);
  if (state.mode === 'walk') {
    const sp = fast ? 9 : 4.2;
    const mx = (-sy * fwd + cy * str) * sp * dt, mz = (-cy * fwd - sy * str) * sp * dt;
    const tryMove = (nx, nz) => coastDist(nx, nz) > 0.4 && !insideBuilding(nx, nz);
    if (tryMove(state.pos.x + mx, state.pos.z + mz)) { state.pos.x += mx; state.pos.z += mz; }
    else if (tryMove(state.pos.x + mx, state.pos.z)) state.pos.x += mx;
    else if (tryMove(state.pos.x, state.pos.z + mz)) state.pos.z += mz;
    const gy = groundH(state.pos.x, state.pos.z) + 1.65;
    state.pos.y += (gy - state.pos.y) * Math.min(1, dt * 12);
  } else {
    const h = Math.max(20, state.pos.y);
    const sp = (fast ? 2.4 : 1) * (18 + h * 0.6);
    const cp = Math.cos(state.pitch), spch = Math.sin(state.pitch);
    // fly forward along the view on the ground plane; climb with buttons / Space+C
    state.pos.x += (-sy * fwd + cy * str) * sp * dt;
    state.pos.z += (-cy * fwd - sy * str) * sp * dt;
    const climb = (keys.Space || upHeld ? 1 : 0) - (keys.KeyC || keys.ControlLeft || downHeld ? 1 : 0);
    state.pos.y += climb * (10 + h * 0.7) * dt;
    const floor = Math.max(groundH(state.pos.x, state.pos.z), 0) + 6;
    state.pos.y = Math.max(floor, Math.min(2500, state.pos.y));
    const lim = 3000; state.pos.x = Math.max(B.x0 - lim, Math.min(B.x1 + lim, state.pos.x)); state.pos.z = Math.max(B.z0 - lim, Math.min(B.z1 + lim, state.pos.z));
  }
  camera.position.copy(state.pos);
  camera.rotation.set(state.pitch, state.yaw, 0);
  camera.near = state.mode === 'walk' ? 0.3 : Math.max(0.5, state.pos.y * 0.02);
  camera.updateProjectionMatrix();
}

// ------------------------------------------------------------------ time of day
const slider = $('#time');
function setTime(h) {
  state.time = h;
  const el = applySun(h);
  W.sky && W.sky.material.uniforms.uRealSun.value.copy(sunDir(h));
  slider.value = h;
  const hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
  $('#clock').textContent = `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'am' : 'pm'}`;
  // exposure: open up a little at dusk and night
  U.uExposure.value = el > 10 ? 1.0 : el > -2 ? 1.0 + (10 - el) * 0.015 : 1.18 + Math.min(0.25, (-2 - el) * 0.03);
  if (bloom) bloom.strength = 0.32 + U.uNight.value * 0.28;
}
slider.addEventListener('input', () => { state.playing = false; $('#play').classList.remove('on'); setTime(+slider.value); });
$('#play').addEventListener('click', () => {
  state.playing = !state.playing; $('#play').classList.toggle('on', state.playing);
  if (state.playing && (state.time > 19.2 || state.time < 16.5)) setTime(17.2);
});
$('#modeBtn').addEventListener('click', () => setMode(state.mode === 'walk' ? 'fly' : 'walk'));
// places
const pl = $('#places');
PLACES.forEach((p, i) => {
  const b = document.createElement('button'); b.textContent = p.name; b.title = p.note || '';
  b.addEventListener('click', () => { goto(resolvePlace(p)); if (p.time) setTime(p.time); pl.hidden = true; });
  pl.querySelector('.list').appendChild(b);
});
$('#placesBtn').addEventListener('click', () => { pl.hidden = !pl.hidden; });
pl.querySelector('.close').addEventListener('click', () => { pl.hidden = true; });
function resolvePlace(p) {
  const x = (p.lon - B.lon0) * B.kx, z = -(p.lat - B.lat0) * B.kz;
  let px = x, pz = z;
  if (p.mode === 'walk') {
    // land on a free spot (on the promenade if asked: 3-7 m from the sea wall)
    const good = (a, b) => { const c = coastDist(a, b); return p.prom ? c > 4 && c < 7 : p.beach ? beachAt(a, b) > 0.8 && c > 12 && c < 40 : c > 1.5; };
    if (!good(px, pz) || insideBuilding(px, pz) || p.beach) {
      let best = null;
      for (let r = 1; r < 300 && !best; r += 1.5) for (let a = 0; a < 6.28; a += 0.25) { const qx = x + Math.cos(a) * r, qz = z + Math.sin(a) * r; if (good(qx, qz) && !insideBuilding(qx, qz)) { best = [qx, qz]; break; } }
      if (best) [px, pz] = best;
    }
  }
  const y = p.mode === 'fly' ? p.alt : Math.max(groundH(px, pz), 0) + 1.65;
  return { name: p.name, x: px, y, z: pz, yaw: -p.hdg * Math.PI / 180, pitch: p.pitch * Math.PI / 180, mode: p.mode };
}
// quality menu
$('#qBtn').addEventListener('click', () => { const n = (Q + 1) % 3; try { localStorage.setItem('md_quality', n); } catch (e) { } location.reload(); });
$('#qBtn').textContent = ['Detail: Low', 'Detail: Medium', 'Detail: High'][Q];

// ------------------------------------------------------------------ main loop
const clock = new THREE.Clock();
let fpsAcc = 0, fpsN = 0, fps = 60, lastAdapt = 0, frame = 0;
function resize() {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setPixelRatio(pixelRatio); renderer.setSize(innerWidth, innerHeight, false);
  if (composer) { composer.setPixelRatio(pixelRatio); composer.setSize(innerWidth, innerHeight); }
  W.props && (W.props.glow.material.uniforms.uPx.value = innerHeight * pixelRatio * 0.9);
  W.traffic && W.traffic.group.children.forEach(o => o.isPoints && (o.material.uniforms.uPx.value = innerHeight * pixelRatio * 0.9));
}
addEventListener('resize', resize);
function adapt(now) {
  if (params.get('dpr') || now - lastAdapt < 2.5) return;
  lastAdapt = now;
  const target = Q >= 2 ? 55 : 45;
  const maxPR = Math.min(window.devicePixelRatio || 1, Q >= 2 ? 1.75 : Q >= 1 ? 1.4 : 1.1);
  if (fps < target - 8 && pixelRatio > 0.6) { pixelRatio = Math.max(0.6, pixelRatio - 0.1); resize(); }
  else if (fps > target + 4 && pixelRatio < maxPR) { pixelRatio = Math.min(maxPR, pixelRatio + 0.05); resize(); }
}
function tick() {
  const dt = Math.min(0.05, clock.getDelta());
  const t = clock.elapsedTime;
  frame++;
  U.uTime.value = t;
  renderer.info.reset();
  if (state.playing) { setTime(state.time + dt * 0.022 * state.speed); if (state.time > 19.4) { state.playing = false; $('#play').classList.remove('on'); } }
  updateControls(dt);
  U.uCam.value.copy(camera.position);
  W.trees.update(camera);
  W.props.update(camera);
  W.traffic.update(dt, t, camera);
  if (audio.on) audio.update(dt, coastDist(camera.position.x, camera.position.z), camera.position.y - Math.max(0, groundH(camera.position.x, camera.position.z)), U.uNight.value);
  if (frame % (Q >= 2 ? 1 : 2) === 0 || frame < 3) renderShadow();
  if (W.water && Q >= 1 && (Q >= 2 || frame % 2 === 0)) {
    // reflections: buildings, sky, lights, landmarks (no small clutter)
    const hide = [W.trees.group, W.ground, W.roads.group, W.traffic.group, ...W.props.noReflect];
    for (const g of hide) g.visible = false;
    W.water.renderReflection(renderer, scene, camera, Q >= 2 ? 0.4 : 0.25);
    for (const g of hide) g.visible = true;
  }
  if (composer) composer.render(); else renderer.render(scene, camera);
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 1) { fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; adapt(t); if (!$('#stats').hidden) $('#stats').textContent = `${fps.toFixed(0)} fps · ${renderer.info.render.calls} draws · ${(renderer.info.render.triangles / 1e6).toFixed(2)}M tris · dpr ${pixelRatio.toFixed(2)} · Q${Q}`; }
  requestAnimationFrame(tick);
}

// ------------------------------------------------------------------ start
(async () => {
  try {
    await build();
  } catch (e) { $('#loadtxt').textContent = 'Could not build the city: ' + e.message; console.error(e); return; }
  resize();
  const start = PLACES[0];
  goto(resolvePlace(start));
  setTime(+(params.get('t') || start.time || 17.6));
  if (params.get('p')) { const p = PLACES[+params.get('p')]; if (p) { goto(resolvePlace(p)); if (p.time && !params.get('t')) setTime(p.time); } }
  $('#loading').classList.add('done');
  $('#start').hidden = false;
  if (params.has('play')) $('#start').hidden = true;
  $('#startBtn').addEventListener('click', () => { $('#start').hidden = true; if (!audio.on) { audio.toggle(); $('#soundBtn').classList.add('on'); } canvas.focus(); });
  $('#soundBtn').addEventListener('click', () => { const on = audio.toggle(); $('#soundBtn').classList.toggle('on', on); $('#soundBtn').setAttribute('aria-label', on ? 'Sound off' : 'Sound on'); });
  tick();
  // test hooks
  window.MD = {
    W, U, state, camera, renderer, hide: (n) => { scene.getObjectByName(n).visible = false; }, geo: { coastDist, beachAt, groundH, insideBuilding },
    goto: (x, y, z, yawDeg = 0, pitchDeg = 0, mode = 'fly') => { goto({ name: '', x, y, z, yaw: yawDeg * Math.PI / 180, pitch: pitchDeg * Math.PI / 180, mode }); },
    place: (i) => { const p = PLACES[i]; goto(resolvePlace(p)); if (p.time) setTime(p.time); },
    profile: () => {
      const out = {}; const kids = scene.children.slice();
      const vis = kids.map(k => k.visible);
      for (const k of kids) {
        kids.forEach(o => o.visible = o === k || o === W.sky);
        renderer.info.reset(); renderer.render(scene, camera);
        out[k.name || k.type] = [renderer.info.render.calls, renderer.info.render.triangles];
      }
      kids.forEach((o, i) => o.visible = vis[i]);
      U.uShadowOn.value = 1; renderer.info.reset(); renderShadow(); out.shadowPass = [renderer.info.render.calls, renderer.info.render.triangles];
      return out;
    },
    setTime, fps: () => fps, info: () => ({ ...renderer.info.render, gpu: (() => { const gl = renderer.getContext(), e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : '?'; })(), fps, pixelRatio, Q, trees: W.trees.count, vehicles: W.traffic.count, tetrapods: W.props.tetrapods, lamps: W.props.lampCount }),
  };
})();
