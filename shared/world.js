// Deterministic street generator. Runs identically on the server and in the browser,
// so only the seed has to travel over the network.
//
// Everything that can be smashed belongs to a named group (W.brk[g]): wall sections, window panes,
// doors, each piece of furniture, cars, lamp posts, cables. The simulation breaks groups; the client
// turns the group's actual parts into physics debris.

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

const SHOPS = ['BUTCHER', 'PHARMACY', 'LAUNDRY', 'HOTEL', 'BAR', 'TAILOR', 'PAWN', 'BOOKS', 'BAKERY', 'CLOCKS', 'DOLLS', 'FUNERALS', 'RADIO', 'TOYS', 'CAFE', 'OPTICIAN'];
const SCRAWLS = ['IT HEARS', 'QUIET', 'DO NOT SLEEP', 'BEHIND YOU', 'EIGHT HANDS', 'STAY OFF THE STREET', 'IT COUNTS TO 30', 'NOT THE CLOSET', 'WE TRIED', 'DAWN IS A LIE', '|||| |||| ||', 'IT KNOWS MY NAME', 'HUSH'];
const NEON = [0xff2a3a, 0x3affd0, 0xff8a2a, 0xb04aff, 0x4a9aff, 0xfff06a];

export function genWorld(seed) {
  const { BW, BD, FH, NB, FRONT, SW, T, BALC } = K;
  const R = rng32(Math.imul(seed | 0, 2654435761) ^ 0x9e3779b9);
  const rr = (a, b) => a + R() * (b - a);
  const pick = (arr) => arr[(R() * arr.length) | 0];
  const L = NB * BW;

  const W = {
    seed, L,
    boxes: [], props: [], cables: [], closets: [], doors: [], flats: [], buildings: [], lamps: [], lights: [], decals: [], signs: [], mannequins: [],
    spots: { street: [], balcony: [], roof: [], flat: [], closet: [] },
    spawns: [], brk: {}, streetBrk: [],
  };
  const G = W.brk;
  let nf = 0;
  // register a breakable group
  const grp = (g, kind, flat, extra) => (G[g] = Object.assign({ g, kind, flat, x0: 1e9, x1: -1e9, y0: 1e9, y1: -1e9, z0: 1e9, z1: -1e9, gone: false }, extra));
  const grow = (e, x0, x1, y0, y1, z0, z1) => { e.x0 = Math.min(e.x0, x0); e.x1 = Math.max(e.x1, x1); e.y0 = Math.min(e.y0, y0); e.y1 = Math.max(e.y1, y1); e.z0 = Math.min(e.z0, z0); e.z1 = Math.max(e.z1, z1); };
  const raw = (x0, x1, y0, y1, z0, z1, m, o = {}) => {
    const b = {
      x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: (z0 + z1) / 2,
      sx: Math.abs(x1 - x0), sy: y1 - y0, sz: Math.abs(z1 - z0), m, c: o.c !== false, g: o.g, nv: o.nv, fu: o.fu,
    };
    W.boxes.push(b);
    if (o.g && G[o.g] && !o.deco) grow(G[o.g], Math.min(x0, x1), Math.max(x0, x1), y0, y1, Math.min(z0, z1), Math.max(z0, z1));
  };
  // round shapes: cyl | cone | sph | tor | tri (gable prism) | arch | wedge (unit size 1, scaled; cylinders/cones stand along y before rotation)
  const prop = (s, x, y, z, sx, sy, sz, m, o = {}) => W.props.push({ s, x, y, z, sx, sy, sz, m, rx: o.rx || 0, ry: o.ry || 0, rz: o.rz || 0, g: o.g });

  // ---------------------------------------------------------------- street
  raw(-10, L + 10, -1, 0, -20, 20, 'asphalt', { nv: true });
  for (const s of [1, -1]) {
    raw(-8, L + 8, 0, 0.12, s * 5, s * 8, 'walk');
    raw(-8, L + 8, 0, 0.16, s * 4.86, s * 5, 'stone', { c: false });           // kerb stones
    raw(-8, 0, 0, 14, s * 8, s * 8.4, 'brick');
    raw(L, L + 8, 0, 14, s * 8, s * 8.4, 'brick');
  }
  raw(-9, -8, 0, 14, -9, 9, 'concrete');
  raw(L + 8, L + 9, 0, 14, -9, 9, 'concrete');
  for (const ex of [-7.2, L + 7.2]) {   // road blocks at both ends
    for (let z = -4; z <= 4; z += 2) { raw(ex - 0.3, ex + 0.3, 0, 0.9, z - 0.8, z + 0.8, 'concrete'); prop('cone', ex + (ex < 0 ? 1.2 : -1.2), 0.3, z + 0.9, 0.36, 0.6, 0.36, 'clothred'); }
    for (let z = -4.6; z <= 4.6; z += 0.4) prop('cyl', ex, 2.2, z, 0.03, 2.6, 0.03, 'rail');
    prop('cyl', ex, 3.5, 0, 0.05, 9.4, 0.05, 'rail', { rx: Math.PI / 2 }); prop('cyl', ex, 1.6, 0, 0.05, 9.4, 0.05, 'rail', { rx: Math.PI / 2 });
  }
  // street lamps (old cast-iron posts with a curved arm)
  for (let k = 0, x = 10; x < L; x += 22, k++) {
    const s = k % 2 ? 1 : -1, g = `lamp${k}`;
    W.streetBrk.push(grp(g, 'street', -1, { lamp: k }));
    raw(x - 0.1, x + 0.1, 0, 5.2, s * 5.5 - 0.1, s * 5.5 + 0.1, 'metal', { nv: true, g });
    prop('cyl', x, 2.6, s * 5.5, 0.14, 5.2, 0.14, 'metal', { g }); prop('cone', x, 0.45, s * 5.5, 0.42, 0.9, 0.42, 'metal', { g });
    prop('tor', x, 0.95, s * 5.5, 0.26, 0.4, 0.26, 'metal', { g }); prop('tor', x, 3.4, s * 5.5, 0.22, 0.4, 0.22, 'metal', { g });
    prop('sph', x, 5.2, s * 5.5, 0.22, 0.22, 0.22, 'metal', { g });
    prop('cyl', x, 5.12, s * 4.9, 0.08, 1.25, 0.08, 'metal', { rx: Math.PI / 2, g });
    prop('cone', x, 5.0, s * 4.35, 0.6, 0.3, 0.6, 'metal', { g });
    W.lamps.push({ x, y: 4.82, z: s * 4.35, broken: R() < 0.25, flicker: R() < 0.45, g });
  }
  // wrecked cars parked along the kerbs (the monster keeps to the centre lane, until it is too big to)
  for (let x = 14, n = 0; x < L - 8; x += rr(13, 24), n++) {
    const s = R() < 0.5 ? 1 : -1, z = s * 3.9, m = pick(['car', 'rust', 'car2', 'car3']), g = `car${n}`, van = R() < 0.3;
    W.streetBrk.push(grp(g, 'street', -1));
    const hgt = van ? 1.95 : 1.5;
    raw(x - 2.1, x + 2.1, 0.32, 1.0, z - 0.85, z + 0.85, m, { g });
    raw(x - (van ? 2.0 : 1.1), x + (van ? 0.9 : 1.2), 1.0, hgt, z - 0.78, z + 0.78, m, { g });
    raw(x - (van ? 1.95 : 1.05), x + (van ? 0.95 : 1.25), 1.08, hgt - 0.1, z - 0.8, z + 0.8, 'glass', { c: false, g });
    raw(x - 2.16, x - 2.08, 0.38, 0.6, z - 0.88, z + 0.88, 'metal', { c: false, g }); raw(x + 2.08, x + 2.16, 0.38, 0.6, z - 0.88, z + 0.88, 'metal', { c: false, g });
    for (const wx of [-1.4, 1.4]) for (const wz of [-0.8, 0.8]) {
      prop('cyl', x + wx, 0.34, z + wz, 0.68, 0.24, 0.68, 'black', { rx: Math.PI / 2, g });
      prop('cyl', x + wx, 0.34, z + wz * 1.02, 0.36, 0.25, 0.36, 'metal', { rx: Math.PI / 2, g });
    }
    prop('sph', x - 2.08, 0.74, z - 0.55, 0.22, 0.2, 0.22, 'white', { g }); prop('sph', x - 2.08, 0.74, z + 0.55, 0.22, 0.2, 0.22, 'white', { g });
    prop('sph', x + 2.08, 0.74, z - 0.6, 0.16, 0.14, 0.2, 'clothred', { g }); prop('sph', x + 2.08, 0.74, z + 0.6, 0.16, 0.14, 0.2, 'clothred', { g });
  }
  // pavement clutter
  for (let x = 6, n = 0; x < L; x += rr(6, 13), n++) {
    const s = R() < 0.5 ? 1 : -1, z = s * rr(5.6, 6.0), kind = R(), g = `st${n}`;
    const e = grp(g, 'street', -1); W.streetBrk.push(e);
    if (kind < 0.2) {            // dumpster
      raw(x - 0.9, x + 0.9, 0.12, 1.3, z - 0.5, z + 0.5, 'rust', { g }); prop('cyl', x, 1.3, z, 0.5, 1.8, 1.0, 'rust', { rz: Math.PI / 2, g });
      prop('cyl', x - 0.7, 0.2, z + 0.52, 0.2, 0.08, 0.2, 'black', { rx: Math.PI / 2, g }); prop('cyl', x + 0.7, 0.2, z + 0.52, 0.2, 0.08, 0.2, 'black', { rx: Math.PI / 2, g });
    } else if (kind < 0.32) raw(x - 0.4, x + 0.4, 0.12, 0.92, z - 0.4, z + 0.4, 'wood', { g });
    else if (kind < 0.52) {      // oil drum, some of them burning
      raw(x - 0.3, x + 0.3, 0.12, 1.0, z - 0.3, z + 0.3, 'rust', { nv: true, g });
      prop('cyl', x, 0.56, z, 0.62, 0.88, 0.62, 'rust', { g }); prop('tor', x, 0.4, z, 0.64, 0.64, 0.64, 'metal', { g }); prop('tor', x, 0.75, z, 0.64, 0.64, 0.64, 'metal', { g });
      if (R() < 0.45) W.lights.push({ x, y: 1.25, z, kind: 'fire', flat: -1, g });
    } else if (kind < 0.72) {    // dead tree
      raw(x - 0.2, x + 0.2, 0.12, 3, z - 0.2, z + 0.2, 'wooddark', { nv: true, g });
      const th = rr(3, 4.4);
      prop('cyl', x, 0.12 + th / 2, z, 0.42, th, 0.42, 'bark', { g }); prop('cone', x, 0.34, z, 1.0, 0.7, 1.0, 'bark', { g });
      prop('tor', x, 0.14, z, 1.5, 0.5, 1.5, 'metal', { g });
      const nb = 6 + ((R() * 4) | 0);
      for (let k = 0; k < nb; k++) {
        const rx = rr(-1.1, 1.1), rz = rr(-1.1, 1.1), len = rr(1.4, 2.9), by = 0.12 + th * rr(0.5, 1);
        const ax = -Math.sin(rz), ay = Math.cos(rz) * Math.cos(rx), az = Math.cos(rz) * Math.sin(rx);
        prop('cone', x + ax * len / 2, by + ay * len / 2, z + az * len / 2, 0.2, len, 0.2, 'bark', { rx, rz, g });
        for (let q = 0; q < 2; q++) {
          const r2x = rx + rr(-0.8, 0.8), r2z = rz + rr(-0.8, 0.8), l2 = len * rr(0.4, 0.65), at = rr(0.4, 0.75);
          const bx2 = -Math.sin(r2z), by2 = Math.cos(r2z) * Math.cos(r2x), bz2 = Math.cos(r2z) * Math.sin(r2x);
          prop('cone', x + ax * len * at + bx2 * l2 / 2, by + ay * len * at + by2 * l2 / 2, z + az * len * at + bz2 * l2 / 2, 0.09, l2, 0.09, 'bark', { rx: r2x, rz: r2z, g });
        }
      }
    } else if (kind < 0.8) {     // phone booth
      raw(x - 0.5, x + 0.5, 0.12, 2.4, z - 0.5, z + 0.5, 'x', { nv: true, g });
      for (const [a, c] of [[-0.46, -0.46], [0.46, -0.46], [-0.46, 0.46], [0.46, 0.46]]) raw(x + a - 0.04, x + a + 0.04, 0.12, 2.3, z + c - 0.04, z + c + 0.04, 'clothred', { c: false, g });
      raw(x - 0.5, x + 0.5, 2.3, 2.45, z - 0.5, z + 0.5, 'clothred', { c: false, g }); raw(x - 0.45, x + 0.45, 0.2, 2.3, z - 0.47, z - 0.45, 'glass', { c: false, g }); raw(x - 0.45, x + 0.45, 0.2, 2.3, z + 0.45, z + 0.47, 'glass', { c: false, g });
      raw(x - 0.15, x + 0.15, 1.1, 1.6, z - s * 0.4, z - s * 0.3, 'black', { c: false, g });
    } else if (kind < 0.9) {     // bench
      raw(x - 0.9, x + 0.9, 0.12, 0.6, z - 0.25, z + 0.25, 'x', { nv: true, g });
      raw(x - 0.9, x + 0.9, 0.52, 0.58, z - 0.25, z + 0.25, 'wood', { c: false, g }); raw(x - 0.9, x + 0.9, 0.6, 1.0, z + s * 0.2, z + s * 0.25, 'wood', { c: false, g });
      for (const a of [-0.8, 0.8]) prop('tor', x + a, 0.36, z, 0.5, 0.5, 0.5, 'metal', { rz: Math.PI / 2, g });
    } else {                     // hydrant + bin
      raw(x - 0.2, x + 0.2, 0.12, 0.8, z - 0.2, z + 0.2, 'x', { nv: true, g });
      prop('cyl', x, 0.42, z, 0.26, 0.6, 0.26, 'clothred', { g }); prop('sph', x, 0.74, z, 0.28, 0.24, 0.28, 'clothred', { g }); prop('cyl', x, 0.5, z, 0.12, 0.5, 0.12, 'metal', { rz: Math.PI / 2, g });
    }
  }
  // sagging cables across the street, manholes, road markings
  for (let x = 5, n = 0; x < L; x += rr(7, 15), n++) {
    const c = { a: [x, rr(6, 10.5), -FRONT], b: [x + rr(-5, 5), rr(6, 10.5), FRONT], sag: rr(0.5, 1.5), g: `cb${n}` };
    W.cables.push(c);
    const e = grp(c.g, 'cable', -1); W.streetBrk.push(e);
    grow(e, Math.min(c.a[0], c.b[0]), Math.max(c.a[0], c.b[0]), Math.min(c.a[1], c.b[1]) - c.sag, Math.max(c.a[1], c.b[1]), -2, 2);
  }
  for (let x = 9; x < L; x += rr(16, 30)) prop('cyl', x, 0.012, rr(-2, 2), 0.9, 0.02, 0.9, 'metal');
  for (let x = 3; x < L; x += 6) if (R() < 0.7) raw(x, x + 2.4, 0.001, 0.012, -0.08, 0.08, 'paint', { c: false });
  for (let i = 0; i < 40; i++) W.spots.street.push({ x: rr(4, L - 4), y: 0.7, z: rr(-4.6, 4.6) });

  // ---------------------------------------------------------------- furniture catalogue
  // each piece is described in a wall-relative frame: a = along the wall, b = away from it.
  // parts: boxes [a0,a1,b0,b1,y0,y1,material]; pp: round props [shape,a,b,y,sx,sy,sz,material,axis?]
  const chair = (a, b) => [[a, a + 0.42, b, b + 0.42, 0.42, 0.47, 'wooddark'], [a, a + 0.42, b, b + 0.05, 0.47, 0.98, 'wooddark'],
    [a, a + 0.04, b, b + 0.04, 0, 0.42, 'wooddark'], [a + 0.38, a + 0.42, b, b + 0.04, 0, 0.42, 'wooddark'], [a, a + 0.04, b + 0.38, b + 0.42, 0, 0.42, 'wooddark'], [a + 0.38, a + 0.42, b + 0.38, b + 0.42, 0, 0.42, 'wooddark']];
  const books = (a0, a1, y, d) => { const out = []; for (let a = a0; a < a1 - 0.08;) { const w = rr(0.08, 0.26), h = rr(0.2, 0.33); if (R() < 0.85) out.push([a, Math.min(a1, a + w), 0.05, d - 0.04, y, y + h, pick(['clothred', 'clothgreen', 'cloth', 'wooddark', 'paper', 'black', 'mattress'])]); a += w + 0.01; } return out; };
  const CAT = {
    bed: { w: 1.6, d: 2.1, h: 0.55, top: 0.6, parts: (c) => [
      [0, 1.6, 0, 2.1, 0.12, 0.35, 'wooddark'], [0.05, 1.55, 0.08, 2.05, 0.35, 0.55, 'mattress'],
      [0.15, 0.75, 0.12, 0.5, 0.55, 0.68, 'white'], [0.85, 1.45, 0.12, 0.5, 0.55, 0.68, 'white'], [0, 1.6, 0, 0.08, 0, 1.15, 'wooddark'], [0, 1.6, 2.04, 2.1, 0, 0.6, 'wooddark'],
      [0.04, 1.56, 0.8, 2.06, 0.55, 0.6, c]], pp: [['sph', 0.05, 0.04, 1.18, 0.14, 0.14, 0.14, 'wooddark'], ['sph', 1.55, 0.04, 1.18, 0.14, 0.14, 0.14, 'wooddark']] },
    mattress: { w: 1.0, d: 2.0, h: 0.22, parts: (c) => [[0, 1.0, 0.1, 2.0, 0, 0.2, 'mattress'], [0.1, 0.8, 0.9, 1.9, 0.2, 0.24, c], [0.15, 0.7, 0.15, 0.5, 0.2, 0.3, 'white']] },
    sofa: { w: 2.0, d: 0.9, h: 0.8, parts: (c) => [
      [0, 2, 0, 0.9, 0.12, 0.42, c], [0, 2, 0, 0.26, 0.42, 0.9, c],
      [0, 0.22, 0, 0.9, 0.42, 0.66, c], [1.78, 2, 0, 0.9, 0.42, 0.66, c],
      [0.24, 0.98, 0.28, 0.88, 0.42, 0.54, c], [1.02, 1.76, 0.28, 0.88, 0.42, 0.54, c], [0.26, 0.96, 0.24, 0.42, 0.54, 0.88, c], [1.04, 1.74, 0.24, 0.42, 0.54, 0.88, c]],
      pp: [['cyl', 0.1, 0.1, 0.06, 0.08, 0.12, 0.08, 'wooddark'], ['cyl', 1.9, 0.1, 0.06, 0.08, 0.12, 0.08, 'wooddark'], ['cyl', 0.1, 0.8, 0.06, 0.08, 0.12, 0.08, 'wooddark'], ['cyl', 1.9, 0.8, 0.06, 0.08, 0.12, 0.08, 'wooddark']] },
    armchair: { w: 0.95, d: 0.9, h: 0.8, parts: (c) => [
      [0, 0.95, 0, 0.9, 0.12, 0.42, c], [0, 0.95, 0, 0.24, 0.42, 0.98, c], [0, 0.2, 0, 0.9, 0.42, 0.68, c], [0.75, 0.95, 0, 0.9, 0.42, 0.68, c], [0.22, 0.73, 0.26, 0.88, 0.42, 0.54, c]],
      pp: [['cyl', 0.1, 0.1, 0.06, 0.08, 0.12, 0.08, 'wooddark'], ['cyl', 0.85, 0.1, 0.06, 0.08, 0.12, 0.08, 'wooddark'], ['cyl', 0.1, 0.8, 0.06, 0.08, 0.12, 0.08, 'wooddark'], ['cyl', 0.85, 0.8, 0.06, 0.08, 0.12, 0.08, 'wooddark']] },
    coffee: { w: 1.1, d: 0.95, h: 0.42, top: 0.44, tb: 0.6, parts: () => [[0, 1.1, 0.3, 0.9, 0.38, 0.43, 'wood'], [0.05, 1.05, 0.35, 0.85, 0.12, 0.15, 'wood']],
      pp: [['cyl', 0.08, 0.36, 0.2, 0.06, 0.4, 0.06, 'wooddark'], ['cyl', 1.02, 0.36, 0.2, 0.06, 0.4, 0.06, 'wooddark'], ['cyl', 0.08, 0.84, 0.2, 0.06, 0.4, 0.06, 'wooddark'], ['cyl', 1.02, 0.84, 0.2, 0.06, 0.4, 0.06, 'wooddark']] },
    table: { w: 2.4, d: 1.0, h: 0.78, top: 0.78, parts: () => [
      [0.5, 1.9, 0.05, 0.95, 0.72, 0.78, 'wood'], [0.56, 1.84, 0.1, 0.9, 0.62, 0.72, 'wooddark'], ...chair(0, 0.3), ...chair(1.98, 0.3)],
      pp: [['cyl', 0.6, 0.14, 0.36, 0.08, 0.72, 0.08, 'wood'], ['cyl', 1.8, 0.14, 0.36, 0.08, 0.72, 0.08, 'wood'], ['cyl', 0.6, 0.86, 0.36, 0.08, 0.72, 0.08, 'wood'], ['cyl', 1.8, 0.86, 0.36, 0.08, 0.72, 0.08, 'wood'],
        ['cyl', 0.9, 0.5, 0.79, 0.26, 0.015, 0.26, 'white'], ['cyl', 1.5, 0.45, 0.79, 0.26, 0.015, 0.26, 'white'], ['cyl', 1.2, 0.7, 0.9, 0.07, 0.24, 0.07, 'glass'], ['cone', 1.2, 0.7, 1.08, 0.07, 0.14, 0.07, 'glass']] },
    rtable: { w: 1.9, d: 1.3, h: 0.76, top: 0.78, parts: () => [], pp: [['cyl', 0.95, 0.65, 0.75, 1.2, 0.05, 1.2, 'wood'], ['cyl', 0.95, 0.65, 0.37, 0.12, 0.72, 0.12, 'wooddark'], ['cone', 0.95, 0.65, 0.1, 0.7, 0.2, 0.7, 'wooddark'],
      ['cyl', 0.2, 0.65, 0.45, 0.36, 0.05, 0.36, 'wooddark'], ['cyl', 0.2, 0.65, 0.22, 0.07, 0.44, 0.07, 'wooddark'], ['cyl', 1.7, 0.65, 0.45, 0.36, 0.05, 0.36, 'wooddark'], ['cyl', 1.7, 0.65, 0.22, 0.07, 0.44, 0.07, 'wooddark'],
      ['cyl', 0.8, 0.5, 0.79, 0.24, 0.015, 0.24, 'white'], ['sph', 1.15, 0.8, 0.88, 0.2, 0.2, 0.2, 'glass']] },
    counter: { w: 2.6, d: 0.62, h: 0.9, top: 0.9, parts: () => [
      [0, 2.6, 0, 0.6, 0.08, 0.86, 'wooddark'], [0, 2.6, 0, 0.62, 0.86, 0.9, 'stone'], [0, 2.6, 0.04, 0.56, 0, 0.08, 'black'],
      [0.9, 1.6, 0, 0.63, 0.1, 0.87, 'metal'], [0.95, 1.55, 0.05, 0.58, 0.9, 0.92, 'black'], [0.98, 1.52, 0.61, 0.64, 0.3, 0.7, 'glass'],
      [0, 2.6, 0, 0.35, 1.5, 2.25, 'wooddark'], [0.86, 0.88, 0.35, 0.36, 1.55, 2.2, 'black'], [1.72, 1.74, 0.35, 0.36, 1.55, 2.2, 'black'],
      [0.44, 0.46, 0.6, 0.61, 0.12, 0.82, 'black'], [2.1, 2.12, 0.6, 0.61, 0.12, 0.82, 'black']],
      pp: [['cyl', 1.1, 0.3, 0.99, 0.24, 0.14, 0.24, 'metal'], ['cyl', 1.42, 0.3, 0.95, 0.2, 0.05, 0.2, 'black'], ['cyl', 0.3, 0.3, 1.02, 0.08, 0.26, 0.08, 'glass'], ['cyl', 2.2, 0.25, 0.96, 0.2, 0.12, 0.2, 'white'], ['cyl', 0.55, 0.12, 1.0, 0.03, 0.22, 0.03, 'metal'],
        ['sph', 2.0, 0.3, 0.86, 0.5, 0.2, 0.4, 'metal'], ['cyl', 2.0, 0.08, 1.02, 0.03, 0.28, 0.03, 'metal']] },
    fridge: { w: 0.7, d: 0.7, h: 1.85, parts: () => [
      [0, 0.7, 0, 0.68, 0, 1.85, 'fridge'], [0.02, 0.68, 0.68, 0.7, 1.22, 1.24, 'black'],
      [0.6, 0.63, 0.68, 0.73, 0.7, 1.1, 'metal'], [0.6, 0.63, 0.68, 0.73, 1.35, 1.65, 'metal']] },
    washer: { w: 0.65, d: 0.62, h: 0.88, top: 0.88, parts: () => [[0, 0.65, 0, 0.6, 0, 0.88, 'fridge'], [0.05, 0.6, 0.6, 0.62, 0.72, 0.84, 'black']],
      pp: [['tor', 0.325, 0.61, 0.42, 0.42, 0.3, 0.42, 'metal', 'b'], ['cyl', 0.325, 0.6, 0.42, 0.34, 0.03, 0.34, 'glass', 'b']] },
    shelf: { w: 1.0, d: 0.35, h: 1.8, parts: (c) => [
      [0, 0.04, 0, 0.35, 0, 1.8, 'wood'], [0.96, 1, 0, 0.35, 0, 1.8, 'wood'], [0, 1, 0, 0.03, 0, 1.8, 'wooddark'],
      [0, 1, 0, 0.35, 0.02, 0.06, 'wood'], [0, 1, 0, 0.35, 0.45, 0.49, 'wood'], [0, 1, 0, 0.35, 0.9, 0.94, 'wood'],
      [0, 1, 0, 0.35, 1.35, 1.39, 'wood'], [0, 1, 0, 0.35, 1.76, 1.8, 'wood'],
      [0.08, 0.5, 0.06, 0.3, 0.49, 0.74, c], [0.55, 0.9, 0.06, 0.3, 0.94, 1.2, 'paper'],
      [0.1, 0.36, 0.06, 0.3, 1.39, 1.6, 'white']], pp: [['cyl', 0.7, 0.18, 0.6, 0.16, 0.22, 0.16, 'glass'], ['sph', 0.25, 0.18, 1.04, 0.2, 0.2, 0.2, 'rust'], ['cyl', 0.7, 0.18, 1.5, 0.12, 0.22, 0.12, 'metal'], ['cyl', 0.25, 0.18, 0.16, 0.22, 0.2, 0.22, 'metal']] },
    bookcase: { w: 1.3, d: 0.36, h: 2.1, parts: () => [
      [0, 0.05, 0, 0.36, 0, 2.1, 'wooddark'], [1.25, 1.3, 0, 0.36, 0, 2.1, 'wooddark'], [0, 1.3, 0, 0.03, 0, 2.1, 'wooddark'], [-0.03, 1.33, 0, 0.39, 2.1, 2.16, 'wooddark'],
      ...[0.04, 0.46, 0.88, 1.3, 1.72].flatMap((y) => [[0, 1.3, 0, 0.36, y, y + 0.04, 'wooddark'], ...(y < 1.7 ? books(0.06, 1.24, y + 0.04, 0.36) : [])])] },
    dresser: { w: 1.2, d: 0.5, h: 0.95, top: 0.95, parts: () => [[0, 1.2, 0, 0.48, 0.06, 0.95, 'wooddark'], [-0.02, 1.22, 0, 0.5, 0.95, 0.99, 'wood'],
      [0.04, 1.16, 0.48, 0.5, 0.1, 0.36, 'wood'], [0.04, 1.16, 0.48, 0.5, 0.39, 0.64, 'wood'], [0.04, 1.16, 0.48, 0.5, 0.67, 0.92, 'wood']],
      pp: [['sph', 0.3, 0.52, 0.23, 0.06, 0.06, 0.06, 'metal'], ['sph', 0.9, 0.52, 0.23, 0.06, 0.06, 0.06, 'metal'], ['sph', 0.3, 0.52, 0.52, 0.06, 0.06, 0.06, 'metal'], ['sph', 0.9, 0.52, 0.52, 0.06, 0.06, 0.06, 'metal'], ['sph', 0.3, 0.52, 0.8, 0.06, 0.06, 0.06, 'metal'], ['sph', 0.9, 0.52, 0.8, 0.06, 0.06, 0.06, 'metal']] },
    tv: { w: 1.2, d: 0.45, h: 0.5, top: 0.5, parts: () => [
      [0, 1.2, 0, 0.45, 0.06, 0.5, 'wood'], [0.2, 1.0, 0.02, 0.4, 0.5, 1.08, 'wooddark'], [0.26, 0.82, 0.4, 0.42, 0.56, 1.02, 'tvglass'],
      [0.86, 0.96, 0.4, 0.42, 0.6, 0.98, 'black']], pp: [['cyl', 0.5, 0.2, 1.3, 0.015, 0.5, 0.015, 'metal'], ['cyl', 0.7, 0.2, 1.3, 0.015, 0.5, 0.015, 'metal'], ['sph', 0.9, 0.42, 0.7, 0.05, 0.05, 0.05, 'metal']] },
    radio: { w: 0.6, d: 0.45, h: 0.72, top: 0.98, parts: () => [[0, 0.6, 0, 0.45, 0.68, 0.72, 'wood'], [0.08, 0.52, 0.08, 0.36, 0.72, 0.98, 'wooddark'], [0.12, 0.3, 0.36, 0.37, 0.76, 0.94, 'cloth']],
      pp: [['cyl', 0.06, 0.06, 0.34, 0.05, 0.68, 0.05, 'wooddark'], ['cyl', 0.54, 0.06, 0.34, 0.05, 0.68, 0.05, 'wooddark'], ['cyl', 0.06, 0.39, 0.34, 0.05, 0.68, 0.05, 'wooddark'], ['cyl', 0.54, 0.39, 0.34, 0.05, 0.68, 0.05, 'wooddark'], ['sph', 0.42, 0.37, 0.85, 0.07, 0.07, 0.07, 'metal']] },
    crate: { w: 0.8, d: 0.8, h: 0.8, top: 0.8, parts: () => [[0, 0.8, 0, 0.8, 0, 0.8, 'wood'], [-0.01, 0.81, -0.01, 0.81, 0.1, 0.18, 'wooddark'], [-0.01, 0.81, -0.01, 0.81, 0.62, 0.7, 'wooddark']] },
    crates: { w: 1.5, d: 0.8, h: 1.4, parts: () => [
      [0, 0.8, 0, 0.8, 0, 0.8, 'wood'], [0.85, 1.5, 0.05, 0.7, 0, 0.65, 'wood'], [0.1, 0.7, 0.1, 0.7, 0.8, 1.4, 'wood'], [-0.01, 0.81, -0.01, 0.81, 0.3, 0.38, 'wooddark']] },
    boxes: { w: 1.1, d: 0.7, h: 1.2, top: 1.2, parts: () => [[0, 0.6, 0, 0.6, 0, 0.45, 'paper'], [0.62, 1.1, 0.05, 0.6, 0, 0.4, 'paper'], [0.05, 0.6, 0.05, 0.6, 0.45, 0.85, 'paper'], [0.1, 0.55, 0.1, 0.55, 0.85, 1.2, 'paper'], [0.65, 1.05, 0.1, 0.55, 0.4, 0.7, 'paper'],
      [0.28, 0.32, 0, 0.61, 0, 0.455, 'wooddark'], [0.3, 0.34, 0.05, 0.61, 0.45, 0.855, 'wooddark']] },
    papers: { w: 0.9, d: 0.5, h: 0.9, top: 0.9, parts: () => { const o = []; for (let k = 0; k < 3; k++) { const a = k * 0.3, n = 3 + ((R() * 5) | 0); for (let j = 0; j < n; j++) o.push([a + rr(0, 0.03), a + 0.27 + rr(-0.02, 0.02), 0.05 + rr(0, 0.04), 0.42 + rr(-0.03, 0.03), j * 0.12, j * 0.12 + 0.115, j % 2 ? 'paper' : 'mattress']); } return o; } },
    tub: { w: 1.7, d: 0.75, h: 0.58, parts: () => [
      [0, 1.7, 0, 0.75, 0.1, 0.5, 'white'], [0, 1.7, 0, 0.08, 0.5, 0.58, 'white'], [0, 1.7, 0.67, 0.75, 0.5, 0.58, 'white'],
      [0, 0.08, 0, 0.75, 0.5, 0.58, 'white'], [1.62, 1.7, 0, 0.75, 0.5, 0.58, 'white'], [0.08, 1.62, 0.08, 0.67, 0.5, 0.51, 'black']],
      pp: [['sph', 0.15, 0.15, 0.08, 0.16, 0.16, 0.16, 'metal'], ['sph', 1.55, 0.15, 0.08, 0.16, 0.16, 0.16, 'metal'], ['sph', 0.15, 0.6, 0.08, 0.16, 0.16, 0.16, 'metal'], ['sph', 1.55, 0.6, 0.08, 0.16, 0.16, 0.16, 'metal'], ['cyl', 0.2, 0.1, 0.75, 0.04, 0.34, 0.04, 'metal']] },
    toilet: { w: 0.45, d: 0.68, h: 0.45, parts: () => [
      [0, 0.45, 0, 0.22, 0.3, 0.85, 'white']], pp: [['cyl', 0.225, 0.45, 0.21, 0.4, 0.42, 0.46, 'white'], ['tor', 0.225, 0.45, 0.43, 0.42, 0.5, 0.48, 'white'], ['cyl', 0.225, 0.11, 0.15, 0.3, 0.3, 0.2, 'white']] },
    sink: { w: 0.6, d: 0.45, h: 0.85, parts: () => [
      [0.05, 0.55, 0, 0.03, 1.1, 1.75, 'mirror'], [0.02, 0.58, 0, 0.02, 1.07, 1.78, 'wooddark']], pp: [['cyl', 0.3, 0.2, 0.35, 0.16, 0.7, 0.16, 'white'], ['sph', 0.3, 0.24, 0.8, 0.6, 0.3, 0.46, 'white'], ['cyl', 0.3, 0.06, 0.95, 0.04, 0.2, 0.04, 'metal']] },
    nightstand: { w: 0.5, d: 0.45, h: 0.5, top: 0.5, parts: () => [
      [0, 0.5, 0, 0.45, 0.08, 0.5, 'wooddark'], [0.03, 0.47, 0.44, 0.46, 0.28, 0.46, 'wood']], pp: [['sph', 0.25, 0.47, 0.37, 0.05, 0.05, 0.05, 'metal'], ['cyl', 0.06, 0.06, 0.04, 0.05, 0.08, 0.05, 'wooddark'], ['cyl', 0.44, 0.06, 0.04, 0.05, 0.08, 0.05, 'wooddark'], ['cyl', 0.06, 0.39, 0.04, 0.05, 0.08, 0.05, 'wooddark'], ['cyl', 0.44, 0.39, 0.04, 0.05, 0.08, 0.05, 'wooddark']] },
    desk: { w: 1.3, d: 1.2, h: 0.76, top: 0.76, tb: 0.3, parts: () => [
      [0, 1.3, 0, 0.6, 0.7, 0.76, 'wood'], [0, 0.05, 0, 0.6, 0, 0.7, 'wood'], [1.25, 1.3, 0, 0.6, 0, 0.7, 'wood'],
      [0.8, 1.25, 0.03, 0.57, 0.25, 0.7, 'wooddark'], ...chair(0.32, 0.72), [0.2, 0.55, 0.12, 0.4, 0.76, 0.78, 'paper']], pp: [['sph', 1.02, 0.58, 0.5, 0.05, 0.05, 0.05, 'metal']] },
    piano: { w: 1.5, d: 0.65, h: 1.25, parts: () => [
      [0, 1.5, 0, 0.4, 0, 1.25, 'black'], [0, 1.5, 0.4, 0.65, 0.62, 0.72, 'black'], [-0.02, 1.52, 0, 0.42, 1.25, 1.29, 'black'],
      [0.05, 1.45, 0.42, 0.64, 0.72, 0.74, 'white'], [0, 0.08, 0.4, 0.65, 0, 0.62, 'black'], [1.42, 1.5, 0.4, 0.65, 0, 0.62, 'black'], [0.4, 1.1, 0.38, 0.41, 0.85, 1.1, 'paper']] },
    clock: { w: 0.55, d: 0.35, h: 2.05, parts: () => [[0.03, 0.52, 0, 0.3, 0, 0.5, 'wooddark'], [0.08, 0.47, 0.02, 0.26, 0.5, 1.5, 'wooddark'], [0.12, 0.43, 0.26, 0.27, 0.6, 1.4, 'glass'], [0, 0.55, 0, 0.33, 1.5, 2.0, 'wooddark'], [-0.03, 0.58, 0, 0.36, 2.0, 2.06, 'wooddark']],
      pp: [['cyl', 0.275, 0.335, 1.75, 0.36, 0.02, 0.36, 'white', 'b'], ['cyl', 0.275, 0.2, 0.95, 0.02, 0.6, 0.02, 'metal'], ['sph', 0.275, 0.2, 0.66, 0.12, 0.12, 0.04, 'metal']] },
    barrel: { w: 0.7, d: 0.7, h: 0.95, top: 0.96, parts: () => [], pp: [['cyl', 0.35, 0.35, 0.47, 0.64, 0.94, 0.64, 'wood'], ['tor', 0.35, 0.35, 0.25, 0.66, 0.66, 0.66, 'metal'], ['tor', 0.35, 0.35, 0.7, 0.66, 0.66, 0.66, 'metal']] },
    lampst: { w: 0.45, d: 0.45, h: 1.7, parts: () => [], pp: [['cyl', 0.22, 0.22, 0.03, 0.4, 0.06, 0.4, 'metal'], ['cyl', 0.22, 0.22, 0.8, 0.05, 1.5, 0.05, 'metal'], ['cone', 0.22, 0.22, 1.6, 0.5, 0.36, 0.5, 'clothred'], ['tor', 0.22, 0.22, 1.43, 0.5, 0.4, 0.5, 'metal']] },
    stool: { w: 0.45, d: 0.45, h: 0.5, top: 0.5, parts: () => [], pp: [['cyl', 0.22, 0.22, 0.47, 0.4, 0.06, 0.4, 'wood'], ['cyl', 0.1, 0.1, 0.22, 0.05, 0.44, 0.05, 'wooddark'], ['cyl', 0.34, 0.1, 0.22, 0.05, 0.44, 0.05, 'wooddark'], ['cyl', 0.22, 0.36, 0.22, 0.05, 0.44, 0.05, 'wooddark']] },
    crib: { w: 1.3, d: 0.75, h: 0.95, parts: () => { const o = [[0, 1.3, 0, 0.75, 0.35, 0.42, 'wood'], [0.04, 1.26, 0.04, 0.71, 0.42, 0.5, 'mattress'], [0, 1.3, 0, 0.04, 0.9, 0.95, 'wood'], [0, 1.3, 0.71, 0.75, 0.9, 0.95, 'wood'], [0, 0.04, 0, 0.75, 0, 0.95, 'wood'], [1.26, 1.3, 0, 0.75, 0, 0.95, 'wood'], [0.3, 0.8, 0.15, 0.6, 0.5, 0.53, 'clothred']];
      for (let a = 0.12; a < 1.25; a += 0.13) { o.push([a, a + 0.03, 0, 0.03, 0.42, 0.9, 'wood']); o.push([a, a + 0.03, 0.72, 0.75, 0.42, 0.9, 'wood']); } return o; } },
    horse: { w: 1.1, d: 0.5, h: 0.9, parts: () => [[0.25, 0.85, 0.15, 0.35, 0.45, 0.68, 'wood'], [0.78, 0.92, 0.18, 0.32, 0.6, 0.98, 'wood'], [0.84, 1.08, 0.19, 0.31, 0.86, 1.0, 'wood'], [0.3, 0.36, 0.17, 0.23, 0.12, 0.46, 'wooddark'], [0.74, 0.8, 0.17, 0.23, 0.12, 0.46, 'wooddark'], [0.3, 0.36, 0.27, 0.33, 0.12, 0.46, 'wooddark'], [0.74, 0.8, 0.27, 0.33, 0.12, 0.46, 'wooddark'],
      [0, 1.1, 0.14, 0.2, 0.04, 0.12, 'clothred'], [0, 1.1, 0.3, 0.36, 0.04, 0.12, 'clothred']], pp: [['sph', 1.0, 0.2, 0.96, 0.04, 0.04, 0.04, 'black'], ['sph', 1.0, 0.3, 0.96, 0.04, 0.04, 0.04, 'black']] },
    wheelchair: { w: 0.7, d: 0.9, h: 0.9, parts: () => [[0.12, 0.58, 0.25, 0.7, 0.45, 0.5, 'black'], [0.12, 0.58, 0.25, 0.3, 0.5, 0.95, 'black'], [0.14, 0.56, 0.7, 0.9, 0.12, 0.16, 'metal']],
      pp: [['tor', 0.08, 0.4, 0.33, 0.62, 0.3, 0.62, 'metal', 'a'], ['tor', 0.62, 0.4, 0.33, 0.62, 0.3, 0.62, 'metal', 'a'], ['cyl', 0.18, 0.78, 0.1, 0.16, 0.05, 0.16, 'black', 'a'], ['cyl', 0.52, 0.78, 0.1, 0.16, 0.05, 0.16, 'black', 'a'], ['cyl', 0.12, 0.28, 0.7, 0.03, 0.5, 0.03, 'metal'], ['cyl', 0.58, 0.28, 0.7, 0.03, 0.5, 0.03, 'metal']] },
    picture: { w: 0.8, d: 0.06, h: 0, nocol: true, parts: () => { const y = rr(1.25, 1.5), h = rr(0.5, 0.9); return [[0, 0.8, 0, 0.03, y, y + h, 'wooddark'], [0.06, 0.74, 0.03, 0.04, y + 0.06, y + h - 0.06, pick(['portrait', 'portrait', 'paper', 'clothgreen'])]]; } },
    mirror: { w: 0.7, d: 0.06, h: 0, nocol: true, parts: () => [[0, 0.7, 0, 0.03, 0.9, 2.0, 'wooddark'], [0.05, 0.65, 0.03, 0.04, 0.95, 1.95, 'mirror']] },
    mannequin: { w: 0.6, d: 0.6, h: 1.8, mq: true, parts: () => [] },
  };
  const ROLES = {
    living: ['sofa', 'tv', 'coffee', 'armchair', 'bookcase', 'lampst', 'rtable', 'piano', 'clock', 'picture', 'radio', 'dresser', 'picture'],
    kitchen: ['counter', 'fridge', 'table', 'washer', 'stool', 'shelf', 'barrel', 'picture', 'rtable'],
    bedroom: ['bed', 'nightstand', 'dresser', 'armchair', 'lampst', 'mirror', 'picture', 'desk', 'radio'],
    bath: ['tub', 'toilet', 'sink', 'washer', 'stool', 'mirror'],
    store: ['crates', 'boxes', 'shelf', 'barrel', 'boxes', 'papers', 'crate', 'wheelchair'],
    kids: ['crib', 'bed', 'horse', 'shelf', 'desk', 'boxes', 'picture'],
    hoard: ['boxes', 'papers', 'boxes', 'crates', 'papers', 'barrel', 'boxes', 'shelf', 'papers', 'armchair', 'boxes', 'papers'],
    nursery: ['crib', 'crib', 'horse', 'dresser', 'armchair', 'lampst', 'picture', 'horse'],
    ritual: ['mannequin', 'mannequin', 'mannequin', 'crate', 'mannequin'],
    butcher: ['counter', 'fridge', 'fridge', 'table', 'barrel', 'crates', 'sink'],
    empty: ['mattress', 'boxes', 'papers', 'wheelchair'],
    workshop: ['desk', 'mannequin', 'shelf', 'desk', 'mannequin', 'crates', 'lampst', 'stool', 'mannequin'],
    study: ['bookcase', 'bookcase', 'desk', 'piano', 'armchair', 'clock', 'bookcase', 'picture', 'lampst', 'radio'],
  };
  const THEMES = ['home', 'home', 'home', 'home', 'hoard', 'nursery', 'ritual', 'butcher', 'empty', 'workshop', 'study'];

  // ---------------------------------------------------------------- buildings
  for (let i = 0; i < NB; i++) for (const side of [1, -1]) {
    const x0 = i * BW, nF = R() < 0.45 ? 3 : 4, flip = R() < 0.5;
    // every block gets its own look
    const st = {
      wall: pick(['brick', 'brick2', 'brick3', 'stucco1', 'stucco2', 'stucco3', 'panel', 'brick']),
      trim: pick(['concrete', 'stone', 'stone']), plinth: R() < 0.6, bands: R() < 0.55, quoins: R() < 0.35,
      cornice: pick(['flat', 'dentil', 'step', 'gable']), win: pick(['plain', 'arch', 'shutter', 'pediment']),
      winW: rr(1.5, 2.1), sill: rr(0.85, 1.05), head: rr(2.15, 2.35), balc: pick(['bars', 'solid', 'bars']),
      shop: R() < 0.4, shut: pick(['clothgreen', 'wooddark', 'cloth']), canopy: pick(['flat', 'arch', 'gable']),
    };
    const brick = st.wall;
    const b = { id: W.buildings.length, i, side, x0, nF, flip, name: `${i + 1}${side > 0 ? 'A' : 'B'}`, flats: [], roofY: nF * FH };
    W.buildings.push(b);
    const wx = (u) => x0 + (flip ? BW - u : u);
    const wz = (v) => side * (FRONT + v);
    const dx = flip ? -1 : 1, dz = side;
    const bx = (u0, u1, y0, y1, v0, v1, m, o) => raw(wx(u0), wx(u1), y0, y1, wz(v0), wz(v1), m, o);
    const pr = (sh, u, y, v, sx, sy, sz, m, o) => prop(sh, wx(u), y, wz(v), sx, sy, sz, m, o);
    const sign = (u, y, v, w, h, text, kind, extra) => W.signs.push(Object.assign({ x: wx(u), y, z: wz(v), nz: -dz, w, h, text, kind }, extra));
    const H = nF * FH, top = H + 0.9;
    // walkable graph for the crawlers: nodes {x,y,z,door?,flat?}, undirected edges
    const nav = b.nav = { n: [], e: [] };
    const node = (u, y, v, extra) => { nav.n.push(Object.assign({ x: wx(u), y, z: wz(v) }, extra)); nav.e.push([]); return nav.n.length - 1; };
    const link = (a, c) => { nav.e[a].push(c); nav.e[c].push(a); };
    const hall = [];

    // shell
    const pg = `par${b.id}`;
    b.parG = grp(pg, 'parapet', -1);
    bx(0, T, 0, top, 0, BD, brick); bx(BW - T, BW, 0, top, 0, BD, brick); bx(T, BW - T, 0, top, BD - T, BD, brick);
    bx(T, BW - T, H, top, 0, T, brick, { g: pg });
    bx(0, BW, top, top + 0.1, -0.12, T + 0.05, st.trim, { c: false, g: pg, deco: 1 });   // coping
    if (st.cornice === 'dentil') for (let u = 0.2; u < BW - 0.2; u += 0.5) bx(u, u + 0.25, top - 0.22, top, -0.1, 0, st.trim, { c: false, g: pg, deco: 1 });
    else if (st.cornice === 'step') { bx(0, BW, top - 0.14, top, -0.07, 0, st.trim, { c: false, g: pg, deco: 1 }); bx(0, BW, top - 0.3, top - 0.14, -0.03, 0, st.trim, { c: false, g: pg, deco: 1 }); }
    else if (st.cornice === 'gable') { pr('tri', 6, top + 0.1, T / 2, 6.4, 1.5, T, brick, { g: pg }); pr('tor', 6, top + 0.62, -0.02, 0.8, 0.5, 0.8, st.trim, { rx: Math.PI / 2, g: pg }); }
    pr('cyl', 0.12, top / 2, -0.09, 0.13, top, 0.13, 'metal'); pr('cyl', 0.12, top - 0.2, -0.09, 0.22, 0.3, 0.22, 'metal');   // drainpipe
    for (let y = 1; y < top; y += 2.2) pr('tor', 0.12, y, -0.09, 0.2, 0.3, 0.2, 'metal');
    if (st.quoins) for (let y = 0; y < top - 0.4; y += 0.8) { bx(0, 0.34, y, y + 0.36, -0.05, 0, 'stone', { c: false }); bx(BW - 0.34, BW, y + 0.4, y + 0.76, -0.05, 0, 'stone', { c: false }); }
    // street entrance
    bx(T, 0.9, 0, FH, 0, T, brick); bx(2.1, SW, 0, FH, 0, T, brick); bx(0.9, 2.1, 2.3, FH, 0, T, brick);
    bx(0.84, 0.9, 0, 2.3, -0.04, T + 0.02, st.trim, { c: false }); bx(2.1, 2.16, 0, 2.3, -0.04, T + 0.02, st.trim, { c: false });
    bx(0.7, 2.3, 0, 0.14, -0.6, 0, 'stone');
    if (st.canopy === 'flat') { bx(0.7, 2.3, 2.34, 2.46, -0.7, 0, 'concrete', { c: false }); pr('cyl', 0.8, 2.2, -0.35, 0.04, 0.8, 0.04, 'metal', { rx: 0.9 * dz }); pr('cyl', 2.2, 2.2, -0.35, 0.04, 0.8, 0.04, 'metal', { rx: 0.9 * dz }); }
    else if (st.canopy === 'arch') pr('arch', 1.5, 2.3, -0.03, 1.5, 1.5, 0.2, st.trim);
    else pr('tri', 1.5, 2.34, -0.2, 1.8, 0.6, 0.5, st.trim);
    sign(2.5, 1.9, -0.012, 0.5, 0.28, b.name, 'number');
    pr('sph', 0.72, 2.0, -0.14, 0.22, 0.26, 0.22, 'lampglass'); pr('cyl', 0.72, 2.0, -0.06, 0.04, 0.16, 0.04, 'metal', { rx: Math.PI / 2 });
    if (R() < 0.45) W.lights.push({ x: wx(0.72), y: 2.0, z: wz(-0.2), kind: 'porch', flat: -1 });
    for (let f = 1; f < nF; f++) {
      const g = `sw${b.id}_${f}`;
      grp(g, 'stairwall', -1);
      bx(T, 1.1, f * FH, (f + 1) * FH, 0, T, brick, { g }); bx(1.9, SW, f * FH, (f + 1) * FH, 0, T, brick, { g });
      bx(1.1, 1.9, f * FH, f * FH + 1.3, 0, T, brick, { g }); bx(1.1, 1.9, f * FH + 2.1, (f + 1) * FH, 0, T, brick, { g });
      pr('tor', 1.5, f * FH + 1.7, 0.02, 0.86, 0.6, 0.86, st.trim, { rx: Math.PI / 2, g });   // round stair window
      bx(1.47, 1.53, f * FH + 1.3, f * FH + 2.1, 0.06, 0.12, 'wooddark', { c: false, g }); bx(1.1, 1.9, f * FH + 1.67, f * FH + 1.73, 0.06, 0.12, 'wooddark', { c: false, g });
      bx(1.1, 1.9, f * FH + 1.3, f * FH + 2.1, 0.08, 0.1, 'glass', { c: false, g });
      if (st.bands) bx(T, SW, (f + 1) * FH - 0.16, (f + 1) * FH, -0.09, 0, st.trim, { c: false, g, deco: 1 });
    }
    bx(SW, SW + T, H, top, 2.5, BD - T, brick);                             // parapet around the stair hole
    W.spawns.push({ x: wx(1.5), y: 0.1, z: wz(1.3), b: b.id });
    // pseudo-flat so hands can be sent into a stairwell (through the street door, or by breaking the wall of that landing)
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
        // handrails along both flights, with balusters
        pr('cyl', 1.6, y0 + 1.75, 5, 0.07, 5.25, 0.07, 'wooddark', { rx: Math.atan2(dz * 5, 1.6) });
        pr('cyl', 1.6, y0 + 3.35, 5, 0.07, 5.25, 0.07, 'wooddark', { rx: Math.atan2(-dz * 5, 1.6) });
        for (let j = 0; j < 8; j++) { pr('cyl', 1.6, y0 + (j + 1) * 0.2 + 0.42, 2.8 + j * 0.625, 0.03, 0.85, 0.03, 'rail'); pr('cyl', 1.6, y0 + 1.6 + (j + 1) * 0.2 + 0.42, 7.2 - j * 0.625, 0.03, 0.85, 0.03, 'rail'); }
        pr('cyl', 1.6, y0 + 0.5, 2.5, 0.1, 1.0, 0.1, 'wooddark'); pr('sph', 1.6, y0 + 1.04, 2.5, 0.16, 0.16, 0.16, 'wooddark');
        pr('cyl', 1.6, y0 + 2.1, 7.5, 0.1, 1.0, 0.1, 'wooddark'); pr('sph', 1.6, y0 + 2.64, 7.5, 0.16, 0.16, 0.16, 'wooddark');
        pr('cyl', 0.32, y0 + 2.9, 5, 0.1, 9.4, 0.1, 'rust', { rx: Math.PI / 2 });      // pipe under the ceiling
        pr('cyl', 0.5, y0 + 2.86, 5, 0.05, 9.4, 0.05, 'metal', { rx: Math.PI / 2 });
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
      if (R() < 0.25) sign(SW - 0.011, y0 + 1.6, 4 + R() * 3, 1.6, 0.5, pick(SCRAWLS), 'blood', { nz: 0, nx: -dx });
    }

    // roof
    bx(SW, BW - T, H - 0.2, H - 0.05, T, BD - T, 'ceil'); bx(SW, BW - T, H - 0.05, H, T, BD - T, 'roof');
    {
      const n = 1 + ((R() * 3) | 0);
      for (let k = 0; k < n; k++) {
        const u = rr(4.5, 10.5), v = rr(3, 8.5), kind = R();
        if (kind < 0.35) {          // water tank on legs
          bx(u - 0.7, u + 0.7, H, H + 2.3, v - 0.7, v + 0.7, 'x', { nv: true });
          pr('cyl', u, H + 1.5, v, 1.5, 1.5, 1.5, 'rust'); pr('cone', u, H + 2.5, v, 1.56, 0.5, 1.56, 'rust'); pr('tor', u, H + 1.1, v, 1.52, 1, 1.52, 'metal'); pr('tor', u, H + 1.9, v, 1.52, 1, 1.52, 'metal');
          for (const [a, c] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) pr('cyl', u + a, H + 0.4, v + c, 0.1, 0.8, 0.1, 'metal');
        } else if (kind < 0.65) {   // vent cowl
          bx(u - 0.4, u + 0.4, H, H + 0.9, v - 0.4, v + 0.4, 'x', { nv: true });
          pr('cyl', u, H + 0.4, v, 0.6, 0.8, 0.6, 'metal'); pr('sph', u, H + 0.85, v, 0.9, 0.5, 0.9, 'metal');
        } else {                    // chimney with pots
          const ch = rr(1.4, 2.2);
          bx(u - 0.4, u + 0.4, H, H + ch, v - 0.4, v + 0.4, brick); bx(u - 0.46, u + 0.46, H + ch, H + ch + 0.08, v - 0.46, v + 0.46, st.trim, { c: false });
          pr('cyl', u - 0.15, H + ch + 0.28, v, 0.24, 0.4, 0.24, 'rust'); pr('cyl', u + 0.17, H + ch + 0.23, v, 0.22, 0.3, 0.22, 'rust');
        }
        if (R() < 0.5) { const au = rr(4, 11), av = rr(7, 9.3); pr('cyl', au, H + 1.4, av, 0.04, 2.8, 0.04, 'metal'); pr('cyl', au, H + 2.4, av, 0.03, 1.2, 0.03, 'metal', { rz: Math.PI / 2 }); pr('cyl', au, H + 2.0, av, 0.03, 0.8, 0.03, 'metal', { rz: Math.PI / 2 }); }
      }
      const rf = {
        id: W.flats.length, b: b.id, f: nF, roof: true, key: `B${b.id}:R`, side, y0: H, dv: BD,
        x0: Math.min(wx(SW + T), wx(BW - T)), x1: Math.max(wx(SW + T), wx(BW - T)), cx: wx((SW + BW) / 2),
        rooms: [{ x0: Math.min(wx(SW + 0.4), wx(BW - 0.4)), x1: Math.max(wx(SW + 0.4), wx(BW - 0.4)),
          z0: Math.min(wz(0.4), wz(BD - 0.4)), z1: Math.max(wz(0.4), wz(BD - 0.4)), front: true, door: null }],
        opens: [{ x: wx(7.5), y: H + 1.6, z: wz(0) }], destroyed: false, g: pg, gs: [pg], brk: [], label: `Block ${b.name} · Terrace`,
      };
      W.flats.push(rf); b.roof = rf;
      for (let k = 0; k < 2; k++) W.spots.roof.push({ x: wx(rr(4, 11)), y: H + 0.7, z: wz(rr(1, 9)) });
    }

    // flats
    for (let f = 0; f < nF; f++) {
      const y0 = f * FH, fid = W.flats.length, hgt = FH - 0.2;
      const theme = pick(THEMES);
      const wall = 'wall' + ((R() * 9) | 0), floorM = theme === 'butcher' ? 'floortile' : pick(['floorwood', 'floorwood', 'floorwood2', 'floortile', 'carpet', 'lino']);
      const cloth = pick(['cloth', 'clothred', 'clothgreen']);
      const keep = [];   // keep-clear rectangles [u0,u1,v0,v1]
      const used = [];
      const flat = {
        id: fid, b: b.id, f, roof: false, key: `B${b.id}:F${f}`, side, y0, theme,
        x0: Math.min(wx(SW + T), wx(BW - T)), x1: Math.max(wx(SW + T), wx(BW - T)), cx: wx((SW + BW) / 2),
        rooms: [], opens: [], destroyed: false, balc: null, gs: [], brk: [],
        label: `Block ${b.name} · ${f === 0 ? 'Ground floor' : 'Floor ' + f}`,
      };
      W.flats.push(flat); b.flats.push(flat);
      const own = (e) => { flat.brk.push(e); return e; };
      const skirt = (u0, u1, v0, v1, g) => bx(u0, u1, y0, y0 + 0.11, v0, v1, 'trimw', { c: false, g, deco: 1 });

      const door = (uh, vh, cu, cv, ou, ov, len, kind) => {
        const d = {
          id: W.doors.length, flat: fid, kind, y: y0, h: 2.1, len,
          hx: wx(uh), hz: wz(vh), cd: [cu * dx, cv * dz], od: [ou * dx, ov * dz], open: false, broken: false,
        };
        d.cx = d.hx + d.cd[0] * len / 2; d.cz = d.hz + d.cd[1] * len / 2;
        d.g = `dr${d.id}`;
        const e = grp(d.g, 'door', fid, { door: d.id });
        const hx = Math.abs(d.cd[0]) > 0.5 ? len / 2 : 0.1, hz = Math.abs(d.cd[1]) > 0.5 ? len / 2 : 0.1;
        grow(e, d.cx - hx, d.cx + hx, y0, y0 + 2.1, d.cz - hz, d.cz + hz);
        W.doors.push(d); return d;
      };

      // floor
      bx(SW, BW - T, f ? y0 - 0.2 : -0.1, f ? y0 - 0.05 : -0.02, T, BD - T, 'ceil');
      bx(SW, BW - T, f ? y0 - 0.05 : -0.02, f ? y0 : 0.02, T, BD - T, floorM);
      // stair partition + entry door
      bx(SW, SW + T, y0, y0 + hgt, T, 0.8, wall); bx(SW, SW + T, y0, y0 + hgt, 1.8, BD - T, wall);
      const entry = door(SW + T / 2, 0.8, 0, 1, 1, 0, 1.0, 'entry');
      bx(SW, SW + T, y0 + 2.1, y0 + hgt, 0.8, 1.8, wall, { g: entry.g });
      bx(SW - 0.03, SW + T + 0.03, y0, y0 + 2.16, 0.74, 0.8, 'trimw', { c: false }); bx(SW - 0.03, SW + T + 0.03, y0, y0 + 2.16, 1.8, 1.86, 'trimw', { c: false }); bx(SW - 0.03, SW + T + 0.03, y0 + 2.1, y0 + 2.18, 0.74, 1.86, 'trimw', { c: false });
      entry.open = R() < 0.25;
      keep.push([SW, SW + 1.5, 0.4, 2.2]);
      skirt(SW + T, SW + T + 0.02, 1.86, BD - T);
      // linings
      bx(BW - T - 0.03, BW - T, y0, y0 + hgt, T, BD - T, wall, { c: false }); skirt(BW - T - 0.05, BW - T - 0.03, T, BD - T);
      bx(SW + T, BW - T, y0, y0 + hgt, BD - T - 0.03, BD - T, wall, { c: false }); skirt(SW + T, BW - T, BD - T - 0.05, BD - T - 0.03);

      // ---- front wall: breakable sections around each opening, plain segments between them
      const ops = [];
      const swap = R() < 0.5, noBalc = f > 0 && R() < 0.22, ww = st.winW;
      const win = (u0) => ({ u0, w: ww, y0: st.sill, y1: st.head });
      const bdoor = (u0) => ({ u0, w: 1.0, y0: 0, y1: 2.1, door: true });
      if (f === 0 || noBalc) ops.push(win(rr(3.9, 5.0)), win(rr(8, 9.6)));
      else if (swap) ops.push(win(rr(3.9, 5.0)), bdoor(rr(8, 10.3)));
      else ops.push(bdoor(rr(3.9, 5.2)), win(rr(7.6, 9.5)));
      for (const o of ops) o.u1 = o.u0 + o.w;
      const secs = ops.map((o) => [Math.max(SW, o.u0 - 0.5), Math.min(BW - T, o.u1 + 0.5)]);
      for (let k = 0; k + 1 < secs.length; k++) if (secs[k][1] > secs[k + 1][0]) secs[k][1] = secs[k + 1][0] = (secs[k][1] + secs[k + 1][0]) / 2;
      const facePiece = (g, u0, u1, ya, yb) => {
        if (u1 - u0 < 0.02 || yb - ya < 0.02) return;
        bx(u0, u1, y0 + ya, y0 + yb, 0, T, brick, { g });
        bx(u0, u1, y0 + ya, y0 + Math.min(yb, hgt), T, T + 0.03, wall, { g, c: false, deco: 1 });
        if (ya === 0) skirt(u0, u1, T + 0.03, T + 0.05, g);
        if (st.plinth && f === 0 && ya < 0.9) bx(u0, u1, y0 + ya, y0 + Math.min(yb, 0.9), -0.07, 0, 'stone', { g, c: false, deco: 1 });
        if (st.bands && yb >= FH) bx(u0, u1, y0 + FH - 0.16, y0 + FH, -0.09, 0, st.trim, { g, c: false, deco: 1 });
      };
      let seg = 0, cur = SW;
      const plain = (u0, u1) => {
        const n = Math.max(1, Math.ceil((u1 - u0) / 2.6));
        for (let k = 0; k < n && u1 - u0 > 0.02; k++) { const g = `fw${fid}_${seg++}`; own(grp(g, 'facade', fid)); flat.gs.push(g); facePiece(g, u0 + (u1 - u0) * k / n, u0 + (u1 - u0) * (k + 1) / n, 0, FH); }
      };
      let fxg = null;
      if (f === 0 && st.shop) {   // shop sign across the ground floor
        fxg = `fx${fid}`; grp(fxg, 'decor', fid); flat.gs.push(fxg);
        const text = pick(SHOPS), neon = R() < 0.55, col = pick(NEON), sw = Math.min(6.5, 1.2 + text.length * 0.55), su = 7.5;
        bx(su - sw / 2 - 0.15, su + sw / 2 + 0.15, 2.5, 3.1, -0.14, 0, neon ? 'black' : 'wooddark', { c: false, g: fxg, deco: 1 });
        sign(su, 2.8, -0.15, sw, 0.5, text, neon ? 'neon' : 'shop', { color: col, g: fxg });
        if (neon) W.lights.push({ x: wx(su), y: 2.8, z: wz(-0.7), kind: 'neon', color: col, flat: -1, g: fxg });
      }
      ops.forEach((o, k) => {
        plain(cur, secs[k][0]);
        const g = `fo${fid}_${k}`, sec = own(grp(g, 'facade', fid, { open: k, sub: [] }));
        flat.gs.push(g);
        if (fxg) sec.sub.push(fxg);
        facePiece(g, secs[k][0], o.u0, 0, FH); facePiece(g, o.u1, secs[k][1], 0, FH); facePiece(g, o.u0, o.u1, 0, o.y0); facePiece(g, o.u0, o.u1, o.y1, FH);
        cur = secs[k][1];
        const cu = (o.u0 + o.u1) / 2;
        flat.opens.push({ x: wx(cu), y: y0 + (o.y0 + o.y1) / 2 + (o.door ? 0.3 : 0), z: wz(T / 2), g, k });
        // frame
        bx(o.u0 - 0.06, o.u0, y0 + o.y0, y0 + o.y1 + 0.06, -0.03, T + 0.05, 'trimw', { g, c: false, deco: 1 }); bx(o.u1, o.u1 + 0.06, y0 + o.y0, y0 + o.y1 + 0.06, -0.03, T + 0.05, 'trimw', { g, c: false, deco: 1 });
        bx(o.u0 - 0.06, o.u1 + 0.06, y0 + o.y1, y0 + o.y1 + 0.06, -0.03, T + 0.05, 'trimw', { g, c: false, deco: 1 });
        if (st.win === 'arch') pr('arch', cu, y0 + o.y1 + 0.06, -0.04, o.w + 0.5, (o.w + 0.5) * 0.7, 0.12, st.trim, { g });
        else if (st.win === 'pediment') { pr('tri', cu, y0 + o.y1 + 0.2, -0.06, o.w + 0.5, 0.42, 0.14, st.trim, { g }); bx(o.u0 - 0.25, o.u1 + 0.25, y0 + o.y1 + 0.1, y0 + o.y1 + 0.2, -0.12, 0, st.trim, { g, c: false, deco: 1 }); }
        if (o.door) {
          const d = door(o.u0, T / 2, 1, 0, 0, 1, 1.0, 'balcony');
          d.open = R() < 0.3; own(G[d.g]); sec.sub.push(d.g);
          keep.push([o.u0 - 0.2, o.u1 + 0.2, 0, 1.4]);
          const bu0 = Math.max(SW + 0.2, o.u0 - 0.9), bu1 = Math.min(BW - 0.2, o.u1 + 0.9);
          bx(bu0, bu1, y0 - 0.2, y0, -BALC, 0, 'concrete'); bx(bu0 - 0.03, bu1 + 0.03, y0 - 0.26, y0 - 0.2, -BALC - 0.03, 0, st.trim, { c: false });
          bx(bu0, bu1, y0, y0 + 0.9, -BALC, -BALC + 0.05, 'rail', { nv: true, g });
          bx(bu0, bu0 + 0.05, y0, y0 + 0.9, -BALC, 0, 'rail', { nv: true, g }); bx(bu1 - 0.05, bu1, y0, y0 + 0.9, -BALC, 0, 'rail', { nv: true, g });
          if (st.balc === 'solid') {
            bx(bu0, bu1, y0, y0 + 0.86, -BALC, -BALC + 0.1, brick, { c: false, g, deco: 1 }); bx(bu0, bu0 + 0.1, y0, y0 + 0.86, -BALC, 0, brick, { c: false, g, deco: 1 }); bx(bu1 - 0.1, bu1, y0, y0 + 0.86, -BALC, 0, brick, { c: false, g, deco: 1 });
            bx(bu0 - 0.03, bu1 + 0.03, y0 + 0.86, y0 + 0.93, -BALC - 0.03, -BALC + 0.13, st.trim, { c: false, g, deco: 1 });
          } else {
            for (let q = bu0 + 0.03; q < bu1; q += 0.2) pr('cyl', q, y0 + 0.45, -BALC + 0.03, 0.035, 0.9, 0.035, 'rail', { g });
            for (let q = -BALC + 0.2; q < 0; q += 0.2) { pr('cyl', bu0 + 0.03, y0 + 0.45, q, 0.035, 0.9, 0.035, 'rail', { g }); pr('cyl', bu1 - 0.03, y0 + 0.45, q, 0.035, 0.9, 0.035, 'rail', { g }); }
            pr('cyl', (bu0 + bu1) / 2, y0 + 0.92, -BALC + 0.03, 0.07, bu1 - bu0 + 0.06, 0.07, 'metal', { rz: Math.PI / 2, g });
            pr('cyl', bu0 + 0.03, y0 + 0.92, -BALC / 2, 0.07, BALC, 0.07, 'metal', { rx: Math.PI / 2, g }); pr('cyl', bu1 - 0.03, y0 + 0.92, -BALC / 2, 0.07, BALC, 0.07, 'metal', { rx: Math.PI / 2, g });
          }
          pr('cone', bu0 + 0.3, y0 - 0.45, -0.3, 0.4, 0.5, 0.6, 'concrete', { rx: Math.PI }); pr('cone', bu1 - 0.3, y0 - 0.45, -0.3, 0.4, 0.5, 0.6, 'concrete', { rx: Math.PI });
          const bk = R();
          if (bk < 0.3) { pr('cyl', bu0 + 0.35, y0 + 0.17, -BALC + 0.35, 0.34, 0.34, 0.34, 'rust', { g }); pr('sph', bu0 + 0.35, y0 + 0.5, -BALC + 0.35, 0.5, 0.5, 0.5, 'bark', { g }); }
          else if (bk < 0.55) { pr('cyl', (bu0 + bu1) / 2, y0 + 1.9, -BALC + 0.2, 0.015, bu1 - bu0, 0.015, 'black', { rz: Math.PI / 2, g }); for (let q = bu0 + 0.3; q < bu1 - 0.4; q += rr(0.45, 0.8)) bx(q, q + rr(0.25, 0.45), y0 + 1.9 - rr(0.5, 0.9), y0 + 1.9, -BALC + 0.19, -BALC + 0.21, pick(['mattress', 'cloth', 'clothred', 'white']), { c: false, g, deco: 1 }); }
          flat.balc = { x0: Math.min(wx(bu0), wx(bu1)), x1: Math.max(wx(bu0), wx(bu1)) };
          W.spots.balcony.push({ x: wx((bu0 + bu1) / 2), y: y0 + 0.7, z: wz(-BALC / 2), flat: fid });
        } else {
          // pane + glazing bars break on their own when a hand comes through
          const gl = `gl${fid}_${k}`; own(grp(gl, 'glass', fid)); sec.sub.push(gl);
          bx(o.u0, o.u1, y0 + o.y0, y0 + o.y1, 0.09, 0.11, 'glass', { g: gl, c: false });
          bx(cu - 0.03, cu + 0.03, y0 + o.y0, y0 + o.y1, 0.07, 0.13, 'trimw', { g: gl, c: false, deco: 1 });
          bx(o.u0, o.u1, y0 + (o.y0 + o.y1) / 2 - 0.03, y0 + (o.y0 + o.y1) / 2 + 0.03, 0.07, 0.13, 'trimw', { g: gl, c: false, deco: 1 });
          bx(o.u0 - 0.12, o.u1 + 0.12, y0 + o.y0 - 0.07, y0 + o.y0, -0.14, T + 0.08, st.trim, { g, c: false, deco: 1 });     // sill
          if (st.win === 'shutter') { bx(o.u0 - 0.5, o.u0 - 0.06, y0 + o.y0, y0 + o.y1, -0.06, -0.02, st.shut, { g, c: false, deco: 1 }); bx(o.u1 + 0.06, o.u1 + 0.5, y0 + o.y0, y0 + o.y1, -0.06, -0.02, st.shut, { g, c: false, deco: 1 }); }
          for (let q = o.u0 + 0.25; q < o.u1 - 0.2; q += 0.13) pr('cyl', q, y0 + 0.42, T + 0.14, 0.1, 0.6, 0.1, 'white', { g });   // radiator
          pr('cyl', cu, y0 + 0.74, T + 0.14, 0.05, o.w - 0.4, 0.05, 'white', { rz: Math.PI / 2, g });
          if (R() < 0.6) {
            const cm = pick(['clothred', 'cloth', 'clothgreen', 'mattress']);
            bx(o.u0 - 0.15, o.u0 + 0.3, y0 + 0.5, y0 + 2.4, T + 0.05, T + 0.13, cm, { g, c: false, deco: 1 }); bx(o.u1 - 0.3, o.u1 + 0.15, y0 + 0.5, y0 + 2.4, T + 0.05, T + 0.13, cm, { g, c: false, deco: 1 });
            pr('cyl', cu, y0 + 2.42, T + 0.09, 0.04, o.w + 0.5, 0.04, 'metal', { rz: Math.PI / 2, g });
          }
          const ex = R();
          if (ex < 0.25) {   // boarded-up
            bx(o.u0 - 0.1, o.u1 + 0.1, y0 + 1.2, y0 + 1.36, T, T + 0.04, 'wood', { g, c: false, deco: 1 });
            bx(o.u0 - 0.1, o.u1 + 0.1, y0 + 1.75, y0 + 1.9, T, T + 0.04, 'wood', { g, c: false, deco: 1 });
          } else if (ex < 0.4 && f > 0) {   // air conditioner hanging under the sill
            bx(cu - 0.4, cu + 0.4, y0 + o.y0 - 0.6, y0 + o.y0 - 0.1, -0.5, 0, 'fridge', { g, c: false, deco: 1 }); pr('cyl', cu, y0 + o.y0 - 0.35, -0.51, 0.4, 0.03, 0.4, 'black', { rx: Math.PI / 2, g });
          } else if (ex < 0.55) {            // window box of dead plants
            bx(o.u0, o.u1, y0 + o.y0 - 0.02, y0 + o.y0 + 0.16, -0.36, -0.12, 'wooddark', { g, c: false, deco: 1 });
            for (let q = o.u0 + 0.2; q < o.u1; q += 0.35) pr('sph', q, y0 + o.y0 + 0.24, -0.24, 0.3, 0.3, 0.26, 'bark', { g });
          } else if (ex < 0.7 && f === 0 && st.shop) pr('wedge', cu, y0 + o.y1 + 0.35, -0.5, o.w + 0.5, 0.6, 1.0, pick(['clothred', 'clothgreen', 'cloth']), { ry: dz < 0 ? 0 : Math.PI, g });
        }
      });
      plain(cur, BW - T);

      // ---- interior walls: each ~2 m run is its own breakable piece, with skirting on both faces
      let wn = 0;
      const wallRun = (u0, u1, v0, v1) => {
        const alongU = u1 - u0 > v1 - v0, len = alongU ? u1 - u0 : v1 - v0, n = Math.max(1, Math.ceil(len / 2.2)), out = [];
        for (let k = 0; k < n; k++) {
          const a0 = k / n, a1 = (k + 1) / n, g = `iw${fid}_${wn++}`;
          own(grp(g, 'wall', fid));
          const s = alongU ? [u0 + (u1 - u0) * a0, u0 + (u1 - u0) * a1, v0, v1] : [u0, u1, v0 + (v1 - v0) * a0, v0 + (v1 - v0) * a1];
          bx(s[0], s[1], y0, y0 + hgt, s[2], s[3], wall, { g });
          if (alongU) { skirt(s[0], s[1], s[2] - 0.02, s[2], g); skirt(s[0], s[1], s[3], s[3] + 0.02, g); } else { skirt(s[0] - 0.02, s[0], s[2], s[3], g); skirt(s[1], s[1] + 0.02, s[2], s[3], g); }
          out.push({ a0: alongU ? s[0] : s[2], a1: alongU ? s[1] : s[3], g });
        }
        return out;
      };
      const dv = rr(3.9, 6.5);
      flat.dv = dv;
      // one, two or three back rooms
      const sr = R(), splits = sr < 0.3 ? [] : sr < 0.8 ? [rr(6.2, 8.8)] : [rr(5.7, 6.3), rr(8.7, 9.3)];
      const edges = [SW + T, ...splits, BW - T];
      const frontRole = { home: pick(['living', 'kitchen', 'living']), hoard: 'hoard', nursery: 'living', ritual: 'ritual', butcher: 'butcher', empty: 'empty', workshop: 'workshop', study: 'study' }[theme];
      const backRole = (narrow) => ({
        home: narrow ? pick(['bath', 'store', 'bath']) : pick(['bedroom', 'bedroom', 'kids', 'store', 'kitchen']), hoard: 'hoard',
        nursery: narrow ? 'bath' : pick(['nursery', 'kids', 'nursery']), ritual: pick(['empty', 'store']), butcher: narrow ? 'bath' : pick(['store', 'store', 'bedroom']),
        empty: 'empty', workshop: narrow ? 'store' : pick(['store', 'bedroom']), study: narrow ? 'bath' : 'bedroom',
      }[theme]);
      const front = { u0: SW + T, u1: BW - T, v0: T, v1: dv, front: true, door: null, role: frontRole };
      const rooms = [front], divSegs = [];
      cur = SW + T;
      for (let k = 0; k + 1 < edges.length; k++) {
        const u0 = edges[k] + (k ? T : 0), u1 = edges[k + 1];
        const du = rr(u0 + 0.35, Math.max(u0 + 0.36, u1 - 1.35));
        divSegs.push(...wallRun(cur, du, dv, dv + T));
        const d = door(du, dv + T / 2, 1, 0, 0, 1, 0.95, 'room');
        own(G[d.g]);
        bx(du, du + 0.95, y0 + 2.1, y0 + hgt, dv, dv + T, wall, { g: d.g });
        for (const q of [du - 0.06, du + 0.95]) bx(q, q + 0.06, y0, y0 + 2.16, dv - 0.03, dv + T + 0.03, 'trimw', { c: false, g: d.g, deco: 1 });
        bx(du - 0.06, du + 1.01, y0 + 2.1, y0 + 2.18, dv - 0.03, dv + T + 0.03, 'trimw', { c: false, g: d.g, deco: 1 });
        cur = du + 0.95;
        d.open = R() < 0.35;
        keep.push([du - 0.25, du + 1.2, dv - 1.1, dv + 1.4]);
        rooms.push({ u0, u1, v0: dv + T, v1: BD - T, front: false, door: d.id, du, role: backRole(u1 - u0 < 3.3) });
        if (k + 2 < edges.length) wallRun(edges[k + 1], edges[k + 1] + T, dv + T, BD - T);
      }
      divSegs.push(...wallRun(cur, BW - T, dv, dv + T));
      const segAt = (u) => (divSegs.find((s) => u >= s.a0 && u <= s.a1) || {}).g;
      // optional partial wall splitting the front room (open archway next to the divider)
      if (R() < 0.35 && dv > 4.6) {
        const uf = rr(6.4, 8.4);
        if (!ops.some((o) => uf > o.u0 - 0.6 && uf < o.u1 + 0.6)) {
          wallRun(uf, uf + T, T + 0.03, dv - 1.7);
          keep.push([uf - 0.2, uf + T + 0.2, T, dv]);
        }
      }
      if (theme !== 'home' || R() < 0.3) for (let k = 0; k < 2; k++) bx(SW + T, BW - T, y0 + hgt - 0.16, y0 + hgt, 1.2 + k * (dv - 2), 1.36 + k * (dv - 2), 'wooddark', { c: false });   // ceiling beams

      // ---- furniture
      const hit = (r, list, m) => list.some((q) => r[0] < q[1] + m && r[1] > q[0] - m && r[2] < q[3] + m && r[3] > q[2] - m);
      const tops = [];
      // find a free spot against one of the room's walls; returns the (a,b)->(u,v) mapping
      const place = (room, w, d, tall, clear, lowOnly) => {
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
          // nothing tall in front of a window; nothing at all hung on the breakable front wall
          if (ws === 0 && room.front && (tall || lowOnly) && (lowOnly || ops.some((o) => rect[0] < o.u1 && rect[1] > o.u0))) continue;
          if (hit(rect, keep, 0) || hit(rect, used, 0.12)) continue;
          used.push(rect);
          map.alongU = alongU;
          return map;
        }
        return null;
      };
      const span2 = (map, q) => { const a = map(q[0], q[2]), c = map(q[1], q[3]); return [Math.min(a[0], c[0]), Math.max(a[0], c[0]), Math.min(a[1], c[1]), Math.max(a[1], c[1])]; };
      for (const room of rooms) {
        // a closet you can open, search and hide in
        if (theme !== 'empty' && R() < (room.front ? 0.4 : 0.85)) {
          const w = 1.5, d = 0.9, map = place(room, w, d, true, 0.8);
          if (map) {
            const cid = W.closets.length, g = `cl${cid}`;
            own(grp(g, 'closet', fid, { closet: cid }));
            for (const q of [[0, w, 0, 0.05, 0, 2.1], [0, 0.05, 0, d, 0, 2.1], [w - 0.05, w, 0, d, 0, 2.1], [0, w, 0, d, 2.04, 2.1]]) {
              const r = span2(map, q); bx(r[0], r[1], y0 + q[4], y0 + q[5], r[2], r[3], 'wooddark', { fu: 1, g });
            }
            { const r = span2(map, [0.05, w - 0.05, 0.05, d, 0, 0.03]); bx(r[0], r[1], y0 + 0.001, y0 + 0.03, r[2], r[3], 'wood', { c: false, g, deco: 1 }); }
            { const r = span2(map, [-0.03, w + 0.03, 0, d + 0.03, 2.1, 2.16]); bx(r[0], r[1], y0 + 2.1, y0 + 2.16, r[2], r[3], 'wooddark', { c: false, g, deco: 1 }); }
            const rail = map(w / 2, 0.4);
            pr('cyl', rail[0], y0 + 1.82, rail[1], 0.04, w - 0.1, 0.04, 'metal', map.alongU ? { rz: Math.PI / 2, g } : { rx: Math.PI / 2, g });
            for (const a of [0.15, 0.35, 1.2]) { const r = span2(map, [a, a + 0.08, 0.15, 0.65, 0, 0]); bx(r[0], r[1], y0 + 0.75, y0 + 1.78, r[2], r[3], pick(['cloth', 'clothred', 'clothgreen', 'mattress']), { c: false, g, deco: 1 }); }
            const i0 = map(0.05, 0.05), i1 = map(w - 0.05, d), h0 = map(0, d), h1 = map(w, d), ce = map(w / 2, d / 2), fr = map(w / 2, d + 1);
            const c = {
              id: cid, flat: fid, y: y0, w, g,
              x0: Math.min(wx(i0[0]), wx(i1[0])), x1: Math.max(wx(i0[0]), wx(i1[0])), z0: Math.min(wz(i0[1]), wz(i1[1])), z1: Math.max(wz(i0[1]), wz(i1[1])),
              cx: wx(ce[0]), cz: wz(ce[1]), h0: [wx(h0[0]), wz(h0[1])], h1: [wx(h1[0]), wz(h1[1])], open: false, broken: false,
            };
            c.f = [wx(fr[0]) - wx(ce[0]) > 0.3 ? 1 : wx(fr[0]) - wx(ce[0]) < -0.3 ? -1 : 0, wz(fr[1]) - wz(ce[1]) > 0.3 ? 1 : wz(fr[1]) - wz(ce[1]) < -0.3 ? -1 : 0];
            W.closets.push(c);
            W.spots.closet.push({ x: c.cx, y: y0 + 0.75, z: c.cz, closet: cid });
          }
        }
        const list = ROLES[room.role].slice();
        const count = room.role === 'empty' ? ((R() * 3) | 0) : room.role === 'hoard' ? 6 + ((R() * 4) | 0) : 3 + ((R() * 4) | 0);
        for (let n = 0, placed = 0; n < list.length && placed < count; n++) {
          const it = CAT[list[n]], depth = it.d, map = place(room, it.w, depth, it.h > 0.9, 0, it.nocol);
          if (!map) continue;
          const g = `fu${nf++}`, e = own(grp(g, 'furn', fid));
          for (const q of it.parts(cloth)) { const r = span2(map, q); bx(r[0], r[1], y0 + q[4], y0 + q[5], r[2], r[3], q[6], { c: false, g }); }
          for (const q of it.pp || []) { const c = map(q[1], q[2]); const o = { g }; if (q[8] === 'b') o[map.alongU ? 'rx' : 'rz'] = Math.PI / 2; else if (q[8] === 'a') o[map.alongU ? 'rz' : 'rx'] = Math.PI / 2; pr(q[0], c[0], y0 + q[3], c[1], q[4], q[5], q[6], q[7], o); }
          const rect = span2(map, [0, it.w, 0, depth]);
          if (!it.nocol) bx(rect[0], rect[1], y0, y0 + it.h, rect[2], rect[3], 'x', { nv: true, fu: 1, g });
          if (it.mq) {
            const cu = (rect[0] + rect[1]) / 2, cv = (rect[2] + rect[3]) / 2, tu = (room.u0 + room.u1) / 2, tv = (room.v0 + room.v1) / 2;
            W.mannequins.push({ x: wx(cu), y: y0, z: wz(cv), ry: Math.atan2(-(wx(tu) - wx(cu)), -(wz(tv) - wz(cv))), g, flat: fid });
          }
          if (it.top) { const tp = map(it.w / 2, it.tb || it.d / 2); tops.push({ u: tp[0], v: tp[1], y: y0 + it.top, g }); }
          e.name = list[n];
          placed++;
        }
        // rug (some round)
        if (R() < 0.55 && room.role !== 'empty' && room.role !== 'bath') {
          const cu = (room.u0 + room.u1) / 2, cv = (room.v0 + room.v1) / 2, rm = pick(['clothred', 'cloth', 'clothgreen']);
          if (R() < 0.5) pr('cyl', cu, y0 + 0.012, cv, 2.0, 0.02, 2.0, rm);
          else { bx(cu - 1.1, cu + 1.1, y0 + 0.001, y0 + 0.02, cv - 0.75, cv + 0.75, rm, { c: false }); bx(cu - 1.0, cu + 1.0, y0 + 0.002, y0 + 0.022, cv - 0.65, cv + 0.65, 'mattress', { c: false }); }
        }
        // stains and worse on the floor
        if (R() < (theme === 'butcher' || theme === 'ritual' ? 0.9 : 0.3)) W.decals.push({ x: wx(rr(room.u0 + 0.8, room.u1 - 0.8)), y: y0 + 0.024, z: wz(rr(room.v0 + 0.8, room.v1 - 0.8)), floor: 1, kind: theme === 'butcher' || theme === 'ritual' || R() < 0.4 ? 'blood' : 'stain', size: rr(0.9, 2.2), rot: rr(0, 6) });
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

      // ---- lights, clutter and what was left on the walls
      const candle = (u, y, v, g) => {
        const ch = rr(0.1, 0.24);
        pr('cyl', u, y + ch / 2, v, 0.06, ch, 0.06, 'wax', { g }); pr('cyl', u, y + 0.008, v, 0.16, 0.016, 0.16, 'metal', { g });
        W.lights.push({ x: wx(u), y: y + ch + 0.06, z: wz(v), kind: 'candle', flat: fid, g });
      };
      const sigil = () => {
        let u = rr(4, 10.8);
        if (rooms.some((r) => !r.front && u > r.du - 0.8 && u < r.du + 1.75)) u = rooms[1].du > 7 ? 4.2 : 10.6;
        const g = segAt(u);
        W.decals.push({ x: wx(u), y: y0 + 1.7, z: wz(dv - 0.012), nz: -dz, flat: fid, kind: 'sigil', g });
        W.lights.push({ x: wx(u), y: y0 + 1.7, z: wz(dv - 0.5), kind: 'sigil', flat: fid, g });
      };
      const chandelier = () => {
        const lu = rr(5, 10), lv = dv * 0.5, ly = y0 + 2.35;
        W.lights.push({ x: wx(lu), y: ly - 0.1, z: wz(lv), kind: 'lamp', flat: fid });
        pr('cyl', lu, y0 + 2.75, lv, 0.03, 0.5, 0.03, 'black'); pr('tor', lu, ly + 0.12, lv, 0.7, 0.7, 0.7, 'black'); pr('sph', lu, ly + 0.2, lv, 0.14, 0.14, 0.14, 'black');
        for (let k = 0; k < 3; k++) { const a = k * 2.094 + 0.4; pr('cone', lu + Math.cos(a) * 0.35, ly, lv + Math.sin(a) * 0.35, 0.3, 0.2, 0.3, 'black'); pr('cyl', lu + Math.cos(a) * 0.18, ly + 0.1, lv + Math.sin(a) * 0.18, 0.02, 0.36, 0.02, 'black', { rz: Math.PI / 2, ry: -a }); }
      };
      const lr = R();
      if (theme === 'ritual') {
        const cu = 7.5, cv = Math.min(dv - 1.4, Math.max(1.6, dv / 2));
        for (let k = 0; k < 7; k++) { const a = k / 7 * Math.PI * 2; candle(cu + Math.cos(a) * 1.15, y0, cv + Math.sin(a) * 1.15); }
        W.decals.push({ x: wx(cu), y: y0 + 0.026, z: wz(cv), floor: 1, kind: 'sigil', size: 2.1, rot: 0 });
        sigil();
      } else if (theme === 'butcher') {
        chandelier();
        for (let k = 0; k < 4; k++) {   // things hanging from hooks
          const u = rr(4.2, 11), v = rr(1.2, dv - 0.8), len = rr(0.6, 1.1), g = `fu${nf++}`;
          if (hit([u - 0.3, u + 0.3, v - 0.3, v + 0.3], keep, 0)) continue;
          const e = own(grp(g, 'furn', fid)); grow(e, Math.min(wx(u - 0.2), wx(u + 0.2)), Math.max(wx(u - 0.2), wx(u + 0.2)), y0 + 1.3, y0 + hgt, Math.min(wz(v - 0.2), wz(v + 0.2)), Math.max(wz(v - 0.2), wz(v + 0.2)));
          pr('cyl', u, y0 + hgt - len / 2, v, 0.02, len, 0.02, 'metal', { g }); pr('sph', u, y0 + hgt - len - 0.4, v, 0.34, 0.9, 0.3, 'meat', { g }); pr('cone', u, y0 + hgt - len - 0.95, v, 0.2, 0.36, 0.18, 'meat', { rx: Math.PI, g });
        }
      } else if (lr < 0.45 && tops.length) {
        const n = 1 + ((R() * 3) | 0);
        for (let k = 0; k < n && tops.length; k++) { const t = tops.splice((R() * tops.length) | 0, 1)[0]; candle(t.u + rr(-0.12, 0.12), t.y, t.v + rr(-0.1, 0.1), t.g); }
      } else if (lr < 0.6) sigil();
      else if (lr < 0.8 && theme !== 'empty') chandelier();
      for (const t of tops) {
        if (R() < 0.45) continue;
        const k = R(), u = t.u + rr(-0.1, 0.1), v = t.v + rr(-0.08, 0.08), g = t.g;
        if (k < 0.35) { pr('cyl', u, t.y + 0.12, v, 0.07, 0.24, 0.07, 'glass', { g }); pr('cone', u, t.y + 0.3, v, 0.07, 0.14, 0.07, 'glass', { g }); }
        else if (k < 0.6) pr('sph', u, t.y + 0.11, v, 0.22, 0.22, 0.22, pick(['white', 'clothred', 'glass']), { g });
        else if (k < 0.8) pr('cyl', u, t.y + 0.05, v, 0.2, 0.1, 0.2, 'metal', { g });
        else { bx(u - 0.12, u + 0.12, t.y, t.y + 0.05, v - 0.09, v + 0.09, 'clothred', { c: false, g, deco: 1 }); bx(u - 0.1, u + 0.14, t.y + 0.05, t.y + 0.09, v - 0.08, v + 0.08, 'paper', { c: false, g, deco: 1 }); }
      }
      if (R() < (theme === 'empty' || theme === 'ritual' ? 0.8 : 0.22)) {
        const u = rr(4.4, 10.4), g = segAt(u);
        if (!rooms.some((r) => !r.front && u > r.du - 1.1 && u < r.du + 2.0)) sign(u, y0 + rr(1.3, 1.9), dv - 0.012, rr(1.5, 2.3), 0.6, pick(SCRAWLS), 'blood', { g, flat: fid });
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
