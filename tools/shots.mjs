// Renders poses to _build/shots/*.png.  node tools/shots.mjs [w h] [mobile] [poses.json]
import { launch } from './browser.mjs';
import fs from 'node:fs';
const args = process.argv.slice(2);
const W = +(args[0] || 1366), H = +(args[1] || 768), mobile = args.includes('mobile');
const posesFile = args.find(a => a.endsWith('.json'));
const poses = posesFile ? JSON.parse(fs.readFileSync(posesFile)) : [{ name: 'p0', place: 0 }];
const out = '_build/shots'; fs.mkdirSync(out, { recursive: true });
const br = await launch();
const ctx = await br.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
const pg = await ctx.newPage();
const logs = [];
pg.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.type() + ': ' + m.text()); });
pg.on('pageerror', e => logs.push('pageerror: ' + e.message));
const t0 = Date.now();
await pg.goto('file://' + process.cwd() + '/index.html#play' + (process.env.Q ? '&q=' + process.env.Q : '') + '&dpr=1');
await pg.waitForFunction(() => window.MD || document.querySelector('#loadtxt')?.textContent.startsWith('Could'), null, { timeout: 180000 });
console.log('loaded in', ((Date.now() - t0) / 1000).toFixed(1), 's', await pg.evaluate(() => document.querySelector('#loadtxt').textContent));
for (const p of poses) {
  await pg.evaluate(p => {
    if (p.place != null) MD.place(p.place);
    if (p.at) MD.goto(...p.at);
    if (p.t != null) MD.setTime(p.t);
    if (p.yaw != null) MD.state.yaw = p.yaw * Math.PI / 180;
    if (p.pitch != null) MD.state.pitch = p.pitch * Math.PI / 180;
    if (p.hideUI) document.querySelectorAll('#top,#bottom,.hint,#joy,#fly,#credit').forEach(e => e.style.visibility = 'hidden');
  }, p);
  await pg.waitForTimeout(p.wait || 1500);
  await pg.screenshot({ path: `${out}/${p.name}.png` });
  console.log(p.name, JSON.stringify(await pg.evaluate(() => MD.info())));
}
if (logs.length) console.log(logs.slice(0, 20).join('\n'));
await br.close();
