// Bundles src/ (three.js included) into one self-contained index.html.
import { build } from 'esbuild';
import fs from 'node:fs';
const dev = process.argv.includes('--dev');
const r = await build({ entryPoints: ['src/main.js'], bundle: true, write: false, format: 'esm', minify: !dev, target: 'es2020', legalComments: 'none', sourcemap: dev ? 'inline' : false });
const js = r.outputFiles[0].text.replace(/<\/script/g, '<\\/script');
const html = fs.readFileSync('template.html', 'utf8').replace('/*APP*/', () => js);
fs.writeFileSync('index.html', html);
console.log('index.html', (html.length / 1024).toFixed(0) + ' KB', dev ? '(dev)' : '');
// artifact variant: the viewer wraps the page in its own document skeleton
fs.mkdirSync('artifact', { recursive: true });
const art = html.replace('<!doctype html>\n', '').replace('<html lang="en">\n', '').replace('<head>\n', '').replace('</head>\n', '')
  .replace('<body data-mode="walk">', '<script>document.body.dataset.mode="walk";</script>').replace('</body>\n</html>\n', '').replace('html,body{margin:0;height:100%;', 'html,body{margin:0;height:100%;padding:0!important;');
fs.writeFileSync('artifact/marine-drive-explorer.html', art);
console.log('artifact', (art.length / 1024).toFixed(0) + ' KB');
