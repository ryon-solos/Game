// Post-processing (ambient occlusion, bloom, colour grade, grain, anti-aliasing) and the rubble physics.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';

export const FX_LAYER = 1;   // sprites, light shafts, decals: drawn, but left out of the occlusion pass

const VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }';
const Grade = {
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, hurt: { value: 0 }, fear: { value: 0 }, gamma: { value: 1 }, dead: { value: 0 }, aspect: { value: 1 }, warp: { value: 0 }, sharpen: { value: 0 }, texel: { value: new THREE.Vector2(1 / 1024, 1 / 1024) } },
  vertexShader: VS,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float time, hurt, fear, gamma, dead, aspect, warp, sharpen; uniform vec2 texel; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec2 uv = vUv;
      // dread: the picture breathes and tears a little
      uv += warp * 0.004 * vec2(sin(uv.y * 40.0 + time * 9.0), cos(uv.x * 34.0 + time * 7.0));
      vec2 c = uv - 0.5; float r2 = dot(c, c);
      float ca = 0.0022 + fear * 0.006 + hurt * 0.01 + warp * 0.01;
      vec2 dir = c * r2;
      vec3 col;
      col.r = texture2D(tDiffuse, uv + dir * ca * 4.0).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - dir * ca * 4.0).b;
      // contrast-adaptive sharpening: brings back texture detail lost to anti-aliasing and a scaled render,
      // and backs off on edges that are already hard so it does not ring
      if (sharpen > 0.0) {
        vec3 n = texture2D(tDiffuse, uv + vec2(0.0, texel.y)).rgb, s = texture2D(tDiffuse, uv - vec2(0.0, texel.y)).rgb;
        vec3 e = texture2D(tDiffuse, uv + vec2(texel.x, 0.0)).rgb, w = texture2D(tDiffuse, uv - vec2(texel.x, 0.0)).rgb;
        vec3 mn = min(col, min(min(n, s), min(e, w))), mx = max(col, max(max(n, s), max(e, w)));
        vec3 amp = sqrt(clamp(min(mn, 1.0 - mx) / max(mx, 1e-4), 0.0, 1.0));
        vec3 wt = -amp * sharpen * 0.2;
        col = clamp((col + (n + s + e + w) * wt) / (1.0 + 4.0 * wt), 0.0, 1.0);
      }
      // teal shadows / warm highlights, gentle filmic contrast
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      vec3 shadow = vec3(0.84, 1.02, 1.12), high = vec3(1.08, 1.0, 0.9);
      col *= mix(shadow, high, smoothstep(0.0, 0.6, l));
      col = mix(vec3(l), col, 1.1 - fear * 0.35 - dead * 0.8);
      col = col * col * (3.0 - 2.0 * col) * 0.35 + col * 0.65;
      col = pow(max(col, 0.0), vec3(1.0 / gamma));
      // vignette, pulsing with fear
      float v = smoothstep(0.85, 0.15, sqrt(r2) * (1.25 + fear * 0.35 * (0.8 + 0.2 * sin(time * 6.0))));
      col *= mix(0.3, 1.0, v);
      col += vec3(0.42, 0.0, 0.0) * hurt * hurt * (1.0 - v + 0.06);
      col = mix(col, col * vec3(1.0, 0.25, 0.2), dead * 0.6);
      float g = hash(vUv * vec2(aspect, 1.0) * 900.0 + fract(time) * 100.0) - 0.5;
      col += g * (0.02 + fear * 0.03) * (0.4 + l);
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class Post {
  // q: the quality tier from game.js
  constructor(renderer, scene, camera, q) {
    this.renderer = renderer; this.scene = scene; this.camera = camera;
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    if (q.ao) {
      try {
        const ao = this.ao = new GTAOPass(scene, camera, 256, 256);
        // at half resolution: a quarter of the cost, and ambient occlusion is soft anyway
        if (q.aoHalf) { const set = ao.setSize.bind(ao); ao.setSize = (w, h) => set(Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(h / 2))); }
        ao.updateGtaoMaterial({ radius: 0.55, distanceExponent: 1.4, thickness: 1.2, scale: 1.25, samples: 12, distanceFallOff: 1, screenSpaceRadius: false });
        ao.blendIntensity = 1;
        const render = ao.render.bind(ao);
        ao.render = (...a) => { camera.layers.disable(FX_LAYER); try { render(...a); } finally { camera.layers.enable(FX_LAYER); } };
        this.composer.addPass(ao);
      } catch (e) { console.warn('ambient occlusion unavailable', e); }
    }
    // one invalid (NaN / infinite) pixel would be smeared over the whole frame by the bloom blur: scrub them first
    this.composer.addPass(new ShaderPass({
      uniforms: { tDiffuse: { value: null } }, vertexShader: VS,
      fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
        void main(){ vec3 c = texture2D(tDiffuse, vUv).rgb;
          if (!(c.r >= 0.0 && c.r < 1e4) || !(c.g >= 0.0 && c.g < 1e4) || !(c.b >= 0.0 && c.b < 1e4)) c = vec3(0.0);
          gl_FragColor = vec4(min(c, vec3(24.0)), 1.0); }`,
    }));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.7, 0.75, 0.8);
    if (q.bloom) this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    if (q.smaa) { try { this.smaa = new SMAAPass(256, 256); this.composer.addPass(this.smaa); } catch (e) { console.warn('SMAA unavailable', e); } }
    this.grade = new ShaderPass(Grade);          // graded in display space, after tone mapping
    this.grade.uniforms.sharpen.value = q.sharpen || 0;
    this.composer.addPass(this.grade);
  }
  size(w, h, pr) {
    this.composer.setPixelRatio(pr); this.composer.setSize(w, h);
    this.grade.uniforms.aspect.value = w / h; this.grade.uniforms.texel.value.set(1 / Math.max(1, w * pr), 1 / Math.max(1, h * pr));
  }
  dispose() {
    for (const p of this.composer.passes) if (p.dispose) p.dispose();
    this.composer.dispose();
  }
  render(dt, u) {
    const g = this.grade.uniforms;
    g.time.value += dt; g.hurt.value = u.hurt; g.fear.value = u.fear; g.gamma.value = u.gamma; g.dead.value = u.dead; g.warp.value = u.warp || 0;
    this.composer.render(dt);
  }
}

// ---------------------------------------------------------------- rubble
// Broken things become real pieces: each chunk is a small rigid body that flies, bounces off the
// building's colliders, tumbles, and comes to rest lying on a face.
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _ax = new THREE.Vector3(), _c = new THREE.Color();
const QX = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2), QZ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2), YUP = new THREE.Vector3(0, 1, 0);

export class Debris {
  constructor(scene, mat, softTex, col, max = 500, geo = null) {
    this.col = col; this.max = max; this.next = 0;
    this.mesh = new THREE.InstancedMesh(geo || new THREE.BoxGeometry(1, 1, 1), mat, max);
    this.mesh.castShadow = true; this.mesh.receiveShadow = true; this.mesh.frustumCulled = false;
    this.parts = Array.from({ length: max }, () => ({ on: false, rest: true, x: 0, y: -50, z: 0, vx: 0, vy: 0, vz: 0, q: new THREE.Quaternion(), tq: new THREE.Quaternion(), wx: 0, wy: 0, wz: 0, sx: 0.1, sy: 0.1, sz: 0.1, r: 0.1, settle: 0, age: 0 }));
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < max; i++) { this.mesh.setMatrixAt(i, zero); this.mesh.setColorAt(i, _c.set(0xffffff)); }
    scene.add(this.mesh);
    this.scene = scene;
    // dust puffs
    this.dust = [];
    for (let i = 0; i < 90; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTex, color: 0x8a8580, transparent: true, opacity: 0, depthWrite: false }));
      s.visible = false; s.layers.set(FX_LAYER); scene.add(s); this.dust.push({ s, t: 1, life: 1, vx: 0, vy: 0, vz: 0, size: 1, a: 0.5 });
    }
    this.dn = 0;
  }

  chunk(x, y, z, vx, vy, vz, sx, sy, sz, color = 0x9a9a9a) {
    const i = this.next, p = this.parts[i]; this.next = (this.next + 1) % this.max;
    p.on = true; p.rest = false; p.settle = 0; p.age = 0; p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz;
    p.sx = sx; p.sy = sy === undefined ? sx : sy; p.sz = sz === undefined ? sx : sz; p.r = (p.sx + p.sy + p.sz) / 6;
    p.q.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    const sp = 2 + Math.hypot(vx, vy, vz) * 0.9;
    p.wx = (Math.random() - 0.5) * sp; p.wy = (Math.random() - 0.5) * sp; p.wz = (Math.random() - 0.5) * sp;
    const k = 0.75 + Math.random() * 0.4;
    this.mesh.setColorAt(i, _c.set(color).multiplyScalar(k)); this.mesh.instanceColor.needsUpdate = true;
    return p;
  }
  puff(x, y, z, size, n = 1, spread = 1, color = 0x4a4642, alpha = 0.34) {
    for (let i = 0; i < n; i++) {
      const d = this.dust[this.dn]; this.dn = (this.dn + 1) % this.dust.length;
      d.s.position.set(x + (Math.random() - 0.5) * spread, y + (Math.random() - 0.5) * spread * 0.6, z + (Math.random() - 0.5) * spread);
      d.vx = (Math.random() - 0.5) * 1.5; d.vy = 0.3 + Math.random() * 0.8; d.vz = (Math.random() - 0.5) * 1.5;
      d.s.material.color.setHex(color); d.t = 0; d.life = 2.5 + Math.random() * 2.5; d.size = size * (0.6 + Math.random() * 0.8); d.a = alpha; d.s.visible = true;
    }
  }
  sparks(x, y, z, n = 10) {
    for (let i = 0; i < n; i++) this.chunk(x, y, z, (Math.random() - 0.5) * 6, 1 + Math.random() * 5, (Math.random() - 0.5) * 6, 0.03, 0.03, 0.09, 0xfff0a0);
    this.puff(x, y, z, 0.8, 3, 0.5, 0xffe0a0, 0.9);
  }

  // Break real parts into pieces. parts: [{x,y,z,sx,sy,sz,color,whole}] (boxes; `whole` = keep in one piece).
  // hit: where it was struck; dir: which way; power: how hard.
  shatter(parts, hit, dir, power = 7, budget = 140) {
    let vol = 0;
    for (const b of parts) vol += b.whole ? 0.1 : Math.max(0.004, b.sx * b.sy * b.sz);
    // piece size so the whole event stays within budget
    const cell = Math.max(0.22, Math.cbrt(vol / Math.max(20, budget)) * 1.25);
    const fling = (x, y, z, sx, sy, sz, color) => {
      const dx = x - hit.x, dy = y - hit.y, dz = z - hit.z, d = Math.hypot(dx, dy, dz) + 0.001, f = 1 / (1 + d * 0.55);
      const j = () => (Math.random() - 0.5) * 2.4;
      this.chunk(x, y, z,
        dir[0] * power * f * (0.4 + Math.random()) + (dx / d) * 1.6 * f + j() * f,
        dir[1] * power * f + Math.random() * 3.5 * f + 0.5,
        dir[2] * power * f * (0.4 + Math.random()) + (dz / d) * 1.6 * f + j() * f,
        sx, sy, sz, color);
    };
    for (const b of parts) {
      if (b.whole || (b.sx <= cell * 1.5 && b.sy <= cell * 1.5 && b.sz <= cell * 1.5)) { fling(b.x, b.y, b.z, Math.max(0.03, b.sx), Math.max(0.03, b.sy), Math.max(0.03, b.sz), b.color); continue; }
      const nx = Math.max(1, Math.round(b.sx / cell)), ny = Math.max(1, Math.round(b.sy / cell)), nz = Math.max(1, Math.round(b.sz / cell));
      const cx = b.sx / nx, cy = b.sy / ny, cz = b.sz / nz;
      for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) {
        const jit = 0.75 + Math.random() * 0.25;
        fling(b.x - b.sx / 2 + (i + 0.5) * cx, b.y - b.sy / 2 + (j + 0.5) * cy, b.z - b.sz / 2 + (k + 0.5) * cz, Math.max(0.03, cx * jit), Math.max(0.03, cy * jit), Math.max(0.03, cz * jit), b.color);
      }
    }
  }

  update(dt, cam = null) {
    let dirty = false;
    const col = this.col;
    for (let i = 0; i < this.max; i++) {
      const p = this.parts[i];
      if (!p.on || p.rest) continue;
      dirty = true; p.age += dt;
      if (p.settle > 0) {             // coming to rest: roll onto a face
        p.settle -= dt;
        p.q.slerp(p.tq, Math.min(1, dt * 14));
        if (p.settle <= 0) { p.q.copy(p.tq); p.rest = true; }
      } else {
        p.vy -= 18 * dt;
        const r = Math.min(0.12, p.r), nx = p.x + p.vx * dt, nz = p.z + p.vz * dt;
        if (col.test(nx - r, p.y - r, p.z - r, nx + r, p.y + r, p.z + r)) { p.vx *= -0.3; p.wy += (Math.random() - 0.5) * 6; } else p.x = nx;
        if (col.test(p.x - r, p.y - r, nz - r, p.x + r, p.y + r, nz + r)) { p.vz *= -0.3; p.wy += (Math.random() - 0.5) * 6; } else p.z = nz;
        p.y += p.vy * dt;
        const w = Math.hypot(p.wx, p.wy, p.wz);
        if (w > 0.01) { _ax.set(p.wx / w, p.wy / w, p.wz / w); p.q.premultiply(_q.setFromAxisAngle(_ax, w * dt)); }
        if (p.vy < 0) {
          const fl = col.floorBelow(p.x, p.y + 0.25, p.z), half = Math.min(p.sx, p.sy, p.sz) / 2 + 0.01;
          if (p.y - half <= fl) {
            p.y = fl + half;
            const hs = Math.hypot(p.vx, p.vz);
            if (Math.abs(p.vy) < 2.2 && hs < 1.2 || p.age > 6) {
              // lie flat: thinnest side down, any heading
              p.settle = 0.16;
              const yaw = _q.setFromAxisAngle(YUP, Math.random() * 6.28);
              if (p.sy <= p.sx && p.sy <= p.sz) p.tq.copy(yaw); else if (p.sx <= p.sz) p.tq.copy(yaw).multiply(QZ); else p.tq.copy(yaw).multiply(QX);
            } else {
              p.vy *= -0.3; p.vx *= 0.62; p.vz *= 0.62;
              p.wx = (Math.random() - 0.5) * hs * 5; p.wz = (Math.random() - 0.5) * hs * 5; p.wy *= 0.5;
            }
          }
        }
        if (p.y < -3) { p.on = false; p.y = -50; }
      }
      _m.compose(_p.set(p.x, p.y, p.z), p.q, _s.set(p.sx, p.sy, p.sz));
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
      // dust is not lit, so it must stay thin, and thinner still right in front of the eye, or it whites the whole view out
      const near = cam ? Math.min(1, Math.max(0, (d.s.position.distanceTo(cam) - 0.7) / 3)) : 1;
      d.s.material.opacity = Math.sin(Math.min(1, k * 4) * Math.PI / 2) * (1 - k) * d.a * near;
    }
  }

  dispose() { this.scene.remove(this.mesh); for (const d of this.dust) this.scene.remove(d.s); }
}
