// The in-game client: rendering, input, local player, and applying what the simulation says.
import * as THREE from 'three';
import { genWorld, zoneAt, K } from '../shared/world.js';
import { makeTextures, makeMaterials } from './textures.js';
import { WorldView } from './worldview.js';
import { Player } from './player.js';
import { MonsterView } from './monster.js';
import { MinionView } from './minion.js';
import { Avatar, makeViewHands } from './avatar.js';
import { Post, Debris, FX_LAYER } from './fx.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const _v = new THREE.Vector3(), _d = new THREE.Vector3();

// Three tiers. Low is built for weak laptops, medium for ordinary PCs, high for a real graphics card.
export const QUALITY = {
  low: { pr: 0.75, shadow: 1024, pshadow: 0, pshadowSize: 256, torchShadow: false, bloom: false, ao: false, smaa: false, env: false, tex: 0.5, aniso: 1, bump: false, round: 0, seg: 7, lights: 5, debris: 220, ash: 200 },
  medium: { pr: 1, shadow: 2048, pshadow: 1, pshadowSize: 512, torchShadow: false, bloom: true, ao: false, smaa: true, env: true, tex: 1, aniso: 4, bump: true, round: 1, seg: 10, lights: 8, debris: 500, ash: 500 },
  high: { pr: 1.5, shadow: 4096, pshadow: 2, pshadowSize: 1024, torchShadow: true, bloom: true, ao: true, smaa: true, env: true, tex: 2, aniso: 8, bump: true, round: 2, seg: 14, lights: 12, debris: 900, ash: 800 },
};

export class Game {
  constructor({ canvas, settings, sound, hud }) {
    this.canvas = canvas; this.set = settings; this.sound = sound; this.hud = hud;
    const q = this.q = QUALITY[settings.quality] || QUALITY.medium;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    r.shadowMap.enabled = q.shadow > 0; r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.2;
    const scene = this.scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b1820);
    scene.fog = new THREE.FogExp2(0x0b1820, 0.024);
    const cam = this.camera = new THREE.PerspectiveCamera(settings.fov, 1, 0.06, 220);
    cam.rotation.order = 'YXZ'; cam.layers.enable(FX_LAYER); scene.add(cam);

    this.T = makeTextures(q);
    this.M = makeMaterials(this.T, q);
    // image-based ambient light and reflections from a dim night sky: wet asphalt, glass and metal pick it up
    if (q.env) {
      const pm = new THREE.PMREMGenerator(r);
      scene.environment = pm.fromEquirectangular(this.T.sky).texture; scene.environmentIntensity = 0.55;
      pm.dispose();
    }

    // moonlight + sky fill
    scene.add(new THREE.HemisphereLight(0x5f86a8, 0x1c1814, q.env ? 1.15 : 1.7));
    const moon = this.moon = new THREE.DirectionalLight(0x8fb2e0, 2.6);
    moon.position.set(20, 60, -34); moon.target.position.set(60, 0, 0); scene.add(moon, moon.target);
    if (q.shadow) {
      moon.castShadow = true; moon.shadow.mapSize.set(q.shadow, q.shadow);
      const sc = moon.shadow.camera; sc.left = -75; sc.right = 75; sc.top = 40; sc.bottom = -40; sc.near = 1; sc.far = 160;
      moon.shadow.bias = -0.0008; moon.shadow.normalBias = 0.06;
    }
    const disc = new THREE.Mesh(new THREE.CircleGeometry(9, 32), new THREE.MeshBasicMaterial({ color: 0xcfe0f0, fog: false }));
    disc.position.set(-40, 120, -150); disc.lookAt(60, 0, 0); disc.layers.set(FX_LAYER); scene.add(disc);
    const haze = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.T.soft, color: 0x7fa0c8, transparent: true, opacity: 0.35, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
    haze.position.copy(disc.position); haze.scale.setScalar(90); haze.layers.set(FX_LAYER); scene.add(haze);

    // torch
    const torch = this.torch = new THREE.SpotLight(0xfff0dc, 0, 34, 0.62, 0.9, 1.35);
    torch.position.set(-0.23, -0.15, -0.56); torch.target.position.set(-0.06, -0.06, -6); cam.add(torch, torch.target);
    if (q.torchShadow) { torch.castShadow = true; torch.shadow.mapSize.set(1024, 1024); torch.shadow.camera.near = 0.3; torch.shadow.bias = -0.002; }
    this.torchOn = false;
    this.flash = new THREE.PointLight(0xffc080, 0, 14); this.flash.position.set(0.2, -0.1, -0.8); cam.add(this.flash);

    this.post = new Post(r, scene, cam, q);

    // drifting ash
    const N = q.ash, pos = new Float32Array(N * 3);
    for (let i = 0; i < N * 3; i++) pos[i] = (Math.random() - 0.5) * 24;
    const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.ash = new THREE.Points(pg, new THREE.PointsMaterial({ color: 0x9fb0b8, size: 0.035, transparent: true, opacity: 0.55, depthWrite: false }));
    this.ash.frustumCulled = false; this.ash.layers.set(FX_LAYER); scene.add(this.ash);

    this.world = null; this.W = null; this.seed = null;
    this.monster = new MonsterView(scene, this.T); this.monster.setVisible(false);
    this.monster.onStep = (x, z, hand) => this.monsterStep(x, z, hand);
    this.minions = new Map(); this.skitT = 0; this.taking = null; this.eaten = null; this.hidden = false;
    this.avatars = new Map();
    this.me = null; this.player = null;
    this.snap = null; this.phase = 'idle'; this.alive = false; this.hp = 100; this.ammo = 0; this.expo = 0; this.bottles = 0;
    this.keys = {}; this.mdx = 0; this.mdy = 0; this.locked = false;
    this.shake = 0; this.hurtFx = 0; this.deadFx = 0; this.recoil = 0; this.noiseLvl = 0; this.shootCd = 0; this.lean = 0; this.fear = 0; this.warp = 0;
    this.sendT = 0; this.hudT = 0; this.pickT = new Map(); this.prompt = null; this.spec = 0; this.time = 0;
    this.ray = new THREE.Raycaster();
    this.viewGun = null; this.thrown = []; this.hauntT = 30; this.ghost = null; this.attract = null;

    // first-person arms: torch in the left hand, pistol in the right
    this.hands = makeViewHands(); cam.add(this.hands.group);

    this.bind();
    this.resize();
    this.last = performance.now(); this.running = true;
    const loop = (now) => { if (!this.running) return; requestAnimationFrame(loop); this.frame(now); };
    requestAnimationFrame(loop);
  }

  bind() {
    const on = (t, e, f, o) => { t.addEventListener(e, f, o); (this.unbind ||= []).push(() => t.removeEventListener(e, f, o)); };
    on(window, 'resize', () => this.resize());
    on(document, 'pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      this.keys = {};
      this.hud.onLock(this.locked);
    });
    on(document, 'mousemove', (e) => { if (this.locked) { this.mdx += e.movementX; this.mdy += e.movementY; } });
    on(document, 'keydown', (e) => {
      if (!this.locked) return;
      if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
      if (e.repeat) return;
      this.keys[e.code] = true;
      if (e.code === 'KeyE') this.interact();
      if (e.code === 'KeyF') this.toggleTorch();
      if (e.code === 'KeyG') this.throwBottle();
      if (e.code === 'KeyQ' && !this.alive) this.spec++;
    });
    on(document, 'keyup', (e) => { this.keys[e.code] = false; });
    on(this.canvas, 'mousedown', (e) => {
      if (!this.locked) return this.lock();
      if (e.button === 0) this.alive ? this.shoot() : this.spec++;
    });
  }
  lock() { try { const p = this.canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch {} }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const pr = Math.min(2, Math.min(window.devicePixelRatio || 1, 2) * this.q.pr);
    this.renderer.setPixelRatio(pr); this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.fov = this.set.fov; this.camera.updateProjectionMatrix();
    this.post.size(w, h, pr);
  }
  applySettings() { this.resize(); }

  // ------------------------------------------------------------------ messages from the simulation
  onMsg(m) {
    switch (m.t) {
      case 'night': return this.startNight(m);
      case 's': this.snap = m; return this.onSnap(m);
      case 'pick': {
        const p = this.world && this.world.removePickup(m.id);
        if (p) this.sound.play(m.k === 'star' ? 'star' : 'pick', m.by === this.me ? 0.9 : 0.7, m.by === this.me ? null : { x: p.k.x, y: p.k.y, z: p.k.z, max: 30 });
        if (m.by === this.me) this.hud.toast({ star: 'Star taken. It heard that. Move.', gun: 'Flare pistol: +2 rounds (left click)', med: 'Bandages: +35 health', bottle: 'Bottle. Throw it with G: it goes to the sound.' }[m.k], m.k);
        if (this.taking && this.taking.id === m.id) this.taking = null;
        return;
      }
      case 'closet': {
        const c = this.W.closets[m.id]; this.world.setCloset(m.id, m.open);
        return this.sound.play('closet', 0.8, { x: c.cx, y: c.y + 1, z: c.cz, max: 20 });
      }
      case 'eaten': return this.onEaten(m);
      case 'summon':
        this.sound.play('summon', 1); this.shake = Math.max(this.shake, 0.3);
        this.hud.alert(m.n > 1 ? 'IT HAS CALLED THEM IN' : 'IT HAS CALLED SOMETHING IN');
        this.hud.toast('Crawlers are loose in the buildings for a minute. Closets will not always save you.', 'bad');
        return;
      case 'door': {
        const d = this.W.doors[m.id]; d.open = m.open; this.world.setDoor(m.id, m.open);
        return this.sound.play('door', 0.8, { x: d.cx, y: d.y + 1, z: d.cz, max: 22 });
      }
      case 'brk': return this.onBreak(m);
      case 'dead': return this.onDead(m);
      case 'hp':
        this.hp = m.hp; this.hurtFx = 1; this.shake = Math.max(this.shake, 0.5); this.sound.play('hurt', 1);
        if (m.cause === 'debris') this.hud.toast('Hit by flying debris', 'bad');
        if (m.cause === 'minion') this.hud.toast('Bitten. Its shriek carries to the street.', 'bad');
        return;
      case 'alert':
        this.sound.play('alert', 1); this.hud.alert('IT KNOWS WHERE YOU ARE');
        return;
      case 'fx': {
        const max = { roar: 140, spot: 110, windup: 80, scratch: 26, reach: 30, doorslam: 30, screech: 45, bite: 25, mdie: 30, summon: 160, starcry: 60, bang: 60, lunge: 50, glass: 60 }[m.k] || 40;
        if (m.k === 'glass' && m.by === this.me) return;          // we already heard our own bottle
        this.sound.play(m.k, 1, { x: m.x, y: m.y, z: m.z, max });
        if (!this.debris) return;
        if (m.k === 'mdie') this.debris.puff(m.x, m.y, m.z, 1.6, 5, 1, 0x1a2a1c);
        else if (m.k === 'bite') this.debris.puff(m.x, m.y + 0.4, m.z, 0.7, 3, 0.5, 0x6a0808);
        else if (m.k === 'bang') { this.debris.puff(m.x, m.y, m.z, 1.2, 3, 0.8); this.bump(m, 0.5, 14); }
        else if (m.k === 'glass') this.shatterBottle(m.x, m.y, m.z);
        else if (m.k === 'roar' || m.k === 'spot') this.shake = Math.max(this.shake, 0.25);
        return;
      }
      case 'shot': {
        const a = this.avatars.get(m.by);
        if (a) this.sound.play('gun', 1, { x: a.x, y: a.y + 1.4, z: a.z, max: 120 });
        return;
      }
      case 'stun':
        this.sound.play('stun', 1, { x: this.monster.x, y: this.monster.h, z: this.monster.z, max: 140 });
        this.hud.toast(`The thing is stunned for ${Math.round(m.d)}s. Move.`, 'good');
        return;
      case 'dawn': this.sound.play('dawn', 0.8); this.hud.toast('Enough stars. Dawn in 15 seconds. Get indoors.', 'good'); return;
      case 'nightEnd': this.phase = 'inter'; return this.hud.nightEnd(m);
      case 'over': this.phase = 'over'; this.exitLock(); return this.hud.over(m);
      case 'left': { const a = this.avatars.get(m.id); if (a) { this.scene.remove(a.group); this.avatars.delete(m.id); } return; }
    }
  }
  exitLock() { if (document.pointerLockElement) document.exitPointerLock(); }
  // camera kick from something heavy happening at a point
  bump(at, amount, range) {
    const c = this.camera.position, d = Math.hypot(at.x - c.x, at.y - c.y, at.z - c.z);
    if (d < range) this.shake = Math.max(this.shake, amount * (1 - d / range));
  }

  build(seed) {
    if (this.world) { this.world.dispose(); this.debris.dispose(); if (this.viewGun) this.hands.right.remove(this.viewGun); }
    this.seed = seed;
    this.W = genWorld(seed);
    this.world = new WorldView(this.scene, this.W, this.M, this.T, this.q);
    this.debris = new Debris(this.scene, this.M.rubble, this.T.soft, this.world.col, this.q.debris, this.q.round ? this.world.roundGeo : null);
    this.player = new Player(this.world.col);
    this.viewGun = this.world.makeGun(); this.viewGun.scale.setScalar(0.62); this.viewGun.position.set(0, 0.03, -0.1); this.hands.right.add(this.viewGun);
    if (this.ghost) { this.scene.remove(this.ghost.g); this.ghost = null; }
  }

  // The menu backdrop: the street, with the thing walking it.
  startAttract(seed) {
    if (!this.world || (this.world.gone.size && this.phase === 'idle')) this.build(seed ?? this.seed);
    this.phase = 'idle'; this.snap = null; this.alive = false; this.eaten = null; this.deadFx = 0; this.hurtFx = 0;
    for (const a of this.avatars.values()) this.scene.remove(a.group);
    this.avatars.clear();
    for (const v of this.minions.values()) v.dispose();
    this.minions.clear();
    this.world.setPickups([]);
    this.attract = { x: this.W.L * 0.7, dir: -1, st: 'roam', t: 0, wait: 0, shot: 0, shotT: 0, h: 14 };
    this.monster.reset(); this.monster.setVisible(true);
  }

  startNight(m) {
    this.attract = null;
    // a fresh game on a street that was wrecked last time: rebuild it whole
    if (!this.world || this.seed !== this.seedWanted || (m.n === 1 && this.world.gone.size)) this.build(this.seedWanted);
    const W = this.W, w = this.world;
    this.night = m.n; this.quota = m.quota; this.phase = 'night'; this.snap = null; this.stars = 0; this.tl = m.duration;
    w.breakGroups(m.destroyed);
    m.doors.forEach((o, i) => { W.doors[i].open = !!o; w.setDoor(i, !!o, true); });
    W.closets.forEach((c, i) => w.setCloset(i, false, true));
    for (const v of this.minions.values()) v.dispose();
    this.minions.clear(); this.taking = null; this.eaten = null; this.thrown.length = 0;
    w.setPickups(m.pickups);
    // avatars
    for (const a of this.avatars.values()) this.scene.remove(a.group);
    this.avatars.clear(); this.names = new Map();
    for (const p of m.players) {
      this.names.set(p.id, p.name);
      if (p.id === this.me) { this.hp = p.hp; this.ammo = p.ammo; this.bottles = p.bottles || 0; continue; }
      const a = new Avatar(p.char, p.name); a.alive = true; a.fl = 0; this.scene.add(a.group); this.avatars.set(p.id, a);
    }
    const s = m.spawn[this.me];
    this.alive = !!s; this.deadFx = 0; this.hurtFx = 0; this.expo = 0; this.lean = 0; this.blackout = 0;
    if (s) {
      const side = s[2] > 0 ? 1 : -1;
      this.player.place(s[0], s[1], s[2], side > 0 ? 0 : Math.PI);   // face the street door
      this.player.stamina = 100; this.player.tired = false;
    }
    this.monster.reset(); this.monster.setVisible(true);
    this.hauntT = 25 + Math.random() * 20;
    this.hud.night(m);
  }

  onSnap(m) {
    this.phase = m.ph; this.stars = m.stars; this.tl = m.tl; this.cd = m.cd;
    for (const p of m.p) {
      if (p[0] === this.me) {
        if (this.alive) { this.hp = p[6]; this.ammo = p[8]; this.expo = p[9]; this.bottles = p[10] || 0; }
        continue;
      }
      const a = this.avatars.get(p[0]);
      if (!a) continue;
      a.tx = p[1]; a.ty = p[2]; a.tz = p[3]; a.tyaw = p[4]; a.fl = p[5]; a.hp = p[6];
      if (a.carry == null) { a.alive = !!p[7]; a.group.visible = a.alive; }
    }
  }

  // Pieces of the world were broken: hide them and throw their real parts around as rubble.
  onBreak(m) {
    if (!this.world) return;
    const { parts, cables } = this.world.breakGroups(m.gs || []);
    const hit = { x: m.x, y: m.y, z: m.z }, d = m.d || [0, 0.3, 0], k = m.k;
    const masonry = k === 'facade' || k === 'wall' || k === 'stairwall' || k === 'parapet' || k === 'smash';
    if (parts.length) {
      const power = m.big ? 10 : k === 'glass' ? 4 : k === 'street' ? 8.5 : masonry ? 7.5 : 6;
      this.debris.shatter(parts, hit, d, power, Math.round(this.q.debris * (m.big ? 0.5 : 0.2)));
      if (masonry) this.debris.puff(m.x, m.y, m.z, m.big ? 4.5 : 2.6, m.big ? 10 : 5, m.big ? 6 : 2);
      else if (k !== 'glass') this.debris.puff(m.x, m.y, m.z, 1.3, 2, 1, 0x6a6258);
    } else if (m.big) {
      // nothing left to break there: it still throws up what is lying around
      for (let i = 0; i < 40; i++) this.debris.chunk(m.x + (Math.random() - 0.5) * 7, m.y + Math.random() * 1.2, m.z + d[2] * Math.random() * 1.5, (Math.random() - 0.5) * 7, 2 + Math.random() * 6, d[2] * (Math.random() * 9 - 2), 0.1 + Math.random() * 0.25, undefined, undefined, 0x7a6a60);
      this.debris.puff(m.x, m.y + 0.5, m.z, 4, 8, 6);
    }
    for (const pts of cables) { const mid = pts[(pts.length / 2) | 0]; this.debris.sparks(mid.x, mid.y, mid.z, 14); this.debris.sparks(pts[2].x, pts[2].y, pts[2].z, 6); }
    const snd = m.big ? 'smash' : cables.length ? 'snap' : k === 'glass' ? 'glass' : k === 'street' ? 'metalcrash' : masonry ? 'crash' : 'woodbreak';
    this.sound.play(snd, 1, { x: m.x, y: m.y, z: m.z, max: m.big ? 150 : 70 });
    this.bump(m, m.big ? 1.7 : masonry ? 0.9 : 0.4, m.big ? 40 : 18);
    if (m.big && m.f >= 0 && this.W.flats[m.f]) this.W.flats[m.f].destroyed = true;
  }

  onDead(m) {
    const grabbed = m.cause === 'hand' && m.h != null;
    if (grabbed) this.monster.eating = m.h;
    if (m.id === this.me) {
      this.alive = false; this.hp = 0; this.shake = 2; this.torchOn = false; this.taking = null;
      this.sound.play('death', 1);
      if (grabbed) { this.eaten = { h: m.h, t: 0 }; this.hud.grabbed(); }
      else { this.deadFx = 1; this.hud.dead(m.cause); }
    } else {
      const a = this.avatars.get(m.id);
      if (a) {
        a.alive = false;
        if (grabbed) a.carry = m.h; else a.group.visible = false;
        this.sound.play('death', 0.6, { x: a.x, y: a.y, z: a.z, max: 60 });
      }
      this.hud.toast(`${this.names.get(m.id) || 'Someone'} was ${m.cause === 'hand' ? 'taken' : 'killed'}`, 'bad');
    }
  }

  // the hand has reached the mouth
  onEaten(m) {
    const mp = this.monster.mouthPos;
    this.monster.eating = -1;
    this.sound.play('eat', 1, m.id === this.me ? null : { x: mp.x, y: mp.y, z: mp.z, max: 120 });
    if (this.debris) this.debris.puff(mp.x, mp.y, mp.z, 1.6, 10, 1.6, 0x7a0606, 0.8);
    if (m.id === this.me) { this.eaten = null; this.deadFx = 1; this.hurtFx = 1; this.blackout = 1; this.hud.dead('hand'); }
    else { const a = this.avatars.get(m.id); if (a) { a.carry = null; a.group.visible = false; } }
  }

  // ------------------------------------------------------------------ actions
  noise(r) {
    this.noiseLvl = Math.max(this.noiseLvl, Math.min(1, r / 18));
    if (r > 0) this.net.send({ t: 'noise', r });
  }
  toggleTorch() {
    if (!this.alive) return;
    this.torchOn = !this.torchOn; this.sound.play('torch', 1);
  }
  interact() {
    const p = this.prompt;
    if (!this.alive || !p) return;
    if (p.type === 'door') this.net.send({ t: 'door', id: p.id });
    else if (p.type === 'closet') this.net.send({ t: 'closet', id: p.id });
    else if (p.type === 'star' && !this.taking) { this.taking = { id: p.id, t: 0 }; this.sound.play('channel', 0.8); }
  }
  shoot() {
    if (this.shootCd > 0 || this.phase === 'inter') return;
    if (this.ammo <= 0) { this.sound.play('empty', 1); return; }
    this.shootCd = 0.7; this.ammo--;
    const cam = this.camera, o = cam.getWorldPosition(new THREE.Vector3()), d = cam.getWorldDirection(new THREE.Vector3());
    this.ray.set(o, d); this.ray.far = 150;
    const hits = this.ray.intersectObject(this.monster.group, true);
    const wall = this.world.col.ray(o.x, o.y, o.z, d.x || 1e-9, d.y || 1e-9, d.z || 1e-9, 150);
    const hit = hits.length > 0 && hits[0].distance < wall;
    this.net.send({ t: 'shoot', hit });
    this.sound.play('gun', 1); this.recoil = 1; this.flash.intensity = 60; this.shake = Math.max(this.shake, 0.35);
    this.noiseLvl = 1;
  }
  // throw a bottle: wherever it breaks, the monster goes to look
  throwBottle() {
    if (!this.alive || this.bottles <= 0 || this.thrown.length) return;
    const cam = this.camera, o = cam.getWorldPosition(new THREE.Vector3()), d = cam.getWorldDirection(new THREE.Vector3());
    const mesh = this.world.makeBottle(); mesh.position.copy(o).addScaledVector(d, 0.5); this.scene.add(mesh);
    this.thrown.push({ mesh, x: mesh.position.x, y: mesh.position.y, z: mesh.position.z, vx: d.x * 15, vy: d.y * 15 + 3.5, vz: d.z * 15, t: 0 });
    this.bottles--; this.sound.play('throw', 0.8);
  }
  shatterBottle(x, y, z) {
    for (let i = 0; i < 12; i++) this.debris.chunk(x, y + 0.05, z, (Math.random() - 0.5) * 5, 1 + Math.random() * 3, (Math.random() - 0.5) * 5, 0.03 + Math.random() * 0.05, 0.01, 0.03 + Math.random() * 0.05, 0x7ab8a0);
  }
  monsterStep(x, z, hand) {
    const c = this.camera.position, d = Math.hypot(x - c.x, z - c.z);
    this.sound.play(hand ? 'slap' : 'mstep', 1, { x, y: 0, z, max: hand ? 55 : 75 });
    if (d < 32) this.shake = Math.max(this.shake, (1 - d / 32) * (hand ? 0.3 : 0.55));
    if (this.debris && d < 50) this.debris.puff(x, 0.4, z, hand ? 1.2 : 2.2, hand ? 1 : 2, 1.5);
  }

  // ------------------------------------------------------------------ frame
  frame(now) {
    const dt = Math.max(0, Math.min(0.05, (now - this.last) / 1000)); this.last = now; this.time += dt;
    const cam = this.camera, set = this.set, snd = this.sound;
    const playing = this.world && (this.phase === 'night' || this.phase === 'dawn');
    if (this.world) {
      const P = this.player;
      if (this.attract) this.runAttract(dt);
      else if (playing && this.alive) {
        // look
        if (this.locked) {
          const s = 0.0022 * set.sens;
          P.yaw -= this.mdx * s; P.pitch = clamp(P.pitch - this.mdy * s * (set.invertY ? -1 : 1), -1.5, 1.5);
        }
        const k = this.keys, act = this.locked;
        P.others = [...this.avatars.values()].filter((a) => a.alive);
        const ev = P.update(dt, {
          fwd: act && (k.KeyW || k.ArrowUp), back: act && (k.KeyS || k.ArrowDown), left: act && (k.KeyA || k.ArrowLeft), right: act && (k.KeyD || k.ArrowRight),
          sprint: act && (k.ShiftLeft || k.ShiftRight), crouch: act && (k.KeyC || k.ControlLeft), jump: act && k.Space,
        });
        for (const e of ev) {
          if (e.t === 'step') { snd.play('step', e.loud ? (e.loud > 10 ? 0.6 : 0.35) : 0.1); this.noise(e.loud); }
          else if (e.t === 'land') {
            snd.play('land', clamp(e.v / 14, 0.2, 1));
            if (e.v > 6) this.noise(Math.min(25, e.v * 1.4));
            if (e.v > 11.5) { const a = Math.round((e.v - 11.5) * 7); this.net.send({ t: 'hurt', a }); this.hp -= a; this.hurtFx = 1; this.shake = 1; snd.play('hurt', 1); this.hud.toast(`Fall damage  −${a}`, 'bad'); }
          }
        }
        // lean round corners (Q / R): the camera moves sideways, as far as the wall lets it
        const want = act ? (k.KeyQ ? -1 : 0) + (k.KeyR ? 1 : 0) : 0;
        this.lean += (want - this.lean) * Math.min(1, dt * 9);
        const rx = Math.cos(P.yaw), rz = -Math.sin(P.yaw);
        let off = this.lean * 0.5;
        const ey = P.y + P.eye;
        while (Math.abs(off) > 0.05 && this.world.col.test(P.x + rx * off - 0.12, ey - 0.12, P.z + rz * off - 0.12, P.x + rx * off + 0.12, ey + 0.12, P.z + rz * off + 0.12)) off *= 0.7;
        // camera
        const bob = set.headBob ? Math.sin(P.bob) * 0.035 : 0, breath = Math.sin(this.time * (1.4 + this.fear * 2.5)) * (0.004 + this.fear * 0.008);
        cam.position.set(P.x + rx * off, ey + bob + P.camLift + breath - Math.abs(this.lean) * 0.06, P.z + rz * off);
        cam.rotation.set(P.pitch + this.recoil * 0.06, P.yaw, (set.headBob ? Math.sin(P.bob * 0.5) * 0.006 : 0) - this.lean * 0.14);
        // tell the simulation where we are
        this.sendT -= dt;
        if (this.sendT <= 0) {
          this.sendT = 1 / 15;
          const fl = (P.crouch ? 1 : 0) | (P.sprinting ? 2 : 0) | (this.torchOn ? 4 : 0) | (Math.hypot(P.vx, P.vz) > 0.3 ? 8 : 0) | (this.ammo > 0 ? 16 : 0);
          this.net.send({ t: 'st', x: +P.x.toFixed(2), y: +P.y.toFixed(2), z: +P.z.toFixed(2), ry: +P.yaw.toFixed(2), fl });
        }
        // stars have to be taken by hand (E): it takes a moment, and it is not quiet
        if (this.taking) {
          const p = this.world.pickups.get(this.taking.id);
          if (!p || Math.hypot(p.k.x - P.x, p.k.z - P.z) > 2.3 || Math.abs(p.k.y - P.y - 0.8) > 1.8) { if (p) p.take = 0; this.taking = null; }
          else {
            this.taking.t += dt / 1.1; p.take = Math.min(1, this.taking.t);
            if (this.taking.t >= 1 && !this.taking.sent) { this.taking.sent = true; this.net.send({ t: 'pick', id: p.k.id }); }
            if (this.taking && this.taking.t > 1.6) { p.take = 0; this.taking = null; }   // (a solo pick is confirmed synchronously)
          }
        }
        // guns, bandages and bottles are picked up by walking into them
        for (const p of this.world.pickups.values()) {
          if (p.k.k === 'star' || (p.k.k === 'bottle' && this.bottles >= 3)) continue;
          if (Math.abs(p.k.x - P.x) > 1.3 || Math.abs(p.k.z - P.z) > 1.3 || Math.abs(p.k.y - P.y - 0.8) > 1.5) continue;
          if ((this.pickT.get(p.k.id) || 0) > this.time) continue;
          this.pickT.set(p.k.id, this.time + 0.5); this.net.send({ t: 'pick', id: p.k.id });
        }
        this.haunt(dt);
      } else if (this.eaten) {
        // held in its fist: out through the hole in the wall, lifted in front of its face, then in
        const e = this.eaten, tip = this.monster.arms[e.h].tip, hp = this.monster.mouthPos;
        e.t += dt;
        cam.position.lerp(_v.set(tip.x, tip.y + 0.15, tip.z), Math.min(1, dt * 12));
        cam.lookAt(hp.x, hp.y, hp.z);
        cam.rotation.z += Math.sin(e.t * 9) * 0.1;
        this.shake = Math.max(this.shake, 0.45);
        this.hurtFx = Math.max(this.hurtFx, Math.min(0.75, e.t * 0.18));
        if (e.t > 12) { this.eaten = null; this.deadFx = 1; this.hud.dead('hand'); }
      } else if (playing || this.phase === 'inter' || this.phase === 'over') {
        this.spectate(dt);
      }
      this.mdx = this.mdy = 0;

      // thrown bottles
      for (let i = this.thrown.length - 1; i >= 0; i--) {
        const b = this.thrown[i]; b.t += dt; b.vy -= 18 * dt;
        const nx = b.x + b.vx * dt, ny = b.y + b.vy * dt, nz = b.z + b.vz * dt;
        if (b.t > 4 || this.world.col.test(nx - 0.06, ny - 0.06, nz - 0.06, nx + 0.06, ny + 0.06, nz + 0.06)) {
          this.scene.remove(b.mesh); this.thrown.splice(i, 1);
          this.shatterBottle(b.x, b.y, b.z); snd.play('glass', 1, { x: b.x, y: b.y, z: b.z, max: 60 });
          if (this.net && playing) this.net.send({ t: 'throw', x: +b.x.toFixed(2), y: +b.y.toFixed(2), z: +b.z.toFixed(2) });
          continue;
        }
        b.x = nx; b.y = ny; b.z = nz; b.mesh.position.set(nx, ny, nz); b.mesh.rotation.x += dt * 14; b.mesh.rotation.z += dt * 9;
      }

      // others
      for (const a of this.avatars.values()) {
        if (a.carry != null) {   // dangling from a fist
          const tip = this.monster.arms[a.carry].tip;
          a.x = tip.x; a.y = tip.y - 0.9; a.z = tip.z;
          a.group.position.set(a.x, a.y, a.z); a.group.rotation.set(Math.sin(this.time * 11) * 0.5, this.time * 3, Math.cos(this.time * 9) * 0.5);
          a.pose(dt, 6, false, false, false);
        } else if (a.tx !== undefined) { a.group.rotation.x = a.group.rotation.z = 0; a.update(dt, a.tx, a.ty, a.tz, a.tyaw, a.fl); }
      }
      // monster + crawlers
      if (this.snap) { this.monster.update(dt, this.snap.m, cam.position); this.updateMinions(dt, this.snap.mn || []); }
      cam.getWorldDirection(_d);
      this.world.update(dt, cam.position, this.fear || 0, _d);
      this.debris.update(dt);
      this.updateGhost(dt);
    }

    // shake / recoil / torch
    this.shake = Math.max(0, this.shake - dt * 1.8);
    if (this.shake > 0) {
      const s = this.shake * this.shake * 0.05;
      cam.rotation.x += (Math.random() - 0.5) * s; cam.rotation.y += (Math.random() - 0.5) * s; cam.rotation.z += (Math.random() - 0.5) * s;
    }
    this.recoil = Math.max(0, this.recoil - dt * 6); this.shootCd -= dt;
    this.flash.intensity = Math.max(0, this.flash.intensity - dt * 600);
    // the torch gutters when it is close
    const t = this.time, gut = this.fear > 0.55 && Math.sin(t * 31) * Math.sin(t * 6.3) > 0.35 - this.fear * 0.5 ? 0.15 : 1;
    this.torch.intensity += ((this.torchOn && this.alive ? 18 * gut : 0) - this.torch.intensity) * Math.min(1, dt * 24);
    const hv = this.alive && playing && !this.attract;
    this.hands.update(dt, { show: hv, torch: this.torchOn, gun: this.ammo > 0, recoil: this.recoil, bob: this.player ? this.player.bob : 0, moving: this.player && this.player.moving, sprint: this.player && this.player.sprinting, lit: gut });
    this.hurtFx = Math.max(0, this.hurtFx - dt * 0.9);
    this.noiseLvl = Math.max(0, this.noiseLvl - dt * 0.9);

    // ash follows the camera
    const ap = this.ash.geometry.attributes.position, c = cam.position;
    for (let i = 0; i < ap.count; i++) {
      let x = ap.getX(i) + dt * 0.25, y = ap.getY(i) - dt * 0.18, z = ap.getZ(i) + dt * 0.1;
      if (x - c.x > 12) x -= 24; else if (x - c.x < -12) x += 24;
      if (y - c.y > 12) y -= 24; else if (y - c.y < -12) y += 24;
      if (z - c.z > 12) z -= 24; else if (z - c.z < -12) z += 24;
      ap.setXYZ(i, x, y, z);
    }
    ap.needsUpdate = true;

    // fear: how close is it, is it hunting, is a hand near
    let fear = 0, md = 999;
    if (this.snap && playing) {
      const m = this.snap.m;
      md = Math.hypot(m.x - c.x, m.z - c.z);
      fear = clamp(1 - md / 48, 0, 1) * 0.7 + (m.st === 'hunt' ? 0.25 : 0);
      for (const h of m.hands) if (h) { const d = Math.hypot(h[1] - c.x, h[2] - c.y, h[3] - c.z); if (d < 9) fear = Math.max(fear, 1 - d / 14); }
      for (const v of this.minions.values()) { const d = Math.hypot(v.x - c.x, (v.y - c.y) * 2, v.z - c.z); if (d < 12) fear = Math.max(fear, 1 - d / 13); }
      fear = Math.max(fear, this.expo > 0.7 ? (this.expo - 0.7) * 2 : 0);
      if (m.st === 'stun') fear *= 0.3;
    }
    this.fear = clamp(fear, 0, 1);
    // the picture itself comes apart a little when it knows where you are, or something stands watching
    const warpT = (playing && this.alive ? Math.max(0, this.expo - 0.8) * 4 : 0) + (this.ghost && this.ghost.seen ? 0.8 : 0) + (this.eaten ? 0.6 : 0);
    this.warp += (Math.min(1, warpT) - this.warp) * Math.min(1, dt * 4);
    // fear narrows the eye
    const fov = set.fov - this.fear * 4 + (this.player && this.player.sprinting && hv ? 5 : 0);
    if (Math.abs(cam.fov - fov) > 0.05) { cam.fov += (fov - cam.fov) * Math.min(1, dt * 5); cam.updateProjectionMatrix(); }
    snd.listener.x = c.x; snd.listener.y = c.y; snd.listener.z = c.z; snd.listener.yaw = cam.rotation.y;
    snd.update(dt, playing && this.alive ? this.fear : this.attract ? 0.25 : 0, playing || this.attract ? md : 999, playing && this.snap && this.snap.m.fast);

    this.blackout = Math.max(0, (this.blackout || 0) - dt * 0.5);
    this.post.render(dt, { hurt: this.hurtFx, fear: this.fear, warp: this.warp, gamma: set.gamma * (1 - this.blackout * 0.85), dead: this.alive || !playing || this.eaten ? 0 : 0.6 });

    this.hudT -= dt;
    if (this.hudT <= 0 && this.world && !this.attract) { this.hudT = 0.1; this.updateHud(); }
  }

  // ---- menu backdrop: a fake, slow patrol and a few fixed camera set-ups
  runAttract(dt) {
    const a = this.attract, L = this.W.L, cam = this.camera;
    a.t += dt; a.shotT -= dt;
    if (a.st === 'roam') {
      a.x += a.dir * 2.1 * dt;
      if (a.x < 22) a.dir = 1; else if (a.x > L - 22) a.dir = -1;
      if (a.t > a.wait) { a.st = 'listen'; a.t = 0; a.wait = 3 + Math.random() * 3; }
    } else if (a.t > a.wait) { a.st = 'roam'; a.t = 0; a.wait = 9 + Math.random() * 9; if (Math.random() < 0.3) a.dir = -a.dir; }
    this.snap = { m: { x: a.x, z: Math.sin(this.time * 0.2) * 1.2, d: a.dir, st: a.st, h: a.h, pk: 0, ps: 0, hands: [0, 0, 0, 0, 0, 0, 0, 0] }, mn: [] };
    if (a.shotT <= 0) { a.shot = (a.shot + 1) % 4; a.shotT = 13; a.anchor = a.x; a.cut = 1; }
    const m = this.monster, t = this.time;
    let px, py, pz, lx = m.x, ly = a.h * 0.62, lz = m.z;
    if (a.shot === 0) { px = a.anchor + a.dir * 24; py = 1.5; pz = -2.6 + Math.sin(t * 0.1) * 0.6; }                 // in the road, it walks at you
    else if (a.shot === 1) { px = m.x - a.dir * 9; py = 7.4; pz = 7.1; ly = a.h * 0.85; }                              // from a balcony, level with its ribs
    else if (a.shot === 2) { px = a.anchor - a.dir * 6; py = 0.5; pz = 3.4; ly = a.h * 0.5; }                         // from the gutter as it passes
    else { px = m.x + a.dir * 15 + Math.sin(t * 0.15) * 3; py = 12; pz = -6.5; ly = a.h * 0.9; }                      // high, across the roofs
    px = clamp(px, 4, L - 4);
    if (a.cut) { cam.position.set(px, py, pz); a.cut = 0; this.blackout = 0.9; } else cam.position.lerp(_v.set(px, py, pz), Math.min(1, dt * 0.8));
    cam.lookAt(lx, ly, lz);
  }

  // ---- things that are not there. Client-only: whispers, knocks, and a figure in a doorway that is gone when you look.
  haunt(dt) {
    this.hauntT -= dt;
    if (this.hauntT > 0) return;
    this.hauntT = 28 + Math.random() * 40 - this.night * 1.2;
    const P = this.player, snd = this.sound, r = Math.random();
    const behind = { x: P.x + Math.sin(P.yaw) * 2.5, y: P.y + 1.5, z: P.z + Math.cos(P.yaw) * 2.5, max: 12 };
    if (r < 0.22) snd.play('breath', 0.9, behind);
    else if (r < 0.42) snd.play('whisper', 1, { x: P.x + (Math.random() - 0.5) * 6, y: P.y + 1.5, z: P.z + (Math.random() - 0.5) * 6, max: 14 });
    else if (r < 0.58) snd.play('knock', 1, { x: P.x + (Math.random() - 0.5) * 10, y: P.y + 1, z: P.z + (Math.random() - 0.5) * 10, max: 22 });
    else if (r < 0.7) snd.play('scream', 0.6, { x: P.x + (Math.random() < 0.5 ? -50 : 50), y: 6, z: 0, max: 120 });
    else this.spawnGhost();
  }
  spawnGhost() {
    if (this.ghost) return;
    const P = this.player, fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw);
    // an open doorway nearby that is not in view right now
    let best = null, bd = 1e9;
    for (const o of this.world.doors) {
      const d = o.d;
      if (o.gone || !o.open || Math.abs(d.y - P.y) > 1) continue;
      const dx = d.cx - P.x, dz = d.cz - P.z, dist = Math.hypot(dx, dz);
      if (dist < 3.5 || dist > 12 || (dx * fx + dz * fz) / dist > 0.2) continue;
      if (dist < bd) { bd = dist; best = d; }
    }
    if (!best) return;
    const g = new THREE.Group(), mat = new THREE.MeshBasicMaterial({ color: 0x020203 }), eye = new THREE.MeshBasicMaterial({ color: 0xd8d0b8 });
    const add = (geo, m, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); g.add(o); return o; };
    add(new THREE.CapsuleGeometry(0.17, 1.3, 4, 8), mat, 0, 1.25, 0); add(new THREE.SphereGeometry(0.15, 10, 8), mat, 0, 2.2, 0).scale.set(0.9, 1.25, 1);
    add(new THREE.CapsuleGeometry(0.05, 1.2, 3, 6), mat, 0.25, 1.15, 0); add(new THREE.CapsuleGeometry(0.05, 1.2, 3, 6), mat, -0.25, 1.15, 0);
    for (const s of [1, -1]) { const e = add(new THREE.SphereGeometry(0.014, 6, 4), eye, s * 0.05, 2.24, -0.14); e.layers.set(FX_LAYER); }
    g.position.set(best.cx, best.y, best.cz); g.rotation.y = Math.atan2(-(P.x - best.cx), -(P.z - best.cz));
    this.scene.add(g);
    this.ghost = { g, t: 0, looked: 0, seen: false };
  }
  updateGhost(dt) {
    const gh = this.ghost;
    if (!gh) return;
    gh.t += dt;
    const c = this.camera.position, dx = gh.g.position.x - c.x, dz = gh.g.position.z - c.z, d = Math.hypot(dx, dz);
    this.camera.getWorldDirection(_d);
    const inView = d > 0.1 && (dx * _d.x + dz * _d.z) / d > 0.82;
    if (inView) { gh.looked += dt; if (!gh.seen) { gh.seen = true; this.sound.play('sting', 0.9); } } else if (gh.seen) gh.looked += dt * 3;
    if (gh.looked > 0.45 || d < 3 || gh.t > 30 || !this.alive) { this.scene.remove(gh.g); this.ghost = null; }
  }

  updateMinions(dt, list) {
    const seen = new Set();
    for (const q of list) {
      let v = this.minions.get(q[0]);
      if (!v) {
        v = new MinionView(this.scene, this.T); this.minions.set(q[0], v);
        v.onStep = (x, y, z) => { if (this.time > this.skitT) { this.skitT = this.time + 0.07; this.sound.play('skitter', 0.7, { x, y, z, max: 22 }); } };
        if (this.debris) this.debris.puff(q[1], q[2] + 0.5, q[3], 2, 6, 1.5, 0x1a2a1c);
      }
      v.tx = q[1]; v.ty = q[2]; v.tz = q[3]; v.tyaw = q[4]; v.chase = q[5];
      seen.add(q[0]);
    }
    for (const [id, v] of this.minions) {
      if (!seen.has(id)) v.dying = 1;
      if (v.update(dt)) { v.dispose(); this.minions.delete(id); }
    }
  }

  spectate(dt) {
    const alive = [...this.avatars.values()].filter((a) => a.alive);
    const cam = this.camera, t = this.time * 0.25;
    let tx, ty, tz, dist = 3.2;
    if (alive.length) { const a = alive[this.spec % alive.length]; tx = a.x; ty = a.y + 1.5; tz = a.z; this.specName = [...this.avatars.entries()].find((e) => e[1] === a)[0]; }
    else { tx = this.monster.x; ty = this.monster.h * 0.7; tz = this.monster.z; dist = 16; this.specName = null; }
    const want = new THREE.Vector3(tx + Math.cos(t) * dist, ty + (alive.length ? 0.8 : 2), tz + Math.sin(t) * dist * (alive.length ? 0.5 : 0.4));
    cam.position.lerp(want, Math.min(1, dt * 3));
    cam.lookAt(tx, ty, tz);
  }

  updateHud() {
    const P = this.player, playing = this.phase === 'night' || this.phase === 'dawn';
    let zone = null, hidden = false;
    this.prompt = null;
    if (playing && this.alive) {
      zone = zoneAt(this.W, P.x, P.y, P.z);
      // what would E do? nearest thing we are facing: a star, a closet, a door
      let best = 2.4;
      const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw);
      const facing = (dx, dz, dist, tight) => dist < 0.75 || (dx * fx + dz * fz) / dist > (tight ? 0.6 : 0.35);
      for (const o of this.world.doors) {
        if (o.gone) continue;
        const d = o.d, dx = d.cx - P.x, dz = d.cz - P.z;
        if (Math.abs(dx) > 2.4 || Math.abs(dz) > 2.4 || Math.abs(d.y - P.y) > 1.2) continue;
        const dist = Math.hypot(dx, dz);
        if (dist < best && facing(dx, dz, dist)) { best = dist; this.prompt = { type: 'door', id: d.id, text: d.open ? 'Close door' : 'Open door' }; }
      }
      for (const o of this.world.closets) {
        const c = o.c;
        if (o.gone || Math.abs(c.y - P.y) > 1.2) continue;
        const inside = P.x > c.x0 - 0.1 && P.x < c.x1 + 0.1 && P.z > c.z0 - 0.1 && P.z < c.z1 + 0.1;
        if (inside && !o.open) hidden = true;
        // aim at the doors, not the middle of the box
        const dx = c.cx + c.f[0] * 0.45 - P.x, dz = c.cz + c.f[1] * 0.45 - P.z, dist = Math.hypot(dx, dz);
        if (inside) { best = 0; this.prompt = { type: 'closet', id: c.id, text: o.open ? 'Pull the closet shut' : 'Open the closet' }; }
        else if (dist < Math.min(best, 2.0) && facing(dx, dz, dist)) { best = dist; this.prompt = { type: 'closet', id: c.id, text: o.open ? 'Close closet' : 'Open closet' }; }
      }
      let sb = 2.0;
      for (const p of this.world.pickups.values()) {
        if (p.k.k !== 'star' || Math.abs(p.k.y - P.y - 0.8) > 1.6) continue;
        if (p.k.closet != null && !this.W.closets[p.k.closet].open) continue;
        const dx = p.k.x - P.x, dz = p.k.z - P.z, dist = Math.hypot(dx, dz);
        if (dist < sb && facing(dx, dz, dist, true)) { sb = dist; this.prompt = { type: 'star', id: p.k.id, text: 'Take the star' }; }
      }
      if (this.taking) this.prompt = { type: 'star', id: this.taking.id, text: 'Taking…', progress: Math.min(1, this.taking.t) };
    }
    this.hidden = hidden;
    const others = [];
    for (const [id, a] of this.avatars) others.push({ name: this.names.get(id), hp: a.hp ?? 100, alive: a.alive });
    this.hud.update({
      playing, alive: this.alive, night: this.night, stars: this.stars, quota: this.quota, tl: this.tl, phase: this.phase, cd: this.cd,
      hp: Math.max(0, this.hp), stamina: P ? P.stamina : 100, tired: P && P.tired, ammo: this.ammo, torch: this.torchOn, bottles: this.bottles,
      zone: zone ? zone.label : '', indoors: zone ? zone.indoors : false, expo: this.expo, noise: this.noiseLvl,
      prompt: this.prompt ? this.prompt.text : null, progress: this.prompt && this.prompt.progress, hidden,
      minions: [...this.minions.values()].filter((v) => !v.dying).length,
      others, crouch: P && P.crouch, spec: !this.alive && this.specName ? this.names.get(this.specName) : null, fear: this.fear,
    });
  }

  destroy() {
    this.running = false;
    this.exitLock();
    for (const f of this.unbind || []) f();
    if (this.world) this.world.dispose();
    this.renderer.dispose();
  }
}
