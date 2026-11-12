// Walk a simulated player through a building: street door -> every flight of stairs -> terrace,
// then into a flat through its door and out onto the balcony.
import assert from 'node:assert';
import { genWorld, zoneAt, K } from '../shared/world.js';
import { Colliders } from '../public/js/physics.js';
import { Player } from '../public/js/player.js';

for (const seed of [20261111, 7, 4242]) {
  const W = genWorld(seed);
  const col = new Colliders();
  for (const b of W.boxes) if (b.c) col.add(b.x, b.y, b.z, b.sx, b.sy, b.sz);
  const doorCols = W.doors.map((d) => { const h = Math.abs(d.cd[0]) > 0.5; const c = col.add(d.cx, d.y + d.h / 2, d.cz, h ? d.len : 0.2, d.h, h ? 0.2 : d.len); c.on = !d.open; return c; });

  for (const b of [W.buildings[3], W.buildings[8], W.buildings[13]]) {
    const wx = (u) => b.x0 + (b.flip ? K.BW - u : u), wz = (v) => b.side * (K.FRONT + v);
    const P = new Player(col);
    const walk = (u, v, label, sprint) => {
      const tx = wx(u), tz = wz(v);
      for (let i = 0; i < 600; i++) {
        const dx = tx - P.x, dz = tz - P.z;
        if (Math.hypot(dx, dz) < 0.15) return;
        P.yaw = Math.atan2(-dx, -dz);
        P.update(1 / 60, { fwd: true, sprint });
      }
      assert.fail(`seed ${seed} block ${b.name}: stuck walking to ${label} (at ${P.x.toFixed(2)},${P.y.toFixed(2)},${P.z.toFixed(2)} want ${tx.toFixed(2)},${tz.toFixed(2)})`);
    };
    // from the pavement, through the street door
    P.place(wx(1.5), 0.3, b.side * 7.1);
    for (let i = 0; i < 30; i++) P.update(1 / 60, {});
    walk(1.5, 1.3, 'hall');
    assert.strictEqual(zoneAt(W, P.x, P.y, P.z).kind, 'stair');
    for (let f = 0; f < b.nF; f++) {
      walk(0.9, 2.4, 'flight A foot'); walk(0.9, 8.6, 'half landing'); walk(2.3, 8.6, 'turn'); walk(2.3, 1.6, 'next floor');
      assert.ok(Math.abs(P.y - (f + 1) * K.FH) < 0.05, `expected floor ${f + 1}, y=${P.y}`);
    }
    walk(6, 1.5, 'terrace');
    assert.strictEqual(zoneAt(W, P.x, P.y, P.z).kind, 'roof');

    // flat on floor 1: entry door, then balcony door
    const flat = b.flats[1], y = K.FH;
    const entry = W.doors.find((d) => d.flat === flat.id && d.kind === 'entry'), balc = W.doors.find((d) => d.flat === flat.id && d.kind === 'balcony');
    P.place(wx(1.5), y + 0.05, wz(1.3));
    for (let i = 0; i < 20; i++) P.update(1 / 60, {});
    doorCols[entry.id].on = true;
    const x0 = P.x;
    for (let i = 0; i < 90; i++) { P.yaw = Math.atan2(-(wx(4.5) - P.x), -(wz(1.3) - P.z)); P.update(1 / 60, { fwd: true }); }
    assert.strictEqual(zoneAt(W, P.x, P.y, P.z).kind, 'stair', 'a closed door must block');
    doorCols[entry.id].on = false;
    walk(4.2, 1.3, 'through entry door');
    assert.strictEqual(zoneAt(W, P.x, P.y, P.z).kind, 'flat');
    doorCols[balc.id].on = false;
    const bu = (balc.hx - b.x0); const u = (b.flip ? K.BW - bu : bu) + 0.5;
    P.place(wx(u), y + 0.05, wz(1.0));
    walk(u, -0.7, 'balcony');
    assert.ok(zoneAt(W, P.x, P.y, P.z).balc, 'on the balcony');
    // the railing holds while walking, but can be vaulted with a jump -> fall damage from a height
    for (let i = 0; i < 60; i++) { P.yaw = b.side > 0 ? 0 : Math.PI; P.update(1 / 60, { fwd: true }); }
    assert.ok(zoneAt(W, P.x, P.y, P.z).balc, 'railing should stop a walking player');
  }
  // closets are hollow: you can walk in when open, not when closed
  for (const c of W.closets.slice(0, 40)) {
    const horiz = c.h0[1] === c.h1[1];
    const dc = col.add((c.h0[0] + c.h1[0]) / 2 - c.f[0] * 0.04, c.y + 1.02, (c.h0[1] + c.h1[1]) / 2 - c.f[1] * 0.04, horiz ? c.w : 0.08, 2.04, horiz ? 0.08 : c.w);
    const P = new Player(col);
    const go = () => { P.place(c.cx + c.f[0] * 0.92, c.y + 0.05, c.cz + c.f[1] * 0.92); for (let i = 0; i < 90; i++) { P.yaw = Math.atan2(c.f[0], c.f[1]); P.update(1 / 60, { fwd: true }); } return P.x > c.x0 - 0.05 && P.x < c.x1 + 0.05 && P.z > c.z0 - 0.05 && P.z < c.z1 + 0.05; };
    assert.ok(!col.test(c.cx + c.f[0] * 0.92 - 0.3, c.y + 0.1, c.cz + c.f[1] * 0.92 - 0.3, c.cx + c.f[0] * 0.92 + 0.3, c.y + 1.7, c.cz + c.f[1] * 0.92 + 0.3), `seed ${seed}: closet ${c.id} front is blocked`);
    assert.ok(!go(), 'closed closet keeps you out');
    dc.on = false;
    assert.ok(go(), `seed ${seed}: cannot walk into open closet ${c.id}`);
  }
  // crawler paths never cross a wall (furniture does not count: they climb over it)
  const walls = new Colliders();
  for (const b of W.boxes) if (b.c && !b.fu) walls.add(b.x, b.y, b.z, b.sx, b.sy, b.sz);
  for (const b of W.buildings) b.nav.n.forEach((n, i) => {
    for (const j of b.nav.e[i]) {
      const m = b.nav.n[j], dx = m.x - n.x, dy = m.y - n.y, dz = m.z - n.z, len = Math.hypot(dx, dy, dz);
      const t = walls.ray(n.x, n.y + 0.7, n.z, dx / len || 1e-9, dy / len || 1e-9, dz / len || 1e-9, len);
      assert.ok(!(t < len - 0.05), `seed ${seed} block ${b.name}: crawler path ${i}->${j} hits a wall at ${t.toFixed(2)} of ${len.toFixed(2)} (${n.x.toFixed(1)},${n.y.toFixed(1)},${n.z.toFixed(1)})`);
    }
  });
  // falling from a 4-storey roof hurts, one storey does not
  const P = new Player(col);
  const fall = (h) => { P.place(60, h, 0); P.ground = false; let v = 0; for (let i = 0; i < 400; i++) for (const e of P.update(1 / 60, {})) if (e.t === 'land') v = Math.max(v, e.v); return v; };
  assert.ok(fall(3.2) < 11.5, 'one storey is safe'); assert.ok(fall(12.8) > 18, 'four storeys is not');
}
console.log('physics ok');
