// First-person character controller: walk / sprint / crouch / jump, stairs, stamina and fall damage.
const R = 0.3, H_STAND = 1.75, H_CROUCH = 1.1, EYE_STAND = 1.6, EYE_CROUCH = 0.92;
const STEP = 0.32, GRAV = 18, JUMP = 6.0;
export const SPEED = { walk: 3.2, sprint: 5.8, crouch: 1.6 };

export class Player {
  constructor(col) {
    this.col = col;
    this.x = 0; this.y = 0; this.z = 0; this.vx = 0; this.vy = 0; this.vz = 0;
    this.yaw = 0; this.pitch = 0;
    this.crouch = false; this.sprinting = false; this.moving = false; this.ground = true;
    this.stamina = 100; this.tired = false; this.restT = 0;
    this.eye = EYE_STAND; this.bob = 0; this.stepDist = 0; this.camLift = 0;
    this.others = [];
  }
  get h() { return this.crouch ? H_CROUCH : H_STAND; }
  hit(x, y, z, h = this.h) { return this.col.test(x - R, y + 0.01, z - R, x + R, y + h, z + R); }
  place(x, y, z, yaw = 0) { this.x = x; this.y = y; this.z = z; this.vx = this.vy = this.vz = 0; this.yaw = yaw; this.pitch = 0; this.ground = true; this.camLift = 0; this.crouch = false; }

  // returns a list of events: {t:'step',loud}, {t:'land',v}, {t:'jump'}
  update(dt, inp) {
    const ev = [];
    // --- stance
    if (inp.crouch && !this.crouch) this.crouch = true;
    else if (!inp.crouch && this.crouch && !this.hit(this.x, this.y, this.z, H_STAND)) this.crouch = false;
    let f = (inp.fwd ? 1 : 0) - (inp.back ? 1 : 0), s = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    const len = Math.hypot(f, s);
    this.moving = len > 0;
    if (len) { f /= len; s /= len; }
    const wantSprint = inp.sprint && f > 0 && !this.crouch && !this.tired;
    this.sprinting = wantSprint && this.moving && this.stamina > 0;
    if (this.sprinting) {
      this.stamina = Math.max(0, this.stamina - 17 * dt); this.restT = 1.1;
      if (this.stamina <= 0) this.tired = true;
    } else {
      this.restT -= dt;
      if (this.restT <= 0) this.stamina = Math.min(100, this.stamina + (this.moving ? 9 : 15) * dt);
      if (this.tired && this.stamina > 30) this.tired = false;
    }
    const sp = this.crouch ? SPEED.crouch : this.sprinting ? SPEED.sprint : SPEED.walk;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const tx = (-sin * f + cos * s) * sp, tz = (-cos * f - sin * s) * sp;
    const acc = this.ground ? 14 : 3;
    const k = Math.min(1, acc * dt);
    this.vx += (tx - this.vx) * k; this.vz += (tz - this.vz) * k;

    if (inp.jump && this.ground && !this.crouch && this.stamina > 8) {
      this.vy = JUMP; this.ground = false; this.stamina -= 8; this.restT = 1.1; ev.push({ t: 'jump' });
    }

    // --- horizontal, one axis at a time, with automatic step-up
    const tryMove = (dx, dz) => {
      const nx = this.x + dx, nz = this.z + dz;
      if (!this.hit(nx, this.y, nz)) { this.x = nx; this.z = nz; return; }
      if (this.ground && !this.hit(nx, this.y + STEP, nz) && !this.hit(this.x, this.y + STEP, this.z)) {
        let ny = this.y + STEP;
        for (let i = 0; i < 8 && !this.hit(nx, ny - 0.04, nz); i++) ny -= 0.04;
        this.camLift -= ny - this.y;
        this.x = nx; this.z = nz; this.y = ny; return;
      }
      if (dx) this.vx = 0; else this.vz = 0;
    };
    const x0 = this.x, z0 = this.z;
    if (this.vx) tryMove(this.vx * dt, 0);
    if (this.vz) tryMove(0, this.vz * dt);

    // other players are solid: push apart
    for (const o of this.others) {
      const dx = this.x - o.x, dz = this.z - o.z, d = Math.hypot(dx, dz);
      if (d < 0.62 && d > 1e-4 && Math.abs(this.y - o.y) < 1.6) {
        const push = (0.62 - d), nx = this.x + (dx / d) * push, nz = this.z + (dz / d) * push;
        if (!this.hit(nx, this.y, nz)) { this.x = nx; this.z = nz; }
      }
    }

    // --- vertical
    this.vy -= GRAV * dt;
    let dy = this.vy * dt;
    const n = Math.max(1, Math.ceil(Math.abs(dy) / 0.1));
    dy /= n;
    const was = this.ground;
    this.ground = false;
    for (let i = 0; i < n; i++) {
      if (!this.hit(this.x, this.y + dy, this.z)) { this.y += dy; continue; }
      if (dy < 0) {
        let lo = 0, hi = dy;                    // find the contact point
        for (let j = 0; j < 5; j++) { const mid = (lo + hi) / 2; if (this.hit(this.x, this.y + mid, this.z)) hi = mid; else lo = mid; }
        this.y += lo; this.ground = true;
        if (!was && this.vy < -4) ev.push({ t: 'land', v: -this.vy });
      }
      this.vy = 0; break;
    }
    if (this.y < -5) { this.y = 0.2; this.vy = 0; }

    // --- footsteps / head bob
    const moved = Math.hypot(this.x - x0, this.z - z0);
    if (this.ground && moved > 0.0005) {
      this.stepDist += moved; this.bob += moved * (this.sprinting ? 2.5 : 3.2);
      const stride = this.crouch ? 1.2 : this.sprinting ? 2.3 : 1.7;
      if (this.stepDist > stride) { this.stepDist = 0; ev.push({ t: 'step', loud: this.crouch ? 0 : this.sprinting ? 16 : 7 }); }
    }
    this.eye += ((this.crouch ? EYE_CROUCH : EYE_STAND) - this.eye) * Math.min(1, dt * 10);
    this.camLift *= Math.max(0, 1 - dt * 12);
    return ev;
  }
}
