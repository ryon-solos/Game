// The thing in the street: procedural body, two stalking legs, eight inverse-kinematic arms
// that bend in through the openings they use. When it knows where someone is it drops onto all
// ten limbs and runs like an insect, head twisted upside-down.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const UP = new THREE.Vector3(0, 1, 0), FWD = new THREE.Vector3(0, 0, -1);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _q = new THREE.Quaternion();
const V = () => new THREE.Vector3();

// weld the parts that never move relative to their parent into one mesh per material: hundreds of draw calls saved
function fuse(root) {
  const nodes = []; root.traverse((o) => { if (!o.isMesh) nodes.push(o); });
  for (const p of nodes) {
    const by = new Map();
    for (const c of p.children) if (c.isMesh && c.userData.st && !c.children.length) { const k = c.material.uuid + (c.castShadow ? 's' : ''); if (!by.has(k)) by.set(k, []); by.get(k).push(c); }
    for (const list of by.values()) {
      if (list.length < 2) continue;
      const geos = list.map((m) => { m.updateMatrix(); const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone(); g.applyMatrix4(m.matrix); for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k); return g; });
      const one = new THREE.Mesh(mergeGeometries(geos), list[0].material); one.castShadow = list[0].castShadow;
      for (const m of list) { p.remove(m); m.geometry.dispose(); }
      for (const g of geos) g.dispose();
      p.add(one);
    }
  }
}

// place a unit-height cylinder (origin at centre) between two points
function span(mesh, a, b, r) {
  _a.subVectors(b, a);
  const len = _a.length() || 1e-4;
  mesh.position.copy(a).addScaledVector(_a, 0.5);
  mesh.quaternion.setFromUnitVectors(UP, _a.multiplyScalar(1 / len));
  mesh.scale.set(r, len, r);
}
// two-bone IK: returns the joint position in `out` (bones stretch if the target is too far)
function ik(root, tip, l1, l2, pole, out) {
  _b.subVectors(tip, root);
  const d = _b.length() || 1e-4;
  const dir = _b.multiplyScalar(1 / d);
  if (d > l1 + l2) { const k = d / (l1 + l2) * 1.001; l1 *= k; l2 *= k; }
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  _c.copy(pole).addScaledVector(dir, -pole.dot(dir));
  if (_c.lengthSq() < 1e-6) _c.set(0, 1, 0); _c.normalize();
  return out.copy(root).addScaledVector(dir, a).addScaledVector(_c, h);
}
const wrap = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };

export class MonsterView {
  constructor(scene, T) {
    this.scene = scene;
    const g = this.group = new THREE.Group(); scene.add(g);
    // wet hide with veins that glow in time with its heart
    const skin = this.skin = new THREE.MeshStandardMaterial({ map: T && T.flesh, bumpMap: T && T.flesh, bumpScale: 3.5, color: 0x70666a, roughness: 0.26, metalness: 0.12, emissiveMap: T && T.veins, emissive: 0xff2a10, emissiveIntensity: 0.6 });
    const bone = new THREE.MeshStandardMaterial({ color: 0xa9a48e, roughness: 0.5 });
    const skullM = new THREE.MeshStandardMaterial({ color: 0xcbc4ae, roughness: 0.55, emissive: 0x1c1810, bumpMap: T && T.flesh, bumpScale: 1.2 });
    const dark = new THREE.MeshBasicMaterial({ color: 0x020202 });
    const gum = new THREE.MeshStandardMaterial({ color: 0x5a0e0c, roughness: 0.2 });
    this.eyeMat = new THREE.MeshBasicMaterial({ color: 0xfff0c0 });
    this.heartMat = new THREE.MeshBasicMaterial({ color: 0xff3a18 });
    this.mawMat = new THREE.MeshBasicMaterial({ color: 0x1c0302 });
    const mk = (geo, mat = skin) => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; g.add(m); return m; };
    const add = (parent, geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.userData.st = 1; parent.add(m); return m; };

    // ---- torso (unit model is 10 m tall, then scaled). Origin at the hips, +x is forward.
    const body = this.body = new THREE.Group(); g.add(body);
    const prof = [[0.05, 0], [0.7, 0.1], [0.6, 0.6], [0.34, 1.3], [0.3, 1.7], [0.46, 2.2], [0.94, 3.1], [0.86, 3.7], [0.4, 4.05], [0.26, 4.6]].map(([r, y]) => new THREE.Vector2(r, y));
    const torso = add(body, new THREE.LatheGeometry(prof, 20), skin, 0, 0, 0); torso.scale.set(1.3, 1, 1.0);
    for (let i = 0; i < 13; i++) {   // spine: knuckles of bone standing out of the back
      add(body, new THREE.SphereGeometry(0.13, 8, 6), bone, -0.5 - Math.sin(i / 12 * 3) * 0.2, 0.3 + i * 0.33, 0);
      const sp = add(body, new THREE.ConeGeometry(0.09, 0.8 - i * 0.03, 5), bone, -0.62 - Math.sin(i / 12 * 3) * 0.2, 0.42 + i * 0.33, 0); sp.rotation.z = 1.15;
    }
    for (let i = 0; i < 7; i++) {    // open ribcage
      for (const sgn of [1, -1]) {
        const rib = add(body, new THREE.TorusGeometry(1.02 - i * 0.05, 0.055, 6, 14, Math.PI * 0.85), bone, 0.12, 1.95 + i * 0.28, 0);
        rib.rotation.set(Math.PI / 2, 0, sgn > 0 ? 0.12 : Math.PI + 0.35); rib.scale.y = 0.78;
      }
    }
    this.heart = add(body, new THREE.SphereGeometry(0.36, 12, 10), this.heartMat, 0.62, 2.9, 0); this.heart.castShadow = false; this.heart.userData.st = 0;
    this.heartLight = new THREE.PointLight(0xff3018, 8, 22, 1.5); this.heartLight.position.set(1.4, 2.9, 0); body.add(this.heartLight);
    for (const sgn of [1, -1]) for (let i = 0; i < 4; i++) {   // shoulder spikes
      const s = add(body, new THREE.ConeGeometry(0.12, 1.1 - i * 0.16, 5), bone, -0.2 + i * 0.2, 3.8, sgn * (0.6 + i * 0.1)); s.rotation.x = sgn * 0.55;
    }
    // a second mouth, in the belly
    this.belly = new THREE.Group(); this.belly.position.set(0.5, 0.95, 0); body.add(this.belly);
    this.bellyHole = add(this.belly, new THREE.SphereGeometry(0.4, 10, 8), this.mawMat, 0, 0, 0); this.bellyHole.castShadow = false; this.bellyHole.userData.st = 0;
    this.bellyLips = [1, -1].map((sgn) => { const p = new THREE.Group(); this.belly.add(p); add(p, new THREE.SphereGeometry(0.42, 10, 8), gum, 0, 0, 0).scale.set(0.5, 1.5, 0.3); for (let i = 0; i < 6; i++) { const t = add(p, new THREE.ConeGeometry(0.035, 0.26, 4), bone, 0.12, -0.45 + i * 0.18, -sgn * 0.04); t.rotation.x = -sgn * Math.PI / 2; } return { p, sgn }; });
    // little arms on the chest that never stop moving
    this.vest = [];
    for (let i = 0; i < 6; i++) {
      const sgn = i % 2 ? 1 : -1, p = new THREE.Group(); p.position.set(0.7 - (i >> 1) * 0.06, 1.75 + (i >> 1) * 0.45, sgn * 0.42); body.add(p);
      add(p, new THREE.CylinderGeometry(0.05, 0.04, 0.6, 6), skin, 0.28, 0, 0).rotation.z = -Math.PI / 2;
      const lo = new THREE.Group(); lo.position.x = 0.58; p.add(lo);
      add(lo, new THREE.CylinderGeometry(0.04, 0.03, 0.5, 6), skin, 0.24, 0, 0).rotation.z = -Math.PI / 2;
      for (let f = 0; f < 3; f++) { const c = add(lo, new THREE.ConeGeometry(0.018, 0.2, 4), bone, 0.56, 0, (f - 1) * 0.05); c.rotation.z = -Math.PI / 2; }
      this.vest.push({ p, lo, sgn, ph: Math.random() * 9 });
    }
    // hanging tendrils
    this.tendrils = [];
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2, top = i % 2 ? 3.6 : 0.5, len = 1.2 + Math.random() * 2.0;
      const piv = new THREE.Group(); piv.position.set(Math.cos(a) * 0.6 - 0.1, top, Math.sin(a) * 0.55); body.add(piv);
      const t = new THREE.Mesh(new THREE.ConeGeometry(0.045, len, 4), skin); t.rotation.x = Math.PI; t.position.y = -len / 2; piv.add(t);
      this.tendrils.push({ piv, ph: Math.random() * 9 });
    }

    // ---- neck (vertebrae showing) + head
    const neck = this.neck = new THREE.Group(); neck.position.set(0.1, 4.4, 0); body.add(neck);
    add(neck, new THREE.CylinderGeometry(0.2, 0.34, 1.4, 8), skin, 0.18, 0.6, 0).rotation.z = -0.3;
    for (let i = 0; i < 5; i++) add(neck, new THREE.SphereGeometry(0.12, 8, 6), bone, -0.08 + i * 0.07, 0.15 + i * 0.27, 0);
    const head = this.head = new THREE.Group(); head.position.set(0.5, 1.45, 0); head.scale.setScalar(1.8); neck.add(head);
    const roll = this.headRoll = new THREE.Group(); head.add(roll);     // twists about the line of the snout
    const skull = add(roll, new THREE.SphereGeometry(0.5, 18, 14), skullM, 0, 0, 0); skull.scale.set(1.45, 0.92, 0.86);
    const snout = add(roll, new THREE.CylinderGeometry(0.2, 0.36, 0.7, 12), skullM, 0.7, -0.08, 0); snout.rotation.z = -Math.PI / 2; snout.scale.z = 0.9;
    add(roll, new THREE.SphereGeometry(0.2, 10, 8), skullM, 0.25, 0.28, 0).scale.set(1.6, 0.6, 1.5);   // brow ridge
    this.pupils = [];
    for (const sgn of [1, -1]) {
      add(roll, new THREE.SphereGeometry(0.17, 12, 10), dark, 0.42, 0.1, sgn * 0.27).castShadow = false;       // sockets
      add(roll, new THREE.SphereGeometry(0.06, 8, 6), dark, 0.98, -0.02, sgn * 0.08).castShadow = false;       // nostrils
      const pu = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), this.eyeMat); pu.position.set(0.52, 0.1, sgn * 0.27); roll.add(pu);
      this.pupils.push({ m: pu, bx: 0.52, by: 0.1, bz: sgn * 0.27 });
      // antlers
      const root = new THREE.Group(); root.position.set(-0.25, 0.3, sgn * 0.3); root.rotation.set(sgn * 0.5, 0, 0.35); roll.add(root);
      add(root, new THREE.ConeGeometry(0.09, 2.3, 6), bone, 0, 1.15, 0);
      for (let i = 0; i < 5; i++) { const tine = add(root, new THREE.ConeGeometry(0.05, 1.0 - i * 0.12, 5), bone, 0.12 + i * 0.02, 0.45 + i * 0.4, sgn * 0.12); tine.rotation.set(sgn * (0.5 + i * 0.1), 0, -0.9 + i * 0.2); }
    }
    for (const [x, y, z, r] of [[0.7, 0.26, 0.14, 0.03], [0.7, 0.26, -0.14, 0.03], [0.3, 0.3, 0.4, 0.03], [0.3, 0.3, -0.4, 0.03], [0.85, 0.12, 0.2, 0.022], [0.85, 0.12, -0.2, 0.022]]) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), this.eyeMat); e.position.set(x, y, z); e.userData.st = 1; roll.add(e);
    }
    // jaws: a hinged lower jaw, two side mandibles, a tongue
    this.jaw = new THREE.Group(); this.jaw.position.set(-0.1, -0.22, 0); roll.add(this.jaw);
    const lower = add(this.jaw, new THREE.CylinderGeometry(0.16, 0.34, 1.05, 12, 1, false, 0, Math.PI), skullM, 0.55, -0.02, 0); lower.rotation.set(Math.PI / 2, 0, -Math.PI / 2); lower.scale.x = 0.9;
    this.maw = add(roll, new THREE.SphereGeometry(0.26, 10, 8), this.mawMat, 0.45, -0.25, 0); this.maw.scale.set(1.5, 0.5, 0.9); this.maw.castShadow = false; this.maw.userData.st = 0;
    for (let i = 0; i < 18; i++) {
      const up = i < 9, k = (i % 9) / 8, a = (k - 0.5) * 1.6;
      const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.032, 0.22 + (i % 3 === 1 ? 0.14 : 0), 4), bone);
      tooth.position.set(0.55 + Math.cos(a) * 0.45, up ? -0.2 : 0.08, Math.sin(a) * 0.26);
      if (up) tooth.rotation.z = Math.PI;
      tooth.userData.st = 1; tooth.castShadow = true; (up ? roll : this.jaw).add(tooth);
    }
    this.tongue = new THREE.Group(); this.tongue.position.set(0.5, -0.02, 0); this.jaw.add(this.tongue);
    add(this.tongue, new THREE.ConeGeometry(0.09, 1.5, 6), gum, 0.7, 0, 0).rotation.z = -Math.PI / 2;
    this.mand = [1, -1].map((sgn) => {
      const p = new THREE.Group(); p.position.set(0.25, -0.2, sgn * 0.36); roll.add(p);
      const m = add(p, new THREE.ConeGeometry(0.07, 1.05, 5), bone, 0.46, -0.05, 0); m.rotation.z = -Math.PI / 2 - 0.2;
      return { p, sgn };
    });
    this.mouthLight = new THREE.PointLight(0xff2008, 0, 14, 1.6); this.mouthLight.position.set(0.9, -0.2, 0); roll.add(this.mouthLight);

    // ---- legs
    const cyl = new THREE.CylinderGeometry(1, 0.7, 1, 10), cyl2 = new THREE.CylinderGeometry(0.75, 0.5, 1, 10);
    const joint = new THREE.SphereGeometry(1, 10, 8);
    this.legs = [1, -1].map((side) => {
      const foot = new THREE.Group(); g.add(foot);
      add(foot, new THREE.SphereGeometry(0.5, 10, 8), skin, 0, 0, 0).scale.set(1.3, 0.5, 0.9);
      for (let i = 0; i < 3; i++) { const c = add(foot, new THREE.ConeGeometry(0.11, 0.9, 5), bone, 0.78, -0.05, (i - 1) * 0.3); c.rotation.z = -Math.PI / 2 - 0.15; c.rotation.y = -(i - 1) * 0.3; }
      add(foot, new THREE.ConeGeometry(0.1, 0.6, 5), bone, -0.6, 0.05, 0).rotation.z = Math.PI / 2 + 0.3;   // heel spur
      return { side, thigh: mk(cyl), shin: mk(cyl2), knee: mk(joint), foot, pos: V(), from: V(), to: V(), t: 1, init: false };
    });
    // ---- arms: shoulder -> elbow -> (the opening it reached in by) -> hand
    this.arms = [];
    const spike = new THREE.ConeGeometry(0.5, 1, 4);
    for (let i = 0; i < 8; i++) {
      const hand = new THREE.Group(); g.add(hand);
      const palm = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), skin); palm.scale.set(1, 0.45, 1.15); palm.castShadow = true; hand.add(palm);
      const fingers = [];
      for (let f = 0; f < 5; f++) {
        const fg = new THREE.Group(); const a = (f - 2) * 0.42;
        fg.position.set(Math.sin(a) * 0.26, 0, -Math.cos(a) * 0.3); fg.rotation.y = -a;
        const s1 = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.065, 0.55, 6), skin); s1.rotation.x = -Math.PI / 2; s1.position.z = -0.27; s1.castShadow = true;
        const kn = new THREE.Mesh(new THREE.SphereGeometry(0.065, 6, 5), bone); kn.castShadow = true; kn.userData.st = 1;
        const tipG = new THREE.Group(); tipG.position.z = -0.54;
        const s2 = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.75, 5), bone); s2.rotation.x = -Math.PI / 2; s2.position.z = -0.37; s2.castShadow = true;
        s2.userData.st = 1; tipG.add(s2, kn); fg.add(s1, tipG); hand.add(fg); fingers.push({ fg, tipG });
      }
      this.arms.push({
        i, upper: mk(cyl), lower: mk(cyl2), elbow: mk(joint), ext: [mk(cyl2), mk(cyl2)], knots: [mk(joint), mk(joint)], spike: mk(spike, bone), strip: mk(spike, skin),
        hand, fingers, tip: V(), via: [V(), V()], nvia: 0, init: false, ph: Math.random() * 9, active: 0,
        plant: V(), from: V(), to: V(), st: 1, planted: false,
      });
    }
    fuse(g);
    this.x = 0; this.z = 0; this.h = 9.3; this.yaw = 0; this.walk = 0; this.stun = 0; this.t = 0; this.state = 'roam';
    this.tilt = 0.12; this.drop = 0; this.jawOpen = 0; this.eating = -1; this.crawl = 0; this.rollA = 0; this.look = V(); this.lookK = 0;
    this.onStep = null;
    this.headPos = V(); this.mouthPos = V();
  }

  // s: {x,z,d,st,h,pk,ps,fast,hands[]} from the simulation; eye: where the viewer is (it looks at you)
  update(dt, s, eye) {
    const t = (this.t += dt);
    const k = Math.min(1, dt * 8);
    if (!this.started) { this.x = s.x; this.z = s.z; this.h = s.h; this.started = true; }
    const px = this.x;
    this.x += (s.x - this.x) * k; this.z += (s.z - this.z) * k; this.h += (s.h - this.h) * Math.min(1, dt * 2);
    this.state = s.st;
    const sc = this.h / 10, speed = Math.abs(this.x - px) / Math.max(dt, 1e-3);
    const stunned = s.st === 'stun', hunt = s.st === 'hunt', eat = s.st === 'eat', peek = s.pk > 0 && !stunned && !eat;
    // it runs on everything it has when it knows where someone is
    const crawling = !!s.fast && !stunned && !eat && !peek;
    this.crawl += ((crawling ? 1 : 0) - this.crawl) * Math.min(1, dt * 3.5);
    const cr = this.crawl, tq = Math.floor(t * 11) / 11;          // tq: time in jerks, for the stop-motion twitching
    this.stun += ((stunned ? 1 : 0) - this.stun) * Math.min(1, dt * 5);

    // facing: along the street, or square on to the building it is looking into / the meal in its fist
    const ty = (peek || eat) && s.ps ? (s.ps > 0 ? -Math.PI / 2 : Math.PI / 2) : (s.d > 0 ? 0 : Math.PI);
    this.yaw += wrap(ty - this.yaw) * Math.min(1, dt * (eat ? 5 : 3));
    const sway = cr * Math.sin(this.walk * 1.7 / sc) * 0.16;      // the body whips from side to side as it runs
    const fx = Math.cos(this.yaw), fz = -Math.sin(this.yaw);
    this.walk += speed * dt;

    // bend down so the face is level with the windows of the floor being searched; flat out when crawling
    const L = 5.9 * sc;
    let tiltT = 0.12 + (hunt ? 0.3 : 0) + this.stun * 0.7 + (speed > 4 ? 0.12 : 0), dropT = this.stun * 1.3 * sc;
    if (peek) {
      const stand = 5 * sc + L * Math.cos(0.12);
      if (s.pk + 0.3 < stand) {
        // lean in to look, but keep the whole skull on the street side of the wall
        const room = 8 - (s.ps > 0 ? this.z : -this.z) - 3.4 * sc - 0.6;
        const lean = Math.min(1.05, Math.asin(Math.max(0.12, Math.min(0.87, room / L))));
        tiltT = lean; dropT = Math.min(3.4 * sc, Math.max(0, 5 * sc + L * Math.cos(lean) - (s.pk + 0.4)));
      }
    }
    if (eat) { tiltT = 0.05; dropT = 0; }
    tiltT += (1.32 - tiltT) * cr; dropT += (2.7 * sc - dropT) * cr;
    this.tilt += (tiltT - this.tilt) * Math.min(1, dt * 2.6); this.drop += (dropT - this.drop) * Math.min(1, dt * 2.6);
    const bob = Math.sin(this.walk * 1.4 / sc) * 0.14 * sc + Math.sin(t * 1.3) * 0.05 * sc + cr * Math.abs(Math.sin(this.walk * 2.4 / sc)) * 0.3 * sc;
    const hip = 5.0 * sc - this.drop + bob;
    this.body.position.set(this.x, hip, this.z);
    this.body.scale.setScalar(sc);
    this.body.rotation.set(cr * Math.sin(tq * 9) * 0.07, this.yaw + sway, -(this.tilt + Math.sin(t * 0.7) * 0.03));
    this.neck.rotation.z = this.tilt * 0.45 + (eat ? 0.25 : 0) + cr * 0.5;
    this.body.updateMatrixWorld(true);

    // ---- head: scans, or locks on to what it wants
    const scan = (s.st === 'listen' || (s.st === 'search' && !peek)) ? Math.sin(t * 0.8) * 0.9 : Math.sin(t * 0.4) * 0.25;
    let lookAt = null;
    const eatHand = this.eating >= 0 ? this.arms[this.eating] : null;
    if (eat && eatHand) lookAt = eatHand.tip; else if ((hunt || crawling) && eye) lookAt = eye; else if (eye && Math.hypot(eye.x - this.x, eye.z - this.z) < 14 * sc && !stunned && !peek) lookAt = eye;
    this.lookK += ((lookAt ? 1 : 0) - this.lookK) * Math.min(1, dt * 4);
    let hy = peek ? Math.sin(t * 1.7) * 0.35 : scan, hz = this.tilt * 0.4 - this.stun * 0.5 + (peek ? Math.sin(t * 2.3) * 0.08 : 0);
    if (lookAt) {
      this.look.lerp(lookAt, Math.min(1, dt * 6));
      const l = this.neck.worldToLocal(_a.copy(this.look)).sub(this.head.position);
      const ly = Math.atan2(-l.z, l.x), lp = Math.atan2(l.y, Math.hypot(l.x, l.z));
      hy += (Math.max(-1.9, Math.min(1.9, ly)) - hy) * this.lookK; hz += (Math.max(-1.3, Math.min(1.3, lp)) - hz) * this.lookK;
    } else if (eye) this.look.copy(eye);
    this.head.rotation.set(stunned ? Math.sin(t * 31) * 0.06 : 0, hy + cr * Math.sin(tq * 5.3) * 0.25, hz);
    // crawling: the head turns over, in jerks, and keeps twitching
    const rollT = cr > 0.5 ? Math.PI + Math.sin(tq * 3.1) * 0.5 : Math.sin(t * 0.9) * 0.1 + (peek ? Math.sin(tq * 2) * 0.35 : 0);
    this.rollA += wrap(rollT - this.rollA) * Math.min(1, dt * (cr > 0.5 ? 9 : 4));
    this.headRoll.rotation.x = this.rollA;
    // jaws
    const near = eat && eatHand ? Math.max(0, 1 - eatHand.tip.distanceTo(this.mouthPos) / (4 * sc)) : 0;
    const jawT = eat ? 0.5 + near * 0.95 : crawling ? 1.15 + Math.sin(tq * 13) * 0.2 : hunt ? 0.6 : peek ? 0.35 : 0.1 + Math.max(0, Math.sin(t * 1.1)) * 0.08;
    this.jawOpen += (jawT - this.jawOpen) * Math.min(1, dt * 6);
    this.jaw.rotation.z = -this.jawOpen;
    for (const m of this.mand) m.p.rotation.y = m.sgn * (0.15 + this.jawOpen * 0.7) + Math.sin(t * 6 + m.sgn) * 0.05;
    this.maw.scale.y = 0.3 + this.jawOpen * 0.9;
    this.tongue.scale.setScalar(0.25 + Math.max(0, this.jawOpen - 0.3) * 1.1);
    this.tongue.rotation.set(0, Math.sin(t * 9) * 0.5 * this.jawOpen, -0.5 + Math.sin(t * 7.3) * 0.4 * this.jawOpen);
    this.mouthLight.intensity = (eat ? 5 : hunt || crawling ? 14 : peek ? 8 : 0) * (0.8 + 0.2 * Math.sin(t * 20));
    this.eyeMat.color.setHex(stunned ? (Math.sin(t * 25) > 0 ? 0x223040 : 0x050505) : hunt || eat || crawling ? 0xff2a18 : peek ? 0xffb040 : 0xfff0c0);
    // pupils slide round the sockets to keep the viewer in sight
    if (eye) {
      const l = this.headRoll.worldToLocal(_a.copy(lookAt || eye)).normalize();
      for (const p of this.pupils) p.m.position.set(p.bx + 0.06 + Math.max(0, l.x) * 0.05, p.by + l.y * 0.09, p.bz + l.z * 0.09);
    }
    const beat = 0.7 + 0.3 * Math.pow(Math.max(0, Math.sin(t * (hunt || crawling ? 7 : 3))), 6);
    this.heart.scale.setScalar(0.85 + beat * 0.3);
    this.heartMat.color.setHex(stunned ? 0x301008 : 0xff3a18);
    this.heartLight.intensity = stunned ? 0.6 : (hunt || crawling ? 16 : 9) * beat;
    this.skin.emissiveIntensity = stunned ? 0.05 : 0.25 + beat * (hunt || crawling || eat ? 1.3 : 0.6);
    // belly mouth: opens for a meal, gapes when it runs
    const bo = eat ? 0.5 + near * 0.5 : cr * 0.7 + (hunt ? 0.3 : 0) + Math.max(0, Math.sin(t * 0.6)) * 0.08;
    this.bellyHole.scale.set(0.5, 1.4, 0.15 + bo * 0.9);
    for (const b of this.bellyLips) b.p.position.z = b.sgn * (0.06 + bo * 0.36);
    for (const v of this.vest) {
      const grab = eat ? 0.9 : cr * 0.6;
      v.p.rotation.set(0, v.sgn * (0.5 - grab * 0.4) + Math.sin(tq * 4 + v.ph) * 0.3, Math.sin(t * 2.1 + v.ph) * 0.4 - 0.3 + grab * 0.5);
      v.lo.rotation.z = -0.6 + Math.sin(tq * 6 + v.ph) * 0.5;
    }
    for (const q of this.tendrils) q.piv.rotation.set(Math.sin(t * 1.3 + q.ph) * 0.25 + this.tilt * 0.8, 0, Math.cos(t * 1.1 + q.ph) * 0.25);
    this.body.updateMatrixWorld(true);
    this.head.getWorldPosition(this.headPos);
    this.mouthPos.set(0.7, -0.25, 0); this.headRoll.localToWorld(this.mouthPos);

    // ---- legs: plant a foot, swing the other when the body gets ahead of it
    const stride = (2.0 - cr * 0.6) * sc, spread = 0.8 + cr * 1.0;
    for (let i = 0; i < 2; i++) {
      const Lg = this.legs[i], o = this.legs[1 - i];
      const hx = this.x + fx * (0.2 - cr * 1.6) * sc - fz * Lg.side * spread * sc, hz2 = this.z + fz * (0.2 - cr * 1.6) * sc + fx * Lg.side * spread * sc;
      if (!Lg.init) { Lg.pos.set(hx, 0, hz2); Lg.init = true; }
      if (Lg.t >= 1) {
        const dist = Math.hypot(hx - Lg.pos.x, hz2 - Lg.pos.z);
        if (dist > stride * (i ? 0.5 : 0.62) && o.t >= 1) {
          Lg.from.copy(Lg.pos); const lead = Math.min(stride * 0.9, speed * 0.5);
          Lg.to.set(hx + Math.sign(this.x - px || fx) * lead, 0, hz2); Lg.t = 0;
        }
      } else {
        Lg.t = Math.min(1, Lg.t + dt * (2.2 + speed * 0.35 + cr * 2));
        Lg.pos.lerpVectors(Lg.from, Lg.to, Lg.t); Lg.pos.y = Math.sin(Lg.t * Math.PI) * (1.1 - cr * 0.5) * sc;
        if (Lg.t >= 1) { Lg.pos.y = 0; if (this.onStep) this.onStep(Lg.pos.x, Lg.pos.z, false); }
      }
      const hipP = V().set(this.x - fz * Lg.side * 0.45 * sc, hip + 0.2 * sc, this.z + fx * Lg.side * 0.45 * sc);
      const ank = V().copy(Lg.pos); ank.y += 0.3 * sc;
      // knees forward when it walks, out and up like a spider's when it crawls
      const pole = V().set(fx * (1 - cr) - fz * Lg.side * cr, 0.3 + cr * 1.2, fz * (1 - cr) + fx * Lg.side * cr);
      const knee = ik(hipP, ank, 2.75 * sc, 2.75 * sc, pole, V());
      span(Lg.thigh, hipP, knee, 0.5 * sc); span(Lg.shin, knee, ank, 0.38 * sc);
      Lg.knee.position.copy(knee); Lg.knee.scale.setScalar(0.42 * sc);
      Lg.foot.position.set(Lg.pos.x, Lg.pos.y + 0.2 * sc, Lg.pos.z); Lg.foot.scale.setScalar(sc); Lg.foot.rotation.y = this.yaw;
    }

    // ---- arms
    for (const A of this.arms) {
      const side = A.i < 4 ? 1 : -1, kk = A.i % 4, hs = s.hands[A.i];
      const root = V().set(0.12, 0.45 + kk * 0.95, side * 0.95); this.body.localToWorld(root);
      const target = _a;
      let nvia = 0, planted = false;
      if (hs) {
        target.set(hs[1], hs[2], hs[3]);
        nvia = Math.min(2, Math.floor((hs.length - 4) / 3));
        for (let j = 0; j < nvia; j++) {
          if (j >= A.nvia) A.via[j].copy(j ? A.via[0] : A.tip);   // unfold from where the arm already is
          A.via[j].lerp(_b.set(hs[4 + j * 3], hs[5 + j * 3], hs[6 + j * 3]), Math.min(1, dt * 12));
        }
        A.planted = false;
      } else if (cr > 0.4) {
        // a free hand becomes a foot: slapped down on the road ahead, one after another
        const lead = (1.6 + Math.min(3, speed * 0.3)) * sc, wide = (2.0 + (kk % 2) * 0.9) * sc;
        const hx = root.x + fx * lead - fz * side * wide, hz2 = root.z + fz * lead + fx * side * wide;
        if (!A.planted) { A.plant.set(hx, 0, hz2); A.planted = true; A.st = 1; }
        if (A.st >= 1) {
          const dist = Math.hypot(hx - A.plant.x, hz2 - A.plant.z);
          const busy = this.arms.some((o) => o !== A && o.st < 1 && (o.i < 4) === (A.i < 4) && Math.abs((o.i % 4) - kk) === 1);
          if (dist > 2.2 * sc && !busy) { A.from.copy(A.plant); A.to.set(hx + Math.sign(this.x - px || fx) * 1.4 * sc, 0, hz2); A.st = 0; }
        } else {
          A.st = Math.min(1, A.st + dt * (5 + speed * 0.5));
          A.plant.lerpVectors(A.from, A.to, A.st); A.plant.y = Math.sin(A.st * Math.PI) * 1.3 * sc;
          if (A.st >= 1) { A.plant.y = 0; if (this.onStep) this.onStep(A.plant.x, A.plant.z, true); }
        }
        target.copy(A.plant); target.y += 0.12 * sc; planted = true;
      } else {   // idle: hang and sway, fingers twitching
        A.planted = false;
        const sw = Math.sin(t * 0.8 + A.ph), limp = this.stun, grabby = eat ? 0.6 : 0;
        target.set(root.x + fx * (0.6 + sw * 0.5 + grabby * 2) * sc * (1 - limp), Math.max(0.4, root.y - (2.8 + kk * 0.4 + limp * 2 - grabby * 2) * sc + Math.sin(t * 1.1 + A.ph) * 0.3 * sc), root.z + side * (1.6 + kk * 0.5 + Math.cos(t * 0.6 + A.ph) * 0.3) * sc * (1 - limp * 0.6) + fz * grabby * 2 * sc);
      }
      A.nvia = nvia;
      if (!A.init) { A.tip.copy(target); A.init = true; }
      A.tip.lerp(target, Math.min(1, dt * (hs ? 14 : planted ? 22 : 3)));
      A.active += ((hs ? 1 : 0) - A.active) * Math.min(1, dt * 6);
      // shoulder -> elbow -> first bend (or the hand)
      const reach = nvia ? A.via[0] : A.tip;
      const elbow = ik(root, reach, 3.2 * sc, 3.2 * sc, V().set(0, hs ? 0.8 : planted ? 2 : 0.3, side * (hs ? 0.2 : 1)), V());
      span(A.upper, root, elbow, 0.27 * sc); span(A.lower, elbow, reach, 0.2 * sc);
      A.elbow.position.copy(elbow); A.elbow.scale.setScalar(0.25 * sc);
      A.spike.position.copy(elbow); A.spike.scale.set(0.14 * sc, 0.9 * sc, 0.14 * sc);
      A.spike.quaternion.setFromUnitVectors(UP, _b.subVectors(elbow, reach).normalize());
      // a strip of skin hanging off the forearm
      A.strip.position.copy(elbow).lerp(reach, 0.45); A.strip.position.y -= 0.55 * sc; A.strip.scale.set(0.22 * sc, 1.1 * sc, 0.05 * sc);
      A.strip.quaternion.setFromUnitVectors(UP, _b.set(Math.sin(t * 1.7 + A.ph) * 0.25, -1, Math.cos(t * 1.3 + A.ph) * 0.25).normalize());
      // inside a building: opening -> hand
      let last = elbow;
      for (let j = 0; j < 2; j++) {
        const on = j < nvia;
        A.ext[j].visible = A.knots[j].visible = on;
        if (!on) continue;
        const from = A.via[j], to = j + 1 < nvia ? A.via[j + 1] : A.tip;
        span(A.ext[j], from, to, 0.15 * sc);
        A.knots[j].position.copy(from); A.knots[j].scale.setScalar(0.17 * sc);
        last = from;
      }
      _b.subVectors(A.tip, last).normalize();
      A.hand.position.copy(A.tip);
      if (planted) A.hand.quaternion.setFromAxisAngle(UP, this.yaw - Math.PI / 2);   // palm flat on the road, fingers forward
      else A.hand.quaternion.copy(_q.setFromUnitVectors(FWD, _b));
      A.hand.scale.setScalar(sc * 1.1 + 0.3);
      const grip = this.eating === A.i ? 1.3 : 0;
      const curl = planted ? -0.15 : grip + 0.25 + (1 - A.active) * 0.5 + Math.sin(t * (hs ? 7 : 1.5) + A.ph) * (hs ? 0.25 : 0.08);
      A.fingers.forEach((f, j) => { f.fg.rotation.x = -curl * 0.6 - Math.sin(t * 5 + j + A.ph) * 0.06 * A.active; f.tipG.rotation.x = -curl; });
    }
  }

  reset() { this.started = false; this.eating = -1; this.crawl = 0; this.legs.forEach((l) => { l.init = false; l.t = 1; }); this.arms.forEach((a) => { a.init = false; a.nvia = 0; a.planted = false; }); }
  setVisible(v) { this.group.visible = v; }
  dispose() { this.scene.remove(this.group); }
}
