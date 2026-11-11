// Turns the generated street into meshes, colliders, doors, closets, lights and pickups.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Colliders } from './physics.js';
import { SOFT } from './textures.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const angle = (d) => Math.atan2(-d[1], d[0]);
const near = (a0, a1) => { while (a1 - a0 > Math.PI) a1 -= Math.PI * 2; while (a1 - a0 < -Math.PI) a1 += Math.PI * 2; return a1; };

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
    this.scene = scene; this.W = W; this.T = T; this.M = M;
    this.col = new Colliders();
    this.group = new THREE.Group(); scene.add(this.group);
    this.fac = new Map();      // breakable group -> [{mesh,index,col,mat4}]
    this.time = 0;
    const shadows = quality !== 'low', hi = quality !== 'low';
    const facAdd = (g, e) => { let f = this.fac.get(g); if (!f) this.fac.set(g, (f = [])); f.push(e); };

    // ---- boxes -> one instanced mesh per material (soft materials get rounded edges)
    const by = new Map();
    for (const b of W.boxes) {
      const col = b.c ? this.col.add(b.x, b.y, b.z, b.sx, b.sy, b.sz) : null;
      let e = null;
      if (!b.nv) {
        let l = by.get(b.m);
        if (!l) by.set(b.m, (l = []));
        e = { list: l, index: l.length, b };
        l.push(e);
      }
      if (b.g) facAdd(b.g, e ? Object.assign(e, { col }) : { col, b });
    }
    const unit = new THREE.BoxGeometry(1, 1, 1), round = hi ? new RoundedBoxGeometry(1, 1, 1, 2, 0.09) : unit;
    for (const [k, list] of by) {
      const mesh = new THREE.InstancedMesh(SOFT.has(k) ? round : unit, M[k] || M.concrete, list.length);
      list.forEach((e, i) => { const b = e.b; e.mesh = mesh; e.mat = new THREE.Matrix4().compose(_p.set(b.x, b.y, b.z), _q.identity(), _s.set(b.sx, b.sy, b.sz)); mesh.setMatrixAt(i, e.mat); });
      mesh.castShadow = shadows; mesh.receiveShadow = true; mesh.frustumCulled = false;
      this.group.add(mesh);
    }

    // ---- round props
    const seg = hi ? 12 : 7;
    const torus = new THREE.TorusGeometry(0.5, 0.045, 6, hi ? 18 : 10); torus.rotateX(Math.PI / 2);
    const GEO = { cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, seg), cone: new THREE.ConeGeometry(0.5, 1, seg), sph: new THREE.SphereGeometry(0.5, seg, Math.max(6, seg - 4)), tor: torus };
    const pb = new Map();
    for (const p of W.props) {
      const k = p.s + '|' + p.m;
      let l = pb.get(k);
      if (!l) pb.set(k, (l = []));
      const e = { index: l.length, b: p };
      l.push(e);
      if (p.g) facAdd(p.g, e);
    }
    for (const [k, list] of pb) {
      const [s, mk] = k.split('|');
      const mesh = new THREE.InstancedMesh(GEO[s], M[mk] || M.concrete, list.length);
      list.forEach((e, i) => { const p = e.b; e.mesh = mesh; e.mat = new THREE.Matrix4().compose(_p.set(p.x, p.y, p.z), _q.setFromEuler(_e.set(p.rx, p.ry, p.rz)), _s.set(p.sx, p.sy, p.sz)); mesh.setMatrixAt(i, e.mat); });
      mesh.castShadow = shadows && mk !== 'glass' && mk !== 'rail'; mesh.receiveShadow = true; mesh.frustumCulled = false;
      this.group.add(mesh);
    }

    // ---- ground
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(W.L + 60, 60), M.asphalt);
    ground.rotation.x = -Math.PI / 2; ground.position.set(W.L / 2, 0, 0); ground.receiveShadow = true;
    this.group.add(ground);

    // ---- sagging cables
    const cmat = new THREE.LineBasicMaterial({ color: 0x06080a });
    for (const c of W.cables) {
      const pts = [];
      for (let i = 0; i <= 14; i++) { const t = i / 14; pts.push(new THREE.Vector3(c.a[0] + (c.b[0] - c.a[0]) * t, c.a[1] + (c.b[1] - c.a[1]) * t - Math.sin(t * Math.PI) * c.sag, c.a[2] + (c.b[2] - c.a[2]) * t)); }
      this.group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), cmat));
    }

    // ---- doors
    const leafGeo = (w, h) => (hi ? new RoundedBoxGeometry(w, h, 0.07, 1, 0.02) : new THREE.BoxGeometry(w, h, 0.07));
    const knobGeo = new THREE.SphereGeometry(0.045, 8, 6);
    this.doors = W.doors.map((d) => {
      const pivot = new THREE.Group();
      pivot.position.set(d.hx, d.y, d.hz);
      const leaf = new THREE.Mesh(leafGeo(d.len - 0.04, d.h - 0.04), M.wooddark);
      leaf.position.set(d.len / 2, d.h / 2, 0); leaf.castShadow = shadows; leaf.receiveShadow = true;
      for (const py of [0.55, 1.5]) { const panel = new THREE.Mesh(new THREE.BoxGeometry(d.len - 0.3, 0.7, 0.09), M.wood); panel.position.set(d.len / 2, py, 0); pivot.add(panel); }
      for (const z of [0.07, -0.07]) { const knob = new THREE.Mesh(knobGeo, M.metal); knob.position.set(d.len - 0.14, 1.0, z); pivot.add(knob); }
      pivot.add(leaf);
      this.group.add(pivot);
      const a0 = angle(d.cd), a1 = near(a0, angle(d.od));
      const horiz = Math.abs(d.cd[0]) > 0.5;
      const col = this.col.add(d.cx, d.y + d.h / 2, d.cz, horiz ? d.len : 0.2, d.h, horiz ? 0.2 : d.len);
      const o = { d, pivot, a0, a1, t: d.open ? 1 : 0, col, open: d.open };
      col.on = !d.open; pivot.rotation.y = d.open ? a1 : a0;
      return o;
    });

    // ---- closets: two leaves, one collider across the front
    this.closets = W.closets.map((c) => {
      const dir = [(c.h1[0] - c.h0[0]) / c.w, (c.h1[1] - c.h0[1]) / c.w], half = c.w / 2;
      const leaves = [[c.h0, dir, 1], [c.h1, [-dir[0], -dir[1]], -1]].map(([h, cd, sgn]) => {
        const pivot = new THREE.Group(); pivot.position.set(h[0], c.y, h[1]);
        const leaf = new THREE.Mesh(leafGeo(half - 0.02, 2.0), M.wooddark); leaf.position.set(half / 2, 1.02, 0); leaf.castShadow = shadows;
        const inset = new THREE.Mesh(new THREE.BoxGeometry(half - 0.2, 1.6, 0.09), M.wood); inset.position.set(half / 2, 1.05, 0);
        const knob = new THREE.Mesh(knobGeo, M.metal); knob.position.set(half - 0.09, 1.05, 0.06 * sgn); const knob2 = knob.clone(); knob2.position.z *= -1;
        pivot.add(leaf, inset, knob, knob2); this.group.add(pivot);
        const a0 = angle(cd);
        // swing outwards, a little past square
        const out = near(a0, angle(c.f)), a1 = a0 + (out - a0) * 1.15;
        pivot.rotation.y = a0;
        return { pivot, a0, a1 };
      });
      const horiz = Math.abs(dir[0]) > 0.5;
      const col = this.col.add((c.h0[0] + c.h1[0]) / 2 - c.f[0] * 0.04, c.y + 1.02, (c.h0[1] + c.h1[1]) / 2 - c.f[1] * 0.04, horiz ? c.w : 0.08, 2.04, horiz ? 0.08 : c.w);
      return { c, leaves, col, open: false, t: 0 };
    });

    // ---- light sources (candles, sigils, bulbs, fires) + a small pool of real lights that follows the camera
    this.srcs = [];
    const flameGeo = new THREE.ConeGeometry(0.022, 0.09, 6), flameMat = new THREE.MeshBasicMaterial({ color: 0xffb060 });
    const bulbGeo = new THREE.SphereGeometry(0.07, 8, 6);
    const sigGeo = new THREE.PlaneGeometry(1.15, 1.15);
    const fireGeo = new THREE.ConeGeometry(0.2, 0.7, 7), fireMat = new THREE.MeshBasicMaterial({ color: 0xff7a20, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending });
    for (const l of W.lights) {
      const s = { x: l.x, y: l.y, z: l.z, kind: l.kind, flat: l.flat, ph: Math.random() * 50, mesh: null, on: true };
      if (l.kind === 'candle') {
        s.mesh = new THREE.Mesh(flameGeo, flameMat); s.mesh.position.set(l.x, l.y - 0.02, l.z);
        s.color = 0xff8a3c; s.power = 2.4; s.dist = 7;
      } else if (l.kind === 'lamp') {
        s.mesh = new THREE.Mesh(bulbGeo, new THREE.MeshBasicMaterial({ color: 0xffe2a8 })); s.mesh.position.set(l.x, l.y, l.z);
        s.color = 0xffd9a0; s.power = 6; s.dist = 9;
      } else if (l.kind === 'fire') {
        s.mesh = new THREE.Group(); s.mesh.position.set(l.x, l.y - 0.2, l.z);
        for (let i = 0; i < 3; i++) { const f = new THREE.Mesh(fireGeo, fireMat); f.position.set((i - 1) * 0.1, 0.2, (i % 2) * 0.1 - 0.05); s.mesh.add(f); }
        s.color = 0xff7a28; s.power = 34; s.dist = 16;
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
    // street lamps with a visible cone of light in the fog
    const coneGeo = new THREE.ConeGeometry(3.4, 4.9, 20, 1, true); coneGeo.translate(0, -2.45, 0);
    for (const l of W.lamps) {
      const mat = new THREE.MeshBasicMaterial({ color: l.broken ? 0x1a1a18 : 0xffc890 });
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), mat); mesh.scale.set(1, 0.5, 1.1); mesh.position.set(l.x, l.y + 0.02, l.z);
      this.group.add(mesh);
      if (l.broken) continue;
      const cone = new THREE.Mesh(coneGeo, new THREE.MeshBasicMaterial({ color: 0xffb070, transparent: true, opacity: 0.045, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false }));
      cone.position.set(l.x, l.y, l.z); this.group.add(cone);
      this.srcs.push({ x: l.x, y: l.y - 0.3, z: l.z, kind: 'street', flat: -1, ph: Math.random() * 50, mesh, cone, color: 0xffb070, power: 60, dist: 22, flicker: l.flicker, on: true });
    }
    const nPool = quality === 'low' ? 5 : quality === 'medium' ? 8 : 12;
    this.pool = Array.from({ length: nPool }, () => { const p = new THREE.PointLight(0xffffff, 0, 8, 1.6); scene.add(p); return p; });
    this.poolT = 0; this.near = [];

    // ---- pickups
    this.pickups = new Map();
    this.starGeo = starGeometry();
    this.starMat = new THREE.MeshBasicMaterial({ color: 0xffe9a8 });
    const glow = (c, o) => new THREE.SpriteMaterial({ map: T.soft, color: c, transparent: true, opacity: o, depthWrite: false, blending: THREE.AdditiveBlending });
    this.glowMat = glow(0xffd070, 0.55); this.gunGlow = glow(0x58d8ff, 0.4); this.medGlow = glow(0xff5050, 0.4);
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
      if (k.k === 'star') { obj.add(new THREE.Mesh(this.starGeo, this.starMat)); spr = new THREE.Sprite(this.glowMat); spr.scale.setScalar(k.closet != null ? 0.9 : 1.5); }
      else if (k.k === 'gun') { const g = this.makeGun(); g.scale.setScalar(1.5); g.rotation.z = 0.5; obj.add(g); spr = new THREE.Sprite(this.gunGlow); spr.scale.setScalar(1.3); }
      else {
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.22, 0.22), this.M.white);
        const cr = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.23), new THREE.MeshBasicMaterial({ color: 0xff3030 }));
        const cr2 = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.23), cr.material);
        obj.add(box, cr, cr2); spr = new THREE.Sprite(this.medGlow); spr.scale.setScalar(1.2);
      }
      obj.add(spr);
      this.group.add(obj);
      this.pickups.set(k.id, { k, obj, ph: Math.random() * 6, take: 0 });
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
    o.open = open; o.col.on = !open && !o.gone;
    if (instant) { o.t = open ? 1 : 0; o.pivot.rotation.y = open ? o.a1 : o.a0; }
  }
  setCloset(id, open, instant) {
    const o = this.closets[id];
    if (!o) return;
    o.open = open; o.c.open = open; o.col.on = !open;
    if (instant) { o.t = open ? 1 : 0; for (const l of o.leaves) l.pivot.rotation.y = open ? l.a1 : l.a0; }
  }

  // tear a named piece of wall (facade, parapet, stairwell wall) off the building; returns the boxes that went
  smash(g, restore) {
    const list = this.fac.get(g) || [], touched = new Set();
    for (const e of list) {
      if (e.col) e.col.on = !!restore;
      if (e.mesh) { e.mesh.setMatrixAt(e.index, restore ? e.mat : ZERO); touched.add(e.mesh); }
    }
    for (const m of touched) m.instanceMatrix.needsUpdate = true;
    const flat = this.W.flats.find((f) => f.g === g);
    if (flat) {
      flat.destroyed = !restore;
      if (!flat.roof) {
        for (const o of this.doors) if (o.d.flat === flat.id && o.d.kind === 'balcony') { o.gone = !restore; o.pivot.visible = !!restore; o.col.on = restore ? !o.open : false; }
        for (const s of this.srcs) if (s.flat === flat.id && s.kind !== 'sigil') { s.on = !!restore; if (s.mesh) s.mesh.visible = !!restore; }
      }
    }
    return list.filter((e) => e.col && e.b.sx !== undefined && e.b.s === undefined).map((e) => e.b);
  }

  // dread 0..1: lights gutter when it is close
  update(dt, cam, dread = 0) {
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
    for (const o of this.closets) {
      const target = o.open ? 1 : 0;
      if (o.t !== target) {
        o.t += Math.sign(target - o.t) * dt * 3.5;
        if ((target - o.t) * (target ? 1 : -1) < 0) o.t = target;
        const e = o.t * o.t * (3 - 2 * o.t);
        for (const l of o.leaves) l.pivot.rotation.y = l.a0 + (l.a1 - l.a0) * e;
      }
    }
    for (const p of this.pickups.values()) {
      p.obj.rotation.y = t * (1.6 + p.take * 14) + p.ph;
      p.obj.children[0].position.y = Math.sin(t * 2 + p.ph) * 0.07 + p.take * 0.5;
      const sc = 1 + p.take * 0.5 - p.take * p.take * 1.2;
      p.obj.children[0].scale.setScalar(Math.max(0.1, sc));
    }
    // re-pick which real lights are nearest a few times a second
    this.poolT -= dt;
    if (this.poolT <= 0) {
      this.poolT = 0.3;
      const cx = cam.x, cy = cam.y, cz = cam.z;
      for (const s of this.srcs) s.d = s.on ? Math.hypot(s.x - cx, (s.y - cy) * 3, s.z - cz) - (s.kind === 'street' || s.kind === 'fire' ? 10 : s.kind === 'sigil' ? 4 : 0) : 1e9;
      this.near = this.srcs.filter((s) => s.d < 34).sort((a, b) => a.d - b.d).slice(0, this.pool.length);
    }
    const gutter = dread > 0.45 ? (Math.sin(t * 23) * Math.sin(t * 7.1) > 0.2 - dread * 0.5 ? 0.25 : 1) : 1;
    for (const s of this.srcs) {
      if (s.kind === 'fire' && s.mesh) s.mesh.children.forEach((f, i) => { f.scale.set(1, 0.7 + 0.5 * Math.abs(Math.sin(t * (7 + i * 2.3) + s.ph + i)), 1); f.position.y = 0.2 + f.scale.y * 0.15; });
    }
    for (let i = 0; i < this.pool.length; i++) {
      const L = this.pool[i], s = this.near[i];
      if (!s) { L.intensity = 0; continue; }
      let f = 1;
      if (s.kind === 'candle') f = (0.8 + 0.2 * Math.sin(t * 11 + s.ph) * Math.sin(t * 7.3 + s.ph * 2)) * (gutter < 1 ? 0.55 : 1);
      else if (s.kind === 'fire') f = 0.75 + 0.25 * Math.sin(t * 9 + s.ph) * Math.sin(t * 5.3 + s.ph);
      else if (s.kind === 'sigil') { f = 0.75 + 0.25 * Math.sin(t * 1.7 + s.ph) + (gutter < 1 ? 0.6 : 0); if (s.mesh) s.mesh.material.opacity = Math.min(1, f); }
      else {
        f = (s.kind === 'lamp' || s.flicker) && Math.sin(t * 3.1 + s.ph) * Math.sin(t * 17 + s.ph) > 0.55 ? 0.15 : 1;
        f *= gutter;
        if (s.kind === 'street') { s.mesh.material.color.setHex(f < 0.5 ? 0x4a3a28 : 0xffc890); s.cone.material.opacity = 0.045 * f; }
        else if (s.mesh) s.mesh.material.color.setHex(f < 0.5 ? 0x5a4a30 : 0xffe2a8);
      }
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
