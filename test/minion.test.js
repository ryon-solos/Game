// The client-side crawler: legs plant and step, nothing goes NaN, it plays footsteps, and it shrinks away when it dies.
import assert from 'node:assert';
import * as THREE from 'three';
import { MinionView } from '../public/js/minion.js';

const scene = new THREE.Scene();
const v = new MinionView(scene, {});
assert.ok(scene.children.includes(v.group), 'crawler is added to the scene');
let steps = 0;
v.onStep = (x, y, z) => { steps++; assert.ok(Number.isFinite(x + y + z), 'footstep position is finite'); };
const finite = () => {
  let ok = true;
  v.group.traverse((o) => { for (const n of [o.position.x, o.position.y, o.position.z, o.scale.x, o.quaternion.w]) if (!Number.isFinite(n)) ok = false; });
  return ok;
};
// walk along the street, climb a flight of stairs, turn round, chase
const dt = 1 / 60;
let t = 0;
for (let i = 0; i < 60 * 12; i++) {
  t += dt;
  v.tx = t * 2.7; v.tz = Math.sin(t) * 2; v.ty = t > 4 && t < 7 ? (t - 4) * 1.06 : t >= 7 ? 3.2 : 0;
  v.tyaw = t > 8 ? Math.PI : -Math.PI / 2; v.chase = t > 9 ? 1 : 0;
  assert.strictEqual(v.update(dt), false, 'alive crawler is not removed');
  assert.ok(finite(), `crawler transform went invalid at t=${t.toFixed(2)}`);
}
assert.ok(steps > 20, 'legs take steps while it walks (' + steps + ')');
// every foot stays near the body (no leg left stretched across the map)
for (const L of v.legs) assert.ok(Math.hypot(L.pos.x - v.x, L.pos.z - v.z) < 4, 'foot stays with the body');
// dying: it shrinks away and reports that it can be removed
v.dying = 1;
let gone = false;
for (let i = 0; i < 60 * 3 && !gone; i++) gone = v.update(dt);
assert.ok(gone, 'a dying crawler finishes shrinking');
v.dispose();
assert.ok(!scene.children.includes(v.group), 'disposed crawler leaves the scene');
console.log('minion view ok: steps', steps);
