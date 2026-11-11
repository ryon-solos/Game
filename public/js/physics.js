// Axis-aligned box collision world on a uniform grid.
const CELL = 4;
const key = (ix, iz) => ix * 4096 + iz;

export class Colliders {
  constructor() { this.grid = new Map(); this.all = []; }

  add(x, y, z, sx, sy, sz) {
    const c = { x0: x - sx / 2, y0: y - sy / 2, z0: z - sz / 2, x1: x + sx / 2, y1: y + sy / 2, z1: z + sz / 2, on: true };
    this.all.push(c);
    const a = Math.floor(c.x0 / CELL), b = Math.floor(c.x1 / CELL), d = Math.floor(c.z0 / CELL), e = Math.floor(c.z1 / CELL);
    if ((b - a) * (e - d) > 400) { (this.big ||= []).push(c); return c; }
    for (let ix = a; ix <= b; ix++) for (let iz = d; iz <= e; iz++) {
      const k = key(ix, iz);
      let l = this.grid.get(k);
      if (!l) this.grid.set(k, (l = []));
      l.push(c);
    }
    return c;
  }

  // first collider overlapping the AABB, or null
  test(x0, y0, z0, x1, y1, z1) {
    if (this.big) for (const c of this.big) if (c.on && x0 < c.x1 && x1 > c.x0 && y0 < c.y1 && y1 > c.y0 && z0 < c.z1 && z1 > c.z0) return c;
    const a = Math.floor(x0 / CELL), b = Math.floor(x1 / CELL), d = Math.floor(z0 / CELL), e = Math.floor(z1 / CELL);
    for (let ix = a; ix <= b; ix++) for (let iz = d; iz <= e; iz++) {
      const l = this.grid.get(key(ix, iz));
      if (!l) continue;
      for (let i = 0; i < l.length; i++) {
        const c = l[i];
        if (c.on && x0 < c.x1 && x1 > c.x0 && y0 < c.y1 && y1 > c.y0 && z0 < c.z1 && z1 > c.z0) return c;
      }
    }
    return null;
  }

  // highest solid surface below a point (for debris and shadows)
  floorBelow(x, y, z) {
    let best = 0;
    const l = this.grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (l) for (const c of l) if (c.on && x > c.x0 && x < c.x1 && z > c.z0 && z < c.z1 && c.y1 <= y + 0.05 && c.y1 > best) best = c.y1;
    return best;
  }

  // distance along a ray to the nearest collider (slab test), or Infinity
  ray(ox, oy, oz, dx, dy, dz, max = 200) {
    let best = max;
    const ix = 1 / dx, iy = 1 / dy, iz = 1 / dz;
    for (const c of this.all) {
      if (!c.on) continue;
      let t0 = (c.x0 - ox) * ix, t1 = (c.x1 - ox) * ix;
      let tmin = Math.min(t0, t1), tmax = Math.max(t0, t1);
      t0 = (c.y0 - oy) * iy; t1 = (c.y1 - oy) * iy;
      tmin = Math.max(tmin, Math.min(t0, t1)); tmax = Math.min(tmax, Math.max(t0, t1));
      t0 = (c.z0 - oz) * iz; t1 = (c.z1 - oz) * iz;
      tmin = Math.max(tmin, Math.min(t0, t1)); tmax = Math.min(tmax, Math.max(t0, t1));
      if (tmax >= Math.max(tmin, 0) && tmin < best && tmin > 0) best = tmin;
    }
    return best === max ? Infinity : best;
  }
}
