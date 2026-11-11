// Authoritative game simulation for one lobby. Used by the Node server for multiplayer
// and directly inside the browser for solo play (same code, no network).
import { K, genWorld, zoneAt, rng32 } from './world.js';

export const MAX_NIGHT = 10;
export const EXPOSE_TIME = 30;   // seconds in one zone before the monster knows where you are

export function nightCfg(n, np = 1) {
  const speed = 2.5 + 0.3 * n;
  return {
    n,
    h: 6.5 + n,                               // monster height (m)
    speed, hunt: Math.min(8.2, speed * 1.45),
    handSpeed: 3.8 + 0.55 * n,
    hands: Math.min(8, 2 + Math.floor(n * 0.7)),
    hearing: 0.8 + 0.08 * n,
    memory: 6 + 2 * n,                        // how long it remembers a sound
    stun: Math.max(2.5, 7 - 0.45 * n),
    depth: 4 + 0.7 * n,                       // how deep into a flat a hand can reach
    aware: 0.08 + 0.03 * n,                   // chance a blind hand "smells" a hiding player
    view: 16 + 1.5 * n,
    opensDoors: n >= 5, predicts: n >= 3, usesHeat: n >= 4, feints: n >= 6,
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

const r2 = (v) => Math.round(v * 100) / 100;
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
        if (!d || !p.alive || Math.hypot(d.cx - p.x, d.cz - p.z) > 4) break;
        this.setDoor(d, !d.open);
        this.noise(d.cx, d.y, d.cz, 9, p);
        break;
      }
      case 'pick': {
        const k = this.pickups && this.pickups.get(msg.id);
        if (!k || !p.alive || Math.hypot(k.x - p.x, k.z - p.z, k.y - p.y - 0.8) > 3.2) break;
        this.pickups.delete(k.id);
        if (k.k === 'star') this.stars++;
        else if (k.k === 'gun') p.ammo = Math.min(6, p.ammo + 2);
        else if (k.k === 'med') p.hp = Math.min(100, p.hp + 35);
        this.bc({ t: 'pick', id: k.id, by: id, k: k.k });
        if (k.k === 'star') this.noise(p.x, p.y, p.z, 4, p);
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
    this.heat = new Map();
    for (const p of this.players.values()) { p.hp = 100; p.ammo = 0; }
    this.startNight(1);
  }

  startNight(n) {
    const W = this.W, R = this.R;
    this.night = n; this.phase = 'night'; this.time = 0; this.snapT = 0;
    const cfg = this.cfg = nightCfg(n, this.players.size);
    this.tleft = cfg.duration; this.frenzyT = 0; this.stars = 0; this.cd = 0;
    W.doors.forEach((d, i) => { d.open = this.doorInit[i]; });

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
    const nStreet = Math.round(total * 0.3), nBalc = Math.round(total * 0.3), nRoof = Math.round(total * 0.15);
    take(W.spots.street, 'star', nStreet); take(W.spots.balcony, 'star', nBalc); take(W.spots.roof, 'star', nRoof);
    const flatSpots = W.spots.flat.slice();
    const takeFlat = (k, count) => {
      for (let i = 0; i < count && flatSpots.length; i++) {
        const s = flatSpots.splice((R() * flatSpots.length) | 0, 1)[0];
        this.pickups.set(pid, { id: pid, k, x: r2(s.x), y: r2(s.y), z: r2(s.z) }); pid++;
      }
    };
    takeFlat('star', total - nStreet - nBalc - nRoof);
    takeFlat('gun', 2 + Math.ceil(this.players.size / 2));
    takeFlat('med', 2 + Math.floor(this.players.size / 2));
    take(W.spots.street, 'gun', 1);

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
      x: mx, z: 0, dir: mx > sp.x ? -1 : 1, h: cfg.h, st: 'listen', t: 9, tx: mx, think: 0,
      stims: [], goal: null, huntId: null, huntForce: 0, stunT: 0, immune: 0, smashCd: 20 + R() * 20,
      hands: Array.from({ length: 8 }, (_, i) => ({ i, side: i < 4 ? 1 : -1, x: mx, y: 3, z: 0, task: null })),
      searchStart: 0, feinted: false, lastFx: 0,
    };
    this.bc({
      t: 'night', n, quota: cfg.quota, duration: cfg.duration, h: cfg.h, stun: cfg.stun,
      pickups: [...this.pickups.values()], doors: W.doors.map((d) => (d.open ? 1 : 0)),
      destroyed: W.flats.filter((f) => f.destroyed).map((f) => f.id), spawn,
      players: [...this.players.values()].map((p) => ({ id: p.id, name: p.name, char: p.char, hp: p.hp, ammo: p.ammo })),
    });
  }

  endNight() {
    for (const p of this.players.values()) {
      if (p.alive && p.zi && p.zi.indoors) p.hp = Math.min(100, p.hp + 40);
      if (!p.alive) p.hp = 60;
    }
    this.m.hands.forEach((h) => { h.task = null; });
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
  kill(p, cause) {
    if (!p.alive) return;
    p.alive = false; p.hp = 0;
    this.bc({ t: 'dead', id: p.id, cause });
    this.checkWipe();
  }
  setDoor(d, open) {
    if (d.open === open) return;
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
      p: [...this.players.values()].map((p) => [p.id, r2(p.x), r2(p.y), r2(p.z), r2(p.ry), p.fl, Math.round(p.hp), p.alive ? 1 : 0, p.ammo, r2(p.expo || 0)]),
      m: {
        x: r2(m.x), z: r2(m.z), d: m.dir, st: m.st, h: m.h,
        hands: m.hands.map((h) => (h.task ? [1, r2(h.x), r2(h.y), r2(h.z)] : 0)),
      },
    };
  }

  updatePlayers(dt) {
    const W = this.W;
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      p.vx = p.vx * 0.8 + ((p.x - p.lx) / dt) * 0.2; p.lx = p.x;
      const z = p.zi = zoneAt(W, p.x, p.y, p.z);
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
    if (!p.alive || !this.outdoors(p)) return false;
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
    m.st = 'stun'; m.stunT = this.cfg.stun; m.rage = this.stimAt(p.x, p.y, p.z, 2, 0.9, p);
    this.retractAll();
    this.bc({ t: 'stun', d: this.cfg.stun, by: p.id });
  }

  // ------------------------------------------------------------------ the monster's mind
  monsterTick(dt) {
    const m = this.m, cfg = this.cfg, W = this.W, R = this.R;
    m.immune -= dt; m.smashCd -= dt; m.t += dt;
    m.z += (Math.sin(this.time * 0.23) * 1.4 - m.z) * Math.min(1, dt);

    if (m.st === 'stun') {
      m.stunT -= dt;
      if (m.stunT <= 0) {
        m.immune = 3.5; m.feinted = false;
        const g = m.rage; m.rage = null;
        this.fx('roar', m.x, m.h, m.z);
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
        if (Math.abs(m.goal.x - m.x) < 2.5 || go(clamp(m.goal.x, 5, W.L - 5), cfg.speed * 1.25) || m.t > 25) this.beginSearch(m.goal);
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
    if (r < 0.4) tx = m.x + (R() * 2 - 1) * 45;                               // wander
    else if (r < 0.62 + 0.03 * cfg.n && alive.length) {                         // vague sense of the living
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
    if (m.st === 'smash') return;
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

  reachable(f) { return f.y0 + 1.2 <= this.m.h + 0.5; }

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
    for (const h of this.m.hands) if (h.task && (!only || h.task.type === only)) h.task = { type: 'retract' };
  }
  launch(h) {
    if (!h.task) { const s = shoulder(this.m, h.i); h.x = s.x; h.y = s.y - 1; h.z = s.z + h.side; }
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
      type: 'search', flat, aware, end: this.time + dur, ph: 0, wp: null, wpT: 0, track: null, scr: 0,
      out: { x: op.x, y: op.y, z: op.z - flat.side * 1.2 }, in: { x: op.x, y: op.y, z: op.z + flat.side * 0.7 },
    };
    return true;
  }

  beginSearch(goal) {
    const m = this.m, cfg = this.cfg, W = this.W, R = this.R;
    m.st = 'search'; m.t = 0; m.goal = goal; m.searchStart = this.time;
    const dur = 4 + R() * 3 + cfg.n * 0.25;
    m.searchEnd = this.time + dur + 1;
    const reachX = 6 + 0.35 * m.h;
    if (goal) {
      if (goal.kind === 'street') {
        const side = goal.z >= 0 ? 1 : -1;
        const pseudo = {
          key: 'street', street: true, roof: true, side, y0: 0, cx: goal.x,
          rooms: [{ x0: goal.x - 5, x1: goal.x + 5, z0: -7.4, z1: 7.4, front: true }],
          opens: [{ x: goal.x, y: 2.6, z: side * 3 }],
        };
        this.searchFlat(pseudo, goal.aware, dur);
      } else if (goal.flat) {
        if (this.reachable(goal.flat)) this.searchFlat(goal.flat, goal.aware, dur + 1.5, goal);
        else if (!goal.flat.destroyed || goal.flat.roof) return this.startSmash(goal.flat);
      } else if (goal.kind === 'stair' && goal.b && goal.aware >= 0.85) {
        // it knows someone is in the stairwell: an arm goes in through the street door and up the stairs,
        // or, if they are higher than it can reach, it beats on the building until the ceiling comes down
        const st = Object.assign({}, goal.b.stair, { y0: goal.f * K.FH });
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
    const h = m.hands.find((q) => q.side === flat.side && q.i % 4 === 3) || m.hands[0];
    const op = flat.opens[0], y = flat.roof ? flat.y0 + 0.5 : flat.y0 + 1.6;
    const s = shoulder(m, h.i); h.x = s.x; h.y = s.y; h.z = s.z;
    h.task = { type: 'smash', flat, ph: 0, hit: { x: flat.cx, y, z: op.z }, back: { x: flat.cx, y: y + 1.5, z: op.z - flat.side * 4.5 } };
    m.st = 'smash'; m.t = 0; m.goal = null;
    this.fx('windup', flat.cx, y, op.z);
  }

  doSmash(flat) {
    const m = this.m, op = flat.opens[0];
    if (flat.roof) {
      this.bc({ t: 'smash', f: flat.id, roof: 1, x: r2(flat.cx), y: r2(flat.y0 + (flat.stair ? 1.6 : 0.6)), z: r2(op.z) });
      for (const p of this.players.values())
        if (p.alive && p.zone === flat.key) this.hurt(p, flat.stair || Math.abs(p.z - op.z) < 5 ? 35 : 15, 'debris');
    } else {
      flat.destroyed = true;
      this.bc({ t: 'smash', f: flat.id, x: r2(flat.cx), y: r2(flat.y0 + 1.6), z: r2(op.z) });
      for (const p of this.players.values())
        if (p.alive && p.zone === flat.key) this.hurt(p, Math.abs(p.z) - K.FRONT < 4 ? 40 : 20, 'debris');
    }
    m.smashCd = Math.max(m.smashCd, 25);
  }

  // Where may a hand go inside this flat? Mutates pos; returns false if it had to stop short.
  limit(h, flat, pos) {
    const cfg = this.cfg, t = h.task;
    if (flat.roof) {
      const r = flat.rooms[0];
      pos.x = clamp(pos.x, r.x0, r.x1); pos.z = clamp(pos.z, r.z0, r.z1);
      if (flat.stair) pos.y = Math.min(pos.y, this.m.h + 1.5);
      return true;
    }
    const side = flat.side, maxD = cfg.depth + (flat.destroyed ? 2 : 0);
    let ok = true;
    if (Math.abs(pos.z) - K.FRONT > maxD) { pos.z = side * (K.FRONT + maxD); ok = false; }
    pos.x = clamp(pos.x, flat.x0 + 0.3, flat.x1 - 0.3);
    const room = flat.rooms.find((r) => pos.x >= r.x0 - 0.1 && pos.x <= r.x1 + 0.1 && pos.z >= r.z0 - 0.15 && pos.z <= r.z1 + 0.15);
    if (room && !room.front) {
      const d = this.W.doors[room.door];
      if (!d.open) {
        if (cfg.opensDoors) { this.setDoor(d, true); this.fx('doorslam', d.cx, d.y + 1, d.cz); } else {
          pos.x = d.cx; pos.z = d.cz - side * 0.7; ok = false;
          if (this.time - t.scr > 1.2) { t.scr = this.time; this.fx('scratch', d.cx, d.y + 1, d.cz); }
        }
      }
    }
    return ok;
  }

  inFlat(p, flat) {
    if (flat.street) return p.zi && p.zi.kind === 'street' && Math.abs(p.x - flat.cx) < 9;
    return p.zone === flat.key;
  }

  pickWp(h) {
    const t = h.task, flat = t.flat, R = this.R;
    t.track = null; t.wpT = this.time + 1.6;
    for (const p of this.players.values()) {
      if (!p.alive || !this.inFlat(p, flat)) continue;
      const hidden = (p.fl & 1) && !(p.fl & 8);       // crouched and still
      if (R() < t.aware * (hidden ? 0.4 : 1)) { t.track = p.id; break; }
    }
    if (t.track) return;
    const rooms = flat.rooms, room = R() < 0.6 ? rooms[0] : rooms[(R() * rooms.length) | 0];
    t.wp = { x: room.x0 + R() * (room.x1 - room.x0), y: flat.y0 + 0.4 + R() * 1.1, z: room.z0 + R() * (room.z1 - room.z0) };
    if (flat.balc && R() < 0.15) t.wp = { x: (flat.balc.x0 + flat.balc.x1) / 2, y: flat.y0 + 0.9, z: flat.side * (K.FRONT - 0.7) };
    this.limit(h, flat, t.wp);
  }

  handsTick(dt) {
    const m = this.m, cfg = this.cfg;
    const sh = {};
    for (const h of m.hands) {
      const t = h.task;
      if (!t) continue;
      shoulder(m, h.i, sh);
      let goal = sh, sp = cfg.handSpeed, lethal = false, flat = null;
      const at = (g, r = 0.35) => Math.hypot(g.x - h.x, g.y - h.y, g.z - h.z) < r;

      if (t.type === 'search') {
        flat = t.flat;
        if (t.ph === 0) { goal = t.out; sp *= 1.6; if (at(goal, 0.5)) t.ph = 1; }
        else if (t.ph === 1) { goal = t.in; lethal = true; if (at(goal)) { t.ph = 2; this.pickWp(h); this.fx('reach', h.x, h.y, h.z); } }
        else if (t.ph === 2) {
          lethal = true;
          if (this.time > t.end) t.ph = 3;
          else {
            if (t.track) {
              const p = this.players.get(t.track);
              if (p && p.alive && this.inFlat(p, flat)) { t.wp = { x: p.x, y: p.y + 0.8, z: p.z }; this.limit(h, flat, t.wp); } else t.track = null;
            }
            if (!t.wp || this.time > t.wpT || (!t.track && at(t.wp))) this.pickWp(h);
            goal = t.wp || t.in;
          }
        } else if (t.ph === 3) { goal = t.in; lethal = true; if (at(goal, 0.5)) t.ph = 4; }
        else if (t.ph === 4) { goal = t.out; sp *= 1.4; if (at(goal, 0.6)) h.task = { type: 'retract' }; }
      } else if (t.type === 'chase') {
        const p = this.players.get(t.pid);
        if (!p || !p.alive || this.time > t.end) h.task = { type: 'retract' };
        else if (!this.outdoors(p)) {
          // followed them to the door: go in after them if it can
          h.task = null;
          const f = p.zi && p.zi.flat;
          if (!(f && !f.roof && this.reachable(f) && this.searchFlat(f, 0.9, 5, p))) h.task = { type: 'retract' };
        } else {
          sp *= 1.25; lethal = true;
          const g = { x: p.x, y: p.y + 0.8, z: p.z };
          const d = Math.hypot(g.x - sh.x, g.y - sh.y, g.z - sh.z), mx = m.h * 0.9 + 5;
          if (d > mx) { const k = mx / d; g.x = sh.x + (g.x - sh.x) * k; g.y = sh.y + (g.y - sh.y) * k; g.z = sh.z + (g.z - sh.z) * k; }
          goal = g;
        }
      } else if (t.type === 'smash') {
        if (t.ph === 0) { goal = t.back; sp = 9; if (at(goal, 0.6) || m.t > 2.2) t.ph = 1; }
        else { goal = t.hit; sp = 30; if (at(goal, 0.8)) { this.doSmash(t.flat); h.task = { type: 'retract' }; this.listen(1.5); } }
      } else if (t.type === 'retract') {
        sp *= 1.8;
        if (at(sh, 0.8)) { h.task = null; continue; }
      }
      if (!h.task) continue;

      const dx = goal.x - h.x, dy = goal.y - h.y, dz = goal.z - h.z, d = Math.hypot(dx, dy, dz);
      if (d > 1e-4) { const k = Math.min(1, (sp * dt) / d); h.x += dx * k; h.y += dy * k; h.z += dz * k; }

      if (!lethal) continue;
      for (const p of this.players.values()) {
        if (!p.alive) continue;
        if (flat ? !this.inFlat(p, flat) : !this.outdoors(p)) continue;
        if (Math.hypot(p.x - h.x, p.z - h.z) < 0.9 && Math.abs(p.y + 0.8 - h.y) < 1.3) {
          this.kill(p, 'hand');
          if (h.task.type === 'chase') h.task = { type: 'retract' }; else { h.task.ph = 3; h.task.track = null; }
          break;
        }
      }
    }
  }
}
