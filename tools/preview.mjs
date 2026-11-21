// Draws the decoded layout to a PNG (top view) for checking the bake.  node tools/preview.mjs out.png [x0 z0 x1 z1]
import { build } from 'esbuild';
import { launch } from './browser.mjs';
import fs from 'node:fs';
const [out = 'preview.png', ...win] = process.argv.slice(2);
const js = (await build({ stdin: { contents: `import {decode} from './src/decode.js'; window.L = decode();`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife' })).outputFiles[0].text;
const html = `<canvas id=c width=1600 height=1700></canvas><script>${js}
const L = window.L, b = L.bounds, c = document.getElementById('c'), g = c.getContext('2d');
const W = ${JSON.stringify(win.map(Number))};
const [x0,z0,x1,z1] = W.length ? W : [b.x0,b.z0,b.x1,b.z1];
const s = Math.min(1600/(x1-x0), 1700/(z1-z0)); const X = x => (x-x0)*s, Z = z => (z-z0)*s;
g.fillStyle = '#1d4f6b'; g.fillRect(0,0,1600,1700);
const path = (p, close) => { g.beginPath(); for (let i=0;i<p.length;i+=2) (i?g.lineTo:g.moveTo).call(g, X(p[i]), Z(p[i+1])); if (close) g.closePath(); };
g.fillStyle = '#d8d2c4'; for (const r of L.land) { path(r, 1); g.fill(); }
const AC = {1:'#7fb069',2:'#6aa35a',3:'#9cc46a',4:'#b9a27a',5:'#f0dca0',6:'#3f7a3a',7:'#4a90b8',8:'#a89a8a',9:'#bbb',10:'#c8b080',11:'#4fc3e8',12:'#c9a77a',13:'#7a9a6a',14:'#c0603a',15:'#e0d8c8',16:'#a8c878',17:'#ccc'};
for (const a of L.areas) { g.fillStyle = AC[a.k]||'#f0f'; path(a.pts, 1); g.fill(); }
const RW = [14,12,10,8,6,5,3,2,2];
for (const r of L.roads) { g.strokeStyle = r.cls<=1?'#f7c948':r.cls<=3?'#fff':'#eee'; g.lineWidth = RW[r.cls]*s; g.lineCap='round'; path(r.pts); g.stroke(); }
g.fillStyle = '#c9785a'; g.strokeStyle='#7a4030'; g.lineWidth=0.5;
for (const bl of L.buildings) { path(bl.pts,1); g.fill(); g.stroke(); }
for (const r of L.rails) { g.strokeStyle = r.k==3?'#888':'#333'; g.lineWidth = 2*s; path(r.pts); g.stroke(); }
for (const w of L.walls) { g.strokeStyle = '#f0f'; g.lineWidth = 2; path(w.pts); g.stroke(); }
g.fillStyle = '#0a5'; for (let i=0;i<L.trees.length;i+=2) { g.beginPath(); g.arc(X(L.trees[i]),Z(L.trees[i+1]),Math.max(1,4*s),0,7); g.fill(); }
g.fillStyle='#000'; g.font='14px sans-serif'; g.fillText('N up  scale '+(100*s).toFixed(1)+' px/100m', 10, 20);
</script>`;
const br = await launch(); const pg = await br.newPage({ viewport: { width: 1600, height: 1700 } });
await pg.setContent(html); await pg.screenshot({ path: out }); await br.close(); console.log('wrote', out);
