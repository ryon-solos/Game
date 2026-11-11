// The thing in the street: procedural body, two stalking legs, eight inverse-kinematic arms.
import * as THREE from 'three';
import { shoulder } from '../shared/room.js';

const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _q = new THREE.Quaternion();

// place a unit-height cylinder (origin at centre) between two points
function span(mesh, a, b, r) {
  _a.subVectors(b, a);
  const len = _a.length() || 1e-4;
  mesh.position.copy(a).addScaledVector(_a, 0.5);
  mesh.quaternion.setFromUnitVectors(UP, _a.multiplyScalar(1 / len));
  mesh.scale.set(r, len, r);
}
// two-bone IK: returns the joint position in `out`
function ik(root, tip, l1, l2, pole, out) {
  _b.subVectors(tip, root);
  let d = _b.length() || 1e-4;
  const dir = _b.multiplyScalar(1 / d);
  if (d > l1 + l2) { const k = d / (l1 + l2) * 1.001; l1 *= k; l2 *= k; }
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  _c.copy(pole).addScaledVector(dir, -pole.dot(dir));
  if (_c.lengthSq() < 1e-6) _c.set(0, 1, 0); _c.normalize();
  return out.copy(root).addScaledVector(dir, a).addScaledVector(_c, h);
}

export class MonsterView {
  constructor(scene) {
    this.scene = scene;
    const g = this.group = new THREE.Group(); scene.add(g);
    const skin = this.skin = new THREE.MeshStandardMaterial({ color: 0x1b1d22, roughness: 0.38, metalness: 0.15 });
    const bone = new THREE.MeshStandardMaterial({ color: 0x8d8a78, roughness: 0.5 });
    this.eyeMat = new THREE.MeshBasicMaterial({ color: 0xfff0c0 });
    const mk = (geo, mat = skin) => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; g.add(m); return m; };

    // torso (unit model is 10 m tall, then scaled)
    this.body = new THREE.Group(); g.add(this.body);
    const prof = [[0.05, 0], [0.62, 0.15], [0.5, 0.8], [0.34, 1.6], [0.5, 2.3], [0.82, 3.1], [0.7, 3.7], [0.28, 4.0], [0.2, 4.3]].map(([r, y]) => new THREE.Vector2(r, y));
    const torso = new THREE.Mesh(new THREE.LatheGeometry(prof, 14), skin); torso.castShadow = true; torso.scale.z = 0.72;
    this.body.add(torso);
    for (let i = 0; i < 9; i++) {   // spine
      const sp = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.55 - i * 0.02, 5), bone);
      sp.position.set(-0.45 - Math.sin(i / 8 * 3) * 0.12, 0.5 + i * 0.4, 0); sp.rotation.z = 1.2; sp.castShadow = true;
      this.body.add(sp);
    }
    for (let i = 0; i < 5; i++) {   // ribs
      const rib = new THREE.Mesh(new THREE.TorusGeometry(0.62 - i * 0.05, 0.035, 5, 14, Math.PI * 1.25), bone);
      rib.position.set(0.02, 2.0 + i * 0.3, 0); rib.rotation.set(Math.PI / 2, 0, Math.PI * 0.375); rib.scale.y = 0.75;
      this.body.add(rib);
    }
    // head
    this.head = new THREE.Group(); this.head.position.set(0.25, 4.55, 0); this.body.add(this.head);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.5, 14, 10), skin); skull.scale.set(1.25, 0.95, 0.9); skull.castShadow = true;
    this.jaw = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), skin);
    this.jaw.position.set(0.12, -0.12, 0); this.jaw.scale.set(1.3, 0.8, 0.8);
    this.head.add(skull, this.jaw);
    for (let i = 0; i < 12; i++) {
      const up = i < 6, a = ((i % 6) - 2.5) * 0.2;
      const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.22, 4), bone);
      tooth.position.set(0.45 * Math.cos(a) + 0.1, up ? -0.12 : 0.0, 0.42 * Math.sin(a));
      if (up) tooth.rotation.z = Math.PI;
      (up ? this.head : this.jaw).add(tooth);
    }
    this.eyes = [];
    for (const [x, y, z, r] of [[0.55, 0.14, 0.2, 0.07], [0.55, 0.14, -0.2, 0.07], [0.5, 0.3, 0.1, 0.04], [0.5, 0.3, -0.1, 0.04], [0.42, 0.2, 0.36, 0.045], [0.42, 0.2, -0.36, 0.045]]) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), this.eyeMat); e.position.set(x, y, z); this.head.add(e); this.eyes.push(e);
    }
    this.glow = new THREE.PointLight(0xff3020, 6, 16, 1.5); this.glow.position.set(0.9, 0.1, 0); this.head.add(this.glow);

    // legs
    const cyl = new THREE.CylinderGeometry(1, 0.7, 1, 8), cyl2 = new THREE.CylinderGeometry(0.75, 0.5, 1, 8);
    const joint = new THREE.SphereGeometry(1, 8, 6);
    this.legs = [1, -1].map((side) => ({
      side, thigh: mk(cyl), shin: mk(cyl2), knee: mk(joint), foot: mk(new THREE.BoxGeometry(1, 0.3, 0.55)),
      pos: new THREE.Vector3(), from: new THREE.Vector3(), to: new THREE.Vector3(), t: 1, init: false,
    }));
    // arms
    this.arms = [];
    for (let i = 0; i < 8; i++) {
      const hand = new THREE.Group(); g.add(hand);
      const palm = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), skin); palm.scale.set(1, 0.45, 1.15); palm.castShadow = true; hand.add(palm);
      const fingers = [];
      for (let f = 0; f < 5; f++) {
        const fg = new THREE.Group(); const a = (f - 2) * 0.42;
        fg.position.set(Math.sin(a) * 0.26, 0, -Math.cos(a) * 0.3); fg.rotation.y = -a;
        const s1 = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.065, 0.55, 5), skin); s1.rotation.x = -Math.PI / 2; s1.position.z = -0.27;
        const tipG = new THREE.Group(); tipG.position.z = -0.54;
        const s2 = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.6, 5), bone); s2.rotation.x = -Math.PI / 2; s2.position.z = -0.3;
        tipG.add(s2); fg.add(s1, tipG); hand.add(fg); fingers.push({ fg, tipG });
      }
      this.arms.push({ i, upper: mk(cyl), lower: mk(cyl2), elbow: mk(joint), hand, fingers, tip: new THREE.Vector3(), init: false, ph: Math.random() * 9, active: 0 });
    }
    this.x = 0; this.z = 0; this.h = 7.5; this.yaw = 0; this.walk = 0; this.stun = 0; this.t = 0; this.state = 'roam';
    this.onStep = null;
    this.headPos = new THREE.Vector3();
  }

  // s: {x,z,d,st,h,hands[]} from the server
  update(dt, s) {
    const g = this, t = (this.t += dt);
    const k = Math.min(1, dt * 8);
    if (!this.started) { this.x = s.x; this.z = s.z; this.h = s.h; this.started = true; }
    const px = this.x;
    this.x += (s.x - this.x) * k; this.z += (s.z - this.z) * k; this.h += (s.h - this.h) * Math.min(1, dt * 2);
    this.state = s.st;
    const sc = this.h / 10, speed = Math.abs(this.x - px) / Math.max(dt, 1e-3);
    const stunned = s.st === 'stun';
    this.stun += ((stunned ? 1 : 0) - this.stun) * Math.min(1, dt * 5);
    const ty = s.d > 0 ? 0 : Math.PI;
    let dy = ty - this.yaw; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
    this.yaw += dy * Math.min(1, dt * 3);
    const fx = Math.cos(this.yaw), fz = -Math.sin(this.yaw);   // facing
    this.walk += speed * dt;
    const hunt = s.st === 'hunt';

    // body
    const bob = Math.sin(this.walk * 1.4 / sc) * 0.12 * sc + Math.sin(t * 1.3) * 0.05 * sc;
    const hip = (5.0 - this.stun * 1.3) * sc + bob;
    this.body.position.set(this.x, hip, this.z);
    this.body.scale.setScalar(sc);
    this.body.rotation.set(0, this.yaw, -(0.12 + (hunt ? 0.22 : 0) + this.stun * 0.6 + Math.sin(t * 0.7) * 0.03));
    this.head.rotation.set(Math.sin(t * 0.9) * 0.1, (s.st === 'listen' || s.st === 'search' ? Math.sin(t * 0.8) * 0.9 : Math.sin(t * 0.4) * 0.25), -this.stun * 0.5 + (stunned ? Math.sin(t * 30) * 0.05 : 0));
    this.jaw.rotation.z = -(hunt ? 0.55 : 0.12 + Math.sin(t * 2) * 0.06);
    this.eyeMat.color.setHex(stunned ? (Math.sin(t * 25) > 0 ? 0x223040 : 0x050505) : hunt ? 0xff2a18 : 0xfff0c0);
    this.glow.color.setHex(hunt ? 0xff1505 : 0xff4a30); this.glow.intensity = stunned ? 0.5 : hunt ? 14 : 6;
    this.head.getWorldPosition(this.headPos);

    // legs: plant a foot, swing the other when the body gets ahead of it
    const stride = 2.0 * sc;
    for (let i = 0; i < 2; i++) {
      const L = this.legs[i], o = this.legs[1 - i];
      const hx = this.x + fx * 0.2 * sc - fz * L.side * 0.75 * sc, hz = this.z + fz * 0.2 * sc + fx * L.side * 0.75 * sc;
      if (!L.init) { L.pos.set(hx, 0, hz); L.init = true; }
      if (L.t >= 1) {
        const dist = Math.hypot(hx - L.pos.x, hz - L.pos.z);
        if (dist > stride * (i ? 0.5 : 0.62) && o.t >= 1) {
          L.from.copy(L.pos); const lead = Math.min(stride * 0.9, speed * 0.5);
          L.to.set(hx + Math.sign(this.x - px || fx) * lead, 0, hz); L.t = 0;
        }
      } else {
        L.t = Math.min(1, L.t + dt * (2.2 + speed * 0.35));
        L.pos.lerpVectors(L.from, L.to, L.t); L.pos.y = Math.sin(L.t * Math.PI) * 1.1 * sc;
        if (L.t >= 1) { L.pos.y = 0; if (this.onStep) this.onStep(L.pos.x, L.pos.z); }
      }
      _d.set(this.x - fz * L.side * 0.45 * sc, hip + 0.2 * sc, this.z + fx * L.side * 0.45 * sc);
      const ankle = _a.copy(L.pos); ankle.y += 0.25 * sc;
      const pole = new THREE.Vector3(fx, 0.3, fz);
      const knee = ik(_d, ankle, 2.75 * sc, 2.75 * sc, pole, new THREE.Vector3());
      const hipP = _d.clone(), ank = ankle.clone();
      span(L.thigh, hipP, knee, 0.36 * sc); span(L.shin, knee, ank, 0.3 * sc);
      L.knee.position.copy(knee); L.knee.scale.setScalar(0.3 * sc);
      L.foot.position.set(L.pos.x + fx * 0.3 * sc, L.pos.y + 0.15 * sc, L.pos.z + fz * 0.3 * sc);
      L.foot.scale.set(1.3 * sc, sc, sc); L.foot.rotation.y = this.yaw;
    }

    // arms
    const m = { x: this.x, z: this.z, h: this.h }, sh = {};
    for (const A of this.arms) {
      const side = A.i < 4 ? 1 : -1, kk = A.i % 4, hs = s.hands[A.i];
      shoulder(m, A.i, sh);
      const root = new THREE.Vector3(sh.x + fx * 0.15 * sc, sh.y + bob - this.stun * 1.3 * sc, sh.z);
      const target = _d;
      if (hs) target.set(hs[1], hs[2], hs[3]);
      else {   // idle: hang and sway, fingers twitching
        const sway = Math.sin(t * 0.8 + A.ph), limp = this.stun;
        target.set(root.x + fx * (0.6 + sway * 0.5) * sc * (1 - limp), Math.max(0.4, root.y - (2.6 + kk * 0.35 + limp * 2) * sc + Math.sin(t * 1.1 + A.ph) * 0.3 * sc), root.z + side * (1.5 + kk * 0.45 + Math.cos(t * 0.6 + A.ph) * 0.3) * sc * (1 - limp * 0.6));
      }
      if (!A.init) { A.tip.copy(target); A.init = true; }
      A.tip.lerp(target, Math.min(1, dt * (hs ? 14 : 3)));
      A.active += ((hs ? 1 : 0) - A.active) * Math.min(1, dt * 6);
      const pole = new THREE.Vector3(0, hs ? 0.8 : 0.3, side * (hs ? 0.2 : 1));
      const elbow = ik(root, A.tip, 3.0 * sc, 3.0 * sc, pole, new THREE.Vector3());
      span(A.upper, root, elbow, 0.2 * sc); span(A.lower, elbow, A.tip, 0.16 * sc);
      A.elbow.position.copy(elbow); A.elbow.scale.setScalar(0.19 * sc);
      // hand points along the forearm
      _a.subVectors(A.tip, elbow).normalize();
      A.hand.position.copy(A.tip);
      _q.setFromUnitVectors(_b.set(0, 0, -1), _a);
      A.hand.quaternion.copy(_q);
      A.hand.scale.setScalar(sc * 1.15 + 0.25);
      const curl = 0.25 + (1 - A.active) * 0.5 + Math.sin(t * (hs ? 7 : 1.5) + A.ph) * (hs ? 0.25 : 0.08);
      A.fingers.forEach((f, j) => { f.fg.rotation.x = -curl * 0.6 - Math.sin(t * 5 + j + A.ph) * 0.06 * A.active; f.tipG.rotation.x = -curl; });
    }
  }

  setVisible(v) { this.group.visible = v; }
  dispose() { this.scene.remove(this.group); }
}
