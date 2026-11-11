// Player bodies (male / female), animated procedurally.
import * as THREE from 'three';

const LOOKS = {
  m: { h: 1.0, sh: 0.23, hip: 0.17, jacket: 0x34485a, pants: 0x1f232a, hair: 0x1c1410, skin: 0xc9a285, limb: 0.062 },
  f: { h: 0.94, sh: 0.19, hip: 0.18, jacket: 0x7a2c3c, pants: 0x2a2630, hair: 0x4a2414, skin: 0xd8b095, limb: 0.052 },
};

function nameTag(name) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const x = c.getContext('2d');
  x.font = '600 30px Georgia, serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.shadowColor = '#000'; x.shadowBlur = 8; x.fillStyle = '#e8e2d4'; x.fillText(name, 128, 32);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
  s.scale.set(1.2, 0.3, 1);
  return s;
}

export class Avatar {
  constructor(char, name) {
    const L = LOOKS[char === 'f' ? 'f' : 'm'], g = this.group = new THREE.Group();
    const mat = (c, r = 0.85) => new THREE.MeshStandardMaterial({ color: c, roughness: r });
    const jacket = mat(L.jacket), pants = mat(L.pants), skin = mat(L.skin, 0.6), hair = mat(L.hair, 0.5), boot = mat(0x0e0e10, 0.5);
    const add = (parent, geo, m, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; parent.add(o); return o; };
    const root = this.root = new THREE.Group(); root.scale.setScalar(L.h); g.add(root);
    // torso group pivots at the hips
    const torso = this.torso = new THREE.Group(); torso.position.y = 0.95; root.add(torso);
    const chest = add(torso, new THREE.CylinderGeometry(L.sh, L.hip * (char === 'f' ? 0.8 : 0.95), 0.56, 10), jacket, 0, 0.3, 0); chest.scale.z = 0.62;
    add(torso, new THREE.CylinderGeometry(L.hip * (char === 'f' ? 0.8 : 0.95), L.hip, 0.2, 10), pants, 0, -0.04, 0).scale.z = 0.7;
    add(torso, new THREE.CylinderGeometry(0.05, 0.055, 0.1, 8), skin, 0, 0.62, 0);
    const head = this.head = new THREE.Group(); head.position.y = 0.78; torso.add(head);
    add(head, new THREE.SphereGeometry(0.115, 14, 12), skin, 0, 0, 0).scale.set(0.92, 1.08, 1);
    add(head, new THREE.BoxGeometry(0.03, 0.03, 0.03), skin, 0, -0.01, -0.115);   // nose
    const eyeM = new THREE.MeshBasicMaterial({ color: 0x101010 });
    add(head, new THREE.SphereGeometry(0.014, 6, 4), eyeM, 0.04, 0.02, -0.103); add(head, new THREE.SphereGeometry(0.014, 6, 4), eyeM, -0.04, 0.02, -0.103);
    if (char === 'f') {
      add(head, new THREE.SphereGeometry(0.125, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.6), hair, 0, 0.02, 0.012);
      add(head, new THREE.CylinderGeometry(0.11, 0.07, 0.34, 10), hair, 0, -0.14, 0.07).scale.z = 0.55;
      add(head, new THREE.SphereGeometry(0.05, 8, 6), hair, 0, 0.06, 0.14);
    } else {
      add(head, new THREE.SphereGeometry(0.122, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.48), hair, 0, 0.022, 0.008);
    }
    const limb = (parent, x, y, len, r, m1, m2, end) => {
      const up = new THREE.Group(); up.position.set(x, y, 0); parent.add(up);
      add(up, new THREE.CylinderGeometry(r, r * 0.88, len, 8), m1, 0, -len / 2, 0);
      const lo = new THREE.Group(); lo.position.y = -len; up.add(lo);
      add(lo, new THREE.CylinderGeometry(r * 0.88, r * 0.72, len, 8), m2, 0, -len / 2, 0);
      if (end) lo.add(end);
      return { up, lo };
    };
    const hand = () => { const h = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), skin); h.position.y = -0.33; return h; };
    const foot = () => { const f = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.25), boot); f.position.set(0, -0.44, -0.06); f.castShadow = true; return f; };
    this.armL = limb(torso, -L.sh - 0.03, 0.53, 0.29, L.limb, jacket, jacket, hand());
    this.armR = limb(torso, L.sh + 0.03, 0.53, 0.29, L.limb, jacket, jacket, hand());
    this.legL = limb(root, -0.09, 0.93, 0.45, L.limb * 1.35, pants, pants, foot());
    this.legR = limb(root, 0.09, 0.93, 0.45, L.limb * 1.35, pants, pants, foot());
    // torch + its light
    const torch = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.16, 8), boot); torch.rotation.x = Math.PI / 2; torch.position.set(0, -0.36, -0.08);
    this.armR.lo.add(torch);
    this.beam = new THREE.SpotLight(0xdfe8ff, 0, 22, 0.42, 0.5, 1.3);
    this.beam.position.set(0.2, 1.35, -0.3); this.beamTarget = new THREE.Object3D(); this.beamTarget.position.set(0.2, 1.2, -6);
    g.add(this.beam, this.beamTarget); this.beam.target = this.beamTarget;
    this.lens = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 4), new THREE.MeshBasicMaterial({ color: 0xeef4ff })); this.lens.position.set(0, -0.36, -0.17); this.armR.lo.add(this.lens);
    if (name) { this.tag = nameTag(name); this.tag.position.y = 2.05 * L.h; g.add(this.tag); }
    this.phase = 0; this.x = 0; this.y = 0; this.z = 0; this.yaw = 0; this.speed = 0; this.crouchK = 0; this.init = false;
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
    this.phase += speed * dt * 2.6;
    const amp = Math.min(1, speed / 3) * (speed > 4.5 ? 1.05 : 0.7), s = Math.sin(this.phase);
    this.crouchK += ((crouch ? 1 : 0) - this.crouchK) * Math.min(1, dt * 10);
    const c = this.crouchK;
    this.root.position.y = -c * 0.42 * this.root.scale.y + Math.abs(Math.cos(this.phase)) * 0.03 * amp;
    this.torso.rotation.x = -c * 0.55 - amp * 0.08;
    this.legL.up.rotation.x = s * amp - c * 1.25; this.legL.lo.rotation.x = Math.max(0, -s) * amp * 1.1 + c * 2.1;
    this.legR.up.rotation.x = -s * amp - c * 1.25; this.legR.lo.rotation.x = Math.max(0, s) * amp * 1.1 + c * 2.1;
    this.armL.up.rotation.x = -s * amp * 0.8; this.armL.lo.rotation.x = -0.25 - amp * 0.4;
    if (torchOn || armed) { this.armR.up.rotation.x = -1.15 + c * 0.4; this.armR.lo.rotation.x = -0.35; } else { this.armR.up.rotation.x = s * amp * 0.8; this.armR.lo.rotation.x = -0.25 - amp * 0.4; }
    this.beam.intensity = torchOn ? 30 : 0; this.lens.visible = torchOn;
  }
}
