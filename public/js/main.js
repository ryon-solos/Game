// Menus, lobby flow, settings and HUD. The 3D game itself lives in game.js.
import * as THREE from 'three';
import { Game } from './game.js';
import { Net, LocalNet } from './net.js';
import { Sound } from './audio.js';
import { Avatar } from './avatar.js';
import { dailySeed } from '/shared/world.js';

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

// ------------------------------------------------------------------ settings + profile
const settings = Object.assign({ sens: 1, fov: 78, master: 0.8, music: 0.7, sfx: 0.9, gamma: 1, quality: 'medium', invertY: false, headBob: true }, store.get('tls.settings', {}));
const profile = Object.assign({ name: '', char: 'm' }, store.get('tls.profile', {}));
const sound = new Sound();
const applySound = () => { sound.vol = { master: settings.master, music: settings.music, sfx: settings.sfx }; sound.applyVol(); };
applySound();

let game = null, net = null, me = null, lobby = null, mode = null, screen = 'home', builtQuality = null;

function show(name) {
  screen = name;
  for (const s of document.querySelectorAll('.screen')) s.classList.toggle('show', s.id === name);
  document.body.classList.toggle('ingame', name === 'game');
  document.body.classList.toggle('menu', name !== 'game' && !!game);
  if (name !== 'game') for (const id of ['pause', 'over', 'banner']) $(id).classList.remove('show');
}
const overlay = (id, on) => $(id).classList.toggle('show', on);
let errT;
function error(msg) { const e = $('err'); e.textContent = msg; e.style.display = 'block'; clearTimeout(errT); errT = setTimeout(() => { e.style.display = 'none'; }, 4000); }
function fullscreen(on) {
  try {
    if (on === undefined) on = !document.fullscreenElement;
    if (on && !document.fullscreenElement) { const p = document.documentElement.requestFullscreen(); if (p && p.catch) p.catch(() => {}); }
    else if (!on && document.fullscreenElement) document.exitFullscreen();
  } catch {}
}
const playerName = () => (profile.name || '').trim() || 'Survivor';

// ------------------------------------------------------------------ HUD
const FLAVOUR = ['It is listening.', 'It has learned the sound of doors.', 'It reaches a little deeper tonight.', 'It remembers where you hid.',
  'It has learned to open doors.', 'It pretends to leave.', 'It is taller than the rooftops soon.', 'Almost every hand is awake.', 'It does not forget any more.', 'The last night. All eight hands.'];
let bannerT;
function banner(title, sub, hold) {
  const b = $('banner');
  $('bannerTitle').textContent = title; $('bannerSub').textContent = sub || '';
  b.classList.remove('show'); b.classList.toggle('hold', !!hold); void b.offsetWidth; b.classList.add('show');
  clearTimeout(bannerT);
  if (!hold) bannerT = setTimeout(() => b.classList.remove('show'), 4600);
}
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const hud = {
  onLock(locked) {
    if (screen !== 'game') return;
    const playing = game && (game.phase === 'night' || game.phase === 'dawn');
    if (net && net.solo) net.paused = !locked && playing;
    if (game && game.phase === 'over') return;
    $('pauseTitle').textContent = net && net.solo ? 'Paused' : 'Menu';
    $('pauseNote').textContent = net && net.solo ? '' : 'The night does not stop for you in multiplayer.';
    if (!$('settings').classList.contains('show')) overlay('pause', !locked);
  },
  toast(text, kind) {
    const t = document.createElement('div'); t.className = 'toast ' + (kind || ''); t.textContent = text;
    $('toasts').appendChild(t); setTimeout(() => t.remove(), 4000);
    while ($('toasts').children.length > 4) $('toasts').firstChild.remove();
  },
  alert(text) { const a = $('alert'); a.textContent = text; a.classList.remove('show'); void a.offsetWidth; a.classList.add('show'); },
  night(m) {
    show('game'); overlay('over', false);
    banner(`NIGHT ${m.n}`, `${FLAVOUR[m.n - 1] || ''}\nCollect ${m.quota} stars.`);
    $('specNote').textContent = '';
    if (!document.pointerLockElement) game.lock();
    setTimeout(() => { if (screen === 'game' && !document.pointerLockElement) hud.onLock(false); }, 300);
  },
  nightEnd(m) {
    const mine = m.players.find((p) => p.id === me);
    const line = !mine ? '' : !mine.alive ? 'You were taken. You wake again at dusk.' : mine.safe ? 'You rested indoors. +40 health.' : 'Dawn found you outside. No rest for you.';
    banner(`NIGHT ${m.n} SURVIVED`, line + '\nThe next night begins shortly…', true);
  },
  dead(cause) {
    $('specNote').textContent = cause === 'hand' ? 'A HAND FOUND YOU' : cause === 'debris' ? 'CRUSHED BY RUBBLE' : 'THE FALL KILLED YOU';
  },
  over(m) {
    overlay('pause', false); $('banner').classList.remove('show');
    $('over').classList.toggle('win', !!m.win);
    $('overTitle').textContent = m.win ? 'DAWN' : 'TAKEN';
    $('overSub').textContent = m.win ? 'You survived all ten nights on the long street.' : `No one saw the morning of night ${m.night}.`;
    $('btnAgain').textContent = mode === 'solo' ? 'Try again' : 'Back to lobby';
    overlay('over', true);
  },
  update(s) {
    $('hNight').textContent = `NIGHT ${s.night || 1}`;
    $('hStars').textContent = `★ ${s.stars || 0} / ${s.quota || 0}`;
    const t = $('hTime');
    if (s.phase === 'dawn') { t.textContent = `DAWN IN ${s.cd}`; t.classList.remove('late'); }
    else { t.textContent = s.tl > 0 ? fmt(s.tl) : 'IT KNOWS'; t.classList.toggle('late', s.tl < 45); }
    $('hHp').style.width = s.hp + '%'; $('hHpN').textContent = Math.round(s.hp);
    $('hSt').style.width = s.stamina + '%'; $('hSt').parentElement.classList.toggle('tired', !!s.tired);
    $('hAmmo').textContent = (s.ammo > 0 ? `FLARE PISTOL  ${'▮'.repeat(s.ammo)}` : '') + (s.torch ? '   TORCH ON' : '');
    const z = $('hZone'); z.textContent = s.alive ? s.zone + (s.crouch ? '  ·  crouched' : '') : '—'; z.classList.toggle('out', s.alive && !s.indoors);
    const e = $('hExpo'); e.style.width = Math.round(s.expo * 100) + '%'; e.classList.toggle('hot', s.expo > 0.75);
    $('hNoise').style.width = Math.round(s.noise * 100) + '%';
    $('prompt').innerHTML = s.prompt ? `<b>E</b>${s.prompt}` : '';
    $('cross').style.display = s.alive ? '' : 'none';
    $('hOthers').innerHTML = s.others.map((o) => `<li class="${o.alive ? '' : 'dead'}">${esc(o.name)}<span>${o.alive ? o.hp : 'taken'}</span></li>`).join('');
    if (!s.alive && s.playing) {
      const base = $('specNote').textContent.split('\n')[0];
      $('specNote').textContent = base + (s.spec ? `\nWatching ${s.spec}  ·  click to switch` : '');
    }
  },
};
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ------------------------------------------------------------------ game + network glue
function ensureGame() {
  if (game && builtQuality === settings.quality) return game;
  if (game) game.destroy();
  builtQuality = settings.quality;
  game = new Game({ canvas: $('game'), settings, sound, hud });
  window.__game = game;
  return game;
}

function onMsg(m) {
  switch (m.t) {
    case 'joined': me = m.you; break;
    case 'rooms': renderRooms(m.rooms); break;
    case 'err': error(m.msg); break;
    case 'lobby':
      lobby = m;
      if (game) { game.seedWanted = m.seed; game.phase = 'idle'; game.monster.setVisible(false); }
      if (mode === 'multi') { renderLobby(); if (document.pointerLockElement) document.exitPointerLock(); show('lobby'); }
      break;
    default:
      if (m.t === 'night') { const g = ensureGame(); g.net = net; g.me = me; g.seedWanted = lobby ? lobby.seed : dailySeed(); }
      if (game) game.onMsg(m);
  }
}

function leaveGame() {
  if (net) { if (!net.solo) net.send({ t: 'leave' }); if (net.solo) { net.close(); net = null; } }
  if (game) { game.phase = 'idle'; game.snap = null; game.monster.setVisible(false); }
  if (document.pointerLockElement) document.exitPointerLock();
  lobby = null;
  overlay('pause', false); overlay('over', false);
  if (mode === 'multi') { show('multi'); refresh(); } else show('home');
}

function startSolo() {
  sound.init(); fullscreen(true);
  mode = 'solo';
  if (net) net.close();
  ensureGame();
  net = new LocalNet(onMsg, playerName(), profile.char);
  net.send({ t: 'start' });
}

async function openMulti() {
  sound.init();
  mode = 'multi';
  show('multi');
  if (net && net.solo) { net.close(); net = null; }
  if (!net || !net.open) {
    $('netState').textContent = 'Connecting…';
    net = new Net(onMsg, () => { $('netState').textContent = 'Disconnected'; if (mode === 'multi') { error('Lost connection to the server'); if (screen === 'game' || screen === 'lobby') leaveGame(); } });
    try { await net.connect(); $('netState').textContent = 'Connected'; } catch (e) {
      $('netState').textContent = 'Offline';
      $('rooms').innerHTML = '<div class="empty">No game server is reachable from this page.<br>Multiplayer needs the Node server running (npm start). Solo play still works.</div>';
      net = null; return;
    }
  }
  refresh();
}
const refresh = () => net && net.open && net.send({ t: 'list' });

function renderRooms(rooms) {
  const el = $('rooms');
  if (!rooms.length) { el.innerHTML = '<div class="empty">No public lobbies right now. Create one.</div>'; return; }
  el.innerHTML = '';
  for (const r of rooms) {
    const row = document.createElement('div'); row.className = 'room';
    const inGame = r.phase !== 'lobby';
    row.innerHTML = `<b>${esc(r.name)}</b><span class="st">${inGame ? 'Night ' + r.night : 'In lobby'}</span><span class="st">${r.players} / ${r.max} players</span>`;
    const b = document.createElement('button'); b.textContent = inGame ? 'In progress' : r.players >= r.max ? 'Full' : 'Join';
    b.disabled = inGame || r.players >= r.max;
    b.onclick = () => { sound.play('ui'); net.send({ t: 'join', id: r.id, name: playerName(), char: profile.char }); };
    row.appendChild(b); el.appendChild(row);
  }
}
function renderLobby() {
  const L = lobby;
  $('lobbyTitle').textContent = L.name; $('lobbyVis').textContent = L.pub ? 'Public lobby' : 'Private lobby';
  $('lobbyCode').textContent = L.code;
  $('lobbyPlayers').innerHTML = L.players.map((p) => `<li>${esc(p.name)}${p.id === me ? ' (you)' : ''}<i>${p.char === 'f' ? 'Female' : 'Male'}${p.id === L.host ? ' · Host' : ''}</i></li>`).join('');
  const host = L.host === me;
  $('btnStart').style.display = host ? '' : 'none';
  $('lobbyHint').textContent = host ? `${L.players.length} of ${L.max} players. Start whenever you are ready.` : 'Waiting for the host to begin…';
}

// ------------------------------------------------------------------ wiring
const click = (id, f) => $(id).addEventListener('click', (e) => { sound.init(); sound.play('ui'); f(e); });
click('btnSolo', startSolo);
click('btnMulti', openMulti);
click('btnSettings', () => overlay('settings', true));
click('btnHow', () => overlay('how', true));
click('btnHowClose', () => overlay('how', false));
click('btnFull', () => fullscreen());
click('btnFull2', () => fullscreen());
click('btnRefresh', refresh);
click('btnCreate', () => { $('lobbyName').value = `${playerName()}'s street`; show('create'); });
click('btnDoCreate', () => {
  if (!net || !net.open) return error('Not connected');
  net.send({ t: 'create', name: $('lobbyName').value, pub: $('vis').querySelector('.on').dataset.v === '1', max: +$('maxPlayers').value, char: profile.char, pname: playerName() });
});
click('btnJoinCode', () => { const c = $('code').value.trim(); if (c.length < 4) return error('Enter the 5-letter lobby code'); net && net.send({ t: 'join', code: c, name: playerName(), char: profile.char }); });
click('btnLeave', leaveGame);
click('btnStart', () => { fullscreen(true); net.send({ t: 'start' }); });
click('btnCopy', () => { navigator.clipboard && navigator.clipboard.writeText(lobby.code).catch(() => {}); });
click('btnResume', () => { overlay('pause', false); fullscreen(true); game && game.lock(); });
click('btnPauseSettings', () => { overlay('pause', false); overlay('settings', true); });
click('btnSettingsClose', () => { overlay('settings', false); if (screen === 'game' && !document.pointerLockElement && game.phase !== 'over') overlay('pause', true); });
click('btnQuit', leaveGame);
click('btnMenu', () => { const m = mode; leaveGame(); if (m === 'multi') { /* stay in server list */ } });
click('btnAgain', () => { overlay('over', false); if (mode === 'solo') startSolo(); });
for (const b of document.querySelectorAll('.back')) b.addEventListener('click', () => { sound.play('ui'); show(b.dataset.go); if (b.dataset.go === 'multi') refresh(); });
$('maxPlayers').addEventListener('input', (e) => { $('maxOut').textContent = e.target.value; });
for (const seg of document.querySelectorAll('.seg')) seg.addEventListener('click', (e) => {
  if (e.target.tagName !== 'BUTTON') return;
  for (const b of seg.children) b.classList.toggle('on', b === e.target);
  seg.dispatchEvent(new CustomEvent('pick', { detail: e.target.dataset.v }));
});
setInterval(() => { if (screen === 'multi') refresh(); }, 4000);
window.addEventListener('keydown', (e) => { if (e.code === 'Enter' && screen === 'game' && !document.pointerLockElement && $('pause').classList.contains('show')) $('btnResume').click(); });

// settings panel
function bindSettings() {
  const fmtV = { sens: (v) => v.toFixed(2), fov: (v) => v + '°', master: (v) => Math.round(v * 100) + '%', music: (v) => Math.round(v * 100) + '%', sfx: (v) => Math.round(v * 100) + '%', gamma: (v) => v.toFixed(2) };
  for (const k of Object.keys(fmtV)) {
    const inp = $('s_' + k), out = $('o_' + k);
    inp.value = settings[k]; out.textContent = fmtV[k](+settings[k]);
    inp.addEventListener('input', () => { settings[k] = +inp.value; out.textContent = fmtV[k](settings[k]); save(); });
  }
  for (const k of ['invertY', 'headBob']) { const c = $('s_' + k); c.checked = settings[k]; c.addEventListener('change', () => { settings[k] = c.checked; save(); }); }
  const q = $('s_quality');
  for (const b of q.children) b.classList.toggle('on', b.dataset.v === settings.quality);
  q.addEventListener('pick', (e) => { settings.quality = e.detail; save(); $('qualityNote').textContent = game && builtQuality !== settings.quality ? 'Graphics quality changes apply when the next game starts.' : ''; });
  function save() { store.set('tls.settings', settings); applySound(); if (game) game.applySettings(); }
}
bindSettings();

// profile + character preview
const nameEl = $('name'); nameEl.value = profile.name;
nameEl.addEventListener('input', () => { profile.name = nameEl.value.slice(0, 16); store.set('tls.profile', profile); });
let preview = null;
function setChar(c) {
  profile.char = c; store.set('tls.profile', profile);
  for (const b of document.querySelectorAll('.char')) b.classList.toggle('on', b.dataset.char === c);
  if (!preview) return;
  if (preview.av) preview.scene.remove(preview.av.group);
  preview.av = new Avatar(c, null); preview.scene.add(preview.av.group);
}
for (const b of document.querySelectorAll('.char')) b.addEventListener('click', () => { sound.init(); sound.play('ui'); setChar(b.dataset.char); });
try {
  const r = new THREE.WebGLRenderer({ canvas: $('preview'), antialias: true, alpha: true });
  r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); r.setSize(300, 380, false);
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(30, 300 / 380, 0.1, 20);
  cam.position.set(0, 1.05, 4.3); cam.lookAt(0, 0.95, 0);
  scene.add(new THREE.HemisphereLight(0x6f98a8, 0x1a0d0a, 1.1));
  const key = new THREE.PointLight(0xffb070, 30, 12); key.position.set(2, 2.2, 2.5); scene.add(key);
  const rim = new THREE.PointLight(0xff2030, 40, 12); rim.position.set(-2.2, 1.6, -2); scene.add(rim);
  preview = { r, scene, cam, av: null };
  let last = performance.now();
  const loop = (now) => {
    requestAnimationFrame(loop);
    if (screen !== 'home' || !preview.av) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    preview.av.group.rotation.y = Math.PI + Math.sin(now / 1800) * 0.9;
    preview.av.pose(dt, 1.4, false, false, false);
    r.render(scene, cam);
  };
  requestAnimationFrame(loop);
} catch (e) { console.warn('preview unavailable', e); }
setChar(profile.char);

const d = new Date();
$('daily').textContent = `Today's street: ${d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}. The layout changes every day.`;
show('home');
window.addEventListener('error', (e) => console.error('ERR', e.message));
