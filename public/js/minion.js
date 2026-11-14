// Crawlers: the things the monster calls into the buildings. Low, wide, six-legged, nothing human about them.
import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
function span(mesh, a, b, r) {
  _a.subVectors(b, a);
  const len = _a.length() || 1e-4;
  mesh.position.copy(a).addScaledVector(_a, 0.5);
  mesh.quaternion.setFromUnitVectors(UP, _a.multiplyScalar(1 / len));
  mesh.scale.set(r, len, r);
}
function ik(root, tip, l1, l2, pole, out) {
  _b.subVectors(tip, root);
  const d = Math.min(_b.length() || 1e-4, (l1 + l2) * 0.999);
  const dir = _b.normalize();
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  _c.copy(pole).addScaledVector(dir, -pole.dot(dir)).normalize();
  return out.copy(root).addScaledVector(dir, a).addScaledVector(_c, h);
}

let shared = null;
function assets(T) {
  if (shared) return shared;
  shared = {
    skin: new THREE.MeshStandardMaterial({ map: T.flesh, bumpMap: T.flesh, bumpScale: 2, color: 0x7a6a66, roughness: 0.35, metalness: 0.1 }),
    bone: new THREE.MeshStandardMaterial({ color: 0xb5ae96, roughness: 0.5 }),
    eye: new THREE.MeshBasicMaterial({ color: 0xd8ffd0 }),
    eyeHot: new THREE.MeshBasicMaterial({ color: 0xff3020 }),
    maw: new THREE.MeshBasicMaterial({ color: 0x5a0604 }),
    seg: new THREE.CylinderGeometry(1, 0.6, 1, 6), ball: new THREE.SphereGeometry(1, 8, 6), claw: new THREE.ConeGeometry(1, 1, 4),
  };
  return shared;
}

export class MinionView {
  constructor(scene, T) {
    const S = assets(T);
    this.scene = scene;
    const g = this.group = new THREE.Group(); scene.add(g);
    const body = this.body = new THREE.Group(); g.add(body);
    const add = (parent, geo, mat, x, y, z, sx, sy, sz) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.scale.set(sx, sy ?? sx, sz ?? sx); m.castShadow = true; parent.add(m); return m; };
    // body: three swollen lumps, forward is -z
    add(body, S.ball, S.skin, 0, 0, 0.15, 0.5, 0.3, 0.6);
    add(body, S.ball, S.skin, 0, 0.05, 0.85, 0.42, 0.34, 0.55);
    add(body, S.ball, S.skin, 0, -0.02, -0.5, 0.36, 0.26, 0.42);
    for (let i = 0; i < 7; i++) { const s = add(body, S.claw, S.bone, 0, 0.3 - Math.abs(i - 3) * 0.03, -0.5 + i * 0.26, 0.05, 0.3 + (i % 2) * 0.12, 0.05); s.rotation.x = 0.4; }
    // face: a vertical slit of a mouth, a ring of eyes, feelers
    this.maw = add(body, S.ball, S.maw, 0, -0.02, -0.86, 0.1, 0.2, 0.1); this.maw.castShadow = false;
    this.mand = [1, -1].map((sgn) => {
      const p = new THREE.Group(); p.position.set(sgn * 0.16, -0.02, -0.8); body.add(p);
      const m = add(p, S.claw, S.bone, 0, 0, -0.25, 0.05, 0.5, 0.05); m.rotation.x = -Math.PI / 2;
      const m2 = add(p, S.claw, S.bone, 0, -0.12, -0.2, 0.035, 0.38, 0.035); m2.rotation.x = -Math.PI / 2;
      return { p, sgn };
    });
    this.eyes = [];
    for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2; const e = add(body, S.ball, S.eye, Math.cos(a) * 0.2, 0.02 + Math.sin(a) * 0.15, -0.84 - Math.abs(Math.sin(a)) * 0.03, 0.028 + (i % 3) * 0.012); e.castShadow = false; this.eyes.push(e); }
    this.feelers = [1, -1].map((sgn) => { const p = new THREE.Group(); p.position.set(sgn * 0.1, 0.16, -0.8); body.add(p); const f = add(p, S.claw, S.skin, 0, 0, -0.55, 0.018, 1.1, 0.018); f.rotation.x = -Math.PI / 2; return { p, sgn }; });
    // (no real light on these: adding or removing a light makes the renderer recompile every material)
    this.glow = add(body, S.ball, S.eye, 0, 0.2, -1.0, 0.001); this.glow.castShadow = false;
    // six legs
    this.legs = [];
    for (let i = 0; i < 6; i++) {
      const side = i % 2 ? 1 : -1, row = Math.floor(i / 2);
      this.legs.push({
        side, row, a: add(g, S.seg, S.skin, 0, 0, 0, 1), b: add(g, S.seg, S.skin, 0, 0, 0, 1), k: add(g, S.ball, S.bone, 0, 0, 0, 1), c: add(g, S.claw, S.bone, 0, 0, 0, 1),
        pos: new THREE.Vector3(), from: new THREE.Vector3(), to: new THREE.Vector3(), t: 1, init: false,
      });
    }
    this.S = S; this.x = 0; this.y = 0; this.z = 0; this.yaw = 0; this.init = false; this.t = Math.random() * 9; this.grow = 0; this.dying = 0; this.hot = false; this.onStep = null;
    this.tx = 0; this.ty = 0; this.tz = 0; this.tyaw = 0; this.chase = 0;
  }

  update(dt) {
    const t = (this.t += dt);
    if (!this.init) { this.x = this.tx; this.y = this.ty; this.z = this.tz; this.yaw = this.tyaw; this.init = true; }
    const px = this.x, pz = this.z, k = Math.min(1, dt * 10);
    this.x += (this.tx - px) * k; this.y += (this.ty - this.y) * k; this.z += (this.tz - pz) * k;
    let d = this.tyaw - this.yaw; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
    this.yaw += d * Math.min(1, dt * 7);
    const speed = Math.hypot(this.x - px, this.z - pz) / Math.max(dt, 1e-3);
    this.grow = this.dying ? Math.max(0, this.grow - dt * 1.6) : Math.min(1, this.grow + dt * 1.4);
    const sc = 1.7 * (0.15 + 0.85 * this.grow);
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw), rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    const lift = (0.55 + Math.sin(t * 9) * 0.03 * Math.min(1, speed) + (this.chase ? 0.12 : 0)) * sc;
    this.body.position.set(this.x, this.y + lift, this.z);
    this.body.rotation.set(Math.sin(t * 2.1) * 0.05 + (this.chase ? -0.18 : 0), this.yaw, Math.sin(t * 7) * 0.04 * Math.min(1, speed));
    this.body.scale.setScalar(sc);
    const hot = !!this.chase;
    if (hot !== this.hot) { this.hot = hot; for (const e of this.eyes) e.material = hot ? this.S.eyeHot : this.S.eye; }
    const open = hot ? 0.7 + Math.sin(t * 16) * 0.3 : 0.15 + Math.max(0, Math.sin(t * 2.2)) * 0.2;
    for (const m of this.mand) m.p.rotation.y = m.sgn * open;
    this.maw.scale.x = 0.06 + open * 0.14;
    for (const f of this.feelers) f.p.rotation.set(Math.sin(t * 3.1 + f.sgn) * 0.35, f.sgn * (0.35 + Math.sin(t * 2.3 + f.sgn * 2) * 0.3), 0);
    // legs
    const stride = 0.7 * sc;
    for (let i = 0; i < 6; i++) {
      const L = this.legs[i];
      const fo = (1 - L.row) * 0.75 * sc, so = L.side * (1.25 + (L.row === 1 ? 0.2 : 0)) * sc;
      const hx = this.x + fx * fo + rx * so, hz = this.z + fz * fo + rz * so;
      if (!L.init) { L.pos.set(hx, this.y, hz); L.init = true; }
      if (L.t >= 1) {
        // alternating tripod gait
        const group = (i + L.row) % 2, phase = Math.sin(t * 0) + group;
        const dist = Math.hypot(hx - L.pos.x, hz - L.pos.z);
        const partnerMoving = this.legs.some((o, j) => j !== i && (j + o.row) % 2 !== group && o.t < 1);
        if ((dist > stride && !partnerMoving) || dist > stride * 2.2 || Math.abs(L.pos.y - this.y) > 0.6) {
          L.from.copy(L.pos); L.to.set(hx + (this.x - px) / Math.max(dt, 1e-3) * 0.12, this.y, hz + (this.z - pz) / Math.max(dt, 1e-3) * 0.12); L.t = 0;
          void phase;
        }
      } else {
        L.t = Math.min(1, L.t + dt * (7 + speed * 1.2));
        L.pos.lerpVectors(L.from, L.to, L.t); L.pos.y += Math.sin(L.t * Math.PI) * 0.3 * sc;
        if (L.t >= 1 && this.onStep) this.onStep(L.pos.x, L.pos.y, L.pos.z);
      }
      const root = _a.set(this.x + fx * (1 - L.row) * 0.35 * sc + rx * L.side * 0.35 * sc, this.y + lift, this.z + fz * (1 - L.row) * 0.35 * sc + rz * L.side * 0.35 * sc).clone();
      const pole = new THREE.Vector3(rx * L.side * 0.4, 1, rz * L.side * 0.4);
      const knee = ik(root, L.pos, 1.0 * sc, 1.15 * sc, pole, new THREE.Vector3());
      span(L.a, root, knee, 0.07 * sc); span(L.b, knee, L.pos, 0.055 * sc);
      L.k.position.copy(knee); L.k.scale.setScalar(0.085 * sc);
      L.c.position.copy(knee).y += 0.12 * sc; L.c.scale.set(0.04 * sc, 0.28 * sc, 0.04 * sc);
    }
    return this.dying && this.grow <= 0;
  }

  dispose() { this.scene.remove(this.group); }
}
