// Deterministic street generator. Runs identically on the server and in the browser,
// so only the seed has to travel over the network.

export const K = {
  BW: 12,      // building width (along the street, x)
  BD: 10,      // building depth
  FH: 3.2,     // floor height
  NB: 10,      // buildings per side
  FRONT: 8,    // |z| of the building fronts
  ROAD: 5,     // |z| of the kerb
  SW: 3,       // stairwell width
  T: 0.2,      // wall thickness
  BALC: 1.4,   // balcony depth
};

export function rng32(a) {
  a = a >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The street changes every (UTC) day.
export function dailySeed() {
  const d = new Date();
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}

export function genWorld(seed) {
  const { BW, BD, FH, NB, FRONT, SW, T, BALC } = K;
  const R = rng32(Math.imul(seed | 0, 2654435761) ^ 0x9e3779b9);
  const rr = (a, b) => a + R() * (b - a);
  const pick = (arr) => arr[(R() * arr.length) | 0];
  const L = NB * BW;

  const W = {
    seed, L,
    boxes: [], props: [], cables: [], closets: [], doors: [], flats: [], buildings: [], lamps: [], lights: [], decals: [],
    spots: { street: [], balcony: [], roof: [], flat: [], closet: [] },
    spawns: [],
  };
  const push = (b) => W.boxes.push(b);
  const raw = (x0, x1, y0, y1, z0, z1, m, o = {}) => push({
    x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: (z0 + z1) / 2,
    sx: Math.abs(x1 - x0), sy: y1 - y0, sz: Math.abs(z1 - z0), m, c: o.c !== false, g: o.g, nv: o.nv, fu: o.fu,
  });
  // round shapes: s = cyl | cone | sph | tor (unit size 1, scaled; cylinders/cones stand along y before rotation)
  const prop = (s, x, y, z, sx, sy, sz, m, o = {}) => W.props.push({ s, x, y, z, sx, sy, sz, m, rx: o.rx || 0, ry: o.ry || 0, rz: o.rz || 0, g: o.g });

  // ---------------------------------------------------------------- street
  raw(-10, L + 10, -1, 0, -20, 20, 'asphalt', { nv: true });
  for (const s of [1, -1]) {
    raw(-8, L + 8, 0, 0.12, s * 5, s * 8, 'walk');
    raw(-8, 0, 0, 14, s * 8, s * 8.4, 'brick');
    raw(L, L + 8, 0, 14, s * 8, s * 8.4, 'brick');
  }
  raw(-9, -8, 0, 14, -9, 9, 'concrete');
  raw(L + 8, L + 9, 0, 14, -9, 9, 'concrete');
  // street lamps
  for (let k = 0, x = 10; x < L; x += 22, k++) {
    const s = k % 2 ? 1 : -1;
    raw(x - 0.08, x + 0.08, 0, 5.2, s * 5.5 - 0.08, s * 5.5 + 0.08, 'metal', { nv: true });
    prop('cyl', x, 2.6, s * 5.5, 0.14, 5.2, 0.14, 'metal'); prop('cyl', x, 0.25, s * 5.5, 0.3, 0.5, 0.3, 'metal');
    prop('sph', x, 5.2, s * 5.5, 0.2, 0.2, 0.2, 'metal');
    raw(x - 0.06, x + 0.06, 5.1, 5.2, s * 4.3, s * 5.5, 'metal', { c: false });
    raw(x - 0.22, x + 0.22, 4.95, 5.1, s * 4.1, s * 4.6, 'metal', { c: false });
    W.lamps.push({ x, y: 4.9, z: s * 4.35, broken: R() < 0.3, flicker: R() < 0.5 });
  }
  // wrecked cars parked along the kerbs (the monster keeps to the centre lane)
  for (let x = 14; x < L - 8; x += rr(14, 26)) {
    const s = R() < 0.5 ? 1 : -1, z = s * 3.9, m = pick(['car', 'rust', 'car2']);
    raw(x - 2.1, x + 2.1, 0.3, 1.0, z - 0.85, z + 0.85, m);
    raw(x - 1.1, x + 1.2, 1.0, 1.55, z - 0.78, z + 0.78, 'black');
    raw(x - 1.15, x + 1.25, 1.55, 1.62, z - 0.8, z + 0.8, m, { c: false });
    for (const wx of [-1.4, 1.4]) for (const wz of [-0.8, 0.8]) {
      prop('cyl', x + wx, 0.33, z + wz, 0.66, 0.24, 0.66, 'black', { rx: Math.PI / 2 });
      prop('cyl', x + wx, 0.33, z + wz * 1.02, 0.34, 0.25, 0.34, 'metal', { rx: Math.PI / 2 });
    }
    prop('sph', x - 2.05, 0.72, z - 0.55, 0.22, 0.2, 0.22, 'white'); prop('sph', x - 2.05, 0.72, z + 0.55, 0.22, 0.2, 0.22, 'white');
  }
  // dumpsters / crates on the pavements
  for (let x = 6; x < L; x += rr(9, 20)) {
    const s = R() < 0.5 ? 1 : -1, z = s * rr(5.6, 6.0);
    const kind = R();
    if (kind < 0.3) { raw(x - 0.9, x + 0.9, 0.12, 1.3, z - 0.5, z + 0.5, 'rust'); prop('cyl', x, 1.3, z, 0.5, 1.8, 1.0, 'rust', { rz: Math.PI / 2 }); }
    else if (kind < 0.5) raw(x - 0.4, x + 0.4, 0.12, 0.92, z - 0.4, z + 0.4, 'wood');
    else if (kind < 0.75) {                     // oil drum, some of them burning
      raw(x - 0.3, x + 0.3, 0.12, 1.0, z - 0.3, z + 0.3, 'rust', { nv: true });
      prop('cyl', x, 0.56, z, 0.62, 0.88, 0.62, 'rust'); prop('tor', x, 0.4, z, 0.64, 0.64, 0.64, 'metal'); prop('tor', x, 0.75, z, 0.64, 0.64, 0.64, 'metal');
      if (R() < 0.45) W.lights.push({ x, y: 1.25, z, kind: 'fire', flat: -1 });
    } else {                                    // dead tree
      raw(x - 0.18, x + 0.18, 0.12, 3, z - 0.18, z + 0.18, 'wooddark', { nv: true });
      const th = rr(3, 4.2);
      prop('cyl', x, 0.12 + th / 2, z, 0.4, th, 0.4, 'bark'); prop('cone', x, 0.3, z, 0.9, 0.6, 0.9, 'bark');
      const nb = 5 + ((R() * 4) | 0);
      for (let k = 0; k < nb; k++) {
        const rx = rr(-1.1, 1.1), rz = rr(-1.1, 1.1), len = rr(1.4, 2.8), by = 0.12 + th * rr(0.55, 1);
        const ax = -Math.sin(rz), ay = Math.cos(rz) * Math.cos(rx), az = Math.cos(rz) * Math.sin(rx);
        prop('cone', x + ax * len / 2, by + ay * len / 2, z + az * len / 2, 0.2, len, 0.2, 'bark', { rx, rz });
        const r2x = rx + rr(-0.7, 0.7), r2z = rz + rr(-0.7, 0.7), l2 = len * 0.6;
        const bx2 = -Math.sin(r2z), by2 = Math.cos(r2z) * Math.cos(r2x), bz2 = Math.cos(r2z) * Math.sin(r2x);
        prop('cone', x + ax * len * 0.55 + bx2 * l2 / 2, by + ay * len * 0.55 + by2 * l2 / 2, z + az * len * 0.55 + bz2 * l2 / 2, 0.1, l2, 0.1, 'bark', { rx: r2x, rz: r2z });
      }
    }
  }
  // sagging cables across the street, manholes
  for (let x = 5; x < L; x += rr(7, 15)) W.cables.push({ a: [x, rr(6, 10.5), -FRONT], b: [x + rr(-5, 5), rr(6, 10.5), FRONT], sag: rr(0.5, 1.5) });
  for (let x = 9; x < L; x += rr(16, 30)) prop('cyl', x, 0.012, rr(-2, 2), 0.9, 0.02, 0.9, 'metal');
  for (let i = 0; i < 40; i++) W.spots.street.push({ x: rr(4, L - 4), y: 0.7, z: rr(-4.6, 4.6) });

  // ---------------------------------------------------------------- furniture catalogue
  // each piece is described in a wall-relative frame: a = along the wall, b = away from it
  const CAT = {
    bed: { w: 1.6, d: 2.1, h: 0.55, top: 0.6, parts: (c) => [
      [0, 1.6, 0, 2.1, 0.12, 0.35, 'wooddark'], [0.05, 1.55, 0.08, 2.05, 0.35, 0.55, 'mattress'],
      [0.2, 1.4, 0.12, 0.5, 0.55, 0.66, 'white'], [0, 1.6, 0, 0.08, 0, 1.05, 'wooddark'],
      [0.04, 1.56, 0.85, 2.06, 0.55, 0.585, c]] },
    sofa: { w: 2.0, d: 0.9, h: 0.8, parts: (c) => [
      [0, 2, 0, 0.9, 0.08, 0.42, c], [0, 2, 0, 0.26, 0.42, 0.86, c],
      [0, 0.2, 0, 0.9, 0.42, 0.62, c], [1.8, 2, 0, 0.9, 0.42, 0.62, c],
      [0.24, 0.98, 0.28, 0.86, 0.42, 0.5, c], [1.02, 1.76, 0.28, 0.86, 0.42, 0.5, c]] },
    table: { w: 2.4, d: 1.0, h: 0.78, top: 0.78, parts: () => [
      [0.5, 1.9, 0.05, 0.95, 0.72, 0.78, 'wood'],
      [0.55, 0.62, 0.1, 0.17, 0, 0.72, 'wood'], [1.78, 1.85, 0.1, 0.17, 0, 0.72, 'wood'],
      [0.55, 0.62, 0.83, 0.9, 0, 0.72, 'wood'], [1.78, 1.85, 0.83, 0.9, 0, 0.72, 'wood'],
      [0, 0.42, 0.3, 0.72, 0.42, 0.46, 'wooddark'], [0, 0.05, 0.3, 0.72, 0, 0.95, 'wooddark'],
      [0.37, 0.42, 0.3, 0.72, 0, 0.42, 'wooddark'],
      [1.98, 2.4, 0.3, 0.72, 0.42, 0.46, 'wooddark'], [2.35, 2.4, 0.3, 0.72, 0, 0.95, 'wooddark'],
      [1.98, 2.03, 0.3, 0.72, 0, 0.42, 'wooddark']],
      pp: [['cyl', 0.9, 0.5, 0.79, 0.26, 0.015, 0.26, 'white'], ['cyl', 1.5, 0.45, 0.79, 0.26, 0.015, 0.26, 'white'], ['cyl', 1.2, 0.7, 0.9, 0.07, 0.24, 0.07, 'glass'], ['cone', 1.2, 0.7, 1.08, 0.07, 0.14, 0.07, 'glass']] },
    counter: { w: 2.6, d: 0.62, h: 0.9, top: 0.9, parts: () => [
      [0, 2.6, 0, 0.6, 0.05, 0.86, 'wooddark'], [0, 2.6, 0, 0.62, 0.86, 0.9, 'concrete'],
      [0.9, 1.6, 0, 0.63, 0.1, 0.87, 'metal'], [0.95, 1.55, 0.05, 0.58, 0.9, 0.92, 'black'],
      [0, 2.6, 0, 0.35, 1.5, 2.25, 'wooddark'], [0.86, 0.88, 0.35, 0.36, 1.55, 2.2, 'black'],
      [1.72, 1.74, 0.35, 0.36, 1.55, 2.2, 'black']],
      pp: [['cyl', 1.1, 0.3, 0.99, 0.24, 0.14, 0.24, 'metal'], ['cyl', 1.42, 0.3, 0.95, 0.2, 0.05, 0.2, 'black'], ['cyl', 0.3, 0.3, 1.02, 0.08, 0.26, 0.08, 'glass'], ['cyl', 2.2, 0.25, 0.96, 0.2, 0.12, 0.2, 'white'], ['cyl', 0.55, 0.12, 1.0, 0.03, 0.22, 0.03, 'metal']] },
    fridge: { w: 0.7, d: 0.7, h: 1.85, parts: () => [
      [0, 0.7, 0, 0.68, 0, 1.85, 'fridge'], [0.02, 0.68, 0.68, 0.7, 1.22, 1.24, 'black'],
      [0.6, 0.63, 0.68, 0.73, 0.7, 1.1, 'metal']] },
    shelf: { w: 1.0, d: 0.35, h: 1.8, parts: (c) => [
      [0, 0.04, 0, 0.35, 0, 1.8, 'wood'], [0.96, 1, 0, 0.35, 0, 1.8, 'wood'], [0, 1, 0, 0.03, 0, 1.8, 'wooddark'],
      [0, 1, 0, 0.35, 0.02, 0.06, 'wood'], [0, 1, 0, 0.35, 0.45, 0.49, 'wood'], [0, 1, 0, 0.35, 0.9, 0.94, 'wood'],
      [0, 1, 0, 0.35, 1.35, 1.39, 'wood'], [0, 1, 0, 0.35, 1.76, 1.8, 'wood'],
      [0.08, 0.5, 0.06, 0.3, 0.49, 0.74, c], [0.55, 0.9, 0.06, 0.3, 0.94, 1.2, 'clothred'],
      [0.1, 0.36, 0.06, 0.3, 1.39, 1.6, 'white']] },
    tv: { w: 1.2, d: 0.45, h: 0.5, top: 0.5, parts: () => [
      [0, 1.2, 0, 0.45, 0, 0.5, 'wood'], [0.12, 1.08, 0.14, 0.2, 0.56, 1.14, 'black'],
      [0.5, 0.7, 0.1, 0.26, 0.5, 0.56, 'black']] },
    rtable: { w: 1.9, d: 1.3, h: 0.76, top: 0.78, parts: () => [], pp: [['cyl', 0.95, 0.65, 0.75, 1.2, 0.05, 1.2, 'wood'], ['cyl', 0.95, 0.65, 0.37, 0.12, 0.72, 0.12, 'wooddark'], ['cone', 0.95, 0.65, 0.1, 0.7, 0.2, 0.7, 'wooddark'],
      ['cyl', 0.2, 0.65, 0.45, 0.36, 0.05, 0.36, 'wooddark'], ['cyl', 0.2, 0.65, 0.22, 0.07, 0.44, 0.07, 'wooddark'], ['cyl', 1.7, 0.65, 0.45, 0.36, 0.05, 0.36, 'wooddark'], ['cyl', 1.7, 0.65, 0.22, 0.07, 0.44, 0.07, 'wooddark'],
      ['cyl', 0.8, 0.5, 0.79, 0.24, 0.015, 0.24, 'white'], ['sph', 1.15, 0.8, 0.88, 0.2, 0.2, 0.2, 'glass']] },
    barrel: { w: 0.7, d: 0.7, h: 0.95, top: 0.96, parts: () => [], pp: [['cyl', 0.35, 0.35, 0.47, 0.64, 0.94, 0.64, 'wood'], ['tor', 0.35, 0.35, 0.25, 0.66, 0.66, 0.66, 'metal'], ['tor', 0.35, 0.35, 0.7, 0.66, 0.66, 0.66, 'metal']] },
    lampst: { w: 0.45, d: 0.45, h: 1.7, parts: () => [], pp: [['cyl', 0.22, 0.22, 0.03, 0.4, 0.06, 0.4, 'metal'], ['cyl', 0.22, 0.22, 0.8, 0.05, 1.5, 0.05, 'metal'], ['cone', 0.22, 0.22, 1.6, 0.5, 0.36, 0.5, 'clothred']] },
    stool: { w: 0.45, d: 0.45, h: 0.5, top: 0.5, parts: () => [], pp: [['cyl', 0.22, 0.22, 0.47, 0.4, 0.06, 0.4, 'wood'], ['cyl', 0.22, 0.22, 0.22, 0.08, 0.44, 0.08, 'wooddark']] },
    crate: { w: 0.8, d: 0.8, h: 0.8, top: 0.8, parts: () => [[0, 0.8, 0, 0.8, 0, 0.8, 'wood']] },
    crates: { w: 1.5, d: 0.8, h: 1.4, parts: () => [
      [0, 0.8, 0, 0.8, 0, 0.8, 'wood'], [0.85, 1.5, 0.05, 0.7, 0, 0.65, 'wood'], [0.1, 0.7, 0.1, 0.7, 0.8, 1.4, 'wood']] },
    tub: { w: 1.7, d: 0.75, h: 0.58, parts: () => [
      [0, 1.7, 0, 0.75, 0, 0.5, 'white'], [0, 1.7, 0, 0.08, 0.5, 0.58, 'white'], [0, 1.7, 0.67, 0.75, 0.5, 0.58, 'white'],
      [0, 0.08, 0, 0.75, 0.5, 0.58, 'white'], [1.62, 1.7, 0, 0.75, 0.5, 0.58, 'white'], [0.08, 1.62, 0.08, 0.67, 0.5, 0.51, 'black']] },
    toilet: { w: 0.45, d: 0.68, h: 0.45, parts: () => [
      [0, 0.45, 0, 0.22, 0.3, 0.85, 'white']], pp: [['cyl', 0.225, 0.45, 0.21, 0.4, 0.42, 0.46, 'white'], ['tor', 0.225, 0.45, 0.43, 0.42, 0.5, 0.48, 'white'], ['cyl', 0.225, 0.11, 0.15, 0.3, 0.3, 0.2, 'white']] },
    sink: { w: 0.6, d: 0.45, h: 0.85, parts: () => [
      [0.05, 0.55, 0, 0.03, 1.1, 1.75, 'mirror']], pp: [['cyl', 0.3, 0.2, 0.35, 0.16, 0.7, 0.16, 'white'], ['sph', 0.3, 0.24, 0.8, 0.6, 0.3, 0.46, 'white'], ['cyl', 0.3, 0.06, 0.95, 0.04, 0.2, 0.04, 'metal']] },
    nightstand: { w: 0.5, d: 0.45, h: 0.5, top: 0.5, parts: () => [
      [0, 0.5, 0, 0.45, 0, 0.5, 'wooddark'], [0.2, 0.3, 0.45, 0.47, 0.3, 0.34, 'metal']] },
    desk: { w: 1.3, d: 0.6, h: 0.76, top: 0.76, parts: () => [
      [0, 1.3, 0, 0.6, 0.7, 0.76, 'wood'], [0, 0.05, 0, 0.6, 0, 0.7, 'wood'], [1.25, 1.3, 0, 0.6, 0, 0.7, 'wood'],
      [0.8, 1.25, 0.03, 0.57, 0.25, 0.7, 'wooddark'], [0.3, 0.75, 0.75, 1.15, 0.42, 0.47, 'cloth']] },
    piano: { w: 1.5, d: 0.65, h: 1.25, parts: () => [
      [0, 1.5, 0, 0.4, 0, 1.25, 'black'], [0, 1.5, 0.4, 0.65, 0.62, 0.72, 'black'],
      [0.05, 1.45, 0.42, 0.64, 0.72, 0.74, 'white'], [0, 0.08, 0.4, 0.65, 0, 0.62, 'black'], [1.42, 1.5, 0.4, 0.65, 0, 0.62, 'black']] },
  };
  const ROLES = {
    living: ['sofa', 'tv', 'rtable', 'shelf', 'lampst', 'table', 'piano', 'crate', 'desk'],
    kitchen: ['counter', 'fridge', 'rtable', 'table', 'shelf', 'stool', 'barrel'],
    bedroom: ['bed', 'nightstand', 'shelf', 'desk', 'lampst', 'crate'],
    bath: ['tub', 'toilet', 'sink', 'stool'],
    store: ['crates', 'shelf', 'barrel', 'crate', 'barrel', 'shelf'],
    kids: ['bed', 'bed', 'shelf', 'desk', 'stool'],
  };

  // ---------------------------------------------------------------- buildings
  for (let i = 0; i < NB; i++) for (const side of [1, -1]) {
    const x0 = i * BW, nF = R() < 0.45 ? 3 : 4, flip = R() < 0.5;
    const brick = pick(['brick', 'brick2', 'brick3']);
    const b = { id: W.buildings.length, i, side, x0, nF, flip, name: `${i + 1}${side > 0 ? 'A' : 'B'}`, flats: [], roofY: nF * FH };
    W.buildings.push(b);
    const wx = (u) => x0 + (flip ? BW - u : u);
    const wz = (v) => side * (FRONT + v);
    const dx = flip ? -1 : 1, dz = side;
    const bx = (u0, u1, y0, y1, v0, v1, m, o) => raw(wx(u0), wx(u1), y0, y1, wz(v0), wz(v1), m, o);
    const pr = (sh, u, y, v, sx, sy, sz, m, o) => prop(sh, wx(u), y, wz(v), sx, sy, sz, m, o);
    const H = nF * FH, top = H + 0.9;
    // walkable graph for the crawlers: nodes {x,y,z,door?,flat?}, undirected edges
    const nav = b.nav = { n: [], e: [] };
    const node = (u, y, v, extra) => { nav.n.push(Object.assign({ x: wx(u), y, z: wz(v) }, extra)); nav.e.push([]); return nav.n.length - 1; };
    const link = (a, c) => { nav.e[a].push(c); nav.e[c].push(a); };
    const hall = [];

    // shell
    bx(0, T, 0, top, 0, BD, brick); bx(BW - T, BW, 0, top, 0, BD, brick); bx(T, BW - T, 0, top, BD - T, BD, brick);
    bx(T, BW - T, H, top, 0, T, brick, { g: `par${b.id}` });
    bx(0, BW, top, top + 0.08, -0.1, T + 0.05, 'concrete', { c: false, g: `par${b.id}` });   // coping
    pr('cyl', 0.12, top / 2, -0.09, 0.13, top, 0.13, 'metal'); pr('cyl', 0.12, top - 0.2, -0.09, 0.22, 0.3, 0.22, 'metal');   // drainpipe
    bx(T, 0.9, 0, FH, 0, T, brick); bx(2.1, SW, 0, FH, 0, T, brick); bx(0.9, 2.1, 2.3, FH, 0, T, brick);
    bx(0.8, 2.2, 2.3, 2.42, -0.5, 0, 'concrete', { c: false });           // entrance canopy
    for (let f = 1; f < nF; f++) {
      const g = `sw${b.id}_${f}`;
      bx(T, 1.1, f * FH, (f + 1) * FH, 0, T, brick, { g }); bx(1.9, SW, f * FH, (f + 1) * FH, 0, T, brick, { g });
      bx(1.1, 1.9, f * FH, f * FH + 1.3, 0, T, brick, { g }); bx(1.1, 1.9, f * FH + 2.1, (f + 1) * FH, 0, T, brick, { g });
      pr('tor', 1.5, f * FH + 1.7, 0.02, 0.86, 0.6, 0.86, 'concrete', { rx: Math.PI / 2, g });   // round stair window
      bx(1.47, 1.53, f * FH + 1.3, f * FH + 2.1, 0.06, 0.12, 'wooddark', { c: false, g }); bx(1.1, 1.9, f * FH + 1.67, f * FH + 1.73, 0.06, 0.12, 'wooddark', { c: false, g });
    }
    pr('cyl', 1.5, 2.36, -0.25, 1.5, 0.12, 0.6, 'concrete'); pr('sph', 0.75, 1.9, -0.12, 0.22, 0.22, 0.22, 'lampglass');
    bx(SW, SW + T, H, top, 2.5, BD - T, brick);                             // parapet around the stair hole
    W.spawns.push({ x: wx(1.5), y: 0.1, z: wz(1.3), b: b.id });
    // pseudo-flat so hands can be sent up a stairwell through the street entrance
    b.stair = {
      id: -1, b: b.id, stair: true, roof: true, key: `B${b.id}:S`, side, y0: 0, cx: wx(1.5),
      x0: Math.min(wx(T), wx(SW)), x1: Math.max(wx(T), wx(SW)),
      rooms: [{ x0: Math.min(wx(0.5), wx(SW - 0.3)), x1: Math.max(wx(0.5), wx(SW - 0.3)), z0: Math.min(wz(0.5), wz(BD - 0.5)), z1: Math.max(wz(0.5), wz(BD - 0.5)), front: true, door: null }],
      opens: [{ x: wx(1.5), y: 1.3, z: wz(T / 2) }], destroyed: false,
    };

    // stairs
    for (let f = 0; f <= nF; f++) {
      const y0 = f * FH;
      bx(T, SW, f ? y0 - 0.2 : -0.1, f ? y0 : 0.02, T, 2.5, 'concrete');
      hall[f] = node(1.5, y0, 1.3, { stair: 1 });
      if (f === 0) link(node(1.5, 0.12, -1.0, { street: 1 }), hall[0]);
      if (f > 0) link(nav.stairTop, hall[f]);
      if (f === nF) { const r1 = node(6, y0, 1.5, { roof: 1 }); link(hall[f], r1); link(r1, node(10.5, y0, 1.5, { roof: 1 })); break; }
      {
        const a = node(0.9, y0, 2.4, { stair: 1 }), c = node(0.9, y0 + 1.6, 8.6, { stair: 1 }), d = node(2.3, y0 + 1.6, 8.6, { stair: 1 }), e = node(2.3, y0 + FH, 2.0, { stair: 1 });
        link(hall[f], a); link(a, c); link(c, d); link(d, e); nav.stairTop = e;
        // handrails along both flights
        pr('cyl', 1.6, y0 + 1.75, 5, 0.07, 5.25, 0.07, 'metal', { rx: Math.atan2(dz * 5, 1.6) });
        pr('cyl', 1.6, y0 + 3.35, 5, 0.07, 5.25, 0.07, 'metal', { rx: Math.atan2(-dz * 5, 1.6) });
        pr('cyl', 1.6, y0 + 0.45, 2.5, 0.07, 0.9, 0.07, 'metal'); pr('cyl', 1.6, y0 + 2.05, 7.5, 0.07, 0.9, 0.07, 'metal');
        pr('cyl', 0.32, y0 + 2.9, 5, 0.1, 9.4, 0.1, 'rust', { rx: Math.PI / 2 });      // pipe under the ceiling
      }
      bx(T, SW, y0 + 1.4, y0 + 1.6, 7.5, BD - T, 'concrete');
      for (let j = 0; j < 8; j++) {
        const t1 = y0 + (j + 1) * 0.2, t2 = y0 + 1.6 + (j + 1) * 0.2;
        bx(T, 1.6, t1 - 0.4, t1, 2.5 + j * 0.625, 2.5 + (j + 1) * 0.625, 'concrete');
        bx(1.6, SW, t2 - 0.4, t2, 7.5 - (j + 1) * 0.625, 7.5 - j * 0.625, 'concrete');
      }
      if (R() < 0.4) {
        W.lights.push({ x: wx(1.5), y: y0 + 2.55, z: wz(1.3), kind: 'lamp', flat: -1 });
        pr('cyl', 1.5, y0 + 2.83, 1.3, 0.025, 0.34, 0.025, 'black'); pr('cone', 1.5, y0 + 2.66, 1.3, 0.42, 0.2, 0.42, 'metal');
      }
    }

    // roof
    bx(SW, BW - T, H - 0.2, H - 0.05, T, BD - T, 'ceil'); bx(SW, BW - T, H - 0.05, H, T, BD - T, 'roof');
    {
      const n = 1 + ((R() * 3) | 0);
      for (let k = 0; k < n; k++) {
        const u = rr(4.5, 10.5), v = rr(3, 8.5);
        const kind = R();
        if (kind < 0.35) {          // water tank on legs
          bx(u - 0.7, u + 0.7, H, H + 2.3, v - 0.7, v + 0.7, 'x', { nv: true });
          pr('cyl', u, H + 1.5, v, 1.5, 1.5, 1.5, 'rust'); pr('cone', u, H + 2.5, v, 1.56, 0.5, 1.56, 'rust');
          for (const [a, c] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) pr('cyl', u + a, H + 0.4, v + c, 0.1, 0.8, 0.1, 'metal');
        } else if (kind < 0.65) {   // vent cowl
          bx(u - 0.4, u + 0.4, H, H + 0.9, v - 0.4, v + 0.4, 'x', { nv: true });
          pr('cyl', u, H + 0.4, v, 0.6, 0.8, 0.6, 'metal'); pr('sph', u, H + 0.85, v, 0.9, 0.5, 0.9, 'metal');
        } else {                    // chimney with pots
          const ch = rr(1.4, 2.2);
          bx(u - 0.4, u + 0.4, H, H + ch, v - 0.4, v + 0.4, brick);
          pr('cyl', u - 0.15, H + ch + 0.2, v, 0.24, 0.4, 0.24, 'rust'); pr('cyl', u + 0.17, H + ch + 0.15, v, 0.22, 0.3, 0.22, 'rust');
        }
        if (R() < 0.5) { const au = rr(4, 11), av = rr(7, 9.3); pr('cyl', au, H + 1.4, av, 0.04, 2.8, 0.04, 'metal'); pr('cyl', au, H + 2.4, av, 0.03, 1.2, 0.03, 'metal', { rz: Math.PI / 2 }); pr('cyl', au, H + 2.0, av, 0.03, 0.8, 0.03, 'metal', { rz: Math.PI / 2 }); }
      }
      const rf = {
        id: W.flats.length, b: b.id, f: nF, roof: true, key: `B${b.id}:R`, side, y0: H, dv: BD,
        x0: Math.min(wx(SW + T), wx(BW - T)), x1: Math.max(wx(SW + T), wx(BW - T)), cx: wx((SW + BW) / 2),
        rooms: [{ x0: Math.min(wx(SW + 0.4), wx(BW - 0.4)), x1: Math.max(wx(SW + 0.4), wx(BW - 0.4)),
          z0: Math.min(wz(0.4), wz(BD - 0.4)), z1: Math.max(wz(0.4), wz(BD - 0.4)), front: true, door: null }],
        opens: [{ x: wx(7.5), y: H + 1.6, z: wz(0) }], destroyed: false, g: `par${b.id}`, label: `Block ${b.name} · Terrace`,
      };
      W.flats.push(rf); b.roof = rf;
      for (let k = 0; k < 2; k++) W.spots.roof.push({ x: wx(rr(4, 11)), y: H + 0.7, z: wz(rr(1, 9)) });
    }

    // flats
    for (let f = 0; f < nF; f++) {
      const y0 = f * FH, fid = W.flats.length, g = `fac${fid}`;
      const wall = 'wall' + ((R() * 6) | 0), floorM = pick(['floorwood', 'floorwood', 'floorwood2', 'floortile']);
      const cloth = pick(['cloth', 'clothred', 'clothgreen']);
      const keep = [];   // keep-clear rectangles [u0,u1,v0,v1]
      const used = [];
      const flat = {
        id: fid, b: b.id, f, roof: false, key: `B${b.id}:F${f}`, side, y0,
        x0: Math.min(wx(SW + T), wx(BW - T)), x1: Math.max(wx(SW + T), wx(BW - T)), cx: wx((SW + BW) / 2),
        rooms: [], opens: [], destroyed: false, g, balc: null,
        label: `Block ${b.name} · ${f === 0 ? 'Ground floor' : 'Floor ' + f}`,
      };
      W.flats.push(flat); b.flats.push(flat);

      const door = (uh, vh, cu, cv, ou, ov, len, kind) => {
        const d = {
          id: W.doors.length, flat: fid, kind, y: y0, h: 2.1, len,
          hx: wx(uh), hz: wz(vh), cd: [cu * dx, cv * dz], od: [ou * dx, ov * dz], open: false,
        };
        d.cx = d.hx + d.cd[0] * len / 2; d.cz = d.hz + d.cd[1] * len / 2;
        W.doors.push(d); return d;
      };

      // floor
      bx(SW, BW - T, f ? y0 - 0.2 : -0.1, f ? y0 - 0.05 : -0.02, T, BD - T, 'ceil');
      bx(SW, BW - T, f ? y0 - 0.05 : -0.02, f ? y0 : 0.02, T, BD - T, floorM);
      // stair partition + entry door
      bx(SW, SW + T, y0, y0 + FH - 0.2, T, 0.8, wall); bx(SW, SW + T, y0, y0 + FH - 0.2, 1.8, BD - T, wall);
      bx(SW, SW + T, y0 + 2.1, y0 + FH - 0.2, 0.8, 1.8, wall);
      const entry = door(SW + T / 2, 0.8, 0, 1, 1, 0, 1.0, 'entry');
      entry.open = R() < 0.25;
      keep.push([SW, SW + 1.5, 0.4, 2.2]);
      // linings
      bx(BW - T - 0.03, BW - T, y0, y0 + FH - 0.2, T, BD - T, wall, { c: false });
      bx(SW + T, BW - T, y0, y0 + FH - 0.2, BD - T - 0.03, BD - T, wall, { c: false });

      // front wall + openings
      const ops = [];
      const swap = R() < 0.5;
      if (f === 0) {
        ops.push({ u0: rr(3.9, 5), w: 1.8, y0: 0.95, y1: 2.2 }, { u0: rr(8, 9.6), w: 1.8, y0: 0.95, y1: 2.2 });
      } else if (swap) {
        ops.push({ u0: rr(3.9, 5), w: 1.8, y0: 0.95, y1: 2.2 }, { u0: rr(8, 10.3), w: 1.0, y0: 0, y1: 2.1, door: true });
      } else {
        ops.push({ u0: rr(3.9, 5.2), w: 1.0, y0: 0, y1: 2.1, door: true }, { u0: rr(7.6, 9.6), w: 1.8, y0: 0.95, y1: 2.2 });
      }
      let cur = SW;
      const fw = (u0, u1, ya, yb) => {
        if (u1 - u0 < 0.01 || yb - ya < 0.01) return;
        bx(u0, u1, y0 + ya, y0 + yb, 0, T, brick, { g });
        bx(u0, u1, y0 + ya, y0 + Math.min(yb, FH - 0.2), T, T + 0.03, wall, { g, c: false });
      };
      for (const o of ops) {
        o.u1 = o.u0 + o.w;
        fw(cur, o.u0, 0, FH); fw(o.u0, o.u1, 0, o.y0); fw(o.u0, o.u1, o.y1, FH);
        cur = o.u1;
        flat.opens.push({ x: wx((o.u0 + o.u1) / 2), y: y0 + (o.y0 + o.y1) / 2 + (o.door ? 0.3 : 0), z: wz(T / 2) });
        if (o.door) {
          door(o.u0, T / 2, 1, 0, 0, 1, 1.0, 'balcony').open = R() < 0.3;
          keep.push([o.u0 - 0.2, o.u1 + 0.2, 0, 1.4]);
          const bu0 = Math.max(SW + 0.2, o.u0 - 0.9), bu1 = Math.min(BW - 0.2, o.u1 + 0.9);
          bx(bu0, bu1, y0 - 0.2, y0, -BALC, 0, 'concrete');
          bx(bu0, bu1, y0, y0 + 0.9, -BALC, -BALC + 0.05, 'rail', { nv: true, g });
          bx(bu0, bu0 + 0.05, y0, y0 + 0.9, -BALC, 0, 'rail', { nv: true, g }); bx(bu1 - 0.05, bu1, y0, y0 + 0.9, -BALC, 0, 'rail', { nv: true, g });
          for (let q = bu0 + 0.03; q < bu1; q += 0.2) pr('cyl', q, y0 + 0.45, -BALC + 0.03, 0.035, 0.9, 0.035, 'rail', { g });
          for (let q = -BALC + 0.2; q < 0; q += 0.2) { pr('cyl', bu0 + 0.03, y0 + 0.45, q, 0.035, 0.9, 0.035, 'rail', { g }); pr('cyl', bu1 - 0.03, y0 + 0.45, q, 0.035, 0.9, 0.035, 'rail', { g }); }
          pr('cyl', (bu0 + bu1) / 2, y0 + 0.92, -BALC + 0.03, 0.07, bu1 - bu0 + 0.06, 0.07, 'metal', { rz: Math.PI / 2, g });
          pr('cyl', bu0 + 0.03, y0 + 0.92, -BALC / 2, 0.07, BALC, 0.07, 'metal', { rx: Math.PI / 2, g }); pr('cyl', bu1 - 0.03, y0 + 0.92, -BALC / 2, 0.07, BALC, 0.07, 'metal', { rx: Math.PI / 2, g });
          pr('cone', bu0 + 0.3, y0 - 0.45, -0.3, 0.4, 0.5, 0.6, 'concrete', { rx: Math.PI }); pr('cone', bu1 - 0.3, y0 - 0.45, -0.3, 0.4, 0.5, 0.6, 'concrete', { rx: Math.PI });
          flat.balc = { x0: Math.min(wx(bu0), wx(bu1)), x1: Math.max(wx(bu0), wx(bu1)) };
          W.spots.balcony.push({ x: wx((bu0 + bu1) / 2), y: y0 + 0.7, z: wz(-BALC / 2), flat: fid });
        } else {
          bx(o.u0 - 0.08, o.u1 + 0.08, y0 + o.y0 - 0.06, y0 + o.y0, -0.12, T + 0.06, 'concrete', { g, c: false });
          bx((o.u0 + o.u1) / 2 - 0.03, (o.u0 + o.u1) / 2 + 0.03, y0 + o.y0, y0 + o.y1, 0.07, 0.13, 'wooddark', { g, c: false });
          bx(o.u0, o.u1, y0 + 1.55, y0 + 1.61, 0.07, 0.13, 'wooddark', { g, c: false });
          for (let q = o.u0 + 0.25; q < o.u1 - 0.2; q += 0.13) pr('cyl', q, y0 + 0.42, T + 0.14, 0.1, 0.6, 0.1, 'white', { g });   // radiator
          if (R() < 0.6) {
            const cm = pick(['clothred', 'cloth', 'clothgreen']);
            bx(o.u0 - 0.15, o.u0 + 0.3, y0 + 0.5, y0 + 2.4, T + 0.05, T + 0.13, cm, { g, c: false }); bx(o.u1 - 0.3, o.u1 + 0.15, y0 + 0.5, y0 + 2.4, T + 0.05, T + 0.13, cm, { g, c: false });
            pr('cyl', (o.u0 + o.u1) / 2, y0 + 2.42, T + 0.09, 0.04, o.w + 0.5, 0.04, 'metal', { rz: Math.PI / 2, g });
          }
          if (R() < 0.3) {   // boarded-up
            bx(o.u0 - 0.1, o.u1 + 0.1, y0 + 1.2, y0 + 1.36, T, T + 0.04, 'wood', { g, c: false });
            bx(o.u0 - 0.1, o.u1 + 0.1, y0 + 1.75, y0 + 1.9, T, T + 0.04, 'wood', { g, c: false });
          }
        }
      }
      fw(cur, BW - T, 0, FH);

      // interior walls
      const hgt = FH - 0.2;
      const dv = rr(4.6, 6.4);
      flat.dv = dv;
      const split = R() < 0.62 ? rr(6.4, 8.6) : 0;
      const dpos = split ? [rr(3.7, split - 1.5), rr(split + 0.6, 10.5)] : [rr(3.9, 10.3)];
      cur = SW + T;
      const front = { u0: SW + T, u1: BW - T, v0: T, v1: dv, front: true, door: null, role: pick(['living', 'kitchen', 'living']) };
      const rooms = [front];
      dpos.forEach((du, k) => {
        bx(cur, du, y0, y0 + hgt, dv, dv + T, wall);
        bx(du, du + 0.95, y0 + 2.1, y0 + hgt, dv, dv + T, wall);
        cur = du + 0.95;
        const d = door(du, dv + T / 2, 1, 0, 0, 1, 0.95, 'room');
        d.open = R() < 0.35;
        keep.push([du - 0.25, du + 1.2, dv - 1.1, dv + 1.4]);
        const u0 = split && k === 1 ? split + T : SW + T, u1 = split && k === 0 ? split : BW - T;
        const narrow = u1 - u0 < 3.4;
        rooms.push({ u0, u1, v0: dv + T, v1: BD - T, front: false, door: d.id, du,
          role: narrow ? pick(['bath', 'store', 'bath']) : pick(['bedroom', 'bedroom', 'kids', 'store', 'kitchen']) });
      });
      bx(cur, BW - T, y0, y0 + hgt, dv, dv + T, wall);
      if (split) bx(split, split + T, y0, y0 + hgt, dv + T, BD - T, wall);
      // optional partial wall splitting the front room (open archway next to the divider)
      if (R() < 0.35) {
        const uf = rr(6.4, 8.4);
        if (!ops.some((o) => uf > o.u0 - 0.5 && uf < o.u1 + 0.5)) {
          bx(uf, uf + T, y0, y0 + hgt, T, dv - 1.7, wall);
          keep.push([uf - 0.2, uf + T + 0.2, T, dv]);
        }
      }

      // furniture
      const hit = (r, list, m) => list.some((q) => r[0] < q[1] + m && r[1] > q[0] - m && r[2] < q[3] + m && r[3] > q[2] - m);
      const tops = [];
      // find a free spot against one of the room's walls; returns the (a,b)->(u,v) mapping
      const place = (room, w, d, tall, clear) => {
        for (let tries = 0; tries < 8; tries++) {
          const ws = (R() * 4) | 0, alongU = ws < 2;
          const span = alongU ? room.u1 - room.u0 : room.v1 - room.v0;
          if (span < w + 0.2) continue;
          const p = (alongU ? room.u0 : room.v0) + 0.05 + R() * (span - w - 0.1);
          const far = alongU ? room.v1 - room.v0 : room.u1 - room.u0;
          if (far < d + Math.max(0.9, clear + 0.4)) continue;
          const map = (a, bb) => ws === 0 ? [p + a, room.v0 + bb] : ws === 1 ? [p + a, room.v1 - bb]
            : ws === 2 ? [room.u0 + bb, p + a] : [room.u1 - bb, p + a];
          const c0 = map(0, 0), c1 = map(w, d + clear);
          const rect = [Math.min(c0[0], c1[0]), Math.max(c0[0], c1[0]), Math.min(c0[1], c1[1]), Math.max(c0[1], c1[1])];
          if (ws === 0 && room.front && tall && ops.some((o) => rect[0] < o.u1 && rect[1] > o.u0)) continue;   // never block a window
          if (hit(rect, keep, 0) || hit(rect, used, 0.12)) continue;
          used.push(rect);
          return map;
        }
        return null;
      };
      const span2 = (map, q) => { const a = map(q[0], q[2]), c = map(q[1], q[3]); return [Math.min(a[0], c[0]), Math.max(a[0], c[0]), Math.min(a[1], c[1]), Math.max(a[1], c[1])]; };
      for (const room of rooms) {
        // a closet you can open, search and hide in
        if (R() < (room.front ? 0.4 : 0.85)) {
          const w = 1.5, d = 0.9, map = place(room, w, d, true, 0.8);
          if (map) {
            const cid = W.closets.length;
            for (const q of [[0, w, 0, 0.05, 0, 2.1], [0, 0.05, 0, d, 0, 2.1], [w - 0.05, w, 0, d, 0, 2.1], [0, w, 0, d, 2.04, 2.1]]) {
              const r = span2(map, q); bx(r[0], r[1], y0 + q[4], y0 + q[5], r[2], r[3], 'wooddark', { fu: 1 });
            }
            { const r = span2(map, [0.05, w - 0.05, 0.05, d, 0, 0.03]); bx(r[0], r[1], y0 + 0.001, y0 + 0.03, r[2], r[3], 'wood', { c: false }); }
            const rail = map(w / 2, 0.4), along = Math.abs(map(1, 0)[0] - map(0, 0)[0]) > 0.5;
            pr('cyl', rail[0], y0 + 1.82, rail[1], 0.04, w - 0.1, 0.04, 'metal', along ? { rz: Math.PI / 2 } : { rx: Math.PI / 2 });
            for (const a of [0.15, 0.35, 1.2]) { const r = span2(map, [a, a + 0.08, 0.15, 0.65, 0, 0]); bx(r[0], r[1], y0 + 0.75, y0 + 1.78, r[2], r[3], pick(['cloth', 'clothred', 'clothgreen', 'mattress']), { c: false }); }
            const i0 = map(0.05, 0.05), i1 = map(w - 0.05, d), h0 = map(0, d), h1 = map(w, d), ce = map(w / 2, d / 2), fr = map(w / 2, d + 1);
            const c = {
              id: cid, flat: fid, y: y0, w,
              x0: Math.min(wx(i0[0]), wx(i1[0])), x1: Math.max(wx(i0[0]), wx(i1[0])), z0: Math.min(wz(i0[1]), wz(i1[1])), z1: Math.max(wz(i0[1]), wz(i1[1])),
              cx: wx(ce[0]), cz: wz(ce[1]), h0: [wx(h0[0]), wz(h0[1])], h1: [wx(h1[0]), wz(h1[1])], open: false,
            };
            c.f = [wx(fr[0]) - wx(ce[0]) > 0.3 ? 1 : wx(fr[0]) - wx(ce[0]) < -0.3 ? -1 : 0, wz(fr[1]) - wz(ce[1]) > 0.3 ? 1 : wz(fr[1]) - wz(ce[1]) < -0.3 ? -1 : 0];
            W.closets.push(c);
            W.spots.closet.push({ x: c.cx, y: y0 + 0.75, z: c.cz, closet: cid });
          }
        }
        const list = ROLES[room.role].slice();
        const count = 2 + ((R() * 4) | 0);
        for (let n = 0, placed = 0; n < list.length && placed < count; n++) {
          const it = CAT[list[n]], map = place(room, it.w, it.d, it.h > 0.9, 0);
          if (!map) continue;
          for (const q of it.parts(cloth)) { const r = span2(map, q); bx(r[0], r[1], y0 + q[4], y0 + q[5], r[2], r[3], q[6], { c: false }); }
          for (const q of it.pp || []) { const c = map(q[1], q[2]); pr(q[0], c[0], y0 + q[3], c[1], q[4], q[5], q[6], q[7]); }
          const rect = span2(map, [0, it.w, 0, it.d]);
          bx(rect[0], rect[1], y0, y0 + it.h, rect[2], rect[3], 'x', { nv: true, fu: 1 });
          if (it.top) tops.push({ u: (rect[0] + rect[1]) / 2, v: (rect[2] + rect[3]) / 2, y: y0 + it.top, small: it.w < 0.6 });
          placed++;
        }
        // rug (some round)
        if (R() < 0.55) {
          const cu = (room.u0 + room.u1) / 2, cv = (room.v0 + room.v1) / 2, rm = pick(['clothred', 'cloth', 'clothgreen']);
          if (R() < 0.5) pr('cyl', cu, y0 + 0.012, cv, 2.0, 0.02, 2.0, rm);
          else bx(cu - 1.1, cu + 1.1, y0 + 0.001, y0 + 0.02, cv - 0.75, cv + 0.75, rm, { c: false });
        }
        // pickup spots: free floor in this room
        for (let k = 0; k < 3; k++) {
          const u = rr(room.u0 + 0.5, room.u1 - 0.5), v = rr(room.v0 + 0.5, room.v1 - 0.5);
          if (!hit([u - 0.3, u + 0.3, v - 0.3, v + 0.3], used, 0)) { W.spots.flat.push({ x: wx(u), y: y0 + 0.7, z: wz(v), flat: fid }); break; }
        }
        flat.rooms.push({
          x0: Math.min(wx(room.u0), wx(room.u1)), x1: Math.max(wx(room.u0), wx(room.u1)),
          z0: Math.min(wz(room.v0), wz(room.v1)), z1: Math.max(wz(room.v0), wz(room.v1)),
          front: room.front, door: room.door,
        });
      }

      // crawler paths through this flat
      {
        const ev = entry.id, lineV = dv - 0.8;
        const e1 = node(SW + 0.1, y0, 1.3, { door: ev, flat: fid }), e2 = node(4.0, y0, 1.3, { flat: fid }), c0 = node(4.0, y0, lineV, { flat: fid });
        link(hall[f], e1); link(e1, e2); link(e2, c0); link(c0, node(5, y0, 2.4, { flat: fid }));
        let prev = c0;
        for (const room of rooms.filter((r) => !r.front).sort((a, c) => a.du - c.du)) {
          const df = node(room.du + 0.47, y0, lineV, { flat: fid }), db = node(room.du + 0.47, y0, dv + 0.95, { door: room.door, flat: fid });
          const rc = node((room.u0 + room.u1) / 2, y0, (room.v0 + room.v1) / 2 + 0.3, { flat: fid });
          link(prev, df); link(df, db); link(db, rc); prev = df;
        }
        const x2 = node(10.4, y0, lineV, { flat: fid }); link(prev, x2); link(x2, node(10.4, y0, 2.4, { flat: fid }));
      }

      // lights + clutter on table tops
      const lr = R();
      if (lr < 0.5 && tops.length) {
        const n = 1 + ((R() * 3) | 0);
        for (let k = 0; k < n && tops.length; k++) {
          const t = tops.splice((R() * tops.length) | 0, 1)[0];
          const ou = rr(-0.12, 0.12), ov = rr(-0.1, 0.1), ch = rr(0.1, 0.22);
          pr('cyl', t.u + ou, t.y + ch / 2, t.v + ov, 0.06, ch, 0.06, 'wax'); pr('cyl', t.u + ou, t.y + 0.008, t.v + ov, 0.16, 0.016, 0.16, 'metal');
          W.lights.push({ x: wx(t.u + ou), y: t.y + ch + 0.06, z: wz(t.v + ov), kind: 'candle', flat: fid });
        }
      } else if (lr < 0.68) {
        // glowing sigil on the divider wall, facing the street
        let u = rr(4, 10.8);
        if (dpos.some((d) => u > d - 0.8 && u < d + 1.75)) u = dpos[0] > 7 ? 4.2 : 10.6;
        W.decals.push({ x: wx(u), y: y0 + 1.7, z: wz(dv - 0.012), nz: -dz, flat: fid });
        W.lights.push({ x: wx(u), y: y0 + 1.7, z: wz(dv - 0.5), kind: 'sigil', flat: fid });
      } else if (lr < 0.82) {
        // hanging chandelier
        const lu = rr(5, 10), lv = dv * 0.5, ly = y0 + 2.35;
        W.lights.push({ x: wx(lu), y: ly - 0.1, z: wz(lv), kind: 'lamp', flat: fid });
        pr('cyl', lu, y0 + 2.75, lv, 0.03, 0.5, 0.03, 'black'); pr('tor', lu, ly + 0.12, lv, 0.7, 0.7, 0.7, 'black'); pr('sph', lu, ly + 0.2, lv, 0.14, 0.14, 0.14, 'black');
        for (let k = 0; k < 3; k++) { const a = k * 2.094 + 0.4; pr('cone', lu + Math.cos(a) * 0.35, ly, lv + Math.sin(a) * 0.35, 0.3, 0.2, 0.3, 'black'); }
      }
      for (const t of tops) {
        if (R() < 0.5) continue;
        const k = R(), ou = rr(-0.1, 0.1), ov = rr(-0.08, 0.08);
        if (k < 0.4) { pr('cyl', t.u + ou, t.y + 0.12, t.v + ov, 0.07, 0.24, 0.07, 'glass'); pr('cone', t.u + ou, t.y + 0.3, t.v + ov, 0.07, 0.14, 0.07, 'glass'); }
        else if (k < 0.7) pr('sph', t.u + ou, t.y + 0.11, t.v + ov, 0.22, 0.22, 0.22, pick(['white', 'clothred', 'glass']));
        else pr('cyl', t.u + ou, t.y + 0.05, t.v + ov, 0.2, 0.1, 0.2, 'metal');
      }
    }
  }
  return W;
}

// Which named zone is a world position in?
export function zoneAt(W, x, y, z) {
  const { BW, FH, NB, FRONT, SW, T, BALC } = K;
  const az = Math.abs(z);
  const seg = Math.max(0, Math.min(NB - 1, Math.floor(x / BW)));
  const street = { key: 'S' + seg, kind: 'street', indoors: false, label: `The Street · Stretch ${seg + 1}`, flat: null };
  if (az < FRONT - BALC - 0.05 || x < 0 || x > W.L) return street;
  const side = z > 0 ? 1 : -1;
  const b = W.buildings[seg * 2 + (side > 0 ? 0 : 1)];
  const v = az - FRONT;
  let u = x - b.x0; if (b.flip) u = BW - u;
  const f = Math.floor((y + 0.35) / FH);
  if (v < 0) {
    if (f < 1) return street;
    const fl = b.flats[Math.min(f, b.nF - 1)];
    if (f >= b.nF || !fl.balc || x < fl.balc.x0 - 0.3 || x > fl.balc.x1 + 0.3) return street;
    return { key: fl.key, kind: 'flat', indoors: false, balc: true, label: fl.label + ' · Balcony', flat: fl, b };
  }
  if (f >= b.nF) return { key: b.roof.key, kind: 'roof', indoors: false, label: b.roof.label, flat: b.roof, b };
  if (u < SW + T / 2) {
    return { key: `B${b.id}:S`, kind: 'stair', indoors: true, label: `Block ${b.name} · Stairwell · ${f === 0 ? 'Ground' : 'Floor ' + f}`, flat: null, b, f };
  }
  const fl = b.flats[Math.max(0, f)];
  return { key: fl.key, kind: 'flat', indoors: !fl.destroyed, label: fl.label + (fl.destroyed ? ' · Ruined flat' : ' · Flat'), flat: fl, b };
}
