// Every surface in the game is generated here at load time: no image downloads.
import * as THREE from 'three';

function cv(s = 512) { const c = document.createElement('canvas'); c.width = c.height = s; return [c, c.getContext('2d')]; }
let seed = 1337;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const rr = (a, b) => a + rnd() * (b - a);

function grain(ctx, s, amp) {
  const img = ctx.getImageData(0, 0, s, s), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() - 0.5) * amp;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
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
function tex(c, aniso) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso;
  return t;
}

export function makeTextures(aniso = 4) {
  const T = {};
  { // brick
    const [c, x] = cv(); x.fillStyle = '#3a342f'; x.fillRect(0, 0, 512, 512);
    const rows = 16, cols = 4, bh = 512 / rows, bw = 512 / cols;
    for (let r = 0; r < rows; r++) for (let k = -1; k < cols; k++) {
      const ox = (r % 2) * bw / 2, l = rr(38, 62), sat = rr(15, 40), hue = rr(8, 24);
      x.fillStyle = `hsl(${hue},${sat}%,${l}%)`;
      x.fillRect(k * bw + ox + 2, r * bh + 2, bw - 4, bh - 4);
      x.fillStyle = 'rgba(0,0,0,0.18)'; x.fillRect(k * bw + ox + 2, r * bh + bh - 6, bw - 4, 4);
    }
    stains(x, 512, 14, 'rgba(0,0,0,0.3)'); drips(x, 512, 20, '#0c0a08'); grain(x, 512, 34);
    T.brick = tex(c, aniso);
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
  { // floorboards
    const [c, x] = cv(); const n = 8, ph = 512 / n;
    for (let i = 0; i < n; i++) {
      x.fillStyle = `hsl(${rr(22, 32)},${rr(22, 36)}%,${rr(26, 40)}%)`; x.fillRect(0, i * ph, 512, ph);
      const cut = rr(0, 512);
      x.fillStyle = 'rgba(0,0,0,0.5)'; x.fillRect(0, i * ph, 512, 2); x.fillRect(cut, i * ph, 2, ph);
      x.strokeStyle = 'rgba(0,0,0,0.13)';
      for (let g = 0; g < 9; g++) { const y = i * ph + rr(4, ph - 4); x.lineWidth = rr(0.5, 2); x.beginPath(); x.moveTo(0, y); x.bezierCurveTo(170, y + rr(-5, 5), 340, y + rr(-5, 5), 512, y); x.stroke(); }
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
    x.strokeStyle = 'rgba(0,0,0,0.5)'; x.lineWidth = 1.2;
    for (let i = 0; i < 6; i++) { let px = rr(0, 512), py = rr(0, 512); x.beginPath(); x.moveTo(px, py); for (let k = 0; k < 9; k++) { px += rr(-34, 34); py += rr(-34, 34); x.lineTo(px, py); } x.stroke(); }
    grain(x, 512, 40); T.concrete = tex(c, aniso);
  }
  { // asphalt
    const [c, x] = cv(); x.fillStyle = '#34363a'; x.fillRect(0, 0, 512, 512);
    stains(x, 512, 20, 'rgba(0,0,0,0.35)'); stains(x, 512, 12, 'rgba(120,130,140,0.12)', 90);
    x.strokeStyle = 'rgba(0,0,0,0.6)'; x.lineWidth = 2;
    for (let i = 0; i < 5; i++) { let px = rr(0, 512), py = rr(0, 512); x.beginPath(); x.moveTo(px, py); for (let k = 0; k < 12; k++) { px += rr(-40, 40); py += rr(-40, 40); x.lineTo(px, py); } x.stroke(); }
    grain(x, 512, 60); T.asphalt = tex(c, aniso);
  }
  { // tiles
    const [c, x] = cv(256); x.fillStyle = '#2b2b29'; x.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { x.fillStyle = `hsl(48,${rr(6, 14)}%,${rr(52, 68)}%)`; x.fillRect(i * 64 + 2, j * 64 + 2, 60, 60); }
    stains(x, 256, 8, 'rgba(30,20,0,0.3)', 80); grain(x, 256, 20); T.tile = tex(c, aniso);
  }
  { // fabric
    const [c, x] = cv(128); x.fillStyle = '#9a9a9a'; x.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 128; i += 2) { x.fillStyle = `rgba(0,0,0,${rr(0.04, 0.16)})`; x.fillRect(i, 0, 1, 128); x.fillRect(0, i, 128, 1); }
    stains(x, 128, 4, 'rgba(0,0,0,0.25)', 50); grain(x, 128, 24); T.fabric = tex(c, aniso);
  }
  { // metal
    const [c, x] = cv(256); x.fillStyle = '#6c7074'; x.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 256; i++) { x.fillStyle = `rgba(0,0,0,${rr(0, 0.12)})`; x.fillRect(0, i, 256, 1); }
    stains(x, 256, 10, 'rgba(110,50,15,0.4)', 60); grain(x, 256, 20); T.metal = tex(c, aniso);
  }
  { // glowing sigil
    const [c, x] = cv(256); x.clearRect(0, 0, 256, 256); x.strokeStyle = '#fff'; x.fillStyle = '#fff'; x.lineCap = 'round';
    x.shadowColor = '#fff'; x.shadowBlur = 10; x.translate(128, 128);
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
  }
  { // soft round sprite (dust, glow)
    const [c, x] = cv(64); const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64); T.soft = new THREE.CanvasTexture(c);
  }
  return T;
}

// Standard material whose texture is mapped in world space (boxes of any size share one material).
function ws(params, metres) {
  if (params.map && params.bump) { params.bumpMap = params.map; params.bumpScale = params.bump; }
  delete params.bump;
  const m = new THREE.MeshStandardMaterial(params);
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
      }
      #endif`);
  };
  m.customProgramCacheKey = () => 'ws' + sc;
  return m;
}

// materials whose boxes get rounded edges (furniture-sized things only)
export const SOFT = new Set(['cloth', 'clothred', 'clothgreen', 'mattress', 'white', 'fridge', 'car', 'car2', 'rust', 'wood', 'wooddark', 'black']);

export function makeMaterials(T, bumps = true) {
  const M = {};
  const S = (k, map, color, rough, metres, extra) => { M[k] = ws(Object.assign({ map, color, roughness: rough, metalness: 0 }, bumps ? extra : Object.assign({}, extra, { bump: 0 })), metres); };
  S('brick', T.brick, 0xa89a90, 0.95, 2.2, { bump: 2.2 }); S('brick2', T.brick, 0x8f9aa0, 0.95, 2.2, { bump: 2.2 }); S('brick3', T.brick, 0xb07a66, 0.95, 2.2, { bump: 2.2 });
  S('concrete', T.concrete, 0x9a9c9c, 0.9, 3, { bump: 1.2 }); S('walk', T.concrete, 0x80858a, 0.85, 2.4, { bump: 1.2 }); S('roof', T.concrete, 0x55595c, 0.95, 3.5, { bump: 1.5 });
  S('asphalt', T.asphalt, 0x8a9096, 0.55, 5, { bump: 1.6 });
  S('floorwood', T.planks, 0xa08a74, 0.6, 2.2, { bump: 1.2 }); S('floorwood2', T.planks, 0x6f6660, 0.55, 2.2, { bump: 1.2 }); S('floortile', T.tile, 0x9aa09c, 0.35, 1.2, { bump: 1.4 });
  S('ceil', T.concrete, 0x6c6a64, 1, 2.5, { bump: 0.8 });
  [0x6f8f90, 0x7f8a66, 0x9a7474, 0xa08c58, 0x66788f, 0xa39d8c].forEach((c, i) => S('wall' + i, T.paper, c, 0.9, 1.5, { bump: 0.5 }));
  S('wood', T.wood, 0xa58a6c, 0.6, 1, { bump: 0.6 }); S('wooddark', T.wood, 0x5d4a3c, 0.5, 1, { bump: 0.6 }); S('bark', T.wood, 0x2e2822, 1, 0.5, { bump: 2.5 });
  S('cloth', T.fabric, 0x4f6166, 1, 0.4, { bump: 0.5 }); S('clothred', T.fabric, 0x7a2f2c, 1, 0.4, { bump: 0.5 }); S('clothgreen', T.fabric, 0x4e5a3a, 1, 0.4, { bump: 0.5 });
  S('mattress', T.fabric, 0xa9a290, 1, 0.5, { bump: 0.5 });
  S('metal', T.metal, 0x8a8f94, 0.45, 1, { metalness: 0.75 }); S('rail', T.metal, 0x3d4246, 0.55, 1, { metalness: 0.7 });
  S('rust', T.metal, 0x7a5236, 0.85, 1.4, { metalness: 0.3, bump: 1 }); S('car', T.metal, 0x35454f, 0.4, 2, { metalness: 0.6 }); S('car2', T.metal, 0x5a2f2c, 0.4, 2, { metalness: 0.6 });
  S('white', null, 0xb9bbb6, 0.3); S('fridge', null, 0x9aa3a3, 0.35, 1, { metalness: 0.3 });
  S('black', null, 0x0b0c0e, 0.35, 1, { metalness: 0.4 }); S('mirror', null, 0x566068, 0.08, 1, { metalness: 1 });
  M.glass = new THREE.MeshStandardMaterial({ color: 0x35584a, roughness: 0.08, metalness: 0.3, transparent: true, opacity: 0.7 });
  M.lampglass = new THREE.MeshBasicMaterial({ color: 0x6a5a40 });
  M.wax = new THREE.MeshStandardMaterial({ color: 0xd8cfb8, roughness: 0.6, emissive: 0x3a2a12 });
  return M;
}
