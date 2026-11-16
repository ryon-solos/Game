// The solo test menu's simulation side: cheats work in a solo room and are ignored everywhere else.
import assert from 'node:assert';
import { Room } from '../shared/room.js';

function setup(solo, cheats) {
  const msgs = [];
  const room = new Room({ id: 'c', seed: 20261111, max: solo ? 1 : 4, solo, jitter: 3, send: (pid, m) => msgs.push(m) });
  room.addPlayer('me', 'Me', 'm'); room.handle('me', { t: 'start' });
  room.cheats = cheats;
  return { room, msgs, p: room.players.get('me') };
}
// stand in the middle of the street with the torch on, sprinting and making noise, right in front of it
function exposed(room, p, secs) {
  for (let i = 0; i < secs * 20 && room.phase === 'night'; i++) {
    room.m.x = Math.max(10, Math.min(room.W.L - 10, p.x + 4));
    room.handle('me', { t: 'st', x: p.x, y: 0, z: 0.5, ry: 0, fl: 2 | 4 | 8 });
    if (i % 5 === 0) room.handle('me', { t: 'noise', r: 20 });
    room.tick(0.05);
  }
}

// ---- god mode: nothing kills you, even standing in the road in front of it all night
{
  const { room, p } = setup(true, { god: true });
  exposed(room, p, 60);
  room.hurt(p, 500, 'fall'); room.kill(p, 'fall');
  assert.ok(p.alive && p.hp > 0, 'god mode: still alive');
  console.log('cheats: god mode survives a minute in the road in front of it');
}

// ---- without cheats the same thing gets you killed (so the test above means something)
{
  const { room, p } = setup(true, null);
  exposed(room, p, 60);
  assert.ok(!p.alive, 'no cheats: standing in the road gets you taken');
}

// ---- the same cheats on a multiplayer (server) room do nothing
{
  const { room, p } = setup(false, { god: true, invisible: true, ammo: true, freeze: true });
  exposed(room, p, 60);
  assert.ok(!p.alive, 'cheats are ignored by a room that is not solo');
  assert.strictEqual(room.cheatAction('stars'), 'Start a game first', 'cheat actions refused on a server room');
  console.log('cheats: ignored by a multiplayer room');
}

// ---- invisible: it never sees, hears or senses you, presence never fills
{
  const { room, p, msgs } = setup(true, { invisible: true });
  room.time = 20;
  exposed(room, p, 60);
  assert.ok(p.alive, 'invisible: not taken');
  assert.ok(!msgs.some((m) => m.t === 'alert'), 'invisible: never revealed');
  assert.ok(room.m.st !== 'hunt' && !room.m.stims.some((s) => s.pid === 'me'), 'invisible: it neither hunts nor heard you');
  assert.strictEqual(p.expo, 0, 'invisible: presence stays empty');
  console.log('cheats: invisible player is never seen, heard or revealed');
}

// ---- infinite health: hits do not hurt, but a grab still kills
{
  const { room, p } = setup(true, { infHp: true });
  room.hurt(p, 80, 'fall'); room.hurt(p, 80, 'debris');
  assert.ok(p.alive && p.hp === 100, 'infinite health: refilled');
  exposed(room, p, 60);
  assert.ok(!p.alive, 'infinite health: a hand still takes you');
}

// ---- ammo, bottles, frozen monster and clock
{
  const { room, p } = setup(true, { ammo: true, bottles: true, freeze: true, freezeTime: true });
  const mx = room.m.x, tl = room.tleft;
  for (let i = 0; i < 100; i++) { room.handle('me', { t: 'shoot', hit: false }); room.tick(0.05); }
  assert.strictEqual(p.ammo, 6); assert.strictEqual(p.bottles, 3);
  assert.strictEqual(room.m.x, mx, 'frozen monster does not move'); assert.strictEqual(room.tleft, tl, 'clock stopped');
  console.log('cheats: infinite ammo and bottles, frozen monster, stopped clock');
}

// ---- actions
{
  const { room, p, msgs } = setup(true, {});
  assert.strictEqual(room.cheatAction('star'), null); assert.strictEqual(room.stars, 1);
  assert.strictEqual(room.cheatAction('stars'), null); room.tick(0.05);
  assert.strictEqual(room.phase, 'dawn', 'completing the quota brings dawn');
  assert.strictEqual(room.cheatAction('night', 7), null);
  assert.ok(room.phase === 'night' && room.night === 7 && msgs.some((m) => m.t === 'night' && m.n === 7), 'jump to night 7');
  assert.strictEqual(room.cheatAction('summon'), null); assert.ok(room.minions.length > 0);
  assert.strictEqual(room.cheatAction('killCrawlers'), null); assert.strictEqual(room.minions.length, 0);
  assert.strictEqual(room.cheatAction('stun'), null); assert.strictEqual(room.m.st, 'stun');
  room.m.stunT = 0; room.tick(0.05);
  assert.strictEqual(room.cheatAction('away'), null); assert.ok(Math.abs(room.m.x - p.x) > room.W.L / 3, 'sent to the far end');
  p.hp = 20; room.cheatAction('heal'); assert.strictEqual(p.hp, 100);
  assert.strictEqual(room.cheatAction('endNight'), null); assert.strictEqual(room.phase, 'inter');
  console.log('cheats: stars, night jump, crawlers, stun, send away, heal, skip night');
}
console.log('cheat tests passed');
