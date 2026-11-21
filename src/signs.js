// Shop signboards painted at load time on a canvas (code-made, uses the device's own fonts): English + Marathi/Hindi.
import * as THREE from 'three';

const BOARDS = [
  ['MEDICAL & GENERAL STORES', '#b51f1a', '#fff'], ['मेडिकल स्टोअर्स', '#1d4e9a', '#fff'], ['JUICE CENTRE', '#e8b21c', '#7a1a10'],
  ['किराणा माल', '#c8341c', '#ffe9a0'], ['SHREE GANESH TAILORS', '#1f5f3a', '#fff'], ['VADA PAV · CHAI', '#d9481a', '#fff6d0'],
  ['IRANI CAFE & BAKERY', '#2a2a2a', '#f2d27a'], ['उपाहार गृह', '#7a1f1a', '#ffe0a0'], ['OPTICIANS', '#1b3c6e', '#fff'],
  ['PHOTO STUDIO', '#5a2a7a', '#fff'], ['BOOK DEPOT', '#2d5a2a', '#f4f0d8'], ['मोबाइल रिपेअर', '#0f6e8a', '#fff'],
  ['HARDWARE & PAINTS', '#c43a12', '#fff'], ['SWEET MART', '#d4142a', '#ffe14d'], ['TRAVELS · TICKETING', '#174a8a', '#ffd24d'],
  ['सलून', '#2a2a2a', '#ff6b4a'], ['STATIONERY', '#e3c04a', '#1d2a5a'], ['ELECTRICALS', '#0e4f7a', '#ffde59'],
  ['DRY CLEANERS', '#3a6fb0', '#fff'], ['पान भांडार', '#1d6e3a', '#fff3a0'], ['CHEMIST', '#178a4a', '#fff'],
  ['RESTAURANT · BAR', '#5a1218', '#f2c46a'], ['JEWELLERS', '#7a1220', '#f7d36a'], ['साडी सेंटर', '#b8155a', '#fff'],
  ['XEROX · PRINTS', '#203050', '#fff'], ['FOOTWEAR', '#8a3a12', '#fff'], ['BHEL PURI', '#e04a1a', '#fff8d0'],
  ['DAIRY', '#f2f2ec', '#1a4a8a'], ['WATCH CO.', '#222', '#e6e6e6'], ['भाजी मंडई', '#3a7a1a', '#fff'],
  ['GENERAL STORES', '#1a5a9a', '#fff'], ['LAUNDRY', '#0a7a7a', '#fff'],
];
export function makeSignAtlas() {
  const C = 4, R = 8, W = 256, H = 64;
  const c = document.createElement('canvas'); c.width = C * W; c.height = R * H;
  const g = c.getContext('2d');
  const dev = '"Kohinoor Devanagari","Noto Sans Devanagari","Mangal","Nirmala UI",sans-serif';
  BOARDS.forEach(([t, bg, fg], i) => {
    const x = (i % C) * W, y = Math.floor(i / C) * H;
    g.fillStyle = bg; g.fillRect(x, y, W, H);
    g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(x, y + H - 5, W, 5);
    g.strokeStyle = fg; g.globalAlpha = 0.5; g.lineWidth = 2; g.strokeRect(x + 4, y + 4, W - 8, H - 8); g.globalAlpha = 1;
    const isDev = /[ऀ-ॿ]/.test(t);
    let size = isDev ? 34 : 30;
    g.font = `700 ${size}px ${isDev ? dev : '"Arial Narrow","Helvetica Neue",Arial,sans-serif'}`;
    while (g.measureText(t).width > W - 24 && size > 12) { size -= 1; g.font = `700 ${size}px ${isDev ? dev : '"Arial Narrow","Helvetica Neue",Arial,sans-serif'}`; }
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(t, x + W / 2, y + H / 2 - 5);
    g.font = '600 11px Arial,sans-serif'; g.globalAlpha = 0.85;
    g.fillText('☎ 22' + (10 + (i * 37) % 89) + ' ' + (1000 + (i * 7919) % 8999), x + W / 2, y + H - 13);
    g.globalAlpha = 1;
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
  return { tex, count: BOARDS.length, cols: C, rows: R };
}
