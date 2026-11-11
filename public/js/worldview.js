// Turns the generated street into meshes, colliders, doors, lights and pickups.
import * as THREE from 'three';
import { Colliders } from './physics.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const angle = (d) => Math.atan2(-d[1], d[0]);

function starGeometry() {
  const sh = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2, r = i % 2 ? 0.11 : 0.27;
    i ? sh.lineTo(Math.cos(a) * r, Math.sin(a) * r) : sh.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const g = new THREE.ExtrudeGeometry(sh, { depth: 0.07, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 1 });
  g.translate(0, 0, -0.035);
  return g;
}

export class WorldView {
  constructor(scene, W, M, T, quality) {
    this.scene = scene; this.W = W; this.T = T;
    this.col = new Colliders();
    this.group = new THREE.Group(); scene.add(this.group);
    this.fac = new Map();      // facade group -> [{mesh,index,col}]
    this.time = 0;
    const shadows = quality !== 'low';

    // ---- boxes -> one instanced mesh per material
    const by = new Map();
    for (const b of W.boxes) {
      const col = b.c ? this.col.add(b.x, b.y, b.z, b.sx, b.sy, b.sz) : null;
      let rec = null;
      if (!b.nv) {
        let l = by.get(b.m);
        if (!l) by.set(b.m, (l = []));
        rec = { list: l, index: l.length };
        l.push(b);
      }
      if (b.g) {
        let f = this.fac.get(b.g);
        if (!f) this.fac.set(b.g, (f = []));
        f.push({ rec, col, b });
      }
    }
    const unit = new THREE.BoxGeometry(1, 1, 1);
    const meshOf = new Map();
    for (const [k, list] of by) {
      const mesh = new THREE.InstancedMesh(unit, M[k] || M.concrete, list.length);
      list.forEach((b, i) => { _m.compose(_p.set(b.x, b.y, b.z), _q.identity(), _s.set(b.sx, b.sy, b.sz)); mesh.setMatrixAt(i, _m); });
      mesh.castShadow = shadows; mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      this.group.add(mesh); meshOf.set(list, mesh);
    }
    for (const f of this.fac.values()) for (const e of f) if (e.rec) e.mesh = meshOf.get(e.rec.list);

    // ---- ground
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(W.L + 60, 60), M.asphalt);
    ground.rotation.x = -Math.PI / 2; ground.position.set(W.L / 2, 0, 0); ground.receiveShadow = true;
    this.group.add(ground);

    // ---- doors
    const doorMat = M.wooddark, knobMat = M.metal;
    this.doors = W.doors.map((d) => {
      const pivot = new THREE.Group();
      pivot.position.set(d.hx, d.y, d.hz);
      const leaf = new THREE.Mesh(new THREE.BoxGeometry(d.len - 0.04, d.h - 0.04, 0.07), doorMat);
      leaf.position.set(d.len / 2, d.h / 2, 0); leaf.castShadow = shadows; leaf.receiveShadow = true;
      const knob = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.16), knobMat);
      knob.position.set(d.len - 0.14, 1.0, 0);
      pivot.add(leaf, knob);
      this.group.add(pivot);
      const a0 = angle(d.cd); let a1 = angle(d.od);
      while (a1 - a0 > Math.PI) a1 -= Math.PI * 2;
      while (a1 - a0 < -Math.PI) a1 += Math.PI * 2;
      const horiz = Math.abs(d.cd[0]) > 0.5;
      const col = this.col.add(d.cx, d.y + d.h / 2, d.cz, horiz ? d.len : 0.2, d.h, horiz ? 0.2 : d.len);
      const o = { d, pivot, a0, a1, t: d.open ? 1 : 0, col, open: d.open };
      col.on = !d.open; pivot.rotation.y = d.open ? a1 : a0;
      return o;
    });

    // ---- light sources (candles, sigils, bulbs) + a small pool of real lights that follows the camera
    this.srcs = [];
    const flameGeo = new THREE.ConeGeometry(0.022, 0.09, 6), flameMat = new THREE.MeshBasicMaterial({ color: 0xffb060 });
    const bulbGeo = new THREE.SphereGeometry(0.07, 8, 6);
    const sigGeo = new THREE.PlaneGeometry(1.15, 1.15);
    for (const l of W.lights) {
      const s = { x: l.x, y: l.y, z: l.z, kind: l.kind, flat: l.flat, ph: Math.random() * 50, mesh: null, on: true };
      if (l.kind === 'candle') {
        s.mesh = new THREE.Mesh(flameGeo, flameMat); s.mesh.position.set(l.x, l.y - 0.02, l.z);
        s.color = 0xff8a3c; s.power = 2.2; s.dist = 7;
      } else if (l.kind === 'lamp') {
        s.mesh = new THREE.Mesh(bulbGeo, new THREE.MeshBasicMaterial({ color: 0xffe2a8 })); s.mesh.position.set(l.x, l.y, l.z);
        s.color = 0xffd9a0; s.power = 5; s.dist = 9;
      } else { s.color = 0xff2a2a; s.power = 9; s.dist = 9; }
      if (s.mesh) this.group.add(s.mesh);
      this.srcs.push(s);
    }
    for (const d of W.decals) {
      const mat = new THREE.MeshBasicMaterial({ map: T.sigil, color: 0xff2030, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
      const mesh = new THREE.Mesh(sigGeo, mat);
      mesh.position.set(d.x, d.y, d.z); if (d.nz < 0) mesh.rotation.y = Math.PI;
      this.group.add(mesh);
      const s = this.srcs.find((q) => q.kind === 'sigil' && q.flat === d.flat);
      if (s) s.mesh = mesh;
    }
    for (const l of W.lamps) {
      const mat = new THREE.MeshBasicMaterial({ color: l.broken ? 0x1a1a18 : 0xffc890 });
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.06, 0.4), mat); mesh.position.set(l.x, l.y + 0.03, l.z);
      this.group.add(mesh);
      if (!l.broken) this.srcs.push({ x: l.x, y: l.y - 0.3, z: l.z, kind: 'street', flat: -1, ph: Math.random() * 50, mesh, color: 0xffb070, power: 60, dist: 22, flicker: l.flicker, on: true });
    }
    const nPool = quality === 'low' ? 5 : quality === 'medium' ? 8 : 12;
    this.pool = Array.from({ length: nPool }, () => { const p = new THREE.PointLight(0xffffff, 0, 8, 1.6); scene.add(p); return p; });
    this.poolT = 0; this.near = [];

    // ---- pickups
    this.pickups = new Map();
    this.starGeo = starGeometry();
    this.starMat = new THREE.MeshBasicMaterial({ color: 0xffe9a8 });
    this.glowMat = new THREE.SpriteMaterial({ map: T.soft, color: 0xffd070, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending });
    this.gunGlow = new THREE.SpriteMaterial({ map: T.soft, color: 0x58d8ff, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending });
    this.medGlow = new THREE.SpriteMaterial({ map: T.soft, color: 0xff5050, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending });
    this.M = M;
  }

  makeGun() {
    const g = new THREE.Group(), M = this.M;
    const a = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.09, 0.42), M.black); a.position.set(0, 0.05, -0.08);
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.2, 0.09), M.wooddark); b.position.set(0, -0.08, 0.1); b.rotation.x = 0.25;
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.2, 8), M.metal); c.rotation.x = Math.PI / 2; c.position.set(0, 0.06, -0.36);
    const e = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.3), new THREE.MeshBasicMaterial({ color: 0x48d0ff })); e.position.set(0, 0.105, -0.1);
    g.add(a, b, c, e);
    return g;
  }

  setPickups(list) {
    for (const p of this.pickups.values()) this.group.remove(p.obj);
    this.pickups.clear();
    for (const k of list) {
      const obj = new THREE.Group();
      obj.position.set(k.x, k.y, k.z);
      let spr;
      if (k.k === 'star') { obj.add(new THREE.Mesh(this.starGeo, this.starMat)); spr = new THREE.Sprite(this.glowMat); spr.scale.setScalar(1.5); }
      else if (k.k === 'gun') { const g = this.makeGun(); g.scale.setScalar(1.5); g.rotation.z = 0.5; obj.add(g); spr = new THREE.Sprite(this.gunGlow); spr.scale.setScalar(1.3); }
      else {
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.22, 0.22), this.M.white);
        const cr = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.23), new THREE.MeshBasicMaterial({ color: 0xff3030 }));
        const cr2 = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.23), cr.material);
        obj.add(box, cr, cr2); spr = new THREE.Sprite(this.medGlow); spr.scale.setScalar(1.2);
      }
      obj.add(spr);
      this.group.add(obj);
      this.pickups.set(k.id, { k, obj, ph: Math.random() * 6 });
    }
  }
  removePickup(id) {
    const p = this.pickups.get(id);
    if (p) { this.group.remove(p.obj); this.pickups.delete(id); }
    return p;
  }

  setDoor(id, open, instant) {
    const o = this.doors[id];
    if (!o) return;
    o.open = open; o.col.on = !open;
    if (instant) { o.t = open ? 1 : 0; o.pivot.rotation.y = open ? o.a1 : o.a0; }
  }

  // rip the front wall off a flat
  smash(flatId, restore) {
    const f = this.W.flats[flatId];
    if (!f || !f.g) return [];
    f.destroyed = !restore;
    const list = this.fac.get(f.g) || [], touched = new Set();
    for (const e of list) {
      if (e.col) e.col.on = !!restore;
      if (e.mesh) {
        if (restore) { const b = e.b; _m.compose(_p.set(b.x, b.y, b.z), _q.identity(), _s.set(b.sx, b.sy, b.sz)); e.mesh.setMatrixAt(e.rec.index, _m); } else e.mesh.setMatrixAt(e.rec.index, ZERO);
        touched.add(e.mesh);
      }
    }
    for (const m of touched) m.instanceMatrix.needsUpdate = true;
    for (const s of this.srcs) if (s.flat === flatId && s.kind !== 'sigil') { s.on = !!restore; if (s.mesh) s.mesh.visible = !!restore; }
    return list.filter((e) => e.col).map((e) => e.b);
  }

  update(dt, cam) {
    this.time += dt;
    const t = this.time;
    for (const o of this.doors) {
      const target = o.open ? 1 : 0;
      if (o.t !== target) {
        o.t += Math.sign(target - o.t) * dt * 3.2;
        if ((target - o.t) * (target ? 1 : -1) < 0) o.t = target;
        const e = o.t * o.t * (3 - 2 * o.t);
        o.pivot.rotation.y = o.a0 + (o.a1 - o.a0) * e;
      }
    }
    for (const p of this.pickups.values()) {
      p.obj.rotation.y = t * 1.6 + p.ph;
      p.obj.children[0].position.y = Math.sin(t * 2 + p.ph) * 0.07;
    }
    // re-pick which real lights are nearest a few times a second
    this.poolT -= dt;
    if (this.poolT <= 0) {
      this.poolT = 0.3;
      const cx = cam.x, cy = cam.y, cz = cam.z;
      for (const s of this.srcs) s.d = s.on ? Math.hypot(s.x - cx, (s.y - cy) * 3, s.z - cz) - (s.kind === 'street' ? 10 : s.kind === 'sigil' ? 4 : 0) : 1e9;
      this.near = this.srcs.filter((s) => s.d < 34).sort((a, b) => a.d - b.d).slice(0, this.pool.length);
    }
    for (let i = 0; i < this.pool.length; i++) {
      const L = this.pool[i], s = this.near[i];
      if (!s) { L.intensity = 0; continue; }
      let f = 1;
      if (s.kind === 'candle') f = 0.8 + 0.2 * Math.sin(t * 11 + s.ph) * Math.sin(t * 7.3 + s.ph * 2);
      else if (s.kind === 'sigil') { f = 0.75 + 0.25 * Math.sin(t * 1.7 + s.ph); if (s.mesh) s.mesh.material.opacity = f; }
      else if (s.kind === 'lamp' || s.flicker) { f = Math.sin(t * 3.1 + s.ph) * Math.sin(t * 17 + s.ph) > 0.55 ? 0.15 : 1; if (s.mesh && s.kind === 'street') s.mesh.material.color.setHex(f < 0.5 ? 0x4a3a28 : 0xffc890); }
      const fade = Math.min(1, Math.max(0, (34 - s.d) / 8));
      L.position.set(s.x, s.y, s.z); L.color.setHex(s.color); L.distance = s.dist; L.intensity = s.power * f * fade;
    }
  }

  dispose() {
    this.scene.remove(this.group);
    for (const p of this.pool) this.scene.remove(p);
    this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  }
}
