// Post-processing (bloom, colour grade, grain, vignette) and physical debris / dust.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const Grade = {
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, hurt: { value: 0 }, fear: { value: 0 }, gamma: { value: 1 }, dead: { value: 0 }, aspect: { value: 1 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float time, hurt, fear, gamma, dead, aspect; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec2 c = vUv - 0.5; float r2 = dot(c, c);
      // lens: slight barrel + chromatic fringe that grows with fear
      float ca = 0.0025 + fear * 0.006 + hurt * 0.01;
      vec2 dir = c * r2;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + dir * ca * 4.0).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - dir * ca * 4.0).b;
      // teal shadows / warm highlights
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      vec3 shadow = vec3(0.82, 1.02, 1.12), high = vec3(1.08, 1.0, 0.9);
      col *= mix(shadow, high, smoothstep(0.0, 0.6, l));
      col = mix(vec3(l), col, 1.08 - fear * 0.35 - dead * 0.8);
      col = pow(max(col, 0.0), vec3(1.0 / gamma));
      // vignette, pulsing with fear
      float v = smoothstep(0.85, 0.15, sqrt(r2) * (1.25 + fear * 0.35 * (0.8 + 0.2 * sin(time * 6.0))));
      col *= mix(0.3, 1.0, v);
      col += vec3(0.42, 0.0, 0.0) * hurt * hurt * (1.0 - v + 0.06);
      col = mix(col, col * vec3(1.0, 0.25, 0.2), dead * 0.6);
      // film grain
      float g = hash(vUv * vec2(aspect, 1.0) * 900.0 + fract(time) * 100.0) - 0.5;
      col += g * (0.022 + fear * 0.03) * (0.4 + l);
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class Post {
  constructor(renderer, scene, camera, quality) {
    this.renderer = renderer; this.scene = scene; this.camera = camera;
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    // one invalid (NaN / infinite) pixel would be smeared over the whole frame by the bloom blur: scrub them first
    this.composer.addPass(new ShaderPass({
      uniforms: { tDiffuse: { value: null } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
        void main(){ vec3 c = texture2D(tDiffuse, vUv).rgb;
          if (!(c.r >= 0.0 && c.r < 1e4) || !(c.g >= 0.0 && c.g < 1e4) || !(c.b >= 0.0 && c.b < 1e4)) c = vec3(0.0);
          gl_FragColor = vec4(min(c, vec3(24.0)), 1.0); }`,
    }));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.75, 0.6, 0.72);
    if (quality !== 'low') this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(Grade);          // graded in display space, after tone mapping
    this.composer.addPass(this.grade);
  }
  size(w, h, pr) { this.composer.setPixelRatio(pr); this.composer.setSize(w, h); this.grade.uniforms.aspect.value = w / h; }
  render(dt, u) {
    const g = this.grade.uniforms;
    g.time.value += dt; g.hurt.value = u.hurt; g.fear.value = u.fear; g.gamma.value = u.gamma; g.dead.value = u.dead;
    this.composer.render(dt);
  }
}

// ---------------------------------------------------------------- debris
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();

export class Debris {
  constructor(scene, mat, softTex, col, max = 420) {
    this.col = col; this.max = max; this.next = 0;
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, max);
    this.mesh.castShadow = true; this.mesh.receiveShadow = true; this.mesh.frustumCulled = false;
    this.parts = Array.from({ length: max }, () => ({ on: false, rest: true, x: 0, y: -50, z: 0, vx: 0, vy: 0, vz: 0, rx: 0, ry: 0, rz: 0, wx: 0, wy: 0, wz: 0, sx: 0.1, sy: 0.1, sz: 0.1, floor: 0 }));
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < max; i++) this.mesh.setMatrixAt(i, zero);
    scene.add(this.mesh);
    // dust puffs
    this.dust = [];
    for (let i = 0; i < 70; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTex, color: 0x8a8580, transparent: true, opacity: 0, depthWrite: false }));
      s.visible = false; scene.add(s); this.dust.push({ s, t: 1, life: 1, vx: 0, vy: 0, vz: 0, size: 1 });
    }
    this.dn = 0;
  }

  chunk(x, y, z, vx, vy, vz, size) {
    const p = this.parts[this.next]; this.next = (this.next + 1) % this.max;
    p.on = true; p.rest = false; p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz;
    p.sx = size * (0.5 + Math.random()); p.sy = size * (0.4 + Math.random() * 0.8); p.sz = size * (0.5 + Math.random());
    p.rx = Math.random() * 6; p.ry = Math.random() * 6; p.rz = Math.random() * 6;
    p.wx = (Math.random() - 0.5) * 12; p.wy = (Math.random() - 0.5) * 12; p.wz = (Math.random() - 0.5) * 12;
    p.floor = this.col.floorBelow(x, y, z);
  }
  puff(x, y, z, size, n = 1, spread = 1, color = 0x8a8580) {
    for (let i = 0; i < n; i++) {
      const d = this.dust[this.dn]; this.dn = (this.dn + 1) % this.dust.length;
      d.s.position.set(x + (Math.random() - 0.5) * spread, y + (Math.random() - 0.5) * spread * 0.6, z + (Math.random() - 0.5) * spread);
      d.vx = (Math.random() - 0.5) * 1.5; d.vy = 0.3 + Math.random() * 0.8; d.vz = (Math.random() - 0.5) * 1.5;
      d.s.material.color.setHex(color); d.t = 0; d.life = 2.5 + Math.random() * 2.5; d.size = size * (0.6 + Math.random() * 0.8); d.s.visible = true;
    }
  }

  // blow a wall (list of boxes) into pieces flying along (dirx, dirz)
  burst(boxes, dirz) {
    let budget = 150;
    const per = Math.max(2, Math.floor(budget / Math.max(1, boxes.length)));
    for (const b of boxes) {
      const n = Math.min(per, 2 + Math.floor(b.sx * b.sy * 2.5));
      for (let i = 0; i < n && budget > 0; i++, budget--) {
        const x = b.x + (Math.random() - 0.5) * b.sx, y = b.y + (Math.random() - 0.5) * b.sy, z = b.z + (Math.random() - 0.5) * b.sz;
        const out = Math.random() < 0.6 ? 1 : -0.5;   // most of it is thrown into the room
        this.chunk(x, y, z, (Math.random() - 0.5) * 6, 1 + Math.random() * 5, dirz * out * (3 + Math.random() * 7), 0.12 + Math.random() * 0.22);
      }
      this.puff(b.x, b.y, b.z, 3.5, 2, Math.max(b.sx, 1.5));
    }
  }

  update(dt) {
    let dirty = false;
    for (let i = 0; i < this.max; i++) {
      const p = this.parts[i];
      if (!p.on || p.rest) continue;
      dirty = true;
      p.vy -= 18 * dt;
      const nx = p.x + p.vx * dt, nz = p.z + p.vz * dt;
      // bounce off walls
      if (this.col.test(nx - 0.05, p.y, p.z - 0.05, nx + 0.05, p.y + 0.1, p.z + 0.05)) p.vx *= -0.35; else p.x = nx;
      if (this.col.test(p.x - 0.05, p.y, nz - 0.05, p.x + 0.05, p.y + 0.1, nz + 0.05)) p.vz *= -0.35; else p.z = nz;
      p.y += p.vy * dt;
      p.rx += p.wx * dt; p.ry += p.wy * dt; p.rz += p.wz * dt;
      if (p.vy < 0) {
        const fl = this.col.floorBelow(p.x, p.y + 0.3, p.z);
        if (p.y - p.sy / 2 <= fl) {
          p.y = fl + p.sy / 2;
          if (Math.abs(p.vy) < 1.6) { p.rest = true; p.rx = 0; p.rz = 0; } else {
            p.vy *= -0.32; p.vx *= 0.6; p.vz *= 0.6; p.wx *= 0.5; p.wz *= 0.5;
          }
        }
      }
      _m.compose(_p.set(p.x, p.y, p.z), _q.setFromEuler(_e.set(p.rx, p.ry, p.rz)), _s.set(p.sx, p.sy, p.sz));
      this.mesh.setMatrixAt(i, _m);
    }
    if (dirty) this.mesh.instanceMatrix.needsUpdate = true;
    for (const d of this.dust) {
      if (d.t >= d.life) { if (d.s.visible) d.s.visible = false; continue; }
      d.t += dt;
      const k = d.t / d.life;
      d.s.position.x += d.vx * dt; d.s.position.y += d.vy * dt; d.s.position.z += d.vz * dt;
      d.vx *= 0.98; d.vz *= 0.98;
      d.s.scale.setScalar(d.size * (0.5 + k * 1.6));
      d.s.material.opacity = Math.sin(Math.min(1, k * 4) * Math.PI / 2) * (1 - k) * 0.5;
    }
  }
}
