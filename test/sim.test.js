// Headless smoke test of the simulation: bots wander/hide while the monster hunts them.
import assert from 'node:assert';
import { Room, nightCfg } from '../shared/room.js';
import { genWorld, zoneAt, K } from '../shared/world.js';

// world sanity
for (const seed of [1, 20261111, 987654]) {
  const W = genWorld(seed), W2 = genWorld(seed);
  assert.strictEqual(JSON.stringify(W.boxes), JSON.stringify(W2.boxes), 'generation must be deterministic');
  assert.ok(W.flats.every((f) => f.rooms.length && f.opens.length));
  for (const b of W.boxes) assert.ok(b.sx >= 0 && b.sy > 0 && b.sz >= 0 && Number.isFinite(b.x + b.y + b.z), 'bad box');
  for (const s of W.spots.flat) assert.strictEqual(zoneAt(W, s.x, s.y - 0.6, s.z).kind, 'flat');
  for (const s of W.spots.balcony) assert.ok(zoneAt(W, s.x, s.y - 0.6, s.z).balc, 'balcony spot');
  for (const s of W.spots.roof) assert.strictEqual(zoneAt(W, s.x, s.y - 0.6, s.z).kind, 'roof');
}

function run(seed, nBots, mode) {
  const log = { dead: 0, smash: 0, nights: 0, over: null, states: new Set(), reveal: 0 };
  const room = new Room({
    id: 'x', seed, max: 8, jitter: 0, send: (pid, m) => {
      if (m.t === 'dead') log.dead++;
      if (m.t === 'brk' && m.big) log.smash++;
      if (m.t === 'nightEnd') log.nights++;
      if (m.t === 'over') log.over = m;
      if (m.t === 'alert') log.reveal++;
      JSON.stringify(m);
    },
  });
  for (let i = 0; i < nBots; i++) room.addPlayer('b' + i, 'Bot' + i, i % 2 ? 'f' : 'm');
  room.handle('b0', { t: 'start' });
  if (mode === 'cheat') room.kill = () => {};   // this run only checks that the night can be completed
  assert.strictEqual(room.phase, 'night');
  let t = 0;
  for (let step = 0; step < 20 * 60 * 40 && room.phase !== 'lobby' && !log.over; step++) {
    t += 0.05;
    for (const p of room.players.values()) {
      if (!p.alive) continue;
      if (mode === 'street') {            // run up and down the road, grabbing stars
        const star = [...room.pickups.values()].find((k) => k.k === 'star');
        if (star) {
          const dx = star.x - p.x, dz = star.z - p.z, d = Math.hypot(dx, dz) || 1;
          room.handle(p.id, { t: 'st', x: p.x + (dx / d) * 0.25, y: 0, z: Math.max(-6, Math.min(6, p.z + (dz / d) * 0.25)), ry: 0, fl: 2 | 8 });
          if (step % 10 === 0) room.handle(p.id, { t: 'noise', r: 16 });
        }
      } else if (mode === 'cheat') {      // teleport to stars, hide in stairwells in between
        if (step % 40 === 0) {
          const star = [...room.pickups.values()].find((k) => k.k === 'star');
          if (star) { room.handle(p.id, { t: 'st', x: star.x, y: star.y - 0.7, z: star.z, ry: 0, fl: 0 }); if (star.closet != null && !room.W.closets[star.closet].open) room.handle(p.id, { t: 'closet', id: star.closet }); room.handle(p.id, { t: 'pick', id: star.id }); }
        }
      } else {                             // camp in a ground-floor flat
        if (mode === 'stairs') room.handle(p.id, { t: 'st', x: p.x, y: 3.2 * 3, z: p.z, ry: 0, fl: 0 });
        else room.handle(p.id, { t: 'st', x: 30 + 6, y: 0.1, z: K.FRONT + (mode === 'back' ? 8.5 : 3), ry: 0, fl: 0 });
      }
    }
    if (mode === 'street') for (const p of room.players.values()) for (const k of room.pickups.values())
      if (k.k === 'star' && Math.hypot(k.x - p.x, k.z - p.z) < 1.5) room.handle(p.id, { t: 'pick', id: k.id });
    room.tick(0.05);
    if (room.m) log.states.add(room.m.st);
    if (room.m) assert.ok(Number.isFinite(room.m.x) && room.m.hands.every((h) => Number.isFinite(h.x + h.y + h.z)), 'NaN in monster');
  }
  return { log, room, t };
}

let r = run(20261111, 1, 'camp');
console.log('camp  :', [...r.log.states].join(','), 'reveals', r.log.reveal, 'dead', r.log.dead, 'after', r.t.toFixed(0) + 's');
assert.ok(r.log.reveal >= 1, 'camping must get you revealed');
assert.ok(r.log.over && !r.log.over.win, 'a camper must eventually be caught');

r = run(20261111, 1, 'back');
console.log('back  :', [...r.log.states].join(','), 'reveals', r.log.reveal, 'dead', r.log.dead, 'after', r.t.toFixed(0) + 's');
assert.ok(r.log.over && !r.log.over.win, 'a back room must not be safe: hands reach the whole flat');

r = run(20261111, 1, 'stairs');
console.log('stairs:', [...r.log.states].join(','), 'reveals', r.log.reveal, 'smash', r.log.smash, 'dead', r.log.dead, 'after', r.t.toFixed(0) + 's');
assert.ok(r.log.over && !r.log.over.win, 'the top of a stairwell must not be a perfect hiding place');

r = run(20261111, 3, 'street');
console.log('street:', [...r.log.states].join(','), 'dead', r.log.dead, 'nights', r.log.nights, 'smash', r.log.smash, 'over', JSON.stringify(r.log.over));
assert.ok(r.log.states.has('hunt'), 'monster should hunt players in the street');

r = run(5, 2, 'cheat');
console.log('cheat :', [...r.log.states].join(','), 'dead', r.log.dead, 'nights', r.log.nights, 'smash', r.log.smash, 'over', JSON.stringify(r.log.over));
assert.ok(r.log.nights >= 1, 'collecting the quota must end the night');

for (let n = 1; n <= 10; n++) { const c = nightCfg(n, 1); assert.ok(c.h > 0 && c.quota > 0); }

// ---- closets, crawlers, eating
{
  const msgs = [];
  const room = new Room({ id: 'y', seed: 20261111, max: 4, jitter: 7, send: (pid, m) => msgs.push(m) });
  room.addPlayer('a', 'A', 'm'); room.handle('a', { t: 'start' });
  const W = room.W, p = room.players.get('a');
  const c = W.closets.find((q) => !W.flats[q.flat].roof && W.flats[q.flat].f === 1), flat = W.flats[c.flat];
  const put = (x, y, z) => room.handle('a', { t: 'st', x, y, z, ry: 0, fl: 0 });
  // a blind hand sweeping the flat passes over a closed closet
  put(c.cx, c.y + 0.05, c.cz); room.tick(0.05);
  assert.ok(p.hid === c, 'standing in a closed closet counts as hidden');
  room.m.x = flat.cx; room.m.st = 'search'; room.m.searchEnd = room.time + 99; room.time = 20;
  room.searchFlat(flat, 0.5, 12);
  for (let i = 0; i < 20 * 12; i++) { put(c.cx, c.y + 0.05, c.cz); p.expo = 0; room.m.stims = []; room.m.st = 'search'; room.tick(0.05); }
  assert.ok(p.alive, 'closet protects from a hand that does not know');
  assert.ok(msgs.some((m) => m.t === 's' && m.m.hands.some((h) => h && h.length >= 7)), 'arm is routed through the window');
  // ...but once it knows, it opens the closet, takes the player and eats them
  room.retractAll(); for (const h of room.m.hands) h.task = null;
  room.m.st = 'search'; room.searchFlat(flat, 1, 20);
  let eaten = false;
  for (let i = 0; i < 20 * 25 && room.phase === 'night'; i++) { if (p.alive) put(c.cx, c.y + 0.05, c.cz); p.expo = 0; room.tick(0.05); }
  eaten = msgs.some((m) => m.t === 'eaten');
  assert.ok(!p.alive && c.open, 'a hand that knows opens the closet');
  assert.ok(msgs.some((m) => m.t === 'dead' && m.h != null) && eaten, 'victim is carried to the mouth and eaten');
  assert.strictEqual(room.phase, 'over');
  console.log('closet: hidden from blind hand, opened by knowing hand, eaten -> game over');
}
{
  const msgs = [];
  const room = new Room({ id: 'z', seed: 20261111, max: 4, jitter: 11, send: (pid, m) => msgs.push(m) });
  room.addPlayer('a', 'A', 'm'); room.handle('a', { t: 'start' });
  room.startNight(3);
  const p = room.players.get('a'), W = room.W;
  room.m.st = 'listen'; room.m.wait = 1e9; room.m.t = 0;            // keep the big one out of this test
  const b = W.buildings[p.zi.b.id], fl = b.flats[2], r0 = fl.rooms[0];
  const px = (r0.x0 + r0.x1) / 2, pz = fl.side * (K.FRONT + 2.5), py = fl.y0 + 0.05;
  room.time = 20; room.summon('test');
  assert.strictEqual(room.minions.length, 1, 'night 3 summons one crawler');
  let hurt = 0, maxY = 0;
  for (let i = 0; i < 20 * 70; i++) {
    if (p.alive) room.handle('a', { t: 'st', x: px, y: py, z: pz, ry: 0, fl: 0 });
    p.expo = 0; p.hp = 100; room.m.stims = []; room.m.st = 'listen'; room.m.t = 0;
    room.tick(0.05);
    for (const q of room.minions) { maxY = Math.max(maxY, q.y); assert.ok(Number.isFinite(q.x + q.y + q.z)); }
  }
  hurt = msgs.filter((m) => m.t === 'hp' && m.cause === 'minion').length + msgs.filter((m) => m.t === 'dead' && m.cause === 'minion').length;
  console.log('crawler: climbed to y=' + maxY.toFixed(1), 'bites', hurt, 'left alive', room.minions.length);
  assert.ok(maxY > 6, 'crawler climbs the stairs'); assert.ok(hurt >= 1, 'crawler finds and bites the player');
  assert.strictEqual(room.minions.length, 0, 'crawlers expire after their minute');
  assert.ok(msgs.some((m) => m.t === 'fx' && m.k === 'mdie'));
}

// ---- crawlers and closets: a shut closet hides you from a crawler until it pulls the doors open
{
  const msgs = [];
  const room = new Room({ id: 'zc', seed: 20261111, max: 4, jitter: 13, send: (pid, m) => msgs.push(m) });
  room.addPlayer('a', 'A', 'm'); room.handle('a', { t: 'start' });
  room.startNight(3);
  const p = room.players.get('a'), W = room.W;
  const c = W.closets.find((q) => !W.flats[q.flat].roof && W.flats[q.flat].f >= 1), b = W.buildings[W.flats[c.flat].b];
  const put = () => room.handle('a', { t: 'st', x: c.cx, y: c.y + 0.05, z: c.cz, ry: 0, fl: 0 });
  put(); room.tick(0.05);
  assert.ok(p.hid === c, 'standing in the shut closet hides the player');
  room.m.st = 'listen'; room.m.wait = 1e9;
  room.time = 20; room.summon('test');
  for (const q of room.minions) q.b = b;          // make sure it hunts this building
  let bitWhileShut = false, opened = false;
  for (let i = 0; i < 20 * 70; i++) {
    if (p.alive) put();
    const shut = !c.open;
    p.expo = 0; p.hp = 100; room.m.stims = []; room.m.st = 'listen'; room.m.t = 0;
    const before = msgs.length;
    room.tick(0.05);
    if (shut && msgs.slice(before).some((m) => m.t === 'hp' && m.cause === 'minion')) bitWhileShut = true;
    if (c.open) opened = true;
  }
  assert.ok(!bitWhileShut, 'a crawler never bites through a shut closet');
  assert.ok(opened, 'the crawler finds the closet and pulls it open (this seed)');
  assert.ok(msgs.some((m) => m.t === 'hp' && m.cause === 'minion'), 'once the closet is open it bites');
  assert.strictEqual(room.minions.length, 0, 'crawlers expire after their minute');
  console.log('crawler+closet: bitten while shut', bitWhileShut, '· closet pulled open', opened);
}

// ---- patrol: with nobody making a sound it still walks its round of the whole street
{
  const room = new Room({ id: 'p', seed: 20261111, max: 4, jitter: 3, send: () => {} });
  room.addPlayer('a', 'A', 'm'); room.handle('a', { t: 'start' });
  const p = room.players.get('a'), L = room.W.L;
  let lo = 1e9, hi = -1e9;
  for (let i = 0; i < 20 * 240 && room.phase === 'night'; i++) {
    room.handle('a', { t: 'st', x: p.x, y: 3.2 * 2 + 1.6, z: p.z, ry: 0, fl: 1 }); p.expo = 0; p.hp = 100;
    room.kill = () => {}; room.tick(0.05);
    lo = Math.min(lo, room.m.x); hi = Math.max(hi, room.m.x);
  }
  console.log('patrol: covered x', lo.toFixed(0), '..', hi.toFixed(0), 'of', L);
  assert.ok(hi - lo > L * 0.75, 'the monster must walk most of the street without being provoked');
}

// ---- hands are solid: stopped by walls, they draw back and punch through; nothing passes through an intact wall
for (const night of [1, 4]) {
  const msgs = [];
  const room = new Room({ id: 'h', seed: 20261111, max: 4, jitter: 1, send: (pid, m) => msgs.push(m) });
  room.addPlayer('a', 'A', 'm'); room.handle('a', { t: 'start' });
  if (night > 1) room.startNight(night);
  const W = room.W, p = room.players.get('a');
  const flat = W.flats.find((f) => !f.roof && f.f === 1 && f.rooms.length > 1 && f.cx > 30 && f.cx < 90), back = flat.rooms[1];
  const px = (back.x0 + back.x1) / 2, pz = (back.z0 + back.z1) / 2, py = flat.y0 + 0.05;
  W.doors[back.door].open = false;
  room.kill = () => {}; room.grab = () => {};
  room.m.x = flat.cx; room.m.st = 'search'; room.m.searchEnd = 1e9; room.time = 20;
  assert.ok(room.searchFlat(flat, 1, 14, { x: px }));
  const hand = room.m.hands.find((h) => h.task);
  const inside = (e, h) => h.x > e.x0 && h.x < e.x1 && h.y > e.y0 && h.y < e.y1 && h.z > e.z0 && h.z < e.z1;
  let reached = false, blocked = 0;
  for (let i = 0; i < 20 * 14; i++) {
    room.handle('a', { t: 'st', x: px, y: py, z: pz, ry: 0, fl: 0 }); p.expo = 0; p.hp = 100; room.m.stims = []; room.m.st = 'search';
    room.tick(0.05);
    if (!hand.task || hand.task.type !== 'search') break;
    if (hand.task.blk) blocked++;
    for (const e of flat.brk) {
      if (e.gone || (e.kind !== 'wall' && e.kind !== 'door' && !(e.kind === 'facade' && night >= 3))) continue;
      if (e.kind === 'door' && W.doors[e.door].open) continue;
      assert.ok(!inside(e, hand), `night ${night}: hand is inside the intact ${e.kind} ${e.g}`);
    }
    if (Math.hypot(hand.x - px, hand.z - pz) < 1) reached = true;
  }
  const brk = msgs.filter((m) => m.t === 'brk'), kinds = new Set(brk.map((m) => m.k));
  console.log(`hands n${night}: reached back room ${reached}, held up for ${(blocked * 0.05).toFixed(1)}s, broke`, [...kinds].join(','), `(${brk.reduce((n, m) => n + m.gs.length, 0)} pieces)`);
  assert.ok(reached, 'the hand must get to the back room');
  assert.ok(blocked > 5 && msgs.some((m) => m.t === 'fx' && m.k === 'bang'), 'a wall must hold it up first');
  assert.ok(kinds.has('wall') || kinds.has('door'), 'it must break through an inner wall or door');
  assert.strictEqual(kinds.has('facade'), night >= 3, 'from night 3 the hand is too big for the window and takes the wall out');
  assert.ok(brk.every((m) => m.gs.every((g) => W.brk[g].gone && room.broken.has(g))));
}

// ---- eaten: carried out through the opening and up in front of the face, never through the building
{
  const msgs = [];
  const room = new Room({ id: 'e', seed: 20261111, max: 4, jitter: 2, send: (pid, m) => msgs.push(m) });
  room.addPlayer('a', 'A', 'm'); room.handle('a', { t: 'start' });
  const W = room.W, p = room.players.get('a');
  const flat = W.flats.find((f) => !f.roof && f.f === 1 && f.cx > 30 && f.cx < 90), r0 = flat.rooms[0];
  const px = (r0.x0 + r0.x1) / 2, pz = flat.side * (K.FRONT + 2.2), py = flat.y0 + 0.05;
  room.m.x = flat.cx; room.m.st = 'search'; room.m.searchEnd = 1e9; room.time = 20;
  room.searchFlat(flat, 1, 14, { x: px });
  let seenEat = false, maxInsideY = 0;
  for (let i = 0; i < 20 * 30 && room.phase === 'night'; i++) {
    if (p.alive) room.handle('a', { t: 'st', x: px, y: py, z: pz, ry: 0, fl: 0 });
    p.expo = 0; room.tick(0.05);
    const h = room.m && room.m.hands.find((q) => q.task && q.task.type === 'eat');
    if (h) { seenEat = true; if (Math.abs(h.z) > K.FRONT + 0.3) maxInsideY = Math.max(maxInsideY, h.y - flat.y0); }
  }
  assert.ok(seenEat && msgs.some((m) => m.t === 'eaten'), 'victim is eaten');
  assert.ok(maxInsideY < 3.0, `the fist must leave by the opening, not up through the ceiling (rose ${maxInsideY.toFixed(1)} m indoors)`);
  assert.strictEqual(room.phase, 'over');
  console.log('eat: left through the opening, then up to the face; game over after it swallows');
}

// ---- a thrown bottle draws it; its body snaps the cables it walks through
{
  const msgs = [];
  const room = new Room({ id: 'b', seed: 20261111, max: 4, jitter: 5, send: (pid, m) => msgs.push(m) });
  room.addPlayer('a', 'A', 'm'); room.handle('a', { t: 'start' });
  const p = room.players.get('a');
  p.bottles = 1; room.time = 20;
  const tx = room.m.x > 60 ? room.m.x - 26 : room.m.x + 26;
  p.x = tx + 10; p.z = 9;
  room.handle('a', { t: 'throw', x: tx, y: 0.1, z: 2 });
  assert.strictEqual(p.bottles, 0);
  let near = false;
  for (let i = 0; i < 20 * 30; i++) { room.handle('a', { t: 'st', x: tx + 10, y: 3.3, z: 9.5, ry: 0, fl: 1 }); p.expo = 0; room.kill = () => {}; room.tick(0.05); if (Math.abs(room.m.x - tx) < 4) near = true; }
  assert.ok(near, 'the monster goes to where the bottle broke');
  assert.ok(msgs.some((m) => m.t === 'brk' && m.k === 'cable'), 'cables snap across its body');
  console.log('bottle: lured the monster; cables snapped:', msgs.filter((m) => m.t === 'brk' && m.k === 'cable').length);
}
console.log('ok');
