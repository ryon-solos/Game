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
    id: 'x', seed, max: 8, send: (pid, m) => {
      if (m.t === 'dead') log.dead++;
      if (m.t === 'smash') log.smash++;
      if (m.t === 'nightEnd') log.nights++;
      if (m.t === 'over') log.over = m;
      if (m.t === 'alert') log.reveal++;
      JSON.stringify(m);
    },
  });
  for (let i = 0; i < nBots; i++) room.addPlayer('b' + i, 'Bot' + i, i % 2 ? 'f' : 'm');
  room.handle('b0', { t: 'start' });
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
          if (star) { room.handle(p.id, { t: 'st', x: star.x, y: star.y - 0.7, z: star.z, ry: 0, fl: 0 }); room.handle(p.id, { t: 'pick', id: star.id }); }
        }
      } else {                             // camp in a ground-floor flat
        if (mode === 'stairs') room.handle(p.id, { t: 'st', x: p.x, y: 3.2 * 3, z: p.z, ry: 0, fl: 0 });
        else room.handle(p.id, { t: 'st', x: 30 + 6, y: 0.1, z: K.FRONT + 3, ry: 0, fl: 0 });
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
console.log('ok');
