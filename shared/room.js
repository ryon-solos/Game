// Authoritative game simulation for one lobby. Used by the Node server for multiplayer
// and directly inside the browser for solo play (same code, no network).
import { K, genWorld, zoneAt, rng32 } from './world.js';

export const MAX_NIGHT = 10;
export const EXPOSE_TIME = 30;   // seconds in one zone before the monster knows where you are

export function nightCfg(n, np = 1) {
  const speed = 2.5 + 0.3 * n;
  return {
    n,
    h: 8 + 1.3 * n,                           // monster height (m): 9.3 on night 1, 21 on night 10
    speed,                                    // idle roaming
    alert: Math.min(9, speed * 1.7),          // going to a sound
    hunt: Math.min(9.5, speed * 1.9),         // it has seen you, or simply knows where you are
    breakDelay: n >= 5 ? 0.7 : 1.3,           // seconds a wall or shut door holds a hand up before it punches through
    handR: 0.45 + 0.05 * n,                   // how much room a hand needs
    bigHands: n >= 3,                         // too big for a window: it takes the wall out to get in
    minions: n >= 8 ? 3 : n >= 5 ? 2 : n >= 3 ? 1 : 0,
    handSpeed: 3.8 + 0.55 * n,
    hands: Math.min(8, 2 + Math.floor(n * 0.7)),
    hearing: 0.8 + 0.08 * n,
    memory: 6 + 2 * n,                        // how long it remembers a sound
    stun: Math.max(2.5, 7 - 0.45 * n),
    aware: 0.08 + 0.03 * n,                   // chance a blind hand "smells" a hiding player
    view: 16 + 1.5 * n,
    predicts: n >= 3, usesHeat: n >= 4, feints: n >= 6,
    quota: 4 + n + 2 * (np - 1),
    duration: 300 + 15 * n,
  };
}

// World position of the monster's i-th shoulder (0-3 reach the +z side, 4-7 the -z side).
export function shoulder(m, i, out = {}) {
  const side = i < 4 ? 1 : -1, k = i % 4, s = m.h / 10;
  out.x = m.x; out.y = (5.4 + k * 0.95) * s; out.z = m.z + side * 0.8 * s;
  return out;
}

export const MINION_LIFE = 60;
const r2 = (v) => Math.round(v * 100) / 100;
// does a sphere touch a box {x0..z1}?
const sphereBox = (e, x, y, z, r) => {
  const dx = x - (x < e.x0 ? e.x0 : x > e.x1 ? e.x1 : x), dy = y - (y < e.y0 ? e.y0 : y > e.y1 ? e.y1 : y), dz = z - (z < e.z0 ? e.z0 : z > e.z1 ? e.z1 : z);
  return dx * dx + dy * dy + dz * dz < r * r;
};
// where (0..1) does the segment a->b first enter a box grown by `pad`? -1 if it does not
const segBox = (e, ax, ay, az, bx, by, bz, pad) => {
  let t0 = 0, t1 = 1;
  for (const [a, d, lo, hi] of [[ax, bx - ax, e.x0 - pad, e.x1 + pad], [ay, by - ay, e.y0 - pad, e.y1 + pad], [az, bz - az, e.z0 - pad, e.z1 + pad]]) {
    if (Math.abs(d) < 1e-9) { if (a < lo || a > hi) return -1; continue; }
    let u0 = (lo - a) / d, u1 = (hi - a) / d;
    if (u0 > u1) { const q = u0; u0 = u1; u1 = q; }
    if (u0 > t0) t0 = u0; if (u1 < t1) t1 = u1;
    if (t0 > t1) return -1;
  }
  return t0;
};
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class Room {
  constructor(o) {
    this.id = o.id; this.name = o.name || 'Lobby'; this.code = o.code || '';
    this.isPublic = !!o.isPublic; this.max = clamp(o.max || 4, 1, 8); this.solo = !!o.solo;
    this.seed = o.seed; this.send = o.send;
    this.players = new Map(); this.host = null;
    this.phase = 'lobby'; this.night = 0; this.time = 0;
    // Live lobbies jitter the seed so two rooms on the same daily seed do not
    // play out identically. Tests pass an explicit jitter to get a reproducible run.
    this.R = rng32((o.seed ^ 0x51ed27) + (o.jitter ?? ((Math.random() * 1e9) | 0)));
    this.W = null;
  }

  info() {
    return { id: this.id, name: this.name, players: this.players.size, max: this.max, phase: this.phase, night: this.night };
  }
  lobbyMsg() {
    return {
      t: 'lobby', id: this.id, name: this.name, code: this.code, pub: this.isPublic, max: this.max, host: this.host,
      phase: this.phase, seed: this.seed, players: [...this.players.values()].map((p) => ({ id: p.id, name: p.name, char: p.char })),
    };
  }
  bc(msg) { this.send(null, msg); }

  addPlayer(id, name, char) {
    if (this.players.size >= this.max) return 'Lobby is full';
    if (this.phase !== 'lobby') return 'That game has already started';
    this.players.set(id, { id, name: String(name || 'Player').slice(0, 16), char: char === 'f' ? 'f' : 'm', x: 0, y: 0, z: 0, ry: 0, fl: 0, hp: 100, alive: false, ammo: 0 });
    if (!this.host) this.host = id;
    this.bc(this.lobbyMsg());
    return null;
  }
  removePlayer(id) {
    if (!this.players.delete(id)) return;
    if (this.host === id) this.host = this.players.keys().next().value || null;
    this.bc({ t: 'left', id });
    if (this.phase === 'lobby') this.bc(this.lobbyMsg());
    else if (this.phase === 'night' || this.phase === 'dawn') this.checkWipe();
  }

  handle(id, msg) {
    const p = this.players.get(id);
    if (!p) return;
    switch (msg.t) {
      case 'start':
        if (id === this.host && this.phase === 'lobby') this.startGame();
        break;
      case 'st':
        if (!p.alive) break;
        if (![msg.x, msg.y, msg.z, msg.ry].every(Number.isFinite)) break;
        p.x = msg.x; p.y = msg.y; p.z = msg.z; p.ry = msg.ry; p.fl = msg.fl | 0;
        break;
      case 'noise':
        if (p.alive && this.m) this.noise(p.x, p.y, p.z, clamp(+msg.r || 0, 0, 30), p);
        break;
      case 'door': {
        const d = this.W && this.W.doors[msg.id];
        if (!d || d.broken || !p.alive || Math.hypot(d.cx - p.x, d.cz - p.z) > 4) break;
        this.setDoor(d, !d.open);
        this.noise(d.cx, d.y, d.cz, 9, p);
        break;
      }
      case 'throw': {
        // a thrown bottle: it shatters where it lands, and the monster goes to look
        if (!p.alive || !(p.bottles > 0) || !this.m || ![msg.x, msg.y, msg.z].every(Number.isFinite)) break;
        if (Math.hypot(msg.x - p.x, msg.z - p.z) > 45) break;
        p.bottles--;
        this.fx('glass', msg.x, msg.y, msg.z, { by: id });
        this.noise(msg.x, msg.y, msg.z, 48, null);
        break;
      }
      case 'closet': {
        const c = this.W && this.W.closets[msg.id];
        if (!c || c.broken || !p.alive || Math.hypot(c.cx - p.x, c.cz - p.z) > 3) break;
        this.setCloset(c, !c.open);
        this.noise(c.cx, c.y, c.cz, 6, p);
        break;
      }
      case 'pick': {
        const k = this.pickups && this.pickups.get(msg.id);
        if (!k || !p.alive || Math.hypot(k.x - p.x, k.z - p.z, k.y - p.y - 0.8) > 3.2) break;
        if (k.closet != null && !this.W.closets[k.closet].open) break;
        this.pickups.delete(k.id);
        if (k.k === 'star') {
          this.stars++;
          // taking a star rings out: the monster learns where it was taken
          if (this.m) { this.m.stims.push(this.stimAt(p.x, p.y, p.z, 1.0, 0.75, p)); this.fx('starcry', p.x, p.y + 1, p.z); }
          if (!this.halfSummon && this.stars >= Math.ceil(this.cfg.quota / 2)) { this.halfSummon = true; this.summon('stars'); }
        }
        else if (k.k === 'bottle') { if (p.bottles >= 3) { this.pickups.set(k.id, k); break; } p.bottles++; }
        else if (k.k === 'gun') p.ammo = Math.min(6, p.ammo + 2);
        else if (k.k === 'med') p.hp = Math.min(100, p.hp + 35);
        this.bc({ t: 'pick', id: k.id, by: id, k: k.k });
        break;
      }
      case 'shoot':
        if (!p.alive || p.ammo <= 0 || !this.m) break;
        p.ammo--;
        this.bc({ t: 'shot', by: id, hit: !!msg.hit });
        this.noise(p.x, p.y, p.z, 70, p);
        if (msg.hit) this.stunMonster(p);
        break;
      case 'hurt':
        if (p.alive) this.hurt(p, clamp(+msg.a || 0, 0, 200), 'fall');
        break;
    }
  }

  // ------------------------------------------------------------------ flow
  startGame() {
    this.W = genWorld(this.seed);
    this.doorInit = this.W.doors.map((d) => d.open);
    this.heat = new Map(); this.broken = new Set();
    for (const p of this.players.values()) { p.hp = 100; p.ammo = 0; p.bottles = 0; }
    this.startNight(1);
  }

  startNight(n) {
    const W = this.W, R = this.R;
    this.night = n; this.phase = 'night'; this.time = 0; this.snapT = 0;
    const cfg = this.cfg = nightCfg(n, this.players.size);
    this.tleft = cfg.duration; this.frenzyT = 0; this.stars = 0; this.cd = 0;
    this.minions = []; this.halfSummon = false; this.summonCd = 0; this.summonT = 70; this.wipeT = 0; this.nextMinion = 1;
    W.doors.forEach((d, i) => { d.open = d.broken || this.doorInit[i]; });
    W.closets.forEach((c) => { c.open = c.broken; });

    // pickups
    this.pickups = new Map();
    let pid = 1;
    const take = (list, k, count) => {
      const pool = list.slice();
      for (let i = 0; i < count && pool.length; i++) {
        const s = pool.splice((R() * pool.length) | 0, 1)[0];
        this.pickups.set(pid, { id: pid, k, x: r2(s.x), y: r2(s.y), z: r2(s.z) }); pid++;
      }
    };
    const total = cfg.quota + 3 + Math.ceil(cfg.quota * 0.35);
    const nStreet = Math.round(total * 0.25), nBalc = Math.round(total * 0.25), nRoof = Math.round(total * 0.12), nClos = Math.round(total * 0.22);
    take(W.spots.street, 'star', nStreet); take(W.spots.balcony, 'star', nBalc); take(W.spots.roof, 'star', nRoof);
    {   // stars shut away in closets
      const pool = W.spots.closet.slice();
      for (let i = 0; i < nClos && pool.length; i++) {
        const sp = pool.splice((R() * pool.length) | 0, 1)[0];
        this.pickups.set(pid, { id: pid, k: 'star', x: r2(sp.x), y: r2(sp.y), z: r2(sp.z), closet: sp.closet }); pid++;
      }
    }
    const flatSpots = W.spots.flat.slice();
    const takeFlat = (k, count) => {
      for (let i = 0; i < count && flatSpots.length; i++) {
        const s = flatSpots.splice((R() * flatSpots.length) | 0, 1)[0];
        this.pickups.set(pid, { id: pid, k, x: r2(s.x), y: r2(s.y), z: r2(s.z) }); pid++;
      }
    };
    takeFlat('star', total - nStreet - nBalc - nRoof - nClos);
    takeFlat('gun', 2 + Math.ceil(this.players.size / 2));
    takeFlat('med', 2 + Math.floor(this.players.size / 2));
    take(W.spots.street, 'gun', 1);
    takeFlat('bottle', 4 + this.players.size);

    // spawn players together in one stairwell, the monster at the far end of the street
    const sp = W.spawns[2 + ((R() * (W.spawns.length - 4)) | 0)];
    const spawn = {};
    let k = 0;
    for (const p of this.players.values()) {
      const a = (k++ / Math.max(1, this.players.size)) * Math.PI * 2;
      p.x = sp.x + Math.cos(a) * 0.55 * (this.players.size > 1); p.y = sp.y; p.z = sp.z + Math.sin(a) * 0.5 * (this.players.size > 1);
      p.alive = true; p.hp = Math.max(p.hp, 60); p.expo = 0; p.zone = null; p.prevZone = null; p.fl = 0; p.lx = p.x; p.vx = 0;
      p.zi = zoneAt(W, p.x, p.y, p.z);
      spawn[p.id] = [r2(p.x), r2(p.y), r2(p.z)];
    }
    const mx = sp.x < W.L / 2 ? W.L - 8 : 8;
    this.m = {
      x: mx, z: 0, dir: mx > sp.x ? -1 : 1, patrol: mx > sp.x ? -1 : 1, h: cfg.h, st: 'listen', t: 0, wait: 5, tx: mx, think: 0,
      stims: [], goal: null, huntId: null, huntForce: 0, stunT: 0, immune: 0, smashCd: 20 + R() * 20,
      hands: Array.from({ length: 8 }, (_, i) => ({ i, side: i < 4 ? 1 : -1, x: mx, y: 3, z: 0, task: null, home: true })),
      searchStart: 0, feinted: false, lastFx: 0,
    };
    this.bc({
      t: 'night', n, quota: cfg.quota, duration: cfg.duration, h: cfg.h, stun: cfg.stun,
      pickups: [...this.pickups.values()], doors: W.doors.map((d) => (d.open ? 1 : 0)),
      destroyed: [...this.broken], spawn,
      players: [...this.players.values()].map((p) => ({ id: p.id, name: p.name, char: p.char, hp: p.hp, ammo: p.ammo, bottles: p.bottles })),
    });
  }

  endNight() {
    for (const p of this.players.values()) {
      if (p.alive && p.zi && p.zi.indoors) p.hp = Math.min(100, p.hp + 40);
      if (!p.alive) p.hp = 60;
    }
    this.m.hands.forEach((h) => { h.task = null; });
    this.minions = [];
    if (this.night >= MAX_NIGHT) return this.gameOver(true);
    this.phase = 'inter'; this.cd = 9;
    this.bc({ t: 'nightEnd', n: this.night, players: [...this.players.values()].map((p) => ({ id: p.id, hp: p.hp, alive: p.alive, safe: !!(p.zi && p.zi.indoors) })) });
  }

  gameOver(win) {
    this.phase = 'over'; this.cd = 12;
    this.bc({ t: 'over', win, night: this.night });
  }
  checkWipe() {
    if (![...this.players.values()].some((p) => p.alive)) this.gameOver(false);
  }

  hurt(p, a, cause) {
    if (!p.alive || a <= 0) return;
    p.hp -= a;
    if (p.hp <= 0) this.kill(p, cause);
    else this.send(p.id, { t: 'hp', hp: Math.round(p.hp), cause });
  }
  kill(p, cause, hand) {
    if (!p.alive) return;
    p.alive = false; p.hp = 0;
    this.bc({ t: 'dead', id: p.id, cause, h: hand });
    if (hand != null) this.wipeT = 9;         // let everyone watch it eat first (cut short once it has swallowed)
    else if (this.wipeT <= 0) this.checkWipe();
  }
  setCloset(c, open) {
    if (c.open === open || c.broken) return;
    c.open = open;
    this.bc({ t: 'closet', id: c.id, open });
  }
  // the closed closet a player is standing inside, if any
  closetOf(p) {
    for (const c of this.W.closets) {
      if (!c.open && p.x > c.x0 - 0.12 && p.x < c.x1 + 0.12 && p.z > c.z0 - 0.12 && p.z < c.z1 + 0.12 && Math.abs(p.y - c.y) < 1) return c;
    }
    return null;
  }
  setDoor(d, open) {
    if (d.open === open || d.broken) return;
    d.open = open;
    this.bc({ t: 'door', id: d.id, open });
  }
  fx(k, x, y, z, extra) {
    this.bc(Object.assign({ t: 'fx', k, x: r2(x), y: r2(y), z: r2(z) }, extra));
  }

  // ------------------------------------------------------------------ tick
  tick(dt) {
    if (this.phase === 'lobby') return;
    if (this.phase === 'inter') {
      this.cd -= dt;
      if (this.cd <= 0) this.startNight(this.night + 1);
      return;
    }
    if (this.phase === 'over') {
      this.cd -= dt;
      if (this.cd <= 0) { this.phase = 'lobby'; this.night = 0; this.m = null; this.bc(this.lobbyMsg()); }
      return;
    }
    this.time += dt;
    this.updatePlayers(dt);
    this.monsterTick(dt);
    this.handsTick(dt);
    this.minionsTick(dt);
    if (this.wipeT > 0) { this.wipeT -= dt; if (this.wipeT <= 0) { this.checkWipe(); if (this.phase === 'over') return; } }
    if (this.phase === 'night') {
      this.tleft -= dt;
      if (this.tleft <= 0) {            // out of time: it starts to simply know
        this.frenzyT -= dt;
        if (this.frenzyT <= 0) {
          this.frenzyT = 12;
          const alive = [...this.players.values()].filter((p) => p.alive);
          if (alive.length) this.reveal(alive[(this.R() * alive.length) | 0]);
        }
      }
      if (this.stars >= this.cfg.quota) { this.phase = 'dawn'; this.cd = 15; this.bc({ t: 'dawn', cd: 15 }); }
    } else if (this.phase === 'dawn') {
      this.cd -= dt;
      if (this.cd <= 0) return this.endNight();
    }
    this.snapT -= dt;
    if (this.snapT <= 0) { this.snapT = 0.1; this.bc(this.snapshot()); }
  }

  snapshot() {
    const m = this.m;
    return {
      t: 's', ph: this.phase, tl: Math.max(0, Math.round(this.tleft)), cd: Math.ceil(this.cd), stars: this.stars,
      p: [...this.players.values()].map((p) => [p.id, r2(p.x), r2(p.y), r2(p.z), r2(p.ry), p.fl, Math.round(p.hp), p.alive ? 1 : 0, p.ammo, r2(p.expo || 0), p.bottles || 0]),
      m: {
        x: r2(m.x), z: r2(m.z), d: m.dir, st: m.st, h: m.h, pk: m.peek || 0, ps: m.st === 'eat' ? m.eatSide : m.peekSide || 0, fast: m.fast ? 1 : 0,
        // [1, tip xyz, then the point the arm is threaded through (the opening it came in by)]
        hands: m.hands.map((h) => (h.task ? [1, r2(h.x), r2(h.y), r2(h.z), ...(h.via || [])] : 0)),
      },
      mn: this.minions.map((q) => [q.id, r2(q.x), r2(q.y), r2(q.z), r2(q.ry), q.st === 'chase' ? 1 : 0, Math.round(q.life)]),
    };
  }

  updatePlayers(dt) {
    const W = this.W;
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      p.vx = p.vx * 0.8 + ((p.x - p.lx) / dt) * 0.2; p.lx = p.x;
      const z = p.zi = zoneAt(W, p.x, p.y, p.z);
      p.hid = z.kind === 'flat' ? this.closetOf(p) : null;
      if (z.key !== p.zone) {
        // going back to the zone you just left does not shake it off
        if (z.key !== p.prevZone) p.expo = 0;
        p.prevZone = p.zone; p.zone = z.key;
      }
      if (this.phase !== 'night' || this.time < 10) continue;
      if (z.kind === 'flat') this.heat.set(z.key, (this.heat.get(z.key) || 0) + dt);
      p.expo += dt / EXPOSE_TIME;
      if (p.expo >= 1) { p.expo = 0; this.reveal(p); }
    }
  }

  // ------------------------------------------------------------------ senses
  stimAt(x, y, z, s, aware, p) {
    const zi = zoneAt(this.W, x, y, z);
    return { x, y, z, s, t: this.time, pid: p ? p.id : null, aware, kind: zi.kind, flat: zi.flat, b: zi.b, f: zi.f, key: zi.key };
  }

  noise(x, y, z, r, p) {
    const m = this.m, cfg = this.cfg;
    if (!m || (this.phase !== 'night' && this.phase !== 'dawn')) return;
    const d = Math.hypot(x - m.x, z - m.z, (y - m.h * 0.8) * 0.5), eff = r * cfg.hearing;
    if (d > eff) return;
    const s = (0.35 + 0.65 * (1 - d / eff)) * Math.min(1.6, r / 14);
    const st = this.stimAt(x, y, z, s, Math.min(0.95, 0.7 + 0.025 * cfg.n), p);
    m.stims.push(st);
    if (m.stims.length > 24) m.stims.shift();
    // a hand already inside that flat homes in on the sound
    for (const h of m.hands) if (h.task && h.task.type === 'search' && h.task.flat.key === st.key) h.task.aware = Math.max(h.task.aware, 0.9);
  }

  bestStim() {
    const m = this.m, mem = this.cfg.memory;
    let best = null, bs = 0.3;
    m.stims = m.stims.filter((s) => this.time - s.t < mem * 2);
    for (const s of m.stims) {
      const sc = s.s * Math.exp(-(this.time - s.t) / mem);
      if (sc > bs) { bs = sc; best = s; }
    }
    return best;
  }

  outdoors(p) {
    const z = p.zi, m = this.m;
    if (!z) return false;
    if (z.kind === 'street' || z.balc) return true;
    if (z.kind === 'roof') return z.flat.y0 <= m.h + 1;
    return z.kind === 'flat' && z.flat.destroyed && Math.abs(p.z) - K.FRONT < 3;
  }
  sees(p) {
    const m = this.m, cfg = this.cfg;
    if (!p.alive || p.hid || !this.outdoors(p)) return false;
    let range = cfg.view;
    if (p.fl & 4) range *= 1.6;                 // flashlight on
    if ((p.fl & 1) && !(p.fl & 8)) range *= 0.45; // crouched and still
    if (p.fl & 2) range *= 1.2;                 // sprinting
    if ((p.x - m.x) * m.dir < -4) range *= 0.4; // behind its back
    return Math.hypot(p.x - m.x, p.z - m.z) < range;
  }

  reveal(p) {
    const m = this.m;
    this.send(p.id, { t: 'alert', k: 'reveal' });
    this.fx('roar', m.x, m.h, m.z);
    const g = this.stimAt(p.x, p.y, p.z, 2, 1, p);
    if (m.st === 'stun') { m.stims.push(g); return; }
    this.retractAll();
    m.feinted = false;
    if (this.outdoors(p)) { m.st = 'hunt'; m.huntId = p.id; m.huntForce = this.time + 6; } else { m.st = 'investigate'; m.goal = g; m.t = 0; }
  }

  stunMonster(p) {
    const m = this.m;
    if (m.st === 'stun' || m.immune > 0) return;
    m.st = 'stun'; m.stunT = this.cfg.stun; m.rage = this.stimAt(p.x, p.y, p.z, 2, 1, p);
    this.retractAll();
    this.bc({ t: 'stun', d: this.cfg.stun, by: p.id });
  }

  // ------------------------------------------------------------------ the monster's mind
  monsterTick(dt) {
    const m = this.m, cfg = this.cfg, W = this.W, R = this.R;
    m.immune -= dt; m.smashCd -= dt; m.t += dt;
    m.z += (Math.sin(this.time * 0.23) * 1.4 - m.z) * Math.min(1, dt);
    m.fast = m.st === 'hunt' || (m.st === 'investigate' && m.goal && m.goal.aware >= 1);
    {   // its body is solid: cables snap across its chest, and what its feet land on is crushed
      const sc = m.h / 10;
      for (const e of W.streetBrk) {
        if (e.gone) continue;
        if (e.kind === 'cable') { if (Math.abs((e.x0 + e.x1) / 2 - m.x) < 1.2 && e.y0 < m.h * 0.97) this.breakGroup(e, m.x, e.y0, m.z, m.dir, 0, 0); continue; }
        if (m.x + 0.9 * sc > e.x0 && m.x - 0.9 * sc < e.x1 && m.z + 1.5 * sc > e.z0 && m.z - 1.5 * sc < e.z1)
          this.breakGroup(e, clamp(m.x, e.x0, e.x1), 0.8, clamp(m.z, e.z0, e.z1), m.dir, 0.5, 0);
      }
    }

    if (m.st === 'stun') {
      m.stunT -= dt;
      if (m.stunT <= 0) {
        m.immune = 3.5; m.feinted = false;
        const g = m.rage; m.rage = null;
        this.fx('roar', m.x, m.h, m.z);
        this.summon('rage');
        if (g && g.flat && !g.flat.roof && !g.flat.destroyed && R() < 0.6 && Math.abs(g.flat.cx - m.x) < 14) this.startSmash(g.flat);
        else if (g) { m.st = 'investigate'; m.goal = g; m.t = 0; } else this.listen(1);
      }
      return;
    }

    m.think -= dt;
    if (m.think <= 0) { m.think = 0.35; this.think(); }

    const go = (tx, sp) => {
      const d = tx - m.x;
      if (Math.abs(d) < 0.3) return true;
      m.dir = d > 0 ? 1 : -1;
      m.x = clamp(m.x + m.dir * Math.min(Math.abs(d), sp * dt), 5, W.L - 5);
      return false;
    };

    switch (m.st) {
      case 'roam':
        if (go(m.tx, cfg.speed) || m.t > 30) this.listen(1.5 + R() * 2.5);
        break;
      case 'listen':
        if (m.t >= m.wait) this.afterListen();
        break;
      case 'investigate':
        if (!m.goal) { this.listen(1); break; }
        // it hurries to a sound, and charges when it knows exactly where someone is
        if (Math.abs(m.goal.x - m.x) < 2.5 || go(clamp(m.goal.x, 5, W.L - 5), m.goal.aware >= 1 ? cfg.hunt : cfg.alert) || m.t > 25) this.beginSearch(m.goal);
        break;
      case 'search':
        if (this.time > m.searchEnd && !m.hands.some((h) => h.task && h.task.type !== 'retract')) {
          const g = m.goal;
          m.stims = m.stims.filter((s) => s.t > m.searchStart);
          if (cfg.feints && g && g.flat && !m.feinted && R() < 0.45) {
            m.feinted = true; m.st = 'feint'; m.t = 0;
            m.feint = { goal: Object.assign({}, g, { aware: 0.6 }), tx: clamp(m.x + (R() < 0.5 ? -1 : 1) * 14, 5, W.L - 5) };
          } else this.listen(1 + R() * 2);
        }
        break;
      case 'feint':   // pretend to lose interest, then come straight back
        if (go(m.feint.tx, cfg.speed) || m.t > 8) { m.st = 'investigate'; m.goal = m.feint.goal; m.t = 0; }
        break;
      case 'hunt': {
        const p = this.players.get(m.huntId);
        if (!p) { this.listen(1); break; }
        const lead = cfg.predicts ? clamp(p.vx, -7, 7) * 0.8 : 0;
        const tx = p.x + lead, d = tx - m.x;
        if (Math.abs(d) > 3) go(tx - Math.sign(d) * 2.5, cfg.hunt); else m.dir = d >= 0 ? 1 : -1;
        break;
      }
      case 'eat':
        if (!m.hands.some((h) => h.task && h.task.type === 'eat') || m.t > 6) this.listen(1.5);
        break;
      case 'smash':
        break;   // driven by the smashing hand
    }
  }

  listen(wait) { const m = this.m; m.st = 'listen'; m.t = 0; m.wait = wait; m.goal = null; }

  pickRoam() {
    const m = this.m, cfg = this.cfg, W = this.W, R = this.R;
    const alive = [...this.players.values()].filter((p) => p.alive);
    const r = R();
    let tx;
    if (r < 0.5) {                                                              // its round: the whole street, end to end
      if (m.x > W.L - 12) m.patrol = -1; else if (m.x < 12) m.patrol = 1;
      tx = m.x + m.patrol * (14 + R() * 24);
    } else if (r < 0.58) { m.patrol = -m.patrol; tx = m.x + m.patrol * (10 + R() * 20); }   // doubles back
    else if (r < 0.78 + 0.02 * cfg.n && alive.length) {                         // vague sense of the living
      const p = alive[(R() * alive.length) | 0];
      tx = p.x + (R() * 2 - 1) * (32 - 2 * cfg.n);
    } else if (cfg.usesHeat && this.heat.size) {                                 // remembered hiding places
      const top = [...this.heat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
      const key = top[(R() * top.length) | 0][0];
      const f = W.flats.find((q) => q.key === key);
      tx = f ? f.cx : R() * W.L;
    } else tx = R() * W.L;
    m.tx = clamp(tx, 6, W.L - 6); m.st = 'roam'; m.t = 0; m.goal = null;
  }

  afterListen() {
    const m = this.m, cfg = this.cfg, R = this.R;
    // on the first nights it is too short for the top floors and terraces, so it lashes out at them blindly
    if (cfg.n <= 2 && m.smashCd <= 0 && R() < 0.5) {
      const c = this.W.flats.filter((f) => !this.reachable(f) && !f.destroyed && Math.abs(f.cx - m.x) < 13);
      if (c.length) { m.smashCd = 35 + R() * 30; return this.startSmash(c[(R() * c.length) | 0]); }
    }
    if (R() < 0.3 + 0.05 * cfg.n) return this.beginSearch(null);
    this.pickRoam();
  }

  think() {
    const m = this.m, R = this.R;
    if (m.st === 'smash' || m.st === 'eat') return;
    // sight
    let seen = null, bd = 1e9;
    for (const p of this.players.values()) {
      if (!this.sees(p)) continue;
      const d = Math.abs(p.x - m.x);
      if (d < bd) { bd = d; seen = p; }
    }
    if (m.st === 'hunt') {
      const p = this.players.get(m.huntId);
      const still = p && p.alive && (this.sees(p) || this.time < m.huntForce);
      if (!still) {
        if (seen) m.huntId = seen.id;
        else if (p && p.alive) { m.st = 'investigate'; m.t = 0; m.goal = this.stimAt(p.x, p.y, p.z, 1.5, 0.85, p); m.feinted = false; }
        else this.listen(1.5);
      }
      if (m.st === 'hunt') this.huntHands(this.players.get(m.huntId));
      return;
    }
    if (seen) {
      this.retractAll('search');
      m.st = 'hunt'; m.huntId = seen.id; m.huntForce = this.time + 1.5;
      this.fx('spot', m.x, m.h, m.z);
      return;
    }
    // a lit torch near a window gives you away
    for (const p of this.players.values()) {
      if (p.alive && (p.fl & 4) && p.zi && p.zi.kind === 'flat' && Math.abs(p.z) - K.FRONT < 3.2 && Math.abs(p.x - m.x) < 14 && R() < 0.2)
        m.stims.push(this.stimAt(p.x, p.y, p.z, 0.7, 0.7, p));
    }
    // sound
    const b = this.bestStim();
    if (!b) {
      if (m.st === 'roam' && R() < 0.05) this.pickRoam();   // changes its mind mid-stride
      return;
    }
    const busy = m.st === 'search' || m.st === 'investigate';
    if (busy && m.goal && (b === m.goal || b.t <= m.searchStart)) return;
    if (m.st === 'search' && (this.time - m.searchStart < 2 || (m.goal && b.key === m.goal.key))) return;
    if (m.st === 'investigate' && m.goal && b.s <= m.goal.s * 1.1) return;
    if (m.st === 'search') this.retractAll();
    m.st = 'investigate'; m.goal = b; m.t = 0; m.feinted = false;
  }

  reachable(f) { return f.y0 + 1.2 <= this.m.h - 0.5; }

  freeHand(side, y) {
    const m = this.m;
    let best = null, bd = 1e9;
    for (const h of m.hands) {
      if (h.side !== side || h.task) continue;
      const d = Math.abs(shoulder(m, h.i).y - y);
      if (d < bd) { bd = d; best = h; }
    }
    return best;
  }
  activeHands() { return this.m.hands.filter((h) => h.task && h.task.type !== 'retract').length; }
  retractAll(only) {
    for (const h of this.m.hands) if (h.task && h.task.type !== 'eat' && h.task.type !== 'retract' && (!only || h.task.type === only)) h.task = this.retractTask(h);
  }
  // send a hand out. One that is folded at the shoulder starts from there; one that is already out
  // (a chasing hand following someone in through a door) carries on from where it is instead of snapping back
  launch(h) {
    if (!h.task && h.home !== false) { const s = shoulder(this.m, h.i); h.x = s.x; h.y = s.y - 1; h.z = s.z + h.side; }
    h.home = false;
  }

  searchFlat(flat, aware, dur, near) {
    const m = this.m;
    if (this.activeHands() >= this.cfg.hands) return false;
    if (m.hands.some((h) => h.task && h.task.flat === flat)) return false;
    const h = this.freeHand(flat.side, flat.y0 + 1.5);
    if (!h) return false;
    // enter through the opening closest to what it heard
    let op = flat.opens[(this.R() * flat.opens.length) | 0];
    if (near) for (const o of flat.opens) if (Math.abs(o.x - near.x) < Math.abs(op.x - near.x)) op = o;
    this.launch(h);
    h.task = {
      type: 'search', flat, aware, end: this.time + dur, ph: 0, wp: null, wpT: 0, track: null, op, blk: null,
      out: { x: op.x, y: op.y, z: op.z - flat.side * 1.2 }, in: { x: op.x, y: op.y, z: op.z + flat.side * 0.7 },
    };
    return true;
  }

  // one landing of a stairwell, as something a hand can be sent into: through the street door on the
  // ground floor, through the wall of the landing (which it has to break) higher up
  stairAt(b, f) {
    const st = Object.assign({}, b.stair, { y0: f * K.FH, brk: [] });
    if (f >= 1) {
      const g = `sw${b.id}_${f}`, e = this.W.brk[g], o = b.stair.opens[0];
      st.opens = [{ x: o.x, y: f * K.FH + 1.7, z: o.z, g }]; st.entryG = g;
      if (e) st.brk = [e];
    }
    return st;
  }

  beginSearch(goal) {
    const m = this.m, cfg = this.cfg, W = this.W, R = this.R;
    m.st = 'search'; m.t = 0; m.goal = goal; m.searchStart = this.time;
    const dur = 4 + R() * 3 + cfg.n * 0.25;
    m.searchEnd = this.time + dur + 1;
    const reachX = 4 + 0.25 * m.h;
    if (goal) {
      if (goal.kind === 'street') {
        const side = goal.z >= 0 ? 1 : -1;
        const pseudo = {
          key: 'street', street: true, roof: true, side, y0: 0, cx: goal.x, brk: W.streetBrk,
          rooms: [{ x0: goal.x - 5, x1: goal.x + 5, z0: -7.4, z1: 7.4, front: true }],
          opens: [{ x: goal.x, y: 2.6, z: side * 3 }],
        };
        this.searchFlat(pseudo, goal.aware, dur);
      } else if (goal.flat) {
        if (this.reachable(goal.flat)) this.searchFlat(goal.flat, goal.aware, dur + 1.5, goal);
        else if (!goal.flat.destroyed || goal.flat.roof) return this.startSmash(goal.flat);
      } else if (goal.kind === 'stair' && goal.b && goal.aware >= 0.85) {
        // it knows someone is in the stairwell: an arm goes in after them,
        // or, if they are higher than it can reach, it beats on the building until the wall comes down
        const st = this.stairAt(goal.b, goal.f);
        if (this.reachable(st)) this.searchFlat(st, goal.aware, dur + 2, goal);
        else return this.startSmash(st);
      } else if (goal.kind === 'stair' && goal.b) {
        // only a noise: rake the flats that open onto that landing
        for (const f of goal.b.flats) if (Math.abs(f.f - goal.f) <= 1 && this.reachable(f)) this.searchFlat(f, 0.3, dur);
      }
    }
    const cands = W.flats.filter((f) => Math.abs(f.cx - m.x) < reachX && this.reachable(f))
      .map((f) => ({ f, s: R() + (cfg.usesHeat ? Math.min(1, (this.heat.get(f.key) || 0) / 60) : 0) + (goal && Math.abs(f.cx - goal.x) < 8 ? 0.4 : 0) }))
      .sort((a, b) => b.s - a.s);
    for (const c of cands) {
      if (this.activeHands() >= cfg.hands) break;
      this.searchFlat(c.f, cfg.aware, dur * (0.6 + R() * 0.4));
    }
  }

  huntHands(p) {
    const m = this.m, cfg = this.cfg;
    if (!p || !p.alive) return;
    const armMax = m.h * 0.9 + 5;
    if (Math.hypot(p.x - m.x, p.z - m.z) > armMax + 2) return;
    const want = 1 + Math.floor(cfg.n / 4);
    let have = m.hands.filter((h) => h.task && h.task.type === 'chase' && h.task.pid === p.id).length;
    while (have < want) {
      const side = Math.abs(p.z) < 1.5 ? (have % 2 ? -1 : 1) : (p.z > 0 ? 1 : -1);
      const h = this.freeHand(side, p.y + 2) || this.freeHand(-side, p.y + 2);
      if (!h) break;
      this.launch(h);
      h.task = { type: 'chase', pid: p.id, end: this.time + 7 };
      have++;
    }
  }

  startSmash(flat) {
    const m = this.m;
    this.retractAll();
    const h = m.hands.find((q) => q.side === flat.side && q.i % 4 === 3 && (!q.task || q.task.type !== 'eat')) || m.hands[0];
    const op = flat.opens[0], y = flat.roof && !flat.stair ? flat.y0 + 0.5 : flat.y0 + 1.6;
    if (h.home !== false) { const s = shoulder(m, h.i); h.x = s.x; h.y = s.y; h.z = s.z; }
    h.home = false;
    h.task = { type: 'smash', flat, ph: 0, hit: { x: flat.cx, y, z: op.z }, back: { x: flat.cx, y: y + 1.5, z: op.z - flat.side * 4.5 } };
    m.st = 'smash'; m.t = 0; m.goal = null;
    this.fx('windup', flat.cx, y, op.z);
  }

  // Break pieces of the world. Every client turns the named groups' real parts into rubble.
  breakMany(list, kind, x, y, z, dx, dy, dz, extra) {
    const gs = [], W = this.W;
    const mark = (q) => {
      if (!q || q.gone) return;
      q.gone = true; this.broken.add(q.g); gs.push(q.g);
      if (q.door != null) { const d = W.doors[q.door]; d.broken = true; d.open = true; }
      if (q.closet != null) { const c = W.closets[q.closet]; c.broken = true; c.open = true; }
      for (const sgk of q.sub || []) mark(W.brk[sgk]);
    };
    for (const e of list) mark(e);
    if (!gs.length) return false;
    this.bc(Object.assign({ t: 'brk', gs, k: kind, x: r2(x), y: r2(y), z: r2(z), d: [r2(dx), r2(dy), r2(dz)] }, extra));
    return true;
  }
  breakGroup(e, x, y, z, dx, dy, dz) {
    if (!this.breakMany([e], e.kind, x, y, z, dx, dy, dz)) return;
    // flying masonry hurts whoever is standing next to it
    if (e.kind === 'facade' || e.kind === 'wall' || e.kind === 'door' || e.kind === 'stairwall')
      for (const p of this.players.values()) if (p.alive && Math.hypot(p.x - x, p.z - z) < 2 && Math.abs(p.y + 0.9 - y) < 1.8) this.hurt(p, 10, 'debris');
  }

  doSmash(flat) {
    const m = this.m, op = flat.opens[0], W = this.W;
    const list = flat.stair ? (flat.entryG ? [W.brk[flat.entryG]] : []) : (flat.gs || []).map((g) => W.brk[g]);
    const y = flat.y0 + (flat.roof && !flat.stair ? 0.6 : 1.6);
    if (!flat.stair) flat.destroyed = true;
    if (!this.breakMany(list, 'smash', flat.cx, y, op.z, 0, 0.3, flat.side, { big: 1, f: flat.stair ? -1 : flat.id }))
      this.bc({ t: 'brk', gs: [], k: 'smash', big: 1, x: r2(flat.cx), y: r2(y), z: r2(op.z), d: [0, 0.3, flat.side] });
    for (const p of this.players.values()) {
      if (!p.alive || p.zone !== flat.key) continue;
      if (flat.roof) this.hurt(p, flat.stair || Math.abs(p.z - op.z) < 5 ? 35 : 15, 'debris');
      else this.hurt(p, Math.abs(p.z) - K.FRONT < 4 ? 40 : 20, 'debris');
    }
    m.smashCd = Math.max(m.smashCd, 25);
  }

  // Keep a target point inside the flat (or on the terrace / landing) being searched.
  limit(h, flat, pos) {
    if (flat.roof) {
      const r = flat.rooms[0];
      pos.x = clamp(pos.x, r.x0, r.x1); pos.z = clamp(pos.z, r.z0, r.z1);
      if (flat.stair) pos.y = Math.min(pos.y, this.m.h + 1.5);
      return;
    }
    pos.x = clamp(pos.x, flat.x0 + 0.3, flat.x1 - 0.3);
    pos.z = flat.side * clamp(Math.abs(pos.z), K.FRONT - 1.2, K.FRONT + K.BD - 0.4);
  }

  inFlat(p, flat) {
    if (flat.street) return p.zi && p.zi.kind === 'street' && Math.abs(p.x - flat.cx) < 9;
    return p.zone === flat.key;
  }

  pickWp(h) {
    const t = h.task, flat = t.flat, R = this.R;
    t.track = null; t.wpT = this.time + 1.8;
    for (const p of this.players.values()) {
      if (!p.alive || !this.inFlat(p, flat)) continue;
      if (p.hid && t.aware < 0.85) continue;          // shut in a closet: a blind hand passes over it
      const hidden = (p.fl & 1) && !(p.fl & 8);       // crouched and still
      if (R() < t.aware * (hidden ? 0.4 : 1)) { t.track = p.id; break; }
    }
    if (t.track) return;
    // a hand that is only feeling around mostly stays in the room it is in
    const rooms = flat.rooms, here = rooms.find((r) => h.x >= r.x0 && h.x <= r.x1 && h.z >= r.z0 && h.z <= r.z1) || rooms[0];
    const room = R() < 0.55 ? here : rooms[(R() * rooms.length) | 0];
    t.wp = { x: room.x0 + R() * (room.x1 - room.x0), y: flat.y0 + 0.4 + R() * 1.1, z: room.z0 + R() * (room.z1 - room.z0) };
    if (flat.balc && R() < 0.15) t.wp = { x: (flat.balc.x0 + flat.balc.x1) / 2, y: flat.y0 + 0.9, z: flat.side * (K.FRONT - 0.7) };
    this.limit(h, flat, t.wp);
  }

  // Move a hand towards a point, colliding with what is in its way. Furniture, glass and street
  // clutter are smashed aside. A wall or a shut door stops it: it strains, draws back, then
  // punches through. `force` skips the drawing back (a fist already at full swing).
  stepHand(h, goal, sp, dt, list, force) {
    const t = h.task, cfg = this.cfg, W = this.W, r = cfg.handR;
    let gx = goal.x, gy = goal.y, gz = goal.z;
    const b = t.blk;
    if (b) {
      b.t += dt;
      if (b.ph === 0) {
        if (b.t < cfg.breakDelay) {
          const push = b.t < cfg.breakDelay * 0.4, tgt = push ? b.at : b.back;
          gx = tgt.x; gy = tgt.y; gz = tgt.z; sp *= push ? 0.25 : 1.3; list = null;
        } else { b.ph = 1; b.t = 0; this.fx('lunge', h.x, h.y, h.z); }
      }
      if (b.ph === 1) { sp *= 3; force = true; if (b.t > 0.7) t.blk = null; }
    }
    let dx = gx - h.x, dy = gy - h.y, dz = gz - h.z;
    const d = Math.hypot(dx, dy, dz);
    if (d < 1e-4) return;
    const k = Math.min(1, (sp * dt) / d), nx = h.x + dx * k, ny = h.y + dy * k, nz = h.z + dz * k;
    dx /= d; dy /= d; dz /= d;
    if (list) for (const e of list) {
      if (e.gone) continue;
      const kd = e.kind;
      if (kd === 'furn' || kd === 'closet' || kd === 'glass' || kd === 'street' || kd === 'cable') {
        if (!sphereBox(e, nx, ny, nz, r)) continue;
        if (kd === 'closet' && t.aware < 0.85) {       // someone is shut inside and it does not know: it slides past
          const c = W.closets[e.closet];
          if ([...this.players.values()].some((p) => p.alive && p.hid === c)) continue;
        }
        this.breakGroup(e, nx, ny, nz, dx, dy, dz);
        continue;
      }
      if (kd === 'door' && W.doors[e.door].open) continue;
      if (kd === 'facade' && e.open !== undefined && !cfg.bigHands) continue;   // a small hand fits through the window
      const ht = segBox(e, h.x, h.y, h.z, nx, ny, nz, r * 0.4);
      if (ht >= 0) {
        if (force) { this.breakGroup(e, h.x + (nx - h.x) * ht, h.y + (ny - h.y) * ht, h.z + (nz - h.z) * ht, dx, dy, dz); continue; }
        if (!t.blk) {
          t.blk = { ph: 0, t: 0, at: { x: h.x, y: h.y, z: h.z }, back: { x: h.x - dx * 1.8, y: h.y - dy * 1.8 + 0.2, z: h.z - dz * 1.8 } };
          this.fx('bang', nx, ny, nz);
        }
        return;
      }
      // the forearm sweeping sideways through a wall tears it out
      if (t.arm) {
        const at = segBox(e, t.arm.x, t.arm.y, t.arm.z, nx, ny, nz, 0.05);
        if (at >= 0) this.breakGroup(e, t.arm.x + (nx - t.arm.x) * at, t.arm.y + (ny - t.arm.y) * at, t.arm.z + (nz - t.arm.z) * at, dx, dy, dz);
      }
    }
    h.x = nx; h.y = ny; h.z = nz;
  }

  // how a hand leaves: back out through the opening it came in by, never through the wall
  retractTask(h) {
    const t = h.task;
    if (t && t.type === 'search' && t.ph >= 1 && t.ph <= 3 && !t.flat.street && !(t.flat.roof && !t.flat.stair))
      return { type: 'retract', path: [t.in, t.out], flat: t.flat, op: t.op, blk: null };
    return { type: 'retract', path: [], blk: null };
  }

  // a hand has closed on someone: carry them out and up to the face
  grab(h, p) {
    const m = this.m, t = h.task, inside = t.type === 'search' && !t.flat.street && !(t.flat.roof && !t.flat.stair);
    const side = t.flat && !t.flat.street ? t.flat.side : (p.z >= m.z ? 1 : -1);
    this.kill(p, 'hand', h.i);
    this.retractAll();
    h.task = { type: 'eat', pid: p.id, t: 0, ph: 0, side, path: inside ? [t.in, t.out] : [], flat: inside ? t.flat : null, op: inside ? t.op : null, blk: null, hold: 0 };
    m.st = 'eat'; m.t = 0; m.eatSide = side;
  }

  handsTick(dt) {
    const m = this.m, cfg = this.cfg, W = this.W, sc = m.h / 10;
    const sh = {};
    m.peek = 0;
    if (m.st === 'search') for (const h of m.hands) {
      const t = h.task;
      if (t && t.type === 'search' && !t.flat.street && t.ph >= 1 && (!m.peek || t.aware > 0.5)) { m.peek = r2(t.flat.y0 + 1.5); m.peekSide = t.flat.side; }
    }
    for (const h of m.hands) {
      const t = h.task;
      if (!t) continue;
      shoulder(m, h.i, sh);
      let goal = sh, sp = cfg.handSpeed, lethal = false, flat = null, list = null, force = false;
      const at = (g, r = 0.35) => Math.hypot(g.x - h.x, g.y - h.y, g.z - h.z) < r;

      if (t.type === 'search') {
        flat = t.flat; list = flat.brk || null;
        t.arm = t.ph >= 2 && t.ph <= 3 && !flat.street && !(flat.roof && !flat.stair) ? t.in : null;
        if (t.ph === 0) { goal = t.out; sp *= 1.6; list = flat.street ? list : null; if (at(goal, 0.5)) t.ph = 1; }
        else if (t.ph === 1) { goal = t.in; lethal = true; if (at(goal)) { t.ph = 2; this.pickWp(h); this.fx('reach', h.x, h.y, h.z); } }
        else if (t.ph === 2) {
          lethal = true;
          if (this.time > t.end && !t.blk) t.ph = 3;
          else {
            if (t.track) {
              const p = this.players.get(t.track);
              if (p && p.alive && this.inFlat(p, flat)) { t.wp = { x: p.x, y: p.y + 0.8, z: p.z }; this.limit(h, flat, t.wp); } else t.track = null;
            }
            if (!t.wp || (this.time > t.wpT && !t.blk) || (!t.track && at(t.wp))) this.pickWp(h);
            goal = t.wp || t.in;
          }
        } else if (t.ph === 3) { goal = t.in; lethal = true; force = true; if (at(goal, 0.5)) t.ph = 4; }
        else if (t.ph === 4) { goal = t.out; sp *= 1.4; list = null; if (at(goal, 0.6)) h.task = { type: 'retract', path: [], blk: null }; }
      } else if (t.type === 'chase') {
        const p = this.players.get(t.pid);
        if (!p || !p.alive || this.time > t.end) h.task = { type: 'retract', path: [], blk: null };
        else if (!this.outdoors(p)) {
          // followed them to the door: go in after them if it can
          h.task = null;
          const f = p.zi && p.zi.flat;
          if (!(f && !f.roof && this.reachable(f) && this.searchFlat(f, 0.9, 5, p))) h.task = { type: 'retract', path: [], blk: null };
        } else {
          sp *= 1.25; lethal = true; list = W.streetBrk; force = true;
          const g = { x: p.x, y: p.y + 0.8, z: p.z };
          const d = Math.hypot(g.x - sh.x, g.y - sh.y, g.z - sh.z), mx = m.h * 0.9 + 5;
          if (d > mx) { const k = mx / d; g.x = sh.x + (g.x - sh.x) * k; g.y = sh.y + (g.y - sh.y) * k; g.z = sh.z + (g.z - sh.z) * k; }
          goal = g;
        }
      } else if (t.type === 'smash') {
        if (t.ph === 0) { goal = t.back; sp = 9; if (at(goal, 0.6) || m.t > 2.2) t.ph = 1; }
        else { goal = t.hit; sp = 30; if (at(goal, 0.8)) { this.doSmash(t.flat); h.task = { type: 'retract', path: [], blk: null }; this.listen(1.5); } }
      } else if (t.type === 'eat') {
        // out the way it came in, up in front of the face, a moment to look, then into the mouth
        t.t += dt; sp = Math.max(6.5, m.h * 0.6);
        if (t.path.length) { goal = t.path[0]; list = t.flat && t.flat.brk; force = true; if (at(goal, 0.6)) t.path.shift(); }
        else if (t.ph === 0) {
          goal = { x: m.x, y: m.h * 0.84, z: m.z + t.side * 2.5 * sc };
          if (at(goal, 0.8) || t.t > 6) { t.ph = 1; t.hold = this.time + 1.0; }
        } else if (t.ph === 1) {
          goal = { x: m.x, y: m.h * 0.84, z: m.z + t.side * 2.5 * sc };
          if (this.time > t.hold) t.ph = 2;
        } else if (t.ph === 2) {
          goal = { x: m.x, y: m.h * 0.9, z: m.z + t.side * 0.95 * sc }; sp *= 0.6;
          if (at(goal, 0.5) || this.time > t.hold + 2) { t.ph = 3; t.hold = this.time + 0.9; this.bc({ t: 'eaten', id: t.pid }); this.wipeT = Math.min(this.wipeT, 1.6); }
        } else { goal = { x: m.x, y: m.h * 0.9, z: m.z + t.side * 0.95 * sc }; if (this.time > t.hold) h.task = { type: 'retract', path: [], blk: null }; }
      } else if (t.type === 'retract') {
        sp *= 1.8;
        if (t.path.length) { goal = t.path[0]; list = t.flat && t.flat.brk; force = true; if (at(goal, 0.6)) t.path.shift(); }
        else if (at(sh, 0.8)) { h.task = null; h.via = null; h.home = true; continue; }
      }
      if (!h.task) { h.via = null; continue; }
      const k = h.task;
      // while the hand is inside, the arm is threaded through the opening it used
      const threaded = (k.type === 'search' && k.ph >= 1 && k.ph <= 3 && !flat.street && !(flat.roof && !flat.stair)) || ((k.type === 'eat' || k.type === 'retract') && k.path.length > 0 && k.op);
      h.via = threaded ? [r2(k.op.x), r2(k.op.y), r2(k.op.z)] : null;

      this.stepHand(h, goal, sp, dt, list, force);

      if (!lethal || h.task !== k) continue;
      for (const p of this.players.values()) {
        if (!p.alive || p.hid) continue;
        if (flat ? !this.inFlat(p, flat) : !this.outdoors(p)) continue;
        if (Math.hypot(p.x - h.x, p.z - h.z) < 0.9 && Math.abs(p.y + 0.8 - h.y) < 1.3) { this.grab(h, p); break; }
      }
    }
  }

  // ------------------------------------------------------------------ minions ("crawlers")
  // Called up by the monster: they come in through a street door and hunt through stairwells and flats.
  summon(why) {
    const cfg = this.cfg, m = this.m, R = this.R;
    if (!cfg.minions || this.summonCd > 0 || this.phase !== 'night') return;
    const alive = [...this.players.values()].filter((p) => p.alive);
    if (!alive.length) return;
    this.summonCd = 45; this.summonT = 80;
    for (let i = 0; i < cfg.minions; i++) {
      const p = alive[(R() * alive.length) | 0];
      const b = (p.zi && p.zi.b) || this.W.buildings[clamp(Math.floor(p.x / K.BW), 0, K.NB - 1) * 2 + (p.z >= 0 ? 0 : 1)];
      const n0 = b.nav.n[1];   // the street door
      this.minions.push({ id: this.nextMinion++, b, node: 1, path: [0], x: n0.x, y: n0.y, z: n0.z, ry: 0, life: MINION_LIFE + i * 4, st: 'roam', bite: 1.5, wait: 1.2 + i * 1.5, sniff: new Set() });
    }
    this.bc({ t: 'summon', n: cfg.minions, why });
    this.fx('summon', m.x, m.h, m.z);
  }

  navPath(b, from, to) {
    const prev = new Map([[from, -1]]), q = [from];
    for (let i = 0; i < q.length; i++) {
      const a = q[i];
      if (a === to) break;
      for (const c of b.nav.e[a]) if (!prev.has(c)) { prev.set(c, a); q.push(c); }
    }
    const path = [];
    for (let a = to; a !== from && a !== undefined && a !== -1; a = prev.get(a)) path.unshift(a);
    return path;
  }
  nearestNode(b, x, y, z, pred) {
    let best = -1, bd = 1e9;
    b.nav.n.forEach((n, i) => {
      if (n.street || (pred && !pred(n))) return;
      const d = Math.hypot(n.x - x, (n.y - y) * 2.5, n.z - z);
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  }
  // the node to head for to reach a player: one in the same room if there is one (the nearest node
  // to someone standing against a wall is often on the far side of it, in the next room)
  nodeNear(b, p) {
    const f = p.zi && p.zi.kind === 'flat' ? p.zi.flat : null, ri = f ? this.roomIndex(f, p.x, p.z) : -1;
    if (ri >= 0) {
      const n = this.nearestNode(b, p.x, p.y, p.z, (q) => Math.abs(q.y - p.y) < 1.6 && this.roomIndex(f, q.x, q.z) === ri);
      if (n >= 0) return n;
    }
    return this.nearestNode(b, p.x, p.y, p.z);
  }
  roomIndex(flat, x, z) { return flat && flat.rooms ? flat.rooms.findIndex((r) => x >= r.x0 - 0.2 && x <= r.x1 + 0.2 && z >= r.z0 - 0.2 && z <= r.z1 + 0.2) : -1; }

  minionsTick(dt) {
    const cfg = this.cfg, R = this.R, W = this.W;
    this.summonCd -= dt;
    if (cfg.minions && this.phase === 'night') { this.summonT -= dt; if (this.summonT <= 0) this.summon('time'); }
    for (let i = this.minions.length - 1; i >= 0; i--) {
      const q = this.minions[i], b = q.b;
      q.life -= dt; q.bite -= dt;
      if (q.life <= 0) { this.fx('mdie', q.x, q.y + 0.5, q.z); this.minions.splice(i, 1); continue; }
      if (q.wait > 0) { q.wait -= dt; continue; }
      const zi = zoneAt(W, q.x, q.y + 0.2, q.z), myRoom = this.roomIndex(zi.flat, q.x, q.z);
      // someone in the same room (or the same stairwell)?
      let prey = null, pd = 7.5, nose = null;
      for (const p of this.players.values()) {
        if (!p.alive || !p.zi || p.zi.key !== zi.key || zi.kind === 'street') continue;
        const d = Math.hypot(p.x - q.x, p.z - q.z);
        if (Math.abs(p.y - q.y) > 1.6 || d > pd) continue;
        if (zi.kind === 'flat' && this.roomIndex(zi.flat, p.x, p.z) !== myRoom && d > 1.5) continue;
        if (p.hid) {   // someone shut in a closet in this room: it goes and noses at the doors
          if (!q.sniff.has(p.hid.id)) nose = p.hid;
          continue;
        }
        prey = p; pd = d;
      }
      let tx, ty, tz, sp;
      if (prey) {
        if (q.st !== 'chase') { q.st = 'chase'; this.fx('screech', q.x, q.y + 0.5, q.z); }
        q.path = []; tx = prey.x; ty = prey.y; tz = prey.z; sp = 3.5 + 0.12 * cfg.n;
        if (pd < 1.15 && q.bite <= 0) {
          q.bite = 1.7;
          this.fx('bite', q.x, q.y + 0.5, q.z);
          this.hurt(prey, 30 + cfg.n, 'minion');
          // its shriek carries to the street
          if (this.m) this.m.stims.push(this.stimAt(prey.x, prey.y, prey.z, 1.2, 0.9, prey));
        }
        if (pd < 0.8) sp = 0;
      } else if (nose) {
        // walk up to the closet doors; there, sometimes, it pulls them open
        if (q.st !== 'nose') q.st = 'nose';
        tx = nose.cx + nose.f[0] * 0.6; ty = nose.y; tz = nose.cz + nose.f[1] * 0.6; sp = 2.2 + 0.1 * cfg.n;
        if (Math.hypot(tx - q.x, tz - q.z) < 0.45) {
          q.sniff.add(nose.id); q.wait = 0.8;
          if (R() < 0.45) { this.setCloset(nose, true); this.fx('doorslam', nose.cx, nose.y + 1, nose.cz); }
        }
      } else {
        if (q.st === 'chase' || q.st === 'nose') { q.st = 'roam'; q.node = this.nearestNode(b, q.x, q.y, q.z); q.path = [q.node]; }
        if (!q.path.length) {
          // pick somewhere to go: mostly towards anyone it can smell in this building
          const here = [...this.players.values()].filter((p) => p.alive && p.zi && p.zi.b === b && p.zi.kind !== 'street');
          let to;
          if (here.length && R() < 0.75) { const p = here[(R() * here.length) | 0]; to = this.nodeNear(b, p); }
          else do { to = (R() * b.nav.n.length) | 0; } while (b.nav.n[to].street);
          q.path = this.navPath(b, q.node, to);
          if (!q.path.length) { q.wait = 0.4; continue; }
        }
        const n = b.nav.n[q.path[0]], cur = b.nav.n[q.node];
        for (const d of [n.door, cur.door]) if (d != null && !W.doors[d].open) { this.setDoor(W.doors[d], true); this.fx('doorslam', W.doors[d].cx, W.doors[d].y + 1, W.doors[d].cz); }
        tx = n.x; ty = n.y; tz = n.z; sp = 2.7 + 0.1 * cfg.n;
      }
      const dx = tx - q.x, dy = ty - q.y, dz = tz - q.z, d = Math.hypot(dx, dy, dz);
      if (d > 0.05 && sp > 0) {
        const k = Math.min(1, (sp * dt) / d);
        q.x += dx * k; q.y += dy * k; q.z += dz * k;
        q.ry = Math.atan2(-dx, -dz);
      }
      if (!prey && !nose && d < 0.15) { q.node = q.path.shift(); if (!q.path.length && R() < 0.5) q.wait = 0.5 + R() * 1.5; }
    }
  }
}
