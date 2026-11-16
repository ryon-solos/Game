// Testing cheats for solo play: a menu (` or F8 in game) with god mode, invisibility, infinite ammo and
// stamina, fly, x-ray for stars / items / the monster, and shortcuts for stars, nights and the monster.
//
// Single-player only. It works on the in-browser solo room (LocalNet.room) directly. In multiplayer there
// is no local room, the server never reads cheat state, and there is no network message for it, so nothing
// here can affect another player. On a hosted copy of the game it stays locked unless the address has
// ?cheats in it (it is always unlocked on localhost and the local network); ?cheats=0 locks it again.
import * as THREE from 'three';

const TOGGLES = [
  { k: 'god', group: 'Survival', label: 'God mode', hint: 'Nothing can hurt or kill you: hands, crawlers, rubble, falls.' },
  { k: 'infHp', group: 'Survival', label: 'Infinite health', hint: 'Health refills after every hit, but a hand that grabs you still kills. Use it to test grabs.' },
  { k: 'noFall', group: 'Survival', label: 'No fall damage', hint: 'Jump off any roof.' },
  { k: 'invisible', group: 'Stealth', label: 'Invisible', hint: 'The monster, its hands and the crawlers cannot see, hear or smell you. Presence never fills.' },
  { k: 'silent', group: 'Stealth', label: 'Silent', hint: 'Footsteps, doors, gunshots and taking stars make no sound it can hear. Thrown bottles still do.' },
  { k: 'stamina', group: 'Movement', label: 'Infinite stamina', hint: 'Sprint and jump forever.' },
  { k: 'fly', group: 'Movement', label: 'Fly / no-clip', hint: 'Fly through walls. Space up, C down, Shift faster.' },
  { k: 'ammo', group: 'Items', label: 'Infinite flare ammo', hint: 'Six rounds that never run out.' },
  { k: 'bottles', group: 'Items', label: 'Infinite bottles', hint: 'Always three bottles to throw (G).' },
  { k: 'instantStar', group: 'Items', label: 'Instant star pickup', hint: 'Stars are taken the moment you press E.' },
  { k: 'xStars', group: 'Vision', label: 'X-ray: stars', hint: 'Every star, through walls, with its distance. Ones shut in closets are marked.' },
  { k: 'xItems', group: 'Vision', label: 'X-ray: items', hint: 'Flare pistols, bandages and bottles.' },
  { k: 'xMonster', group: 'Vision', label: 'X-ray: monster', hint: 'The monster (and what it is doing), each hand that is out, and crawlers.' },
  { k: 'bright', group: 'Vision', label: 'Full bright', hint: 'See in the dark.' },
  { k: 'freeze', group: 'World', label: 'Freeze monster', hint: 'The monster, its hands and the crawlers stop where they are.' },
  { k: 'freezeTime', group: 'World', label: 'Stop the clock', hint: 'The night timer does not run down.' },
];
const SHORT = { god: 'GOD', infHp: 'HP', noFall: 'NOFALL', invisible: 'INVIS', silent: 'SILENT', stamina: 'STAM', fly: 'FLY', ammo: 'AMMO', bottles: 'BOTTLES', instantStar: 'FASTSTAR', xStars: 'XSTARS', xItems: 'XITEMS', xMonster: 'XMON', bright: 'BRIGHT', freeze: 'FREEZE', freezeTime: 'CLOCK' };
const ACTIONS = [
  { k: 'stars', label: 'Complete the star quota', ok: 'Quota complete. Dawn in 15 seconds.' },
  { k: 'star', label: '+1 star', ok: '+1 star' },
  { k: 'tpStar', label: 'Teleport to nearest star', client: true },
  { k: 'heal', label: 'Heal to full', ok: 'Health 100' },
  { k: 'stun', label: 'Stun the monster', ok: 'Monster stunned' },
  { k: 'away', label: 'Send the monster away', ok: 'It walks off to the far end of the street' },
  { k: 'killCrawlers', label: 'Kill all crawlers', ok: 'Crawlers gone' },
  { k: 'summon', label: 'Summon crawlers', ok: 'Crawlers summoned' },
  { k: 'endNight', label: 'Skip to the next night', ok: 'Night skipped', close: true },
];
const MON_ST = { roam: 'walking', listen: 'listening', investigate: 'going to a sound', search: 'searching', hunt: 'HUNTING', stun: 'stunned', eat: 'eating', smash: 'smashing', feint: 'pretending to leave' };
const ITEM = { gun: 'FLARE PISTOL', med: 'BANDAGES', bottle: 'BOTTLE' };

const store = {
  get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const LOCAL_HOST = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|::1|0\.0\.0\.0|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/;
const _v = new THREE.Vector3();

export class Cheats {
  // getNet / getGame: the live transport and game. inGame(): the game screen is up. hud: toasts. onClosed(): the menu was shut.
  constructor({ getNet, getGame, inGame, hud, onClosed }) {
    this.getNet = getNet; this.getGame = getGame; this.inGame = inGame; this.hud = hud; this.onClosed = onClosed;
    // ?cheats unlocks this page and is remembered for next time; ?cheats=0 locks it again. The address
    // itself counts even when the browser will not store anything (private windows, blocked site data).
    const q = new URLSearchParams(location.search), asked = q.has('cheats') ? q.get('cheats') !== '0' : null;
    if (asked !== null) store.set('tls.cheatsUnlocked', asked);
    this.unlocked = LOCAL_HOST.test(location.hostname) || location.protocol === 'file:' || (asked ?? store.get('tls.cheatsUnlocked', false));
    this.state = Object.assign({ speed: 1 }, store.get('tls.cheats', {}));
    for (const t of TOGGLES) this.state[t.k] = !!this.state[t.k];
    this.isOpen = false; this.pool = []; this.badge = '';
    this.buildUi();
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Backquote' && e.code !== 'F8') {
        if (e.code === 'Escape' && this.isOpen) this.close(false);
        return;
      }
      if (!this.inGame()) return;
      e.preventDefault();
      if (!e.repeat) this.isOpen ? this.close(true) : this.open();
    });
  }

  // a solo game is running and cheats may be used
  active() { const n = this.getNet(); return !!(this.unlocked && n && n.solo && n.room); }
  on(k) { return !!this.state[k] && this.active(); }

  // ------------------------------------------------------------------ menu
  buildUi() {
    const $ = (id) => document.getElementById(id);
    const groups = new Map();
    for (const t of TOGGLES) { if (!groups.has(t.group)) groups.set(t.group, []); groups.get(t.group).push(t); }
    const tog = [...groups].map(([g, list]) => `<fieldset><legend>${g}</legend>${list.map((t) =>
      `<label class="ctog" title="${t.hint}"><input type="checkbox" data-k="${t.k}"><span><b>${t.label}</b><i>${t.hint}</i></span></label>`).join('')}</fieldset>`).join('');
    const act = ACTIONS.map((a) => `<button data-a="${a.k}">${a.label}</button>`).join('');
    const nights = Array.from({ length: 10 }, (_, i) => `<option value="${i + 1}">Night ${i + 1}</option>`).join('');
    const el = document.createElement('section');
    el.id = 'cheats'; el.className = 'overlay';
    el.innerHTML = `<div class="panel wide">
      <header><h2>Test menu</h2><span class="dim">Single player only · <b>\`</b> or <b>F8</b> to open and close</span></header>
      <div class="cgrid">${tog}</div>
      <fieldset class="cspeed"><legend>Move speed</legend>
        <input type="range" id="chSpeed" min="0.5" max="4" step="0.25"><output id="chSpeedO"></output>
      </fieldset>
      <fieldset><legend>Do it now</legend><div class="cact">${act}</div>
        <div class="row"><select id="chNight">${nights}</select><button id="chNightGo">Jump to that night</button>
        <span class="grow"></span><button id="chNone">Turn everything off</button></div>
      </fieldset>
      <div class="row"><span class="dim">Cheats stay on between games until you turn them off. Active ones are listed in the top right corner.</span><span class="grow"></span><button id="chClose" class="accent">Back to the game</button></div>
    </div>`;
    document.body.appendChild(el);
    this.el = el;
    this.boxes = [...el.querySelectorAll('input[data-k]')];
    for (const b of this.boxes) b.addEventListener('change', () => { this.state[b.dataset.k] = b.checked; this.save(); });
    const sp = $('chSpeed'), spo = $('chSpeedO');
    sp.addEventListener('input', () => { this.state.speed = +sp.value; spo.textContent = this.state.speed + 'x'; this.save(); });
    for (const b of el.querySelectorAll('button[data-a]')) b.addEventListener('click', () => this.act(b.dataset.a));
    $('chNightGo').addEventListener('click', () => this.act('night', +$('chNight').value));
    $('chNone').addEventListener('click', () => { for (const t of TOGGLES) this.state[t.k] = false; this.state.speed = 1; this.save(); this.sync(); });
    $('chClose').addEventListener('click', () => this.close(true));
    // x-ray markers and the list of what is on
    this.esp = document.createElement('div'); this.esp.id = 'esp';
    this.badgeEl = document.createElement('div'); this.badgeEl.id = 'cheatBadge';
    $('hud').append(this.esp, this.badgeEl);
  }
  sync() {
    for (const b of this.boxes) b.checked = !!this.state[b.dataset.k];
    document.getElementById('chSpeed').value = this.state.speed;
    document.getElementById('chSpeedO').textContent = this.state.speed + 'x';
    const g = this.getGame();
    if (g) document.getElementById('chNight').value = String(g.night || 1);
  }
  save() { store.set('tls.cheats', this.state); }

  open() {
    const n = this.getNet();
    if (!n || !n.solo) return this.hud.toast('The test menu is single player only.', 'bad');
    if (!this.unlocked) return this.hud.toast(`Cheats are locked on this site. Open ${location.origin}/?cheats to unlock them.`, 'bad');
    this.isOpen = true; this.sync();
    this.el.classList.add('show');
    document.getElementById('pause').classList.remove('show');
    if (document.pointerLockElement) document.exitPointerLock();
  }
  close(resume) {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.el.classList.remove('show');
    this.onClosed(resume);
  }

  act(k, arg) {
    const a = ACTIONS.find((q) => q.k === k), n = this.getNet(), g = this.getGame();
    if (!this.active() || !g) return;
    let err = null;
    if (k === 'tpStar') err = this.tpStar(g);
    else err = n.room.cheatAction(k, arg);
    if (err) return this.hud.toast(err, 'bad');
    if (a && a.ok) this.hud.toast(a.ok, 'good');
    if (k === 'night' || (a && a.close)) this.close(true);
  }

  tpStar(g) {
    const P = g.player;
    if (!g.alive || !P || !g.world) return 'Only while you are alive in a night';
    let best = null, bd = 1e9;
    for (const p of g.world.pickups.values()) {
      if (p.k.k !== 'star') continue;
      const d = Math.hypot(p.k.x - P.x, p.k.y - 0.8 - P.y, p.k.z - P.z);
      if (d > 1.5 && d < bd) { bd = d; best = p.k; }
    }
    if (!best) return 'No stars left';
    // stand on the star's floor, at it or just beside it, wherever there is room
    const y0 = best.y - 0.8;
    for (const r of [0, 0.5, 0.9, 1.3]) for (let i = 0; i < (r ? 8 : 1); i++) {
      const a = (i / 8) * Math.PI * 2, x = best.x + Math.cos(a) * r, z = best.z + Math.sin(a) * r;
      for (let dy = 0; dy < 1.2; dy += 0.1) {
        if (P.hit(x, y0 + dy, z)) continue;
        P.place(x, y0 + dy + 0.02, z, r ? Math.atan2(x - best.x, z - best.z) : P.yaw);
        if (best.closet != null && !g.W.closets[best.closet].open) g.net.send({ t: 'closet', id: best.closet });
        this.hud.toast(best.closet != null ? 'Star in a closet: press E to take it' : 'Press E to take the star', 'good');
        return null;
      }
    }
    return 'No room to stand next to the nearest star';
  }

  // ------------------------------------------------------------------ every frame, from Game.frame
  pre(g) {
    const P = g.player;
    if (!this.active()) {
      if (P) { P.speedMul = 1; P.fly = false; }
      return;
    }
    const s = this.state, room = this.getNet().room;
    if (room.cheats !== s) room.cheats = s;
    if (!P) return;
    P.speedMul = s.speed || 1;
    const fly = s.fly && g.alive;
    if (P.fly && !fly) { P.ground = false; P.vy = 0; }
    P.fly = fly;
    if (s.stamina) { P.stamina = 100; P.tired = false; }
  }

  draw(g) {
    const s = this.state, on = this.active() && !g.attract && g.world && (g.phase === 'night' || g.phase === 'dawn');
    const want = [];
    if (on) {
      if (s.xStars || s.xItems) for (const p of g.world.pickups.values()) {
        const k = p.k;
        if (k.k === 'star' ? !s.xStars : !s.xItems) continue;
        want.push([k.x, k.y + 0.35, k.z, k.k === 'star' ? 'star' : 'item ' + k.k, k.k === 'star' ? (k.closet != null ? '★ in closet' : '★') : ITEM[k.k] || k.k]);
      }
      if (s.xMonster && g.snap && g.snap.m) {
        const m = g.snap.m, mv = g.monster;
        want.push([mv.x, mv.h * 0.8, mv.z, 'mon', `MONSTER · ${MON_ST[m.st] || m.st}`]);
        m.hands.forEach((h, i) => { if (h) { const t = mv.arms[i] && mv.arms[i].tip; want.push(t ? [t.x, t.y, t.z, 'hand', 'HAND'] : [h[1], h[2], h[3], 'hand', 'HAND']); } });
        for (const v of g.minions.values()) if (!v.dying) want.push([v.x, v.y + 0.5, v.z, 'crawl', 'CRAWLER']);
      }
    }
    while (this.pool.length < want.length) { const d = document.createElement('div'); this.esp.appendChild(d); this.pool.push({ d, cls: '', txt: '', vis: true }); }
    const cam = g.camera, W = window.innerWidth, H = window.innerHeight;
    for (let i = 0; i < this.pool.length; i++) {
      const o = this.pool[i], w = want[i];
      if (!w) { if (o.vis) { o.d.style.display = 'none'; o.vis = false; } continue; }
      _v.set(w[0], w[1], w[2]).applyMatrix4(cam.matrixWorldInverse);
      const dist = _v.length(), behind = _v.z > 0;
      _v.applyMatrix4(cam.projectionMatrix);
      let x = behind ? -_v.x : _v.x, y = behind ? -_v.y : _v.y;
      const edge = behind || Math.abs(x) > 1 || Math.abs(y) > 1;
      // off screen: the monster and crawlers are pinned to the nearest edge, in the direction they lie;
      // stars and items only show while they are in view (pinned, dozens of them bury the monster's marker)
      if (edge && w[3] !== 'mon' && w[3] !== 'crawl') { if (o.vis) { o.d.style.display = 'none'; o.vis = false; } continue; }
      if (edge) {
        if (behind && Math.abs(x) < 1e-3 && Math.abs(y) < 1e-3) y = -1;
        const k = 0.98 / Math.max(Math.abs(x), Math.abs(y), 1e-6); x *= k; y *= k;
      }
      const cls = 'esp ' + w[3] + (edge ? ' edge' : ''), txt = `${w[4]} ${Math.round(dist)}m`;
      if (o.cls !== cls) { o.d.className = cls; o.cls = cls; }
      if (o.txt !== txt) { o.d.textContent = txt; o.txt = txt; }
      // on screen the label is centred on the thing; pinned to an edge it is anchored on that side, so it stays whole
      const ax = edge ? (x * 0.5 + 0.5) * 100 : 50, ay = edge ? (-y * 0.5 + 0.5) * 100 : 50;
      o.d.style.transform = `translate(${((x * 0.5 + 0.5) * W).toFixed(1)}px, ${((-y * 0.5 + 0.5) * H).toFixed(1)}px) translate(-${ax.toFixed(0)}%, -${ay.toFixed(0)}%)`;
      if (!o.vis) { o.d.style.display = ''; o.vis = true; }
    }
    const badge = this.active() ? TOGGLES.filter((t) => s[t.k]).map((t) => SHORT[t.k]).concat(s.speed !== 1 ? [`SPEED ${s.speed}x`] : []).join(' · ') : '';
    if (badge !== this.badge) { this.badge = badge; this.badgeEl.textContent = badge ? 'CHEATS: ' + badge : ''; }
  }
}
