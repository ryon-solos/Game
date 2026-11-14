// Every surface in the game is generated here at load time: no image downloads.
// Texture resolution follows the graphics quality (q.tex = 0.5 | 1 | 2).
import * as THREE from 'three';

let Q = 1;
// a canvas drawn in `s` logical units, backed by s*Q real pixels
function cv(s = 512) { const c = document.createElement('canvas'); c.width = c.height = Math.round(s * Q); const x = c.getContext('2d'); x.scale(Q, Q); return [c, x]; }
let seed = 1337;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const rr = (a, b) => a + rnd() * (b - a);

function grain(ctx, s, amp) {
  const n = Math.round(s * Q), img = ctx.getImageData(0, 0, n, n), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = (rnd() - 0.5) * amp;
    d[i] += v; d[i + 1] += v; d[i + 2] += v;
  }
  ctx.putImageData(img, 0, 0);
}
function stains(ctx, s, n, col, maxR = 120) {
  for (let i = 0; i < n; i++) {
    const x = rr(0, s), y = rr(0, s), r = rr(20, maxR);
    for (const [ox, oy] of [[0, 0], [s, 0], [-s, 0], [0, s], [0, -s]]) {   // tileable
      const g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
      g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
    }
  }
}
function drips(ctx, s, n, col) {
  ctx.strokeStyle = col;
  for (let i = 0; i < n; i++) {
    const x = rr(0, s); ctx.lineWidth = rr(1, 5); ctx.globalAlpha = rr(0.1, 0.4);
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + rr(-4, 4), rr(s * 0.2, s)); ctx.stroke();
  }
  ctx.globalAlpha = 1;
}
function cracks(ctx, s, n, col, w = 1.2, step = 34) {
  ctx.strokeStyle = col; ctx.lineWidth = w;
  for (let i = 0; i < n; i++) { let px = rr(0, s), py = rr(0, s); ctx.beginPath(); ctx.moveTo(px, py); for (let k = 0; k < 10; k++) { px += rr(-step, step); py += rr(-step, step); ctx.lineTo(px, py); } ctx.stroke(); }
}
function tex(c, aniso, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso;
  return t;
}

export function makeTextures(q = {}) {
  Q = q.tex || 1; seed = 1337;
  const aniso = q.aniso || 4;
  const T = {};
  { // brick: colour + a separate height map so the mortar is really recessed
    const [c, x] = cv(), [ch, xh] = cv();
    x.fillStyle = '#3a342f'; x.fillRect(0, 0, 512, 512); xh.fillStyle = '#202020'; xh.fillRect(0, 0, 512, 512);
    const rows = 16, cols = 4, bh = 512 / rows, bw = 512 / cols;
    for (let r = 0; r < rows; r++) for (let k = -1; k < cols; k++) {
      const ox = (r % 2) * bw / 2, l = rr(38, 62), sat = rr(15, 40), hue = rr(8, 24), in2 = rr(0, 1.5);
      x.fillStyle = `hsl(${hue},${sat}%,${l}%)`;
      x.fillRect(k * bw + ox + 2, r * bh + 2, bw - 4, bh - 4);
      x.fillStyle = 'rgba(0,0,0,0.18)'; x.fillRect(k * bw + ox + 2, r * bh + bh - 6, bw - 4, 4);
      x.fillStyle = 'rgba(255,255,255,0.06)'; x.fillRect(k * bw + ox + 2, r * bh + 2, bw - 4, 3);
      const hv = rr(150, 230) | 0; xh.fillStyle = `rgb(${hv},${hv},${hv})`; xh.fillRect(k * bw + ox + 2 + in2, r * bh + 2 + in2, bw - 4 - in2 * 2, bh - 4 - in2 * 2);
    }
    stains(x, 512, 14, 'rgba(0,0,0,0.3)'); drips(x, 512, 20, '#0c0a08'); grain(x, 512, 34);
    stains(xh, 512, 10, 'rgba(0,0,0,0.25)', 60); grain(xh, 512, 30);
    T.brick = tex(c, aniso); T.brickH = tex(ch, aniso, false);
  }
  { // damask wallpaper (neutral so the material colour can tint it)
    const [c, x] = cv(); x.fillStyle = '#b9b4aa'; x.fillRect(0, 0, 512, 512);
    const motif = (cx, cy, s) => {
      x.save(); x.translate(cx, cy); x.scale(s, s); x.fillStyle = 'rgba(70,62,52,0.28)';
      for (const m of [1, -1]) {
        x.save(); x.scale(m, 1); x.beginPath();
        x.moveTo(0, -60); x.bezierCurveTo(34, -44, 44, -10, 12, 0); x.bezierCurveTo(52, 6, 40, 46, 0, 62);
        x.bezierCurveTo(14, 36, 16, 20, 0, 12); x.bezierCurveTo(10, -8, 12, -30, 0, -60); x.fill();
        x.beginPath(); x.ellipse(36, -52, 9, 15, 0.6, 0, 7); x.fill();
        x.beginPath(); x.ellipse(40, 56, 8, 13, -0.6, 0, 7); x.fill();
        x.restore();
      }
      x.beginPath(); x.arc(0, 0, 6, 0, 7); x.fill(); x.restore();
    };
    for (let i = -1; i < 3; i++) for (let j = -1; j < 3; j++) { motif(i * 256 + 128, j * 256 + 128, 0.95); motif(i * 256, j * 256, 0.95); }
    stains(x, 512, 10, 'rgba(40,30,20,0.25)', 160); drips(x, 512, 14, '#2a221a'); grain(x, 512, 26);
    T.paper = tex(c, aniso);
  }
  { // striped wallpaper, peeling
    const [c, x] = cv(); x.fillStyle = '#bdb8ac'; x.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 16; i++) { x.fillStyle = i % 2 ? 'rgba(60,50,40,0.22)' : 'rgba(255,250,235,0.08)'; x.fillRect(i * 32, 0, i % 2 ? 12 : 4, 512); }
    for (let i = 0; i < 7; i++) { const px = rr(0, 512), py = rr(0, 512), w = rr(30, 90), h = rr(40, 140); x.fillStyle = 'rgba(96,90,82,0.9)'; x.beginPath(); x.moveTo(px, py); x.lineTo(px + w, py + rr(-10, 10)); x.lineTo(px + w * rr(0.4, 1), py + h); x.lineTo(px + rr(-10, 10), py + h * rr(0.5, 1)); x.fill(); }
    stains(x, 512, 10, 'rgba(40,30,20,0.3)', 150); drips(x, 512, 18, '#2a221a'); grain(x, 512, 26);
    T.stripe = tex(c, aniso);
  }
  { // bare plaster, cracked and damp
    const [c, x] = cv(); x.fillStyle = '#b0aca2'; x.fillRect(0, 0, 512, 512);
    stains(x, 512, 22, 'rgba(60,54,40,0.25)', 150); stains(x, 512, 10, 'rgba(255,255,255,0.1)', 90); stains(x, 512, 5, 'rgba(30,50,40,0.3)', 110);
    cracks(x, 512, 9, 'rgba(20,16,12,0.6)', 1.1); drips(x, 512, 16, '#221c16'); grain(x, 512, 34);
    T.plaster = tex(c, aniso);
  }
  { // floorboards
    const [c, x] = cv(); const n = 8, ph = 512 / n;
    for (let i = 0; i < n; i++) {
      x.fillStyle = `hsl(${rr(22, 32)},${rr(22, 36)}%,${rr(26, 40)}%)`; x.fillRect(0, i * ph, 512, ph);
      const cut = rr(0, 512);
      x.fillStyle = 'rgba(0,0,0,0.55)'; x.fillRect(0, i * ph, 512, 2.5); x.fillRect(cut, i * ph, 2.5, ph);
      x.strokeStyle = 'rgba(0,0,0,0.13)';
      for (let g = 0; g < 9; g++) { const y = i * ph + rr(4, ph - 4); x.lineWidth = rr(0.5, 2); x.beginPath(); x.moveTo(0, y); x.bezierCurveTo(170, y + rr(-5, 5), 340, y + rr(-5, 5), 512, y); x.stroke(); }
      for (let k = 0; k < 2; k++) { x.fillStyle = 'rgba(20,12,6,0.5)'; x.beginPath(); x.ellipse(rr(0, 512), i * ph + rr(10, ph - 10), rr(3, 8), rr(2, 5), 0, 0, 7); x.fill(); }
    }
    stains(x, 512, 8, 'rgba(0,0,0,0.3)'); grain(x, 512, 22);
    T.planks = tex(c, aniso);
  }
  { // furniture wood
    const [c, x] = cv(256); x.fillStyle = '#6b513a'; x.fillRect(0, 0, 256, 256);
    x.strokeStyle = 'rgba(20,10,0,0.25)';
    for (let g = 0; g < 60; g++) { const y = rr(0, 256); x.lineWidth = rr(0.5, 2.5); x.beginPath(); x.moveTo(0, y); x.bezierCurveTo(80, y + rr(-9, 9), 170, y + rr(-9, 9), 256, y); x.stroke(); }
    stains(x, 256, 5, 'rgba(0,0,0,0.25)', 70); grain(x, 256, 18);
    T.wood = tex(c, aniso);
  }
  { // concrete
    const [c, x] = cv(); x.fillStyle = '#7d7d7a'; x.fillRect(0, 0, 512, 512);
    stains(x, 512, 26, 'rgba(0,0,0,0.22)'); stains(x, 512, 10, 'rgba(255,255,255,0.07)');
    cracks(x, 512, 6, 'rgba(0,0,0,0.5)');
    grain(x, 512, 40); T.concrete = tex(c, aniso);
  }
  { // precast panels: seams, rust streaks under the fixings
    const [c, x] = cv(); x.fillStyle = '#858583'; x.fillRect(0, 0, 512, 512);
    stains(x, 512, 18, 'rgba(0,0,0,0.2)');
    for (let i = 0; i < 2; i++) for (let j = 0; j < 4; j++) { x.strokeStyle = 'rgba(0,0,0,0.6)'; x.lineWidth = 3; x.strokeRect(i * 256 + 1, j * 128 + 1, 254, 126); x.fillStyle = '#3a2a1c'; for (const [a, b] of [[20, 16], [236, 16]]) { x.beginPath(); x.arc(i * 256 + a, j * 128 + b, 4, 0, 7); x.fill(); x.fillStyle = 'rgba(90,45,15,0.35)'; x.fillRect(i * 256 + a - 2, j * 128 + b, 4, rr(30, 100)); x.fillStyle = '#3a2a1c'; } }
    drips(x, 512, 14, '#14120e'); grain(x, 512, 34); T.panel = tex(c, aniso);
  }
  { // rough stucco
    const [c, x] = cv(); x.fillStyle = '#b4b0a6'; x.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 2600; i++) { x.fillStyle = `rgba(${rnd() < 0.5 ? '0,0,0' : '255,255,255'},${rr(0.03, 0.1)})`; x.beginPath(); x.arc(rr(0, 512), rr(0, 512), rr(1, 4), 0, 7); x.fill(); }
    stains(x, 512, 16, 'rgba(40,34,26,0.28)', 150); cracks(x, 512, 7, 'rgba(20,16,12,0.55)', 1.2);
    for (let i = 0; i < 4; i++) { const px = rr(0, 512), py = rr(0, 512); x.fillStyle = 'rgba(120,84,70,0.85)'; x.beginPath(); x.ellipse(px, py, rr(18, 50), rr(14, 40), rr(0, 3), 0, 7); x.fill(); x.strokeStyle = 'rgba(0,0,0,0.3)'; x.lineWidth = 1; for (let r = 0; r < 3; r++) { x.beginPath(); x.moveTo(px - 40, py - 10 + r * 10); x.lineTo(px + 40, py - 10 + r * 10); x.stroke(); } }
    drips(x, 512, 22, '#191510'); grain(x, 512, 30); T.stucco = tex(c, aniso);
  }
  { // dressed stone blocks
    const [c, x] = cv(); x.fillStyle = '#2c2b28'; x.fillRect(0, 0, 512, 512);
    for (let r = 0; r < 4; r++) for (let k = -1; k < 2; k++) { const ox = (r % 2) * 128; x.fillStyle = `hsl(40,${rr(4, 10)}%,${rr(42, 58)}%)`; x.fillRect(k * 256 + ox + 3, r * 128 + 3, 250, 122); x.fillStyle = 'rgba(255,255,255,0.07)'; x.fillRect(k * 256 + ox + 3, r * 128 + 3, 250, 5); x.fillStyle = 'rgba(0,0,0,0.2)'; x.fillRect(k * 256 + ox + 3, r * 128 + 118, 250, 7); }
    stains(x, 512, 18, 'rgba(0,0,0,0.25)'); drips(x, 512, 12, '#0c0a08'); grain(x, 512, 36); T.stone = tex(c, aniso);
  }
  { // asphalt + where the water stands (roughness map: dark = wet and shiny)
    const [c, x] = cv(); x.fillStyle = '#34363a'; x.fillRect(0, 0, 512, 512);
    stains(x, 512, 20, 'rgba(0,0,0,0.35)'); stains(x, 512, 12, 'rgba(120,130,140,0.12)', 90);
    cracks(x, 512, 5, 'rgba(0,0,0,0.6)', 2, 40);
    grain(x, 512, 60); T.asphalt = tex(c, aniso);
    const [cr, xr] = cv(256); xr.fillStyle = '#b8b8b8'; xr.fillRect(0, 0, 256, 256);
    stains(xr, 256, 9, 'rgba(10,10,10,0.95)', 70); stains(xr, 256, 6, 'rgba(40,40,40,0.6)', 40); grain(xr, 256, 24);
    T.puddle = tex(cr, aniso, false);
  }
  { // tiles
    const [c, x] = cv(256); x.fillStyle = '#2b2b29'; x.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { x.fillStyle = `hsl(48,${rr(6, 14)}%,${rr(52, 68)}%)`; x.fillRect(i * 64 + 2, j * 64 + 2, 60, 60); }
    cracks(x, 256, 3, 'rgba(0,0,0,0.5)', 0.8, 20);
    stains(x, 256, 8, 'rgba(30,20,0,0.3)', 80); grain(x, 256, 20); T.tile = tex(c, aniso);
  }
  { // chequered lino
    const [c, x] = cv(256);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { x.fillStyle = (i + j) % 2 ? `hsl(30,8%,${rr(20, 26)}%)` : `hsl(44,14%,${rr(58, 66)}%)`; x.fillRect(i * 64, j * 64, 64, 64); }
    stains(x, 256, 10, 'rgba(30,20,0,0.35)', 90); cracks(x, 256, 3, 'rgba(0,0,0,0.4)', 0.8, 20); grain(x, 256, 22); T.lino = tex(c, aniso);
  }
  { // worn carpet
    const [c, x] = cv(256); x.fillStyle = '#8a8a8a'; x.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { x.strokeStyle = 'rgba(0,0,0,0.3)'; x.lineWidth = 3; x.strokeRect(i * 64 + 10, j * 64 + 10, 44, 44); x.fillStyle = 'rgba(255,255,255,0.12)'; x.beginPath(); x.arc(i * 64 + 32, j * 64 + 32, 8, 0, 7); x.fill(); }
    stains(x, 256, 9, 'rgba(0,0,0,0.3)', 90); grain(x, 256, 40); T.carpet = tex(c, aniso);
  }
  { // fabric
    const [c, x] = cv(128); x.fillStyle = '#9a9a9a'; x.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 128; i += 2) { x.fillStyle = `rgba(0,0,0,${rr(0.04, 0.16)})`; x.fillRect(i, 0, 1, 128); x.fillRect(0, i, 128, 1); }
    stains(x, 128, 4, 'rgba(0,0,0,0.25)', 50); grain(x, 128, 24); T.fabric = tex(c, aniso);
  }
  { // cardboard / old paper
    const [c, x] = cv(128); x.fillStyle = '#a89070'; x.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 128; i += 3) { x.fillStyle = `rgba(60,40,10,${rr(0.03, 0.12)})`; x.fillRect(0, i, 128, 1); }
    stains(x, 128, 5, 'rgba(50,30,10,0.3)', 50); grain(x, 128, 22); T.card = tex(c, aniso);
  }
  { // metal
    const [c, x] = cv(256); x.fillStyle = '#6c7074'; x.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 256; i++) { x.fillStyle = `rgba(0,0,0,${rr(0, 0.12)})`; x.fillRect(0, i, 256, 1); }
    stains(x, 256, 10, 'rgba(110,50,15,0.4)', 60); grain(x, 256, 20); T.metal = tex(c, aniso);
  }
  { // an old portrait: the face has been scratched out
    const [c, x] = cv(256); const g = x.createRadialGradient(128, 110, 10, 128, 128, 170); g.addColorStop(0, '#4a3a2a'); g.addColorStop(1, '#0c0a08'); x.fillStyle = g; x.fillRect(0, 0, 256, 256);
    x.fillStyle = '#1a1612'; x.beginPath(); x.ellipse(128, 230, 80, 70, 0, 0, 7); x.fill();
    x.fillStyle = '#a89478'; x.beginPath(); x.ellipse(128, 108, 34, 44, 0, 0, 7); x.fill();
    x.strokeStyle = '#0a0806'; x.lineWidth = 2.5; for (let i = 0; i < 26; i++) { x.beginPath(); x.moveTo(rr(92, 164), rr(70, 150)); x.lineTo(rr(92, 164), rr(70, 150)); x.stroke(); }
    stains(x, 256, 6, 'rgba(0,0,0,0.4)', 80); grain(x, 256, 26); T.portrait = tex(c, aniso);
  }
  { // glowing sigil
    const [c, x] = cv(256); x.strokeStyle = '#fff'; x.fillStyle = '#fff'; x.lineCap = 'round';
    x.shadowColor = '#fff'; x.shadowBlur = 10 * Q; x.translate(128, 128);
    x.lineWidth = 5; x.beginPath(); x.arc(0, 0, 110, 0, 7); x.stroke();
    x.lineWidth = 2.5; x.beginPath(); x.arc(0, 0, 92, 0, 7); x.stroke();
    for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2; x.save(); x.rotate(a); x.fillRect(-1.5, -106, 3, rr(5, 11)); x.restore(); }
    x.lineWidth = 4;
    for (let i = 0; i < 3; i++) { const a = i / 3 * Math.PI * 2 - Math.PI / 2; x.beginPath(); x.arc(Math.cos(a) * 38, Math.sin(a) * 38, 30, 0, 7); x.stroke(); x.beginPath(); x.arc(Math.cos(a) * 38, Math.sin(a) * 38, 9, 0, 7); x.fill(); }
    x.beginPath(); x.ellipse(0, -72, 20, 9, 0, 0, 7); x.stroke(); x.beginPath(); x.arc(0, -72, 4, 0, 7); x.fill();
    x.beginPath(); x.moveTo(-78, 46); x.lineTo(0, -88); x.lineTo(78, 46); x.closePath(); x.lineWidth = 2; x.stroke();
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; T.sigil = t;
  }
  { // monster hide: mottled, veined
    const [c, x] = cv(256); x.fillStyle = '#3a3438'; x.fillRect(0, 0, 256, 256);
    stains(x, 256, 30, 'rgba(0,0,0,0.5)', 50); stains(x, 256, 14, 'rgba(120,40,40,0.35)', 40); stains(x, 256, 10, 'rgba(160,150,130,0.18)', 30);
    x.lineCap = 'round';
    for (let i = 0; i < 26; i++) {
      let px = rr(0, 256), py = rr(0, 256); x.strokeStyle = `rgba(${rr(110, 190) | 0},20,24,${rr(0.3, 0.7)})`; x.lineWidth = rr(0.6, 2.4);
      x.beginPath(); x.moveTo(px, py); for (let k = 0; k < 10; k++) { px += rr(-22, 22); py += rr(-6, 26); x.lineTo(px, py); } x.stroke();
    }
    grain(x, 256, 30); T.flesh = tex(c, aniso);
    // the same veins alone, for a pulsing glow under the skin
    const [cg, xg] = cv(256); xg.fillStyle = '#000'; xg.fillRect(0, 0, 256, 256); xg.lineCap = 'round'; seed = 4242;
    for (let i = 0; i < 22; i++) { let px = rr(0, 256), py = rr(0, 256); xg.strokeStyle = `rgba(255,${rr(30, 90) | 0},20,${rr(0.4, 0.9)})`; xg.lineWidth = rr(0.8, 2.6); xg.beginPath(); xg.moveTo(px, py); for (let k = 0; k < 10; k++) { px += rr(-22, 22); py += rr(-6, 26); xg.lineTo(px, py); } xg.stroke(); }
    T.veins = tex(cg, aniso);
  }
  { // soft round sprite (dust, glow)
    const [c, x] = cv(64); const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64); T.soft = new THREE.CanvasTexture(c);
  }
  { // floor stains: old damp, and blood (white-on-transparent, tinted by the decal material)
    const splat = (n, big) => { const [c, x] = cv(256); x.fillStyle = '#fff';
      for (let i = 0; i < n; i++) { const a = rr(0, 6.3), d = rr(0, big ? 60 : 100) * rnd(), r = rr(3, big ? 46 : 16) * (1 - d / 130); x.globalAlpha = rr(0.5, 1); x.beginPath(); x.ellipse(128 + Math.cos(a) * d, 128 + Math.sin(a) * d, r, r * rr(0.6, 1), a, 0, 7); x.fill(); }
      x.globalAlpha = 0.8; x.lineCap = 'round'; x.strokeStyle = '#fff';
      for (let i = 0; i < (big ? 3 : 0); i++) { const a = rr(0, 6.3); x.lineWidth = rr(6, 16); x.beginPath(); x.moveTo(128, 128); x.quadraticCurveTo(128 + Math.cos(a) * 60 + rr(-20, 20), 128 + Math.sin(a) * 60 + rr(-20, 20), 128 + Math.cos(a) * 118, 128 + Math.sin(a) * 118); x.stroke(); }
      return new THREE.CanvasTexture(c); };
    T.blood = splat(46, true); T.stain = splat(70, false);
  }
  { // sky for reflections and ambient light: a dim night dome with a moon glow
    const c = document.createElement('canvas'); c.width = 256; c.height = 128; const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, 128); g.addColorStop(0, '#0b1622'); g.addColorStop(0.45, '#16293a'); g.addColorStop(0.52, '#1c2f3c'); g.addColorStop(0.56, '#0c1014'); g.addColorStop(1, '#050607');
    x.fillStyle = g; x.fillRect(0, 0, 256, 128);
    const m = x.createRadialGradient(60, 30, 0, 60, 30, 46); m.addColorStop(0, 'rgba(210,225,255,1)'); m.addColorStop(0.12, 'rgba(150,180,220,0.7)'); m.addColorStop(1, 'rgba(60,90,130,0)'); x.fillStyle = m; x.fillRect(0, 0, 256, 128);
    const w = x.createRadialGradient(190, 66, 0, 190, 66, 40); w.addColorStop(0, 'rgba(255,150,70,0.5)'); w.addColorStop(1, 'rgba(255,120,50,0)'); x.fillStyle = w; x.fillRect(0, 0, 256, 128);
    const t = new THREE.CanvasTexture(c); t.mapping = THREE.EquirectangularReflectionMapping; t.colorSpace = THREE.SRGBColorSpace; T.sky = t;
  }
  return T;
}

// Lettering: shop boards, neon tubes, numbers, and what people wrote on the walls.
const textCache = new Map();
export function textTexture(text, kind, color = 0xffffff) {
  const key = kind + '|' + text + '|' + color;
  if (textCache.has(key)) return textCache.get(key);
  const c = document.createElement('canvas'), wide = Math.max(2, Math.min(8, text.length * 0.62));
  c.height = 128; c.width = Math.round(128 * wide);
  const x = c.getContext('2d'), col = '#' + color.toString(16).padStart(6, '0');
  x.textAlign = 'center'; x.textBaseline = 'middle';
  const fit = (font, max) => { let s = max; do { x.font = font.replace('%', s); s -= 4; } while (x.measureText(text).width > c.width - 24 && s > 20); };
  if (kind === 'neon') {
    fit('600 %px Georgia, serif', 92); x.shadowColor = col; x.shadowBlur = 18; x.strokeStyle = col; x.lineWidth = 5; x.strokeText(text, c.width / 2, 68);
    x.shadowBlur = 0; x.strokeStyle = '#ffffff'; x.lineWidth = 1.6; x.strokeText(text, c.width / 2, 68);
    // a dead letter
    const dead = text.length > 4 ? (text.charCodeAt(1) * 7) % text.length : -1;
    if (dead >= 0) { const w = (c.width - 24) / text.length; x.globalCompositeOperation = 'destination-out'; x.globalAlpha = 0.85; x.fillRect(12 + dead * w, 0, w, 128); x.globalCompositeOperation = 'source-over'; x.globalAlpha = 1; }
  } else if (kind === 'shop') {
    fit('700 %px Georgia, serif', 88); x.fillStyle = 'rgba(214,200,160,0.9)'; x.fillText(text, c.width / 2, 68);
    x.globalCompositeOperation = 'destination-out'; for (let i = 0; i < 90; i++) { x.globalAlpha = Math.random() * 0.7; x.fillRect(Math.random() * c.width, Math.random() * 128, 2 + Math.random() * 14, 1 + Math.random() * 4); }
  } else if (kind === 'number') {
    x.fillStyle = '#16181a'; x.fillRect(0, 0, c.width, 128); x.strokeStyle = '#a8a08a'; x.lineWidth = 5; x.strokeRect(6, 6, c.width - 12, 116);
    fit('700 %px Georgia, serif', 84); x.fillStyle = '#c8c0a8'; x.fillText(text, c.width / 2, 68);
  } else {   // scrawled
    fit('italic 700 %px "Comic Sans MS", "Segoe Print", cursive', 84);
    x.save(); x.translate(c.width / 2, 64); x.rotate((text.length % 5 - 2) * 0.012); x.fillStyle = '#ffffff';
    for (let i = 0; i < 3; i++) { x.globalAlpha = 0.5; x.fillText(text, (Math.random() - 0.5) * 4, 4 + (Math.random() - 0.5) * 4); }
    x.restore();
    x.globalAlpha = 0.9; x.fillStyle = '#fff'; for (let i = 0; i < text.length; i++) if (text[i] !== ' ' && Math.random() < 0.5) { const px = 20 + (i + 0.5) * (c.width - 40) / text.length; x.fillRect(px, 78, 3 + Math.random() * 3, 14 + Math.random() * 34); }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  textCache.set(key, t);
  return t;
}

// Standard material whose textures are mapped in world space (boxes of any size share one material).
function ws(params, metres) {
  if (params.map && params.bump) { params.bumpMap = params.bumpMap || params.map; params.bumpScale = params.bump; }
  delete params.bump;
  for (const k of Object.keys(params)) if (params[k] === undefined) delete params[k];
  const m = new THREE.MeshStandardMaterial(params);
  m.userData.col = params.color;
  if (!params.map) return m;
  const sc = (1 / metres).toFixed(4);
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
      #ifdef USE_MAP
      {
        vec4 wsp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          wsp = instanceMatrix * wsp;
        #endif
        wsp = modelMatrix * wsp;
        vec3 an = abs(normal);
        vec2 wuv = an.x > 0.5 ? wsp.zy : (an.y > 0.5 ? wsp.xz : wsp.xy);
        vMapUv = wuv * ${sc};
        #ifdef USE_BUMPMAP
          vBumpMapUv = vMapUv;
        #endif
        #ifdef USE_ROUGHNESSMAP
          vRoughnessMapUv = wuv * 0.09;
        #endif
      }
      #endif`);
  };
  m.customProgramCacheKey = () => 'ws' + sc;
  return m;
}

// materials whose boxes get rounded edges (furniture-sized things only)
export const SOFT = new Set(['cloth', 'clothred', 'clothgreen', 'mattress', 'white', 'fridge', 'car', 'car2', 'car3', 'rust', 'wood', 'wooddark', 'black', 'paper', 'meat']);

export function makeMaterials(T, q = {}) {
  const M = {}, bumps = q.bump !== false;
  const S = (k, map, color, rough, metres, extra) => { M[k] = ws(Object.assign({ map, color, roughness: rough, metalness: 0 }, bumps ? extra : Object.assign({}, extra, { bump: 0, bumpMap: undefined })), metres); };
  S('brick', T.brick, 0xa89a90, 0.95, 2.2, { bump: 5, bumpMap: T.brickH }); S('brick2', T.brick, 0x8f9aa0, 0.95, 2.2, { bump: 5, bumpMap: T.brickH }); S('brick3', T.brick, 0xb07a66, 0.95, 2.2, { bump: 5, bumpMap: T.brickH });
  S('stucco1', T.stucco, 0xb9ad98, 0.95, 3.2, { bump: 1.6 }); S('stucco2', T.stucco, 0x86a09c, 0.95, 3.2, { bump: 1.6 }); S('stucco3', T.stucco, 0xa98a80, 0.95, 3.2, { bump: 1.6 });
  S('panel', T.panel, 0x9a9c9c, 0.85, 3, { bump: 2 }); S('stone', T.stone, 0x8f8c84, 0.8, 1.6, { bump: 2.5 });
  S('concrete', T.concrete, 0x9a9c9c, 0.9, 3, { bump: 1.2 }); S('walk', T.stone, 0x767a7e, 0.8, 1.8, { bump: 2 }); S('roof', T.concrete, 0x55595c, 0.95, 3.5, { bump: 1.5 });
  S('asphalt', T.asphalt, 0x8a9096, 1, 5, { bump: 1.6, roughnessMap: bumps ? T.puddle : undefined, metalness: 0.02 });
  S('paint', T.concrete, 0xb8b4a0, 0.8, 2);
  S('floorwood', T.planks, 0xa08a74, 0.55, 2.2, { bump: 1.4 }); S('floorwood2', T.planks, 0x6f6660, 0.5, 2.2, { bump: 1.4 }); S('floortile', T.tile, 0x9aa09c, 0.3, 1.2, { bump: 1.6 });
  S('carpet', T.carpet, 0x70403c, 1, 1.2, { bump: 0.6 }); S('lino', T.lino, 0x9a9c94, 0.35, 1.3, { bump: 0.5 });
  S('ceil', T.plaster, 0x6c6a64, 1, 2.5, { bump: 0.8 });
  [0x6f8f90, 0x7f8a66, 0x9a7474, 0xa08c58, 0x66788f, 0xa39d8c].forEach((c, i) => S('wall' + i, T.paper, c, 0.9, 1.5, { bump: 0.5 }));
  S('wall6', T.stripe, 0x7c9078, 0.9, 1.5, { bump: 0.5 }); S('wall7', T.stripe, 0xb0a084, 0.9, 1.5, { bump: 0.5 }); S('wall8', T.plaster, 0x9c9a92, 0.95, 2.4, { bump: 1.4 });
  S('wood', T.wood, 0xa58a6c, 0.55, 1, { bump: 0.6 }); S('wooddark', T.wood, 0x5d4a3c, 0.45, 1, { bump: 0.6 }); S('bark', T.wood, 0x2e2822, 1, 0.5, { bump: 2.5 });
  S('trimw', T.wood, 0x8f8878, 0.5, 1.2, { bump: 0.4 });
  S('cloth', T.fabric, 0x4f6166, 1, 0.4, { bump: 0.5 }); S('clothred', T.fabric, 0x7a2f2c, 1, 0.4, { bump: 0.5 }); S('clothgreen', T.fabric, 0x4e5a3a, 1, 0.4, { bump: 0.5 });
  S('mattress', T.fabric, 0xa9a290, 1, 0.5, { bump: 0.5 }); S('paper', T.card, 0xb09a78, 0.95, 0.5, { bump: 0.4 });
  S('portrait', T.portrait, 0xb0a898, 0.7, 0.72);
  S('metal', T.metal, 0x8a8f94, 0.4, 1, { metalness: 0.8 }); S('rail', T.metal, 0x3d4246, 0.5, 1, { metalness: 0.75 });
  S('rust', T.metal, 0x7a5236, 0.85, 1.4, { metalness: 0.3, bump: 1 }); S('car', T.metal, 0x35454f, 0.32, 2, { metalness: 0.65 }); S('car2', T.metal, 0x5a2f2c, 0.32, 2, { metalness: 0.65 }); S('car3', T.metal, 0x4a5540, 0.35, 2, { metalness: 0.6 });
  S('white', null, 0xb9bbb6, 0.25); S('fridge', null, 0x9aa3a3, 0.3, 1, { metalness: 0.35 });
  S('black', null, 0x0b0c0e, 0.3, 1, { metalness: 0.45 }); S('mirror', null, 0x8a949c, 0.03, 1, { metalness: 1 });
  S('meat', null, 0x6a1c1a, 0.35); S('tvglass', null, 0x06080a, 0.08, 1, { metalness: 0.6 });
  M.glass = new THREE.MeshStandardMaterial({ color: 0x4a6a62, roughness: 0.06, metalness: 0.4, transparent: true, opacity: 0.38 }); M.glass.userData.col = 0x9ab8b0;
  M.lampglass = new THREE.MeshBasicMaterial({ color: 0x6a5a40 }); M.lampglass.userData.col = 0x6a5a40;
  M.wax = new THREE.MeshStandardMaterial({ color: 0xd8cfb8, roughness: 0.6, emissive: 0x3a2a12 }); M.wax.userData.col = 0xd8cfb8;
  // rubble: one material for every broken piece, tinted per chunk
  M.rubble = new THREE.MeshStandardMaterial({ map: T.concrete, bumpMap: bumps ? T.concrete : null, bumpScale: 2, roughness: 0.9, color: 0xffffff });
  return M;
}
