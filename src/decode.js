// Decodes the varint/base64 layout streams from data.js
import * as D from './data.js';

function reader(b64) {
  const s = atob(b64), n = s.length, u = new Uint8Array(n);
  for (let i = 0; i < n; i++) u[i] = s.charCodeAt(i);
  let p = 0;
  const vu = () => { let r = 0, m = 1, b; do { b = u[p++]; r += (b & 127) * m; m *= 128; } while (b & 128); return r; };
  const vs = () => { const v = vu(); return v & 1 ? -(v + 1) / 2 : v / 2; };
  const line = () => { const c = vu(), a = new Float32Array(c * 2); let x = 0, z = 0; for (let i = 0; i < c; i++) { x += vs(); z += vs(); a[i * 2] = x / 4; a[i * 2 + 1] = z / 4; } return a; };
  return { vu, vs, line, more: () => p < n };
}

export function decode() {
  const out = { bounds: D.BOUNDS, roadNames: D.ROAD_NAMES, land: [], roads: [], buildings: [], areas: [], rails: [], trees: null, walls: [] };
  let r = reader(D.LAND); while (r.more()) out.land.push(r.line());
  r = reader(D.ROADS);
  while (r.more()) { const cls = r.vu(), lanes = r.vu(), f = r.vu(), name = r.vu(); out.roads.push({ cls, lanes, oneway: f & 1, bridge: (f >> 1) & 1, layer: f >> 2, name: name ? D.ROAD_NAMES[name - 1] : '', pts: r.line() }); }
  r = reader(D.BUILDINGS);
  while (r.more()) { const type = r.vu(), lv = r.vu(), h = r.vu() / 2, nm = r.vu(); out.buildings.push({ type, lv, h, lm: nm ? D.LANDMARKS[nm - 1] : '', pts: r.line() }); }
  r = reader(D.AREAS); while (r.more()) { const k = r.vu(); out.areas.push({ k, pts: r.line() }); }
  r = reader(D.RAILS); while (r.more()) { const k = r.vu(); out.rails.push({ k, pts: r.line() }); }
  r = reader(D.TREES); out.trees = r.line();
  r = reader(D.WALLS); while (r.more()) { const k = r.vu(); out.walls.push({ k, pts: r.line() }); }
  return out;
}
