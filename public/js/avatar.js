// Player bodies (male / female), animated procedurally, and the first-person arms.
import * as THREE from 'three';

const LOOKS = {
  m: { h: 1.0, sh: 0.215, waist: 0.15, hip: 0.165, chest: 0.2, jacket: 0x3a4c5c, lining: 0x8a7a5a, pants: 0x23272e, hair: 0x1c1410, skin: 0xc49a7c, limb: 0.056, pack: 0x4a4636 },
  f: { h: 0.94, sh: 0.18, waist: 0.125, hip: 0.172, chest: 0.185, jacket: 0x7a2c3c, lining: 0xc8b89a, pants: 0x2c2832, hair: 0x4a2414, skin: 0xd6ac90, limb: 0.048, pack: 0x3c4a4a },
};

let clothTex = null;
function cloth() {
  if (clothTex) return clothTex;
  const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
  x.fillStyle = '#c8c8c8'; x.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 64; i += 2) { x.fillStyle = `rgba(0,0,0,${0.05 + Math.random() * 0.12})`; x.fillRect(i, 0, 1, 64); x.fillRect(0, i, 64, 1); }
  for (let i = 0; i < 40; i++) { x.fillStyle = `rgba(0,0,0,${Math.random() * 0.15})`; x.beginPath(); x.arc(Math.random() * 64, Math.random() * 64, 2 + Math.random() * 8, 0, 7); x.fill(); }
  clothTex = new THREE.CanvasTexture(c); clothTex.wrapS = clothTex.wrapT = THREE.RepeatWrapping; clothTex.repeat.set(3, 3); clothTex.colorSpace = THREE.SRGBColorSpace;
  return clothTex;
}

function nameTag(name) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const x = c.getContext('2d');
  x.font = '600 30px Georgia, serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.shadowColor = '#000'; x.shadowBlur = 8; x.fillStyle = '#e8e2d4'; x.fillText(name, 128, 32);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
  s.scale.set(1.2, 0.3, 1); s.layers.set(1);
  return s;
}

export class Avatar {
  constructor(char, name) {
    const fem = char === 'f', L = LOOKS[fem ? 'f' : 'm'], g = this.group = new THREE.Group();
    const fab = (c, r = 0.85) => new THREE.MeshStandardMaterial({ color: c, roughness: r, map: cloth(), bumpMap: cloth(), bumpScale: 0.6 });
    const flat = (c, r = 0.6, m = 0) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });
    const jacket = fab(L.jacket), lining = fab(L.lining), pants = fab(L.pants, 0.9), skin = flat(L.skin, 0.55), hair = flat(L.hair, 0.4), boot = flat(0x121214, 0.45), pack = fab(L.pack), metal = flat(0x8a8f94, 0.35, 0.8);
    const add = (parent, geo, m, x, y, z, sx = 1, sy = 1, sz = 1) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.scale.set(sx, sy, sz); o.castShadow = true; parent.add(o); return o; };
    const cap = (r, len) => new THREE.CapsuleGeometry(r, len, 5, 12);
    const sph = new THREE.SphereGeometry(1, 18, 14);
    const root = this.root = new THREE.Group(); root.scale.setScalar(L.h); g.add(root);

    // ---- torso (pivots at the hips)
    const torso = this.torso = new THREE.Group(); torso.position.y = 0.95; root.add(torso);
    const prof = [[0.02, -0.1], [L.hip, -0.08], [L.hip * 1.02, 0.02], [L.waist, 0.2], [L.chest, 0.4], [L.sh, 0.52], [L.sh * 0.92, 0.58], [0.075, 0.63], [0.055, 0.66]].map(([r, y]) => new THREE.Vector2(r, y));
    add(torso, new THREE.LatheGeometry(prof, 20), jacket, 0, 0, 0, 1, 1, fem ? 0.66 : 0.64);
    if (fem) { add(torso, sph, jacket, 0.07, 0.41, -0.085, 0.075, 0.07, 0.07); add(torso, sph, jacket, -0.07, 0.41, -0.085, 0.075, 0.07, 0.07); }
    add(torso, sph, pants, 0, -0.03, 0, L.hip * 1.02, 0.11, L.hip * 0.7);                           // hips
    add(torso, new THREE.TorusGeometry(L.waist * 1.1, 0.018, 6, 20), boot, 0, 0.06, 0, 1, 1, 0.68).rotation.x = Math.PI / 2;   // belt
    add(torso, new THREE.BoxGeometry(0.05, 0.04, 0.02), metal, 0, 0.06, -L.waist * 0.75);
    add(torso, new THREE.BoxGeometry(0.012, 0.44, 0.012), metal, 0, 0.36, -L.chest * 0.62);         // zip
    add(torso, new THREE.TorusGeometry(0.075, 0.03, 8, 16, Math.PI * 1.5), lining, 0, 0.62, 0.005).rotation.set(Math.PI / 2, 0, Math.PI * 0.75);   // collar
    // backpack + straps
    add(torso, new THREE.CapsuleGeometry(0.11, 0.2, 4, 10), pack, 0, 0.36, 0.17, 1.1, 1, 0.75);
    add(torso, new THREE.BoxGeometry(0.16, 0.1, 0.05), pack, 0, 0.3, 0.26);
    for (const s of [1, -1]) add(torso, new THREE.TorusGeometry(0.13, 0.014, 5, 14, Math.PI), pack, s * L.sh * 0.6, 0.4, 0.0, 1, 1.3, 1).rotation.set(0, Math.PI / 2, -Math.PI / 2);

    // ---- head
    add(torso, new THREE.CylinderGeometry(0.047, 0.055, 0.1, 12), skin, 0, 0.67, 0);
    const head = this.head = new THREE.Group(); head.position.y = 0.8; torso.add(head);
    add(head, sph, skin, 0, 0, 0, 0.098, 0.122, 0.108);                                             // skull
    add(head, sph, skin, 0, -0.06, -0.022, 0.078, 0.07, 0.085);                                     // jaw
    add(head, new THREE.ConeGeometry(0.016, 0.045, 6), skin, 0, -0.012, -0.108).rotation.x = -1.2;  // nose
    for (const s of [1, -1]) {
      add(head, sph, skin, s * 0.098, -0.005, 0.005, 0.012, 0.028, 0.02);                           // ear
      add(head, sph, flat(0xe8e4dc, 0.3), s * 0.036, 0.018, -0.09, 0.018, 0.012, 0.012);            // eye
      add(head, sph, flat(0x18120e, 0.2), s * 0.036, 0.018, -0.1, 0.008, 0.008, 0.005);
      add(head, new THREE.BoxGeometry(0.04, 0.008, 0.012), hair, s * 0.037, 0.042, -0.094).rotation.z = -s * 0.12;   // brow
    }
    add(head, new THREE.BoxGeometry(0.04, 0.006, 0.01), flat(0x6a3a34, 0.5), 0, -0.058, -0.097);    // mouth
    if (fem) {
      add(head, new THREE.SphereGeometry(1, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), hair, 0, 0.012, 0.01, 0.108, 0.13, 0.118);
      add(head, sph, hair, 0, -0.12, 0.06, 0.1, 0.17, 0.06);                                        // length down the back
      for (const s of [1, -1]) add(head, cap(0.022, 0.2), hair, s * 0.092, -0.1, -0.01).rotation.z = s * 0.1;
      add(head, new THREE.BoxGeometry(0.15, 0.03, 0.03), hair, 0, 0.085, -0.085).rotation.x = 0.5;  // fringe
    } else {
      add(head, new THREE.SphereGeometry(1, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), hair, 0, 0.022, 0.008, 0.104, 0.125, 0.114);
      add(head, new THREE.BoxGeometry(0.12, 0.025, 0.03), hair, 0.01, 0.09, -0.088).rotation.x = 0.4;
      add(head, sph, hair, 0, -0.03, 0.07, 0.085, 0.075, 0.05);                                     // nape
    }

    // ---- limbs
    const limb = (parent, x, y, len, r, m1, m2, end) => {
      const up = new THREE.Group(); up.position.set(x, y, 0); parent.add(up);
      add(up, cap(r, len - r), m1, 0, -len / 2, 0);
      const lo = new THREE.Group(); lo.position.y = -len; up.add(lo);
      add(lo, cap(r * 0.86, len - r), m2, 0, -len / 2, 0);
      add(lo, sph, m1, 0, 0, 0, r * 1.05, r * 1.05, r * 1.05);   // elbow / knee
      if (end) lo.add(end);
      return { up, lo };
    };
    const hand = () => { const h = new THREE.Group(); h.position.y = -0.32; add(h, sph, skin, 0, -0.03, 0, 0.034, 0.05, 0.024); add(h, cap(0.011, 0.04), skin, 0.03, -0.02, -0.012).rotation.z = 0.6; add(h, new THREE.BoxGeometry(0.058, 0.04, 0.03), skin, 0, -0.075, 0); return h; };
    const foot = () => { const f = new THREE.Group(); f.position.set(0, -0.44, 0); add(f, new THREE.CapsuleGeometry(0.048, 0.14, 4, 8), boot, 0, 0, -0.05).rotation.x = Math.PI / 2; add(f, new THREE.BoxGeometry(0.1, 0.03, 0.27), flat(0x050505, 0.8), 0, -0.045, -0.055); add(f, new THREE.CylinderGeometry(0.058, 0.055, 0.1, 10), boot, 0, 0.06, 0.02); return f; };
    add(torso, sph, jacket, -L.sh - 0.012, 0.54, 0, 0.07, 0.065, 0.07); add(torso, sph, jacket, L.sh + 0.012, 0.54, 0, 0.07, 0.065, 0.07);   // shoulders
    this.armL = limb(torso, -L.sh - 0.03, 0.53, 0.29, L.limb, jacket, jacket, hand());
    this.armR = limb(torso, L.sh + 0.03, 0.53, 0.29, L.limb, jacket, jacket, hand());
    this.legL = limb(root, -0.09, 0.93, 0.45, L.limb * 1.38, pants, pants, foot());
    this.legR = limb(root, 0.09, 0.93, 0.45, L.limb * 1.38, pants, pants, foot());
    // torch + its light
    const torch = new THREE.Group(); torch.position.set(0, -0.37, -0.07); torch.rotation.x = Math.PI / 2; this.armR.lo.add(torch);
    add(torch, new THREE.CylinderGeometry(0.018, 0.02, 0.15, 10), boot, 0, 0, 0); add(torch, new THREE.CylinderGeometry(0.032, 0.02, 0.05, 10), metal, 0, 0.09, 0);
    this.lens = add(torch, new THREE.CylinderGeometry(0.028, 0.028, 0.005, 10), new THREE.MeshBasicMaterial({ color: 0xeef4ff }), 0, 0.118, 0); this.lens.castShadow = false;
    this.beam = new THREE.SpotLight(0xdfe8ff, 0, 22, 0.42, 0.5, 1.3);
    this.beam.position.set(0.2, 1.35, -0.3); this.beamTarget = new THREE.Object3D(); this.beamTarget.position.set(0.2, 1.2, -6);
    g.add(this.beam, this.beamTarget); this.beam.target = this.beamTarget;
    if (name) { this.tag = nameTag(name); this.tag.position.y = 2.05 * L.h; g.add(this.tag); }
    this.phase = 0; this.x = 0; this.y = 0; this.z = 0; this.yaw = 0; this.speed = 0; this.crouchK = 0; this.init = false; this.t = Math.random() * 9;
  }

  // target state from the network; smoothed here
  update(dt, tx, ty, tz, yaw, flags) {
    if (!this.init) { this.x = tx; this.y = ty; this.z = tz; this.yaw = yaw; this.init = true; }
    const px = this.x, pz = this.z, k = Math.min(1, dt * 12);
    this.x += (tx - px) * k; this.y += (ty - this.y) * k; this.z += (tz - pz) * k;
    let d = yaw - this.yaw; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
    this.yaw += d * k;
    const sp = Math.hypot(this.x - px, this.z - pz) / Math.max(dt, 1e-3);
    this.speed += (sp - this.speed) * Math.min(1, dt * 8);
    this.pose(dt, this.speed, !!(flags & 1), !!(flags & 4), !!(flags & 16));
    this.group.position.set(this.x, this.y, this.z); this.group.rotation.y = this.yaw;
  }

  pose(dt, speed, crouch, torchOn, armed) {
    this.phase += speed * dt * 2.6; this.t += dt;
    const amp = Math.min(1, speed / 3) * (speed > 4.5 ? 1.05 : 0.7), s = Math.sin(this.phase), idle = 1 - Math.min(1, speed);
    this.crouchK += ((crouch ? 1 : 0) - this.crouchK) * Math.min(1, dt * 10);
    const c = this.crouchK, br = Math.sin(this.t * 1.6) * 0.012 * idle;
    this.root.position.y = -c * 0.42 * this.root.scale.y + Math.abs(Math.cos(this.phase)) * 0.03 * amp;
    this.torso.rotation.set(-c * 0.55 - amp * 0.08 + br, Math.sin(this.phase) * 0.08 * amp, Math.cos(this.phase) * 0.03 * amp);
    this.torso.scale.set(1, 1 + br, 1 + br * 2);
    this.head.rotation.set(c * 0.35 + amp * 0.05, Math.sin(this.t * 0.5) * 0.18 * idle, 0);
    this.legL.up.rotation.x = s * amp - c * 1.25; this.legL.lo.rotation.x = Math.max(0, -s) * amp * 1.1 + c * 2.1;
    this.legR.up.rotation.x = -s * amp - c * 1.25; this.legR.lo.rotation.x = Math.max(0, s) * amp * 1.1 + c * 2.1;
    this.armL.up.rotation.set(-s * amp * 0.8, 0, -0.06); this.armL.lo.rotation.x = -0.25 - amp * 0.4;
    if (torchOn || armed) { this.armR.up.rotation.set(-1.15 + c * 0.4, 0, 0.06); this.armR.lo.rotation.x = -0.35; } else { this.armR.up.rotation.set(s * amp * 0.8, 0, 0.06); this.armR.lo.rotation.x = -0.25 - amp * 0.4; }
    this.beam.intensity = torchOn ? 30 : 0; this.lens.visible = torchOn;
  }
}

// First-person arms: torch in the left hand, flare pistol in the right. Parented to the camera.
export function makeViewHands() {
  const group = new THREE.Group();
  const sleeve = new THREE.MeshStandardMaterial({ color: 0x2e3a46, roughness: 0.9, map: cloth() }), skin = new THREE.MeshStandardMaterial({ color: 0xc49a7c, roughness: 0.55 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x101012, roughness: 0.4, metalness: 0.5 }), steel = new THREE.MeshStandardMaterial({ color: 0x8a8f94, roughness: 0.3, metalness: 0.85 });
  const lensMat = new THREE.MeshBasicMaterial({ color: 0xfff4dc });
  const arm = (sgn) => {
    const a = new THREE.Group();
    const fore = new THREE.Mesh(new THREE.CapsuleGeometry(0.042, 0.3, 5, 10), sleeve); fore.rotation.x = -1.15; fore.position.set(sgn * 0.03, -0.11, 0.2); a.add(fore);
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.05, 0.05, 10), sleeve); cuff.rotation.x = -1.15; cuff.position.set(sgn * 0.015, -0.035, 0.06); a.add(cuff);
    const palm = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 10), skin); palm.scale.set(0.04, 0.05, 0.03); palm.position.set(0, 0, 0.02); a.add(palm);
    for (let i = 0; i < 4; i++) { const f = new THREE.Mesh(new THREE.CapsuleGeometry(0.009, 0.045, 3, 6), skin); f.position.set(-0.026 + i * 0.017, 0.012, -0.012); f.rotation.x = 1.3; a.add(f); }
    const th = new THREE.Mesh(new THREE.CapsuleGeometry(0.011, 0.035, 3, 6), skin); th.position.set(-sgn * 0.036, 0.02, 0.0); th.rotation.set(0.6, 0, sgn * 0.7); a.add(th);
    group.add(a);
    return a;
  };
  const left = arm(-1), right = arm(1);
  // torch
  const torch = new THREE.Group(); torch.position.set(0, 0.035, -0.05); torch.rotation.x = -Math.PI / 2; left.add(torch);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.022, 0.18, 12), dark); torch.add(body);
  const hd = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.022, 0.06, 12), steel); hd.position.y = 0.11; torch.add(hd);
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.031, 0.031, 0.004, 12), lensMat); lens.position.y = 0.142; torch.add(lens);
  const st = { l: 0, r: 0, t: 0 };
  group.visible = false;
  return {
    group, right, left,
    update(dt, s) {
      group.visible = s.show;
      if (!s.show) return;
      st.t += dt;
      st.l += ((s.torch ? 1 : 0) - st.l) * Math.min(1, dt * 9); st.r += ((s.gun ? 1 : 0) - st.r) * Math.min(1, dt * 9);
      const sway = Math.sin(s.bob) * (s.sprint ? 0.022 : 0.01), lift = Math.abs(Math.cos(s.bob)) * (s.sprint ? 0.02 : 0.008), idle = Math.sin(st.t * 1.5) * 0.004;
      left.position.set(-0.23 + sway, -0.2 - (1 - st.l) * 0.5 + lift + idle, -0.4); left.rotation.set(0.05 + (1 - st.l) * 0.8, 0.12, 0.1);
      right.position.set(0.22 - sway, -0.2 - (1 - st.r) * 0.5 + lift - idle + s.recoil * 0.03, -0.42 + s.recoil * 0.07); right.rotation.set(0.03 + (1 - st.r) * 0.8 + s.recoil * 0.4, -0.08, -0.08);
      lensMat.color.setScalar(s.torch ? 0.15 + 0.45 * s.lit : 0.03);
      left.visible = st.l > 0.04; right.visible = st.r > 0.04;
    },
  };
}
