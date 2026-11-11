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
    boxes: [], doors: [], flats: [], buildings: [], lamps: [], lights: [], decals: [],
    spots: { street: [], balcony: [], roof: [], flat: [] },
    spawns: [],
  };
  const push = (b) => W.boxes.push(b);
  const raw = (x0, x1, y0, y1, z0, z1, m, o = {}) => push({
    x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: (z0 + z1) / 2,
    sx: Math.abs(x1 - x0), sy: y1 - y0, sz: Math.abs(z1 - z0), m, c: o.c !== false, g: o.g, nv: o.nv,
  });

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
    raw(x - 0.08, x + 0.08, 0, 5.2, s * 5.5 - 0.08, s * 5.5 + 0.08, 'metal');
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
    for (const wx of [-1.4, 1.4]) for (const wz of [-0.8, 0.8])
      raw(x + wx - 0.33, x + wx + 0.33, 0, 0.66, z + wz - 0.12, z + wz + 0.12, 'black', { c: false });
  }
  // dumpsters / crates on the pavements
  for (let x = 6; x < L; x += rr(9, 20)) {
    const s = R() < 0.5 ? 1 : -1, z = s * rr(5.6, 6.0);
    if (R() < 0.5) raw(x - 0.9, x + 0.9, 0.12, 1.3, z - 0.5, z + 0.5, 'rust');
    else raw(x - 0.4, x + 0.4, 0.12, 0.92, z - 0.4, z + 0.4, 'wood');
  }
  for (let i = 0; i < 40; i++) W.spots.street.push({ x: rr(4, L - 4), y: 0.7, z: rr(-4.6, 4.6) });

  // ---------------------------------------------------------------- furniture catalogue
  // each piece is described in a wall-relative frame: a = along the wall, b = away from it
  const CAT = {
    bed: { w: 1.6, d: 2.1, h: 0.55, top: 0.6, parts: (c) => [
      [0, 1.6, 0, 2.1, 0.12, 0.35, 'wooddark'], [0.05, 1.55, 0.08, 2.05, 0.35, 0.55, 'mattress'],
      [0.2, 1.4, 0.12, 0.5, 0.55, 0.66, 'white'], [0, 1.6, 0, 0.08, 0, 1.05, 'wooddark'],
      [0.04, 1.56, 0.85, 2.06, 0.55, 0.585, c]] },
    wardrobe: { w: 1.4, d: 0.6, h: 2.1, parts: () => [
      [0, 1.4, 0, 0.58, 0, 2.1, 'wooddark'], [0.69, 0.71, 0.58, 0.6, 0.1, 2.0, 'black'],
      [0.6, 0.63, 0.58, 0.62, 0.95, 1.15, 'metal'], [0.77, 0.8, 0.58, 0.62, 0.95, 1.15, 'metal']] },
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
      [1.98, 2.03, 0.3, 0.72, 0, 0.42, 'wooddark']] },
    counter: { w: 2.6, d: 0.62, h: 0.9, top: 0.9, parts: () => [
      [0, 2.6, 0, 0.6, 0.05, 0.86, 'wooddark'], [0, 2.6, 0, 0.62, 0.86, 0.9, 'concrete'],
      [0.9, 1.6, 0, 0.63, 0.1, 0.87, 'metal'], [0.95, 1.55, 0.05, 0.58, 0.9, 0.92, 'black'],
      [0, 2.6, 0, 0.35, 1.5, 2.25, 'wooddark'], [0.86, 0.88, 0.35, 0.36, 1.55, 2.2, 'black'],
      [1.72, 1.74, 0.35, 0.36, 1.55, 2.2, 'black']] },
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
    crate: { w: 0.8, d: 0.8, h: 0.8, top: 0.8, parts: () => [[0, 0.8, 0, 0.8, 0, 0.8, 'wood']] },
    crates: { w: 1.5, d: 0.8, h: 1.4, parts: () => [
      [0, 0.8, 0, 0.8, 0, 0.8, 'wood'], [0.85, 1.5, 0.05, 0.7, 0, 0.65, 'wood'], [0.1, 0.7, 0.1, 0.7, 0.8, 1.4, 'wood']] },
    tub: { w: 1.7, d: 0.75, h: 0.58, parts: () => [
      [0, 1.7, 0, 0.75, 0, 0.5, 'white'], [0, 1.7, 0, 0.08, 0.5, 0.58, 'white'], [0, 1.7, 0.67, 0.75, 0.5, 0.58, 'white'],
      [0, 0.08, 0, 0.75, 0.5, 0.58, 'white'], [1.62, 1.7, 0, 0.75, 0.5, 0.58, 'white'], [0.08, 1.62, 0.08, 0.67, 0.5, 0.51, 'black']] },
    toilet: { w: 0.45, d: 0.68, h: 0.45, parts: () => [
      [0.02, 0.43, 0.22, 0.68, 0, 0.42, 'white'], [0, 0.45, 0, 0.22, 0, 0.85, 'white'], [0.02, 0.43, 0.22, 0.68, 0.42, 0.45, 'white']] },
    sink: { w: 0.6, d: 0.45, h: 0.85, parts: () => [
      [0.2, 0.4, 0.05, 0.3, 0, 0.7, 'white'], [0, 0.6, 0, 0.45, 0.7, 0.85, 'white'],
      [0.05, 0.55, 0, 0.03, 1.1, 1.75, 'mirror']] },
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
    living: ['sofa', 'tv', 'shelf', 'table', 'piano', 'crate', 'shelf', 'desk'],
    kitchen: ['counter', 'fridge', 'table', 'shelf', 'crate', 'sofa'],
    bedroom: ['bed', 'wardrobe', 'nightstand', 'shelf', 'desk', 'crate'],
    bath: ['tub', 'toilet', 'sink', 'crate'],
    store: ['crates', 'shelf', 'crate', 'crates', 'wardrobe', 'shelf'],
    kids: ['bed', 'bed', 'shelf', 'desk', 'crate'],
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
    const H = nF * FH, top = H + 0.9;

    // shell
    bx(0, T, 0, top, 0, BD, brick); bx(BW - T, BW, 0, top, 0, BD, brick); bx(T, BW - T, 0, top, BD - T, BD, brick);
    bx(T, BW - T, H, top, 0, T, brick);
    bx(T, 0.9, 0, FH, 0, T, brick); bx(2.1, SW, 0, FH, 0, T, brick); bx(0.9, 2.1, 2.3, FH, 0, T, brick);
    bx(0.8, 2.2, 2.3, 2.42, -0.5, 0, 'concrete', { c: false });           // entrance canopy
    bx(T, SW, FH, H, 0, T, brick);
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
      if (f === nF) break;
      bx(T, SW, y0 + 1.4, y0 + 1.6, 7.5, BD - T, 'concrete');
      for (let j = 0; j < 8; j++) {
        const t1 = y0 + (j + 1) * 0.2, t2 = y0 + 1.6 + (j + 1) * 0.2;
        bx(T, 1.6, t1 - 0.4, t1, 2.5 + j * 0.625, 2.5 + (j + 1) * 0.625, 'concrete');
        bx(1.6, SW, t2 - 0.4, t2, 7.5 - (j + 1) * 0.625, 7.5 - j * 0.625, 'concrete');
      }
      if (R() < 0.4) W.lights.push({ x: wx(1.5), y: y0 + 2.75, z: wz(1.3), kind: 'lamp', flat: -1 });
    }

    // roof
    bx(SW, BW - T, H - 0.2, H - 0.05, T, BD - T, 'ceil'); bx(SW, BW - T, H - 0.05, H, T, BD - T, 'roof');
    {
      const n = 1 + ((R() * 3) | 0);
      for (let k = 0; k < n; k++) {
        const u = rr(4.5, 10.5), v = rr(3, 8.5);
        if (R() < 0.5) bx(u - 0.5, u + 0.5, H, H + rr(0.6, 1.1), v - 0.5, v + 0.5, 'metal');
        else bx(u - 0.4, u + 0.4, H, H + rr(1.4, 2.2), v - 0.4, v + 0.4, brick);
      }
      const rf = {
        id: W.flats.length, b: b.id, f: nF, roof: true, key: `B${b.id}:R`, side, y0: H, dv: BD,
        x0: Math.min(wx(SW + T), wx(BW - T)), x1: Math.max(wx(SW + T), wx(BW - T)), cx: wx((SW + BW) / 2),
        rooms: [{ x0: Math.min(wx(SW + 0.4), wx(BW - 0.4)), x1: Math.max(wx(SW + 0.4), wx(BW - 0.4)),
          z0: Math.min(wz(0.4), wz(BD - 0.4)), z1: Math.max(wz(0.4), wz(BD - 0.4)), front: true, door: null }],
        opens: [{ x: wx(7.5), y: H + 1.6, z: wz(0) }], destroyed: false, label: `Block ${b.name} · Terrace`,
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
          bx(bu0, bu1, y0, y0 + 0.9, -BALC, -BALC + 0.05, 'rail');
          bx(bu0, bu0 + 0.05, y0, y0 + 0.9, -BALC, 0, 'rail'); bx(bu1 - 0.05, bu1, y0, y0 + 0.9, -BALC, 0, 'rail');
          bx(bu0 - 0.02, bu1 + 0.02, y0 + 0.9, y0 + 0.95, -BALC - 0.02, -BALC + 0.07, 'metal', { c: false });
          flat.balc = { x0: Math.min(wx(bu0), wx(bu1)), x1: Math.max(wx(bu0), wx(bu1)) };
          W.spots.balcony.push({ x: wx((bu0 + bu1) / 2), y: y0 + 0.7, z: wz(-BALC / 2), flat: fid });
        } else {
          bx(o.u0 - 0.08, o.u1 + 0.08, y0 + o.y0 - 0.06, y0 + o.y0, -0.12, T + 0.06, 'concrete', { g, c: false });
          bx((o.u0 + o.u1) / 2 - 0.03, (o.u0 + o.u1) / 2 + 0.03, y0 + o.y0, y0 + o.y1, 0.07, 0.13, 'wooddark', { g, c: false });
          bx(o.u0, o.u1, y0 + 1.55, y0 + 1.61, 0.07, 0.13, 'wooddark', { g, c: false });
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
        rooms.push({ u0, u1, v0: dv + T, v1: BD - T, front: false, door: d.id,
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
      for (const room of rooms) {
        const list = ROLES[room.role].slice();
        const count = 2 + ((R() * 4) | 0);
        for (let n = 0, placed = 0; n < list.length && placed < count; n++) {
          const it = CAT[list[n]];
          for (let tries = 0; tries < 7; tries++) {
            const ws = (R() * 4) | 0;   // which wall of the room
            const alongU = ws < 2;
            const span = alongU ? room.u1 - room.u0 : room.v1 - room.v0;
            if (span < it.w + 0.2) continue;
            const p = (alongU ? room.u0 : room.v0) + 0.05 + R() * (span - it.w - 0.1);
            const far = alongU ? room.v1 - room.v0 : room.u1 - room.u0;
            if (far < it.d + 0.9) continue;
            // (a,b) -> (u,v)
            const map = (a, bb) => ws === 0 ? [p + a, room.v0 + bb] : ws === 1 ? [p + a, room.v1 - bb]
              : ws === 2 ? [room.u0 + bb, p + a] : [room.u1 - bb, p + a];
            const c0 = map(0, 0), c1 = map(it.w, it.d);
            const rect = [Math.min(c0[0], c1[0]), Math.max(c0[0], c1[0]), Math.min(c0[1], c1[1]), Math.max(c0[1], c1[1])];
            // never block windows on the front wall with tall furniture
            if (ws === 0 && room.front && it.h > 0.9 && ops.some((o) => rect[0] < o.u1 && rect[1] > o.u0)) continue;
            if (hit(rect, keep, 0) || hit(rect, used, 0.12)) continue;
            used.push(rect);
            for (const q of it.parts(cloth)) {
              const a = map(q[0], q[2]), c = map(q[1], q[3]);
              bx(Math.min(a[0], c[0]), Math.max(a[0], c[0]), y0 + q[4], y0 + q[5], Math.min(a[1], c[1]), Math.max(a[1], c[1]), q[6], { c: false });
            }
            bx(rect[0], rect[1], y0, y0 + it.h, rect[2], rect[3], 'x', { nv: true });
            if (it.top) tops.push({ u: (rect[0] + rect[1]) / 2, v: (rect[2] + rect[3]) / 2, y: y0 + it.top });
            placed++;
            break;
          }
        }
        // rug
        if (R() < 0.5) {
          const cu = (room.u0 + room.u1) / 2, cv = (room.v0 + room.v1) / 2;
          bx(cu - 1.1, cu + 1.1, y0 + 0.001, y0 + 0.02, cv - 0.75, cv + 0.75, pick(['clothred', 'cloth', 'clothgreen']), { c: false });
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

      // lights
      const lr = R();
      if (lr < 0.5 && tops.length) {
        const n = 1 + ((R() * 3) | 0);
        for (let k = 0; k < n && tops.length; k++) {
          const t = tops.splice((R() * tops.length) | 0, 1)[0];
          const ou = rr(-0.15, 0.15), ov = rr(-0.12, 0.12);
          bx(t.u + ou - 0.03, t.u + ou + 0.03, t.y, t.y + 0.16, t.v + ov - 0.03, t.v + ov + 0.03, 'wax', { c: false });
          W.lights.push({ x: wx(t.u + ou), y: t.y + 0.22, z: wz(t.v + ov), kind: 'candle', flat: fid });
        }
      } else if (lr < 0.68) {
        // glowing sigil on the divider wall, facing the street
        let u = rr(4, 10.8);
        if (dpos.some((d) => u > d - 0.8 && u < d + 1.75)) u = dpos[0] > 7 ? 4.2 : 10.6;
        W.decals.push({ x: wx(u), y: y0 + 1.7, z: wz(dv - 0.012), nz: -dz, flat: fid });
        W.lights.push({ x: wx(u), y: y0 + 1.7, z: wz(dv - 0.5), kind: 'sigil', flat: fid });
      } else if (lr < 0.8) {
        W.lights.push({ x: wx(rr(5, 10)), y: y0 + 2.7, z: wz(dv * 0.5), kind: 'lamp', flat: fid });
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
