// The in-game client: rendering, input, local player, and applying what the simulation says.
import * as THREE from 'three';
import { genWorld, zoneAt, K } from '../shared/world.js';
import { makeTextures, makeMaterials } from './textures.js';
import { WorldView } from './worldview.js';
import { Player } from './player.js';
import { MonsterView } from './monster.js';
import { MinionView } from './minion.js';
import { Avatar } from './avatar.js';
import { Post, Debris } from './fx.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const _v = new THREE.Vector3();
const QUALITY = {
  low: { pr: 0.7, shadow: 0, torchShadow: false },
  medium: { pr: 1, shadow: 2048, torchShadow: false },
  high: { pr: 1.5, shadow: 4096, torchShadow: true },
};

export class Game {
  constructor({ canvas, settings, sound, hud }) {
    this.canvas = canvas; this.set = settings; this.sound = sound; this.hud = hud;
    this.q = QUALITY[settings.quality] || QUALITY.medium;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    r.shadowMap.enabled = this.q.shadow > 0; r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.25;
    const scene = this.scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0c1a22);
    scene.fog = new THREE.FogExp2(0x0c1a22, 0.024);
    const cam = this.camera = new THREE.PerspectiveCamera(settings.fov, 1, 0.08, 220);
    cam.rotation.order = 'YXZ'; scene.add(cam);

    // moonlight + sky fill
    scene.add(new THREE.HemisphereLight(0x5f86a8, 0x1c1814, 1.7));
    const moon = this.moon = new THREE.DirectionalLight(0x8fb2e0, 2.8);
    moon.position.set(20, 60, -34); moon.target.position.set(60, 0, 0); scene.add(moon, moon.target);
    if (this.q.shadow) {
      moon.castShadow = true; moon.shadow.mapSize.set(this.q.shadow, this.q.shadow);
      const sc = moon.shadow.camera; sc.left = -75; sc.right = 75; sc.top = 40; sc.bottom = -40; sc.near = 1; sc.far = 160;
      moon.shadow.bias = -0.0008; moon.shadow.normalBias = 0.06;
    }
    const disc = new THREE.Mesh(new THREE.CircleGeometry(9, 32), new THREE.MeshBasicMaterial({ color: 0xcfe0f0, fog: false }));
    disc.position.set(-40, 120, -150); disc.lookAt(60, 0, 0); scene.add(disc);

    // torch
    const torch = this.torch = new THREE.SpotLight(0xfff0dc, 0, 34, 0.62, 0.9, 1.35);
    torch.position.set(0.18, -0.12, 0.1); torch.target.position.set(0.05, -0.05, -5); cam.add(torch, torch.target);
    if (this.q.torchShadow) { torch.castShadow = true; torch.shadow.mapSize.set(1024, 1024); torch.shadow.camera.near = 0.3; torch.shadow.bias = -0.002; }
    this.torchOn = false;
    this.flash = new THREE.PointLight(0xffc080, 0, 14); this.flash.position.set(0.2, -0.1, -0.8); cam.add(this.flash);

    this.T = makeTextures(r.capabilities.getMaxAnisotropy() > 4 ? 4 : 1);
    this.M = makeMaterials(this.T, settings.quality !== 'low');
    this.post = new Post(r, scene, cam, settings.quality);

    // drifting ash
    const N = 500, pos = new Float32Array(N * 3);
    for (let i = 0; i < N * 3; i++) pos[i] = (Math.random() - 0.5) * 24;
    const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.ash = new THREE.Points(pg, new THREE.PointsMaterial({ color: 0x9fb0b8, size: 0.035, transparent: true, opacity: 0.55, depthWrite: false }));
    this.ash.frustumCulled = false; scene.add(this.ash);

    this.world = null; this.W = null; this.seed = null;
    this.monster = new MonsterView(scene, this.T); this.monster.setVisible(false);
    this.minions = new Map(); this.skitT = 0; this.taking = null; this.eaten = null; this.hidden = false;
    this.monster.onStep = (x, z) => this.monsterStep(x, z);
    this.avatars = new Map();
    this.me = null; this.player = null;
    this.snap = null; this.phase = 'idle'; this.alive = false; this.hp = 100; this.ammo = 0; this.expo = 0;
    this.keys = {}; this.mdx = 0; this.mdy = 0; this.locked = false;
    this.shake = 0; this.hurtFx = 0; this.deadFx = 0; this.recoil = 0; this.noiseLvl = 0; this.shootCd = 0;
    this.sendT = 0; this.hudT = 0; this.pickT = new Map(); this.prompt = null; this.spec = 0; this.time = 0;
    this.ray = new THREE.Raycaster();
    this.viewGun = null;

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
    const pr = Math.min(window.devicePixelRatio || 1, 2) * this.q.pr;
    this.renderer.setPixelRatio(Math.min(pr, 2)); this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.fov = this.set.fov; this.camera.updateProjectionMatrix();
    this.post.size(w, h, Math.min(pr, 2));
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
        if (m.by === this.me) this.hud.toast(m.k === 'star' ? 'Star taken. It heard that. Move.' : m.k === 'gun' ? 'Flare pistol: +2 rounds (left click)' : 'Bandages: +35 health', m.k);
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
      case 'smash': return this.onSmash(m);
      case 'dead': return this.onDead(m);
      case 'hp':
        this.hp = m.hp; this.hurtFx = 1; this.shake = Math.max(this.shake, 0.5); this.sound.play('hurt', 1);
        if (m.cause === 'debris') this.hud.toast('Hit by falling debris', 'bad');
        if (m.cause === 'minion') this.hud.toast('Bitten. Its shriek carries to the street.', 'bad');
        return;
      case 'alert':
        this.sound.play('alert', 1); this.hud.alert('IT KNOWS WHERE YOU ARE');
        return;
      case 'fx': {
        const max = { roar: 140, spot: 110, windup: 80, scratch: 26, reach: 30, doorslam: 30, screech: 45, bite: 25, mdie: 30, summon: 160, starcry: 60 }[m.k] || 40;
        this.sound.play(m.k, 1, { x: m.x, y: m.y, z: m.z, max });
        if (m.k === 'mdie' && this.debris) this.debris.puff(m.x, m.y, m.z, 1.6, 5, 1, 0x1a2a1c);
        if (m.k === 'bite' && this.debris) this.debris.puff(m.x, m.y + 0.4, m.z, 0.7, 3, 0.5, 0x6a0808);
        if (m.k === 'roar' || m.k === 'spot') this.shake = Math.max(this.shake, 0.25);
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

  build(seed) {
    if (this.world) this.world.dispose();
    this.seed = seed;
    this.W = genWorld(seed);
    this.world = new WorldView(this.scene, this.W, this.M, this.T, this.set.quality);
    this.debris = new Debris(this.scene, this.M.brick, this.T.soft, this.world.col);
    this.gone = new Set();
    this.player = new Player(this.world.col);
    this.viewGun = this.world.makeGun(); this.viewGun.position.set(0.2, -0.2, -0.42); this.viewGun.visible = false; this.camera.add(this.viewGun);
  }

  startNight(m) {
    if (!this.world || this.seed !== this.seedWanted) this.build(this.seedWanted);
    const W = this.W, w = this.world;
    this.night = m.n; this.quota = m.quota; this.phase = 'night'; this.snap = null; this.stars = 0; this.tl = m.duration;
    m.doors.forEach((o, i) => { W.doors[i].open = !!o; w.setDoor(i, !!o, true); });
    for (const g of m.destroyed) if (!(this.gone ||= new Set()).has(g)) { this.gone.add(g); w.smash(g); }
    W.closets.forEach((c, i) => w.setCloset(i, false, true));
    for (const v of this.minions.values()) v.dispose();
    this.minions.clear(); this.taking = null; this.eaten = null;
    w.setPickups(m.pickups);
    // avatars
    for (const a of this.avatars.values()) this.scene.remove(a.group);
    this.avatars.clear(); this.names = new Map();
    for (const p of m.players) {
      this.names.set(p.id, p.name);
      if (p.id === this.me) { this.hp = p.hp; this.ammo = p.ammo; continue; }
      const a = new Avatar(p.char, p.name); a.alive = true; a.fl = 0; this.scene.add(a.group); this.avatars.set(p.id, a);
    }
    const s = m.spawn[this.me];
    this.alive = !!s; this.deadFx = 0; this.hurtFx = 0; this.expo = 0;
    if (s) {
      const side = s[2] > 0 ? 1 : -1;
      this.player.place(s[0], s[1], s[2], side > 0 ? 0 : Math.PI);   // face the street door
      this.player.stamina = 100; this.player.tired = false;
    }
    this.monster.reset(); this.monster.setVisible(true);
    this.hud.night(m);
  }

  onSnap(m) {
    this.phase = m.ph; this.stars = m.stars; this.tl = m.tl; this.cd = m.cd;
    for (const p of m.p) {
      if (p[0] === this.me) {
        if (this.alive) { this.hp = p[6]; this.ammo = p[8]; this.expo = p[9]; }
        continue;
      }
      const a = this.avatars.get(p[0]);
      if (!a) continue;
      a.tx = p[1]; a.ty = p[2]; a.tz = p[3]; a.tyaw = p[4]; a.fl = p[5]; a.hp = p[6];
      a.alive = !!p[7]; a.group.visible = a.alive;
    }
  }

  onSmash(m) {
    const d = Math.hypot(m.x - this.camera.position.x, m.y - this.camera.position.y, m.z - this.camera.position.z);
    this.sound.play('smash', 1, { x: m.x, y: m.y, z: m.z, max: 150 });
    this.shake = Math.max(this.shake, clamp(1.6 - d / 22, 0.15, 1.6));
    const side = m.z > 0 ? 1 : -1;
    const boxes = m.g ? this.world.smash(m.g) : [];
    if (m.g) this.gone.add(m.g);
    if (boxes.length) this.debris.burst(boxes, side);
    if (m.roof || !boxes.length) {
      for (let i = 0; i < (boxes.length ? 30 : 50); i++) this.debris.chunk(m.x + (Math.random() - 0.5) * 7, m.y + Math.random() * 1.2, m.z + side * Math.random() * 1.5, (Math.random() - 0.5) * 7, 2 + Math.random() * 6, side * (Math.random() * 9 - 2), 0.1 + Math.random() * 0.25);
      this.debris.puff(m.x, m.y + 0.5, m.z + side, 4, 8, 6);
    }
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
    if (this.debris) this.debris.puff(mp.x, mp.y, mp.z, 1.6, 10, 1.6, 0x7a0606);
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
  monsterStep(x, z) {
    const c = this.camera.position, d = Math.hypot(x - c.x, z - c.z);
    this.sound.play('mstep', 1, { x, y: 0, z, max: 75 });
    if (d < 32) this.shake = Math.max(this.shake, (1 - d / 32) * 0.55);
    if (this.debris && d < 50) this.debris.puff(x, 0.4, z, 2.2, 2, 1.5);
  }

  // ------------------------------------------------------------------ frame
  frame(now) {
    const dt = Math.max(0, Math.min(0.05, (now - this.last) / 1000)); this.last = now; this.time += dt;
    const cam = this.camera, set = this.set, snd = this.sound;
    const playing = this.world && (this.phase === 'night' || this.phase === 'dawn');
    if (this.world) {
      const P = this.player;
      if (playing && this.alive) {
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
        // camera
        const bob = set.headBob ? Math.sin(P.bob) * 0.035 : 0;
        cam.position.set(P.x, P.y + P.eye + bob + P.camLift, P.z);
        cam.rotation.set(P.pitch + this.recoil * 0.06, P.yaw, set.headBob ? Math.sin(P.bob * 0.5) * 0.006 : 0);
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
        // guns and bandages are picked up by walking into them
        for (const p of this.world.pickups.values()) {
          if (p.k.k === 'star') continue;
          if (Math.abs(p.k.x - P.x) > 1.3 || Math.abs(p.k.z - P.z) > 1.3 || Math.abs(p.k.y - P.y - 0.8) > 1.5) continue;
          if ((this.pickT.get(p.k.id) || 0) > this.time) continue;
          this.pickT.set(p.k.id, this.time + 0.5); this.net.send({ t: 'pick', id: p.k.id });
        }
      } else if (this.eaten) {
        // held in its fist, carried up to the mouth
        const e = this.eaten, tip = this.monster.arms[e.h].tip, hp = this.monster.mouthPos;
        e.t += dt;
        cam.position.lerp(_v.set(tip.x, tip.y + 0.2, tip.z), Math.min(1, dt * 10));
        cam.lookAt(hp.x, hp.y, hp.z);
        cam.rotation.z += Math.sin(e.t * 9) * 0.12;
        this.shake = Math.max(this.shake, 0.5);
        this.hurtFx = Math.max(this.hurtFx, Math.min(0.8, e.t * 0.25));
        if (e.t > 6) { this.eaten = null; this.deadFx = 1; this.hud.dead('hand'); }
      } else if (playing || this.phase === 'inter' || this.phase === 'over') {
        this.spectate(dt);
      }
      this.mdx = this.mdy = 0;

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
      if (this.snap) { this.monster.update(dt, this.snap.m); this.updateMinions(dt, this.snap.mn || []); }
      this.world.update(dt, cam.position, this.fear || 0);
      this.debris.update(dt);
    }

    // shake / recoil / torch
    this.shake = Math.max(0, this.shake - dt * 1.8);
    if (this.shake > 0) {
      const s = this.shake * this.shake * 0.05;
      cam.rotation.x += (Math.random() - 0.5) * s; cam.rotation.y += (Math.random() - 0.5) * s; cam.rotation.z += (Math.random() - 0.5) * s;
    }
    this.recoil = Math.max(0, this.recoil - dt * 6); this.shootCd -= dt;
    this.flash.intensity = Math.max(0, this.flash.intensity - dt * 600);
    this.torch.intensity += ((this.torchOn && this.alive ? 18 : 0) - this.torch.intensity) * Math.min(1, dt * 20);
    if (this.viewGun) {
      this.viewGun.visible = this.alive && this.ammo > 0;
      this.viewGun.position.set(0.17, -0.15 + this.recoil * 0.02, -0.4 + this.recoil * 0.06); this.viewGun.rotation.set(this.recoil * 0.4, 0.08, 0); this.viewGun.scale.setScalar(0.55);
    }
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
    snd.listener.x = c.x; snd.listener.y = c.y; snd.listener.z = c.z; snd.listener.yaw = cam.rotation.y;
    snd.update(dt, playing && this.alive ? this.fear : 0, playing ? md : 999);

    this.blackout = Math.max(0, (this.blackout || 0) - dt * 0.5);
    this.post.render(dt, { hurt: this.hurtFx, fear: this.fear, gamma: set.gamma * (1 - this.blackout * 0.85), dead: this.alive || !playing || this.eaten ? 0 : 0.6 });

    this.hudT -= dt;
    if (this.hudT <= 0 && this.world) { this.hudT = 0.1; this.updateHud(); }
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
        if (Math.abs(c.y - P.y) > 1.2) continue;
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
      hp: Math.max(0, this.hp), stamina: P ? P.stamina : 100, tired: P && P.tired, ammo: this.ammo, torch: this.torchOn,
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
