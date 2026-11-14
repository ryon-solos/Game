// Turns the generated street into meshes, colliders, doors, closets, lights, signs and pickups,
// and breaks named pieces of it into rubble when the simulation says so.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Colliders } from './physics.js';
import { SOFT, textTexture } from './textures.js';
import { FX_LAYER } from './fx.js';

const _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const angle = (d) => Math.atan2(-d[1], d[0]);
const near = (a0, a1) => { while (a1 - a0 > Math.PI) a1 -= Math.PI * 2; while (a1 - a0 < -Math.PI) a1 += Math.PI * 2; return a1; };
const fx = (o) => { o.traverse((c) => c.layers.set(FX_LAYER)); return o; };

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
// extra unit shapes: gable prism, arch band, awning wedge
// A unit box with its edges cut off: the same silhouette as a one-segment rounded box for 44 triangles instead of 108.
function chamferBox(c = 0.06) {
  const P = [], N = [], I = [], h = 0.5, k = 0.5 - c, id = (sx, sy, sz, f) => ((sx > 0 ? 4 : 0) + (sy > 0 ? 2 : 0) + (sz > 0 ? 1 : 0)) * 3 + f;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    P.push(sx * h, sy * k, sz * k, sx * k, sy * h, sz * k, sx * k, sy * k, sz * h);
    N.push(sx, 0, 0, 0, sy, 0, 0, 0, sz);
  }
  const tri = (a, b, c2) => {   // wind it so it faces outwards
    const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2], ux = P[b * 3] - ax, uy = P[b * 3 + 1] - ay, uz = P[b * 3 + 2] - az, vx = P[c2 * 3] - ax, vy = P[c2 * 3 + 1] - ay, vz = P[c2 * 3 + 2] - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (nx * (ax + P[b * 3] + P[c2 * 3]) + ny * (ay + P[b * 3 + 1] + P[c2 * 3 + 1]) + nz * (az + P[b * 3 + 2] + P[c2 * 3 + 2]) >= 0) I.push(a, b, c2); else I.push(a, c2, b);
  };
  const quad = (a, b, c2, d) => { tri(a, b, c2); tri(a, c2, d); };
  for (const s of [-1, 1]) {
    quad(id(s, -1, -1, 0), id(s, 1, -1, 0), id(s, 1, 1, 0), id(s, -1, 1, 0));
    quad(id(-1, s, -1, 1), id(1, s, -1, 1), id(1, s, 1, 1), id(-1, s, 1, 1));
    quad(id(-1, -1, s, 2), id(1, -1, s, 2), id(1, 1, s, 2), id(-1, 1, s, 2));
    for (const t of [-1, 1]) {
      quad(id(s, t, -1, 0), id(s, t, 1, 0), id(s, t, 1, 1), id(s, t, -1, 1));   // edges along z
      quad(id(s, -1, t, 0), id(s, 1, t, 0), id(s, 1, t, 2), id(s, -1, t, 2));   // edges along y
      quad(id(-1, s, t, 1), id(1, s, t, 1), id(1, s, t, 2), id(-1, s, t, 2));   // edges along x
      for (const u of [-1, 1]) tri(id(s, t, u, 0), id(s, t, u, 1), id(s, t, u, 2));
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(48).fill(0), 2)); g.setIndex(I);
  return g;
}

function shapes(seg) {
  const tri = new THREE.Shape(); tri.moveTo(-0.5, 0); tri.lineTo(0.5, 0); tri.lineTo(0, 1); tri.closePath();
  const gTri = new THREE.ExtrudeGeometry(tri, { depth: 1, bevelEnabled: false }); gTri.translate(0, 0, -0.5);
  const ar = new THREE.Shape(); ar.absarc(0, 0, 0.5, 0, Math.PI, false); ar.absarc(0, 0, 0.37, Math.PI, 0, true); ar.closePath();
  const gArch = new THREE.ExtrudeGeometry(ar, { depth: 1, bevelEnabled: false, curveSegments: seg }); gArch.translate(0, 0, -0.5);
  // awning: high at the wall (-z), low at the outer edge (+z)
  const A = [-0.5, 1, -0.5], B = [-0.5, 0.62, -0.5], C = [-0.5, 0, 0.5], A2 = [0.5, 1, -0.5], B2 = [0.5, 0.62, -0.5], C2 = [0.5, 0, 0.5];
  const tris = [A, C, A2, A2, C, C2, B, B2, C, B2, C2, C, A, B, C, A2, C2, B2, A, A2, B, A2, B2, B];
  const gWedge = new THREE.BufferGeometry(); gWedge.setAttribute('position', new THREE.Float32BufferAttribute(tris.flat(), 3)); gWedge.computeVertexNormals();
  gWedge.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(tris.length * 2).fill(0), 2));
  const torus = new THREE.TorusGeometry(0.5, 0.045, 6, seg + 6); torus.rotateX(Math.PI / 2);
  return { cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, seg), cone: new THREE.ConeGeometry(0.5, 1, seg), sph: new THREE.SphereGeometry(0.5, seg, Math.max(6, seg - 4)), tor: torus, tri: gTri, arch: gArch, wedge: gWedge };
}
// a soft cone of light hanging in the fog: fades with height and towards its silhouette, no hard edge
const shaftMaterial = (color) => new THREE.ShaderMaterial({
  uniforms: { color: { value: new THREE.Color(color) }, power: { value: 1 } },
  vertexShader: 'varying vec3 vN; varying vec3 vV; varying float vH; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); vH = uv.y; gl_Position = projectionMatrix * mv; }',
  fragmentShader: 'uniform vec3 color; uniform float power; varying vec3 vN; varying vec3 vV; varying float vH; void main(){ float rim = abs(dot(normalize(vN), normalize(vV))); float a = pow(rim, 2.4) * pow(clamp(vH, 0.0, 1.0), 1.7) * power; gl_FragColor = vec4(color * a, a); }',
  transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false,
});

export class WorldView {
  // q: the quality tier from game.js
  constructor(scene, W, M, T, q) {
    this.scene = scene; this.W = W; this.T = T; this.M = M; this.q = q;
    this.col = new Colliders();
    this.group = new THREE.Group(); scene.add(this.group);
    this.fac = new Map();      // breakable group -> its parts
    this.gone = new Set();
    this.time = 0;
    const shadows = q.shadow > 0;
    const facAdd = (g, e) => { let f = this.fac.get(g); if (!f) this.fac.set(g, (f = [])); f.push(e); };
    const chunkOf = (x) => Math.max(-1, Math.min(5, Math.floor(x / 24)));
    // small things (doors, candles, decals, dummies) live in per-stretch groups that are switched off at a distance
    this.detail = []; for (let i = -1; i <= 5; i++) { const g = new THREE.Group(); g.userData.x0 = i * 24; g.userData.x1 = i * 24 + 24; this.detail.push(g); this.group.add(g); }
    const dadd = (o, x) => { this.detail[chunkOf(x) + 1].add(o); };   // 24 m stretches: few enough draw calls, still cullable
    const colOf = (m) => { const mat = M[m]; return mat ? (mat.userData.col ?? (mat.color ? mat.color.getHex() : 0x888888)) : 0x888888; };

    // what is inside a flat can be dropped at a distance; what makes the street's outline stays
    const INT_KIND = new Set(['furn', 'closet', 'wall']);
    const INT_MAT = new Set(['wall0', 'wall1', 'wall2', 'wall3', 'wall4', 'wall5', 'wall6', 'wall7', 'wall8', 'floorwood', 'floorwood2', 'floortile', 'carpet', 'lino', 'ceil', 'paper', 'portrait', 'mattress', 'mirror', 'tvglass', 'fridge', 'meat', 'wax']);
    const inside = (b) => (INT_MAT.has(b.m) || (b.g && W.brk[b.g] && INT_KIND.has(W.brk[b.g].kind)) ? 'i' : 'o');
    const innerShadows = q.pshadow > 0 || q.torchShadow;   // nothing indoors is in moonlight, so it only needs to cast when lamps and the torch do
    // ---- boxes -> instanced meshes, one per material per stretch of street (so they can be culled)
    const by = new Map();
    for (const b of W.boxes) {
      const col = b.c ? this.col.add(b.x, b.y, b.z, b.sx, b.sy, b.sz) : null;
      let e = null;
      if (!b.nv) {
        const k = b.m + '|' + chunkOf(b.x) + '|' + inside(b);
        let l = by.get(k);
        if (!l) by.set(k, (l = []));
        e = { b, col, index: l.length };
        l.push(e);
      }
      if (b.g) facAdd(b.g, e || { b, col });
    }
    const unit = new THREE.BoxGeometry(1, 1, 1);
    const round = q.round ? chamferBox(q.round === 2 ? 0.07 : 0.06) : unit;
    this.roundGeo = round;
    const instanced = (geo, mk, list, mat4, ch, io) => {
      const mesh = new THREE.InstancedMesh(geo, M[mk] || M.concrete, list.length);
      list.forEach((e, i) => { e.mesh = mesh; e.mat = mat4(e.b); e.color = colOf(e.b.m); mesh.setMatrixAt(i, e.mat); });
      mesh.castShadow = shadows && mk !== 'glass' && mk !== 'rail' && mk !== 'paint' && (io === 'o' || innerShadows); mesh.receiveShadow = true;
      mesh.computeBoundingSphere(); mesh.frustumCulled = true;
      if (mk === 'glass') mesh.layers.set(FX_LAYER);
      if (io === 'i') this.detail[+ch + 1].add(mesh); else this.group.add(mesh);
    };
    for (const [k, list] of by) {
      const [mk, ch, io] = k.split('|');
      instanced(SOFT.has(mk) ? round : unit, mk, list, (b) => new THREE.Matrix4().compose(_p.set(b.x, b.y, b.z), _q.identity(), _s.set(b.sx, b.sy, b.sz)), ch, io);
    }

    // ---- round props
    const GEO = shapes(q.seg);
    const pb = new Map();
    for (const p of W.props) {
      const k = p.s + '|' + p.m + '|' + chunkOf(p.x) + '|' + inside(p);
      let l = pb.get(k);
      if (!l) pb.set(k, (l = []));
      const e = { index: l.length, b: p, prop: true };
      l.push(e);
      if (p.g) facAdd(p.g, e);
    }
    for (const [k, list] of pb) {
      const [s, mk, ch, io] = k.split('|');
      instanced(GEO[s] || GEO.cyl, mk, list, (p) => new THREE.Matrix4().compose(_p.set(p.x, p.y, p.z), _q.setFromEuler(_e.set(p.rx, p.ry, p.rz)), _s.set(p.sx, p.sy, p.sz)), ch, io);
    }

    // ---- ground
    const gg = new THREE.PlaneGeometry(W.L + 60, 60); gg.rotateX(-Math.PI / 2);
    const ground = new THREE.Mesh(gg, M.asphalt);
    ground.position.set(W.L / 2, 0, 0); ground.receiveShadow = true;
    this.group.add(ground);

    // ---- sagging cables
    const cmat = new THREE.LineBasicMaterial({ color: 0x06080a });
    this.cables = new Map();
    for (const c of W.cables) {
      const pts = [];
      for (let i = 0; i <= 14; i++) { const t = i / 14; pts.push(new THREE.Vector3(c.a[0] + (c.b[0] - c.a[0]) * t, c.a[1] + (c.b[1] - c.a[1]) * t - Math.sin(t * Math.PI) * c.sag, c.a[2] + (c.b[2] - c.a[2]) * t)); }
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), cmat); line.layers.set(FX_LAYER);
      this.group.add(line); this.cables.set(c.g, { line, pts });
    }

    // ---- doors
    const geoCache = new Map();
    const cached = (key, make) => { let g2 = geoCache.get(key); if (!g2) geoCache.set(key, (g2 = make())); return g2; };
    const tint = (g, c) => { const n = g.attributes.position.count, a = new Float32Array(n * 3), col = new THREE.Color(c); for (let i = 0; i < n; i++) { a[i * 3] = col.r; a[i * 3 + 1] = col.g; a[i * 3 + 2] = col.b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g.index ? g.toNonIndexed() : g; };
    const part = (g, c, x, y, z) => { g.translate(x, y, z); return tint(g, c); };
    const slab = (w, h, t) => (q.round ? new RoundedBoxGeometry(w, h, t, 1, 0.02) : new THREE.BoxGeometry(w, h, t));
    // a whole door leaf (slab, two raised panels, two knobs) as one mesh: one draw call instead of five
    const doorGeo = (len, h) => cached(`door${len.toFixed(2)}x${h.toFixed(2)}`, () => mergeGeometries([
      part(slab(len - 0.04, h - 0.04, 0.07), 0x5d4a3c, len / 2, h / 2, 0),
      part(new THREE.BoxGeometry(len - 0.3, 0.7, 0.09), 0x8a7258, len / 2, 0.55, 0), part(new THREE.BoxGeometry(len - 0.3, 0.7, 0.09), 0x8a7258, len / 2, 1.5, 0),
      part(new THREE.SphereGeometry(0.045, 8, 6), 0xb8b4a8, len - 0.14, 1.0, 0.07), part(new THREE.SphereGeometry(0.045, 8, 6), 0xb8b4a8, len - 0.14, 1.0, -0.07)]));
    const closetGeo = (half, sgn) => cached(`closet${half.toFixed(2)}${sgn}`, () => mergeGeometries([
      part(slab(half - 0.02, 2.0, 0.07), 0x5d4a3c, half / 2, 1.02, 0), part(new THREE.BoxGeometry(half - 0.2, 1.6, 0.09), 0x8a7258, half / 2, 1.05, 0),
      part(new THREE.SphereGeometry(0.045, 8, 6), 0xb8b4a8, half - 0.09, 1.05, 0.06 * sgn), part(new THREE.SphereGeometry(0.045, 8, 6), 0xb8b4a8, half - 0.09, 1.05, -0.06 * sgn)]));
    this.byG = new Map();   // group -> the special object that goes with it (door, closet)
    this.doors = W.doors.map((d) => {
      const pivot = new THREE.Group();
      pivot.position.set(d.hx, d.y, d.hz);
      const leaf = new THREE.Mesh(doorGeo(d.len, d.h), M.door);
      leaf.castShadow = shadows; leaf.receiveShadow = true;
      pivot.add(leaf);
      dadd(pivot, d.hx);
      const a0 = angle(d.cd), a1 = near(a0, angle(d.od));
      const horiz = Math.abs(d.cd[0]) > 0.5;
      const col = this.col.add(d.cx, d.y + d.h / 2, d.cz, horiz ? d.len : 0.2, d.h, horiz ? 0.2 : d.len);
      const o = { d, pivot, a0, a1, t: d.open ? 1 : 0, col, open: d.open, horiz };
      col.on = !d.open; pivot.rotation.y = d.open ? a1 : a0;
      this.byG.set(d.g, { door: o });
      return o;
    });

    // ---- closets: two leaves, one collider across the front
    this.closets = W.closets.map((c) => {
      const dir = [(c.h1[0] - c.h0[0]) / c.w, (c.h1[1] - c.h0[1]) / c.w], half = c.w / 2;
      const leaves = [[c.h0, dir, 1], [c.h1, [-dir[0], -dir[1]], -1]].map(([h, cd, sgn]) => {
        const pivot = new THREE.Group(); pivot.position.set(h[0], c.y, h[1]);
        const leaf = new THREE.Mesh(closetGeo(half, sgn), M.door); leaf.castShadow = shadows; leaf.receiveShadow = true;
        pivot.add(leaf); dadd(pivot, h[0]);
        const a0 = angle(cd);
        const out = near(a0, angle(c.f)), a1 = a0 + (out - a0) * 1.15;   // swing outwards, a little past square
        pivot.rotation.y = a0;
        return { pivot, a0, a1 };
      });
      const horiz = Math.abs(dir[0]) > 0.5;
      const col = this.col.add((c.h0[0] + c.h1[0]) / 2 - c.f[0] * 0.04, c.y + 1.02, (c.h0[1] + c.h1[1]) / 2 - c.f[1] * 0.04, horiz ? c.w : 0.08, 2.04, horiz ? 0.08 : c.w);
      const o = { c, leaves, col, open: false, t: 0 };
      this.byG.set(c.g, { closet: o });
      return o;
    });

    // ---- light sources (candles, sigils, bulbs, fires, neon) + a small pool of real lights that follows the camera
    this.srcs = [];
    const flameGeo = new THREE.ConeGeometry(0.022, 0.09, 6), flameMat = new THREE.MeshBasicMaterial({ color: 0xffb060 });
    const bulbGeo = new THREE.SphereGeometry(0.07, 8, 6);
    const sigGeo = new THREE.PlaneGeometry(1.15, 1.15);
    const fireGeo = new THREE.ConeGeometry(0.2, 0.7, 7), fireMat = new THREE.MeshBasicMaterial({ color: 0xff7a20, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending });
    const halo = (c, size, o = 0.5) => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.soft, color: c, transparent: true, opacity: o, depthWrite: false, blending: THREE.AdditiveBlending })); s.scale.setScalar(size); s.layers.set(FX_LAYER); return s; };
    for (const l of W.lights) {
      const s = { x: l.x, y: l.y, z: l.z, kind: l.kind, flat: l.flat, g: l.g, ph: Math.random() * 50, mesh: null, on: true };
      if (l.kind === 'candle') {
        s.mesh = new THREE.Group(); s.mesh.position.set(l.x, l.y - 0.02, l.z);
        s.mesh.add(new THREE.Mesh(flameGeo, flameMat), halo(0xff9a40, 0.5, 0.45));
        s.color = 0xff8a3c; s.power = 2.6; s.dist = 7;
      } else if (l.kind === 'lamp' || l.kind === 'porch') {
        s.mesh = new THREE.Group(); s.mesh.position.set(l.x, l.y, l.z);
        s.bulb = new THREE.Mesh(bulbGeo, new THREE.MeshBasicMaterial({ color: 0xffe2a8 })); s.mesh.add(s.bulb, halo(0xffd090, 0.9, 0.4));
        s.color = 0xffd9a0; s.power = l.kind === 'porch' ? 5 : 6.5; s.dist = 9;
      } else if (l.kind === 'fire') {
        s.mesh = new THREE.Group(); s.mesh.position.set(l.x, l.y - 0.2, l.z);
        for (let i = 0; i < 3; i++) { const f = new THREE.Mesh(fireGeo, fireMat); f.position.set((i - 1) * 0.1, 0.2, (i % 2) * 0.1 - 0.05); s.mesh.add(f); }
        s.mesh.add(halo(0xff7a28, 2.6, 0.35)); fx(s.mesh);
        s.color = 0xff7a28; s.power = 36; s.dist = 16;
      } else if (l.kind === 'neon') { s.color = l.color; s.power = 16; s.dist = 13; }
      else { s.color = 0xff2a2a; s.power = 9; s.dist = 9; }
      if (s.mesh) dadd(s.mesh, l.x);
      this.srcs.push(s);
    }
    // decals: glowing sigils on walls and floors, stains and blood on floors
    this.decals = [];
    const floorGeo = new THREE.PlaneGeometry(1, 1); floorGeo.rotateX(-Math.PI / 2);
    const bloodMat = new THREE.MeshStandardMaterial({ map: T.blood, color: 0x4a0606, roughness: 0.18, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    const stainMat = new THREE.MeshStandardMaterial({ map: T.stain, color: 0x1a140c, roughness: 0.6, transparent: true, opacity: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    for (const d of W.decals) {
      let mesh;
      if (d.kind === 'sigil') {
        const mat = new THREE.MeshBasicMaterial({ map: T.sigil, color: 0xff2030, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
        if (d.floor) { mesh = new THREE.Mesh(floorGeo, mat); mesh.scale.setScalar(d.size); } else { mesh = new THREE.Mesh(sigGeo, mat); if (d.nz < 0) mesh.rotation.y = Math.PI; }
        const s = this.srcs.find((q2) => q2.kind === 'sigil' && q2.flat === d.flat && !q2.mesh);
        if (s && !d.floor) s.mesh = mesh;
      } else { mesh = new THREE.Mesh(floorGeo, d.kind === 'blood' ? bloodMat : stainMat); mesh.scale.setScalar(d.size); mesh.rotation.y = d.rot || 0; mesh.receiveShadow = true; }
      mesh.position.set(d.x, d.y, d.z); mesh.layers.set(FX_LAYER);
      dadd(mesh, d.x); this.decals.push({ mesh, g: d.g });
    }
    // lettering
    this.signs = [];
    const unitPlane = new THREE.PlaneGeometry(1, 1);
    for (const sg of W.signs) {
      const neon = sg.kind === 'neon', map = textTexture(sg.text, sg.kind, neon ? sg.color : 0xffffff);
      const mat = neon ? new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false })
        : sg.kind === 'blood' ? new THREE.MeshStandardMaterial({ map, color: 0x5a0808, roughness: 0.3, transparent: true, depthWrite: false })
          : sg.kind === 'number' ? new THREE.MeshStandardMaterial({ map, roughness: 0.6 })
            : new THREE.MeshStandardMaterial({ map, roughness: 0.8, transparent: true, depthWrite: false });
      const mesh = new THREE.Mesh(unitPlane, mat); mesh.scale.set(sg.w, sg.h, 1);
      mesh.position.set(sg.x, sg.y, sg.z);
      mesh.rotation.y = sg.nx ? (sg.nx > 0 ? Math.PI / 2 : -Math.PI / 2) : (sg.nz < 0 ? Math.PI : 0);
      if (sg.kind !== 'number') mesh.layers.set(FX_LAYER);
      if (neon || sg.kind === 'shop') this.group.add(mesh); else dadd(mesh, sg.x);
      const rec = { mesh, g: sg.g, neon, ph: Math.random() * 40 };
      this.signs.push(rec);
      if (neon) { const s = this.srcs.find((q2) => q2.kind === 'neon' && q2.g === sg.g); if (s) s.sign = rec; }
    }
    // street lamps with a soft shaft of light in the fog
    const coneGeo = new THREE.ConeGeometry(3.6, 4.9, 28, 1, true); coneGeo.translate(0, -2.45, 0);
    const lampGeo = new THREE.SphereGeometry(0.2, 10, 8);
    for (const l of W.lamps) {
      const mat = new THREE.MeshBasicMaterial({ color: l.broken ? 0x1a1a18 : 0xffc890 });
      const mesh = new THREE.Mesh(lampGeo, mat); mesh.scale.set(1, 0.6, 1); mesh.position.set(l.x, l.y - 0.02, l.z);
      this.group.add(mesh);
      const s = { x: l.x, y: l.y - 0.3, z: l.z, kind: 'street', flat: -1, g: l.g, ph: Math.random() * 50, mesh, bulb: mesh, color: 0xffb070, power: 70, dist: 24, flicker: l.flicker, on: !l.broken, dead: l.broken };
      if (!l.broken) {
        s.cone = new THREE.Mesh(coneGeo, shaftMaterial(0xffb070)); s.cone.position.set(l.x, l.y, l.z); s.cone.layers.set(FX_LAYER); this.group.add(s.cone);
        s.halo = halo(0xffc080, 1.7, 0.4); s.halo.position.set(l.x, l.y - 0.1, l.z); this.group.add(s.halo);
      }
      this.srcs.push(s);
    }
    this.pool = Array.from({ length: q.lights }, (_, i) => {
      const p = new THREE.PointLight(0xffffff, 0, 8, 1.7);
      if (i < q.pshadow) { p.castShadow = true; p.shadow.mapSize.set(q.pshadowSize, q.pshadowSize); p.shadow.bias = -0.004; p.shadow.normalBias = 0.05; p.shadow.camera.near = 0.06; p.shadow.autoUpdate = false; }
      scene.add(p); return p;
    });
    this.poolT = 0; this.near = [];

    // ---- tailor's dummies: they turn to face you while you are not looking
    const mqMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75, map: T.fabric, vertexColors: true });
    const bake = (geo, c, x, y, z, sx = 1, sy = 1, sz = 1, rz = 0) => { const g2 = geo.clone(); g2.applyMatrix4(new THREE.Matrix4().compose(_p.set(x, y, z), _q.setFromEuler(_e.set(0, 0, rz)), _s.set(sx, sy, sz))); return tint(g2, c); };
    const cloth = 0xb4aa98, stand = 0x3a2e26;
    const mqParts = [bake(GEO.cyl, stand, 0, 0.03, 0, 0.5, 0.06, 0.5), bake(GEO.cyl, stand, 0, 0.5, 0, 0.05, 0.95, 0.05),
      bake(new THREE.LatheGeometry([[0.01, 0], [0.17, 0.02], [0.19, 0.2], [0.13, 0.42], [0.2, 0.68], [0.21, 0.78], [0.08, 0.86], [0.06, 0.94]].map(([r, y]) => new THREE.Vector2(r, y)), 14), cloth, 0, 0.95, 0, 1, 1, 0.66),
      bake(GEO.sph, cloth, 0, 2.0, 0, 0.22, 0.27, 0.24)];
    for (const sgn of [1, -1]) mqParts.push(bake(GEO.sph, cloth, sgn * 0.21, 1.7, 0, 0.12, 0.12, 0.12), bake(GEO.cyl, cloth, sgn * 0.24, 1.42, 0, 0.075, 0.56, 0.075, sgn * 0.08), bake(GEO.cyl, cloth, sgn * 0.27, 0.92, 0.02, 0.06, 0.5, 0.06));
    for (const g2 of mqParts) for (const k of Object.keys(g2.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g2.deleteAttribute(k);
    const mqGeo = mergeGeometries(mqParts);
    this.mannequins = W.mannequins.map((m) => {
      const g = new THREE.Mesh(mqGeo, mqMat); g.position.set(m.x, m.y, m.z); g.rotation.y = m.ry; g.castShadow = shadows; g.receiveShadow = true;
      dadd(g, m.x);
      return { g, m, t: Math.random() * 2, gkey: m.g, gone: false };
    });

    // ---- pickups
    this.pickups = new Map();
    this.starGeo = starGeometry();
    this.starMat = new THREE.MeshBasicMaterial({ color: 0xffe9a8 });
    const glow = (c, o) => new THREE.SpriteMaterial({ map: T.soft, color: c, transparent: true, opacity: o, depthWrite: false, blending: THREE.AdditiveBlending });
    this.glowMat = glow(0xffd070, 0.55); this.gunGlow = glow(0x58d8ff, 0.4); this.medGlow = glow(0xff5050, 0.4); this.botGlow = glow(0x70ff9a, 0.25);
    this.GEO = GEO;
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
  makeBottle() {
    const g = new THREE.Group(), M = this.M;
    const a = new THREE.Mesh(this.GEO.cyl, M.glass); a.scale.set(0.08, 0.2, 0.08);
    const b = new THREE.Mesh(this.GEO.cone, M.glass); b.scale.set(0.08, 0.1, 0.08); b.position.y = 0.15;
    const c = new THREE.Mesh(this.GEO.cyl, M.glass); c.scale.set(0.03, 0.1, 0.03); c.position.y = 0.2;
    g.add(a, b, c);
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
      else if (k.k === 'bottle') { const g = this.makeBottle(); g.scale.setScalar(1.3); obj.add(g); obj.position.y -= 0.45; spr = new THREE.Sprite(this.botGlow); spr.scale.setScalar(0.9); }
      else {
        const m = new THREE.Group();
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.22, 0.22), this.M.white);
        const cr = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.23), new THREE.MeshBasicMaterial({ color: 0xff3030 }));
        const cr2 = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.23), cr.material);
        m.add(box, cr, cr2); obj.add(m); spr = new THREE.Sprite(this.medGlow); spr.scale.setScalar(1.2);
      }
      spr.layers.set(FX_LAYER);
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
    if (!o || o.gone) return;
    o.open = open; o.col.on = !open;
    if (instant) { o.t = open ? 1 : 0; o.pivot.rotation.y = open ? o.a1 : o.a0; }
  }
  setCloset(id, open, instant) {
    const o = this.closets[id];
    if (!o || o.gone) return;
    o.open = open; o.c.open = open; o.col.on = !open;
    if (instant) { o.t = open ? 1 : 0; for (const l of o.leaves) l.pivot.rotation.y = open ? l.a1 : l.a0; }
  }

  // The simulation broke these groups. Hides them, switches their colliders off, and returns the
  // real parts (position, size, colour) so the caller can throw them around as rubble.
  breakGroups(gs) {
    const parts = [], cables = [], touched = new Set();
    for (const g of gs) {
      if (this.gone.has(g)) continue;
      this.gone.add(g);
      for (const e of this.fac.get(g) || []) {
        if (e.col) e.col.on = false;
        if (!e.mesh) continue;
        e.mesh.setMatrixAt(e.index, ZERO); touched.add(e.mesh);
        const b = e.b;
        if (e.prop) parts.push({ x: b.x, y: b.y, z: b.z, sx: b.s === 'cone' ? b.sx * 0.7 : b.sx, sy: b.s === 'tor' ? Math.max(0.05, b.sy * 0.09) : b.sy, sz: b.s === 'cone' ? b.sz * 0.7 : b.sz, color: e.color, whole: Math.max(b.sx, b.sy, b.sz) < 1.2 });
        else parts.push({ x: b.x, y: b.y, z: b.z, sx: b.sx, sy: b.sy, sz: b.sz, color: e.color });
      }
      const sp = this.byG.get(g);
      if (sp && sp.door && !sp.door.gone) {
        const o = sp.door, d = o.d;
        o.gone = true; o.pivot.visible = false; o.col.on = false; d.open = true; d.broken = true;
        parts.push({ x: d.cx, y: d.y + d.h / 2, z: d.cz, sx: o.horiz ? d.len : 0.07, sy: d.h, sz: o.horiz ? 0.07 : d.len, color: 0x4a3a2e });
      }
      if (sp && sp.closet && !sp.closet.gone) {
        const o = sp.closet, c = o.c;
        o.gone = true; o.col.on = false; o.open = true; c.open = true; c.broken = true;
        for (const l of o.leaves) l.pivot.visible = false;
        parts.push({ x: c.cx + c.f[0] * 0.45, y: c.y + 1.02, z: c.cz + c.f[1] * 0.45, sx: c.f[0] ? 0.07 : c.w, sy: 2, sz: c.f[0] ? c.w : 0.07, color: 0x4a3a2e });
      }
      for (const s of this.srcs) if (s.g === g) { s.on = false; s.dead = true; if (s.mesh) s.mesh.visible = false; if (s.cone) s.cone.visible = false; if (s.halo) s.halo.visible = false; }
      for (const d of this.decals) if (d.g === g) d.mesh.visible = false;
      for (const s of this.signs) if (s.g === g) s.mesh.visible = false;
      for (const m of this.mannequins) if (m.gkey === g && !m.gone) { m.gone = true; m.g.visible = false; for (const [y, sy] of [[0.5, 0.9], [1.4, 0.8], [2.0, 0.26]]) parts.push({ x: m.m.x, y: m.m.y + y, z: m.m.z, sx: 0.3, sy, sz: 0.22, color: 0xb4aa98, whole: true }); }
      const cb = this.cables.get(g);
      if (cb) { this.group.remove(cb.line); this.cables.delete(g); cables.push(cb.pts); }
    }
    for (const m of touched) m.instanceMatrix.needsUpdate = true;
    // a flat whose whole front is gone counts as open to the street
    for (const f of this.W.flats) if (!f.roof && f.gs && f.gs.length && !f.destroyed && f.gs.every((g) => this.gone.has(g))) f.destroyed = true;
    return { parts, cables };
  }

  // dread 0..1: lights gutter when it is close. look: unit view direction (for the dummies)
  update(dt, cam, dread = 0, look = null, indoors = false) {
    this.time += dt;
    const t = this.time;
    for (const o of this.doors) {
      const target = o.open ? 1 : 0;
      if (o.t !== target && !o.gone) {
        o.t += Math.sign(target - o.t) * dt * 3.2;
        if ((target - o.t) * (target ? 1 : -1) < 0) o.t = target;
        const e = o.t * o.t * (3 - 2 * o.t);
        o.pivot.rotation.y = o.a0 + (o.a1 - o.a0) * e;
      }
    }
    for (const o of this.closets) {
      const target = o.open ? 1 : 0;
      if (o.t !== target && !o.gone) {
        o.t += Math.sign(target - o.t) * dt * 3.5;
        if ((target - o.t) * (target ? 1 : -1) < 0) o.t = target;
        const e = o.t * o.t * (3 - 2 * o.t);
        for (const l of o.leaves) l.pivot.rotation.y = l.a0 + (l.a1 - l.a0) * e;
      }
    }
    for (const p of this.pickups.values()) {
      const body = p.obj.children[0];
      if (p.k.k === 'bottle') { body.rotation.y = t * 0.6 + p.ph; continue; }
      p.obj.rotation.y = t * (1.6 + p.take * 14) + p.ph;
      body.position.y = Math.sin(t * 2 + p.ph) * 0.07 + p.take * 0.5;
      body.scale.setScalar(Math.max(0.1, 1 + p.take * 0.5 - p.take * p.take * 1.2));
    }
    for (const g of this.detail) { const d = cam.x < g.userData.x0 ? g.userData.x0 - cam.x : cam.x > g.userData.x1 ? cam.x - g.userData.x1 : 0; g.visible = d < this.q.detail; }
    // dummies turn towards you while you look away
    if (look) for (const m of this.mannequins) {
      if (m.gone) continue;
      m.t -= dt;
      if (m.t > 0) continue;
      m.t = 0.4;
      const dx = m.m.x - cam.x, dz = m.m.z - cam.z, d = Math.hypot(dx, dz);
      if (d > 11 || d < 0.8 || Math.abs(m.m.y - cam.y + 1.6) > 2.5) continue;
      const facing = (dx * look.x + dz * look.z) / d;
      if (facing < 0.45) m.g.rotation.y = Math.atan2(-dx, -dz) + Math.PI;   // not in view: now it is facing the player
    }
    // re-pick which real lights are nearest a few times a second
    this.poolT -= dt;
    if (this.poolT <= 0) {
      this.poolT = 0.3;
      const cx = cam.x, cy = cam.y, cz = cam.z;
      for (const s of this.srcs) s.d = s.on ? Math.hypot(s.x - cx, (s.y - cy) * 3, s.z - cz) - (s.kind === 'street' || s.kind === 'fire' ? 10 : s.kind === 'sigil' || s.kind === 'neon' ? 4 : 0) : 1e9;
      this.near = this.srcs.filter((s) => s.d < 36).sort((a, b) => a.d - b.d).slice(0, this.pool.length);
    }
    const gutter = dread > 0.45 ? (Math.sin(t * 23) * Math.sin(t * 7.1) > 0.2 - dread * 0.5 ? 0.25 : 1) : 1;
    for (const s of this.srcs) {
      if (s.kind === 'fire' && s.mesh) s.mesh.children.forEach((f, i) => { if (i > 2) return; f.scale.set(1, 0.7 + 0.5 * Math.abs(Math.sin(t * (7 + i * 2.3) + s.ph + i)), 1); f.position.y = 0.2 + f.scale.y * 0.15; });
      s.f = 1;
      if (!s.on) continue;
      if (s.kind === 'candle') s.f = (0.8 + 0.2 * Math.sin(t * 11 + s.ph) * Math.sin(t * 7.3 + s.ph * 2)) * (gutter < 1 ? 0.55 : 1);
      else if (s.kind === 'fire') s.f = 0.75 + 0.25 * Math.sin(t * 9 + s.ph) * Math.sin(t * 5.3 + s.ph);
      else if (s.kind === 'sigil') { s.f = 0.75 + 0.25 * Math.sin(t * 1.7 + s.ph) + (gutter < 1 ? 0.6 : 0); if (s.mesh) s.mesh.material.opacity = Math.min(1, s.f); }
      else if (s.kind === 'neon') { s.f = Math.sin(t * 2.3 + s.ph) * Math.sin(t * 13 + s.ph) > 0.72 ? 0.2 : 1; if (s.sign) s.sign.mesh.material.opacity = 0.35 + 0.65 * s.f; }
      else {
        s.f = (s.kind === 'lamp' || s.kind === 'porch' || s.flicker) && Math.sin(t * 3.1 + s.ph) * Math.sin(t * 17 + s.ph) > 0.55 ? 0.15 : 1;
        s.f *= gutter;
        if (s.bulb) s.bulb.material.color.setHex(s.f < 0.5 ? 0x4a3a28 : s.kind === 'street' ? 0xffc890 : 0xffe2a8);
        if (s.cone) { s.cone.material.uniforms.power.value = 0.16 * s.f; s.halo.material.opacity = 0.4 * s.f; }
      }
    }
    this.frame = (this.frame || 0) + 1;
    for (let i = 0; i < this.pool.length; i++) {
      const L = this.pool[i], s = this.near[i];
      // (the lights stay "visible" even at zero: changing how many lights exist makes the renderer recompile every material)
      if (!s) { L.intensity = 0; L.userData.src = null; continue; }
      const fade = Math.min(1, Math.max(0, (36 - s.d) / 8));
      // a lamp does not move: its shadow cube (six views of the room) only needs redrawing every few frames, or when it changes lamp
      if (L.castShadow && (L.userData.src !== s || (this.frame + i * 2) % this.q.pEvery === 0)) { L.shadow.needsUpdate = true; L.userData.src = s; }
      L.position.set(s.x, s.y, s.z); L.color.setHex(s.color); L.distance = s.dist; 
      // lights have no walls to stop them: from indoors, what is out in the street is turned right down so it cannot flood the room
      const leak = indoors && (s.kind === 'neon' || s.kind === 'street' || s.kind === 'porch' || s.kind === 'fire') ? 0.1 : 1;
      L.intensity = s.power * s.f * fade * leak;
    }
  }

  dispose() {
    this.scene.remove(this.group);
    for (const p of this.pool) { this.scene.remove(p); if (p.shadow && p.shadow.map) p.shadow.map.dispose(); }
    this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  }
}
