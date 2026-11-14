// Every sound is synthesised with WebAudio at run time: no downloads.
//
//  - one-shot effects, placed in 3D (HRTF) round the listener, muffled through walls, sent to the reverb of
//    the space they happen in (a long stone street with slap echoes between the facades, or a small room)
//  - the player's body: breathing that follows exertion and fear, and a heartbeat
//  - the monster: a breathing growl that follows it, footfalls you feel, and a voice (see speak())
//  - a horror ambience bed: wind and gusts, a low drone, a tension pad, and things happening in the dark
import { K } from '../shared/world.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const pick = (a) => a[(Math.random() * a.length) | 0];
// vowel formants (Hz) for anything with a throat
const VOW = { a: [730, 1090, 2440], o: [570, 840, 2410], u: [300, 870, 2240], e: [530, 1840, 2480], i: [270, 2290, 3010], uh: [520, 1190, 2390], aw: [640, 900, 2500] };

export class Sound {
  constructor() {
    this.ctx = null;
    this.vol = { master: 0.8, music: 0.7, sfx: 0.9 };
    this.tension = 0;
    this.listener = { x: 0, y: 0, z: 0, yaw: 0, indoors: false };
    this.monster = null;          // {x, y, z} of its head, for the breathing growl (null: not about)
    this.voiceOn = true;          // the monster talks
    this.onSubtitle = null;       // (text) => void
    this.live = 0;                // positioned sounds playing (HRTF is dear: past a dozen, cheaper panning)
    this.paused = false;
    this.body = { alive: false, exert: 0, fear: 0, hp: 100, tired: false, crouch: false, still: true };
    this.breathT = 0; this.beatT = 0; this.eventT = 6; this.gustT = 2; this.chaseK = 0;
  }

  // ctx: optional, for rendering offline in tests
  init(ctx) {
    if (this.ctx) { if (this.ctx.state === 'suspended' && this.ctx.resume) this.ctx.resume(); return; }
    const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    if (!ctx && !AC) return;
    const c = this.ctx = ctx || new AC({ latencyHint: 'interactive' });
    // master -> gentle limiter -> out. A pause duck sits in front of everything but the menus.
    this.master = c.createGain();
    const lim = c.createDynamicsCompressor();
    lim.threshold.value = -9; lim.knee.value = 6; lim.ratio.value = 10; lim.attack.value = 0.004; lim.release.value = 0.3;
    this.master.connect(lim); lim.connect(c.destination);
    this.duck = c.createGain(); this.duck.connect(this.master);
    this.uiG = c.createGain(); this.uiG.connect(this.master);
    this.sfxG = c.createGain(); this.sfxG.connect(this.duck);
    this.musG = c.createGain(); this.musG.connect(this.duck);
    this.bodyG = c.createGain(); this.bodyG.gain.value = 1; this.bodyG.connect(this.sfxG);
    // noise
    const sr = c.sampleRate, n = sr * 3;
    const mk = (fill) => { const b = c.createBuffer(1, n, sr), d = b.getChannelData(0); fill(d); return b; };
    this.white = mk((d) => { for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1; });
    this.pink = mk((d) => {
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0;
      for (let i = 0; i < n; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + w * 0.5362) * 0.11;
      }
    });
    this.brown = mk((d) => { let l = 0; for (let i = 0; i < n; i++) { l = (l + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = l * 3.5; } });
    // soft clipping for throats
    this.curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = (i / 1023) * 2 - 1; this.curve[i] = Math.tanh(x * 3.2) / Math.tanh(3.2); }
    // reverbs: the street (two facades 16 m apart: a fluttering slap, then a long dark tail) and a room
    const flutter = [];
    for (let k = 1; k < 14; k++) flutter.push([k * (2 * K.FRONT / 343) + rnd(-0.002, 0.002), 0.5 * Math.pow(0.72, k)]);
    this.revOut = c.createConvolver(); this.revOut.buffer = this.ir(3.2, 3.0, 2.2, flutter.concat([[0.11, 0.25], [0.19, 0.18]]));
    this.revIn = c.createConvolver(); this.revIn.buffer = this.ir(0.75, 2.4, 1.2, [[0.007, 0.6], [0.013, 0.45], [0.021, 0.35], [0.029, 0.25], [0.041, 0.2]]);
    this.revOutG = c.createGain(); this.revOutG.gain.value = 0.55; this.revOut.connect(this.revOutG); this.revOutG.connect(this.sfxG);
    this.revInG = c.createGain(); this.revInG.gain.value = 0.42; this.revIn.connect(this.revInG); this.revInG.connect(this.sfxG);
    this.applyVol();
    this.startAmbience();
    // the browser loads its speech voices lazily: ask now so they are there when the thing first talks
    try { if (typeof speechSynthesis !== 'undefined') { speechSynthesis.getVoices(); speechSynthesis.onvoiceschanged = () => speechSynthesis.getVoices(); } } catch {}
  }

  // impulse response: dark noise tail (highs die first) plus discrete early reflections
  ir(sec, decay, damp, early) {
    const c = this.ctx, sr = c.sampleRate, n = Math.floor(sr * sec), b = c.createBuffer(2, n, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / n, k = 0.06 + 0.88 * Math.pow(1 - t, damp);
        lp += ((Math.random() * 2 - 1) - lp) * k;
        d[i] = lp * Math.pow(1 - t, decay) * Math.min(1, i / (sr * 0.012));
      }
      for (const [time, amp] of early) {
        const j = Math.floor(time * sr) + (ch ? Math.floor(sr * 0.0023) : 0);
        for (let q = 0; q < 24 && j + q < n; q++) d[j + q] += amp * (ch ? -1 : 1) * (1 - q / 24) * (q % 2 ? -0.6 : 1);
      }
    }
    return b;
  }

  applyVol() {
    if (!this.ctx) return;
    this.master.gain.value = this.vol.master; this.sfxG.gain.value = this.vol.sfx; this.musG.gain.value = this.vol.music; this.uiG.gain.value = this.vol.sfx * 0.8;
  }

  // the game is paused: the world goes quiet and far away, the monster stops talking
  setPaused(p) {
    if (!this.ctx || this.paused === p) return;
    this.paused = p;
    this.duck.gain.setTargetAtTime(p ? 0.12 : 1, this.ctx.currentTime, 0.15);
    if (p) this.hush();
  }
  hush() { try { if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel(); } catch {} }

  src(buf, loop = false) { const s = this.ctx.createBufferSource(); s.buffer = buf || this.white; s.loop = loop; return s; }

  // ------------------------------------------------------------------ ambience
  startAmbience() {
    const c = this.ctx, t = c.currentTime;
    // wind: a low rush and a thin whistle through the gaps; gusts are scheduled from update()
    this.windF = c.createBiquadFilter(); this.windF.type = 'lowpass'; this.windF.frequency.value = 380; this.windF.Q.value = 0.6;
    this.windG = c.createGain(); this.windG.gain.value = 0.14;
    const w = this.src(this.brown, true); w.connect(this.windF); this.windF.connect(this.windG); this.windG.connect(this.musG); w.start(t, rnd(0, 2));
    this.whistF = c.createBiquadFilter(); this.whistF.type = 'bandpass'; this.whistF.frequency.value = 1100; this.whistF.Q.value = 14;
    this.whistG = c.createGain(); this.whistG.gain.value = 0.0;
    const w2 = this.src(this.pink, true); w2.connect(this.whistF); this.whistF.connect(this.whistG); this.whistG.connect(this.musG); this.whistG.connect(this.revOut); w2.start(t, rnd(0, 2));
    // drone: two low tones a few cents apart beat slowly against each other, under a dark fifth
    this.droneG = c.createGain(); this.droneG.gain.value = 0.35;
    const dl = c.createBiquadFilter(); dl.type = 'lowpass'; dl.frequency.value = 220; dl.connect(this.droneG); this.droneG.connect(this.musG);
    for (const [f, g, type] of [[36.7, 0.3, 'sine'], [36.95, 0.26, 'sine'], [55.1, 0.09, 'triangle'], [73.4, 0.05, 'sawtooth'], [77.8, 0.035, 'sawtooth']]) {
      const o = c.createOscillator(), og = c.createGain(); o.type = type; o.frequency.value = f; og.gain.value = g;
      const l = c.createOscillator(), lg = c.createGain(); l.frequency.value = rnd(0.03, 0.09); lg.gain.value = g * 0.6; l.connect(lg); lg.connect(og.gain);
      o.connect(og); og.connect(dl); o.start(t); l.start(t);
    }
    // tension: a dark, slowly breathing string cluster, with a thin high tremolo that only comes in when it is close
    this.tenG = c.createGain(); this.tenG.gain.value = 0;
    this.tenF = c.createBiquadFilter(); this.tenF.type = 'lowpass'; this.tenF.frequency.value = 500; this.tenF.Q.value = 0.7;
    for (const f of [130.8, 138.6, 196, 207.7, 261.6, 277.2]) {
      for (const det of [-9, 7]) {
        const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det + rnd(-3, 3);
        const v = c.createOscillator(), vg = c.createGain(); v.frequency.value = rnd(4.5, 6); vg.gain.value = 5; v.connect(vg); vg.connect(o.detune);
        const og = c.createGain(); og.gain.value = 0.05; o.connect(og); og.connect(this.tenF); o.start(t); v.start(t);
      }
    }
    this.tenF.connect(this.tenG); this.tenG.connect(this.musG); this.tenG.connect(this.revOut);
    this.highG = c.createGain(); this.highG.gain.value = 0;
    const hf = c.createBiquadFilter(); hf.type = 'bandpass'; hf.frequency.value = 2400; hf.Q.value = 2.5;
    const trem = c.createGain(); trem.gain.value = 0.5;
    const tl = c.createOscillator(), tlg = c.createGain(); tl.frequency.value = 9; tlg.gain.value = 0.5; tl.connect(tlg); tlg.connect(trem.gain); tl.start(t);
    for (const f of [1567, 1661, 2349]) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = rnd(-10, 10); const g = c.createGain(); g.gain.value = 0.04; o.connect(g); g.connect(hf); o.start(t); }
    hf.connect(trem); trem.connect(this.highG); this.highG.connect(this.musG); this.highG.connect(this.revOut);
    // a sour rising pair while it charges
    this.chaseG = c.createGain(); this.chaseG.gain.value = 0; this.chaseG.connect(this.musG); this.chaseG.connect(this.revOut);
    this.chaseO = [0, 1].map((i) => { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = i ? 98 : 92.5; const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900; o.connect(f); f.connect(this.chaseG); o.start(t); return o; });
    // the monster's breathing growl: noise and a rough low pulse through a big throat, gated by its breath.
    // It is placed where the monster is, every frame.
    this.growlPan = this.panner(true); this.growlPan.connect(this.sfxG);
    this.growlLP = c.createBiquadFilter(); this.growlLP.type = 'lowpass'; this.growlLP.frequency.value = 2400; this.growlLP.connect(this.growlPan);
    this.growlG = c.createGain(); this.growlG.gain.value = 0; this.growlG.connect(this.growlLP);
    this.growlWet = c.createGain(); this.growlWet.gain.value = 0; this.growlG.connect(this.growlWet); this.growlWet.connect(this.revOut);
    this.growlBreath = c.createGain(); this.growlBreath.gain.value = 0; this.growlBreath.connect(this.growlG);
    const throat = c.createWaveShaper(); throat.curve = this.curve; throat.connect(this.growlBreath);
    const fry = c.createOscillator(); fry.type = 'sawtooth'; fry.frequency.value = 34;
    const jit = this.src(this.brown, true), jg = c.createGain(); jg.gain.value = 14; jit.connect(jg); jg.connect(fry.frequency);
    const fryG = c.createGain(); fryG.gain.value = 0.55; fry.connect(fryG);
    const gn = this.src(this.pink, true), gnG = c.createGain(); gnG.gain.value = 0.9; gn.connect(gnG);
    for (const [f, q, g] of [[260, 4, 1], [620, 6, 0.6], [1250, 8, 0.25]]) { const b = c.createBiquadFilter(); b.type = 'bandpass'; b.frequency.value = f; b.Q.value = q; const bg = c.createGain(); bg.gain.value = g; fryG.connect(b); gnG.connect(b); b.connect(bg); bg.connect(throat); }
    fry.start(t); jit.start(t, rnd(0, 2)); gn.start(t, rnd(0, 2));
    this.growlPhase = 0;
  }

  // a panner placed relative to the listener (we do our own distance curve)
  panner(hrtf) {
    const p = this.ctx.createPanner();
    p.panningModel = hrtf ? 'HRTF' : 'equalpower'; p.distanceModel = 'linear'; p.refDistance = 1; p.maxDistance = 1e4; p.rolloffFactor = 0;
    return p;
  }
  // direction of a world point in the listener's frame: x right, y up, z towards the back
  rel(x, y, z) {
    const L = this.listener, dx = x - L.x, dy = y - L.y, dz = z - L.z, s = Math.sin(L.yaw), co = Math.cos(L.yaw);
    const rx = co * dx - s * dz, fz = s * dx + co * dz, d = Math.hypot(dx, dy, dz) || 1e-3;
    return { x: rx / d, y: dy / d, z: fz / d, d };
  }
  place(p, x, y, z) {
    const r = this.rel(x, y, z);
    if (p.positionX) { const t = this.ctx.currentTime; p.positionX.setValueAtTime(r.x, t); p.positionY.setValueAtTime(r.y, t); p.positionZ.setValueAtTime(r.z, t); } else p.setPosition(r.x, r.y, r.z);
    return r;
  }
  // a wall between the listener and the sound? (inside a building vs out in the street)
  outside(x, y, z) { return Math.abs(z) < K.FRONT - 0.2 || y > 30; }
  occluded(x, y, z) { return this.listener.indoors === this.outside(x, y, z); }

  // ------------------------------------------------------------------ every frame
  // tension 0..1, monsterDist (m), charging: it is running at someone
  update(dt, tension, monsterDist, charging) {
    if (!this.ctx) return;
    const c = this.ctx, now = c.currentTime, L = this.listener;
    this.tension += (tension - this.tension) * Math.min(1, dt * 1.2);
    const T = this.tension;
    this.tenG.gain.setTargetAtTime(0.04 + T * T * 0.45, now, 0.4);
    this.tenF.frequency.setTargetAtTime(380 + T * 1500, now, 0.5);
    this.highG.gain.setTargetAtTime(T > 0.55 ? (T - 0.55) * 0.5 : 0, now, 0.3);
    this.droneG.gain.setTargetAtTime(0.35 + T * 0.35, now, 0.8);
    // indoors the wind is a muffled moan behind the glass
    this.windF.frequency.setTargetAtTime(L.indoors ? 170 : 420, now, 0.6);
    this.gustT -= dt;
    if (this.gustT <= 0) {
      this.gustT = rnd(3, 9);
      const peak = rnd(0.12, 0.3) * (L.indoors ? 0.55 : 1), dur = rnd(1.5, 4);
      this.windG.gain.setTargetAtTime(peak, now, dur * 0.35); this.windG.gain.setTargetAtTime(0.1 * (L.indoors ? 0.6 : 1), now + dur, dur * 0.5);
      if (Math.random() < 0.45) { const f = rnd(700, 1600); this.whistF.frequency.setTargetAtTime(f, now, 0.6); this.whistF.frequency.setTargetAtTime(f * rnd(0.7, 1.3), now + dur * 0.6, 0.8); this.whistG.gain.setTargetAtTime(L.indoors ? 0.05 : 0.025, now, dur * 0.3); this.whistG.gain.setTargetAtTime(0, now + dur, 0.6); }
    }
    // the monster's breath
    const near = clamp(1 - monsterDist / 55, 0, 1);
    if (this.monster && near > 0) {
      const m = this.monster, r = this.place(this.growlPan, m.x, m.y, m.z), occ = this.occluded(m.x, m.y, m.z);
      this.growlPhase += dt * (charging ? 0.55 : 0.22);
      const ph = this.growlPhase % 1, breath = ph < 0.38 ? Math.sin((ph / 0.38) * Math.PI) * 0.45 : Math.pow(Math.sin(((ph - 0.38) / 0.62) * Math.PI), 0.7);
      this.growlBreath.gain.setTargetAtTime(breath, now, 0.08);
      this.growlG.gain.setTargetAtTime(near * near * (charging ? 0.9 : 0.6) * (occ ? 0.55 : 1), now, 0.12);
      this.growlLP.frequency.setTargetAtTime((occ ? 600 : 3200) * (0.35 + near * 0.65), now, 0.2);
      this.growlWet.gain.setTargetAtTime(0.25 + (1 - near) * 0.5, now, 0.3);
      void r;
    } else this.growlG.gain.setTargetAtTime(0, now, 0.3);
    this.chaseK += ((charging ? 1 : 0) - this.chaseK) * Math.min(1, dt * 1.5);
    this.chaseG.gain.setTargetAtTime(this.chaseK * 0.06 * (0.4 + near), now, 0.15);
    this.chaseO.forEach((o, i) => o.frequency.setTargetAtTime((i ? 98 : 92.5) * (1 + this.chaseK * 0.5), now, 0.6));
    this.updateBody(dt);
    if (this.paused) return;
    this.eventT -= dt;
    if (this.eventT <= 0) { this.eventT = rnd(5, 14) * (1.2 - T * 0.5); this.randomEvent(); }
  }

  // ------------------------------------------------------------------ the player's body
  // s: {alive, exert 0..1 (how winded), fear 0..1, hp, tired, crouch, still}
  setBody(s) { Object.assign(this.body, s); }
  updateBody(dt) {
    const b = this.body;
    if (!b.alive || this.paused) { this.breathT = 0.5; return; }
    const lowHp = clamp((45 - b.hp) / 45, 0, 1);
    // heart: 62 bpm calm, up past 160 running scared
    const bpm = clamp(62 + b.fear * 85 + b.exert * 45 + lowHp * 20, 55, 175);
    const loud = clamp(b.fear * 1.05 + b.exert * 0.35 + lowHp * 0.6 - 0.12, 0, 1);
    this.beatT -= dt;
    if (this.beatT <= 0) {
      const period = 60 / bpm;
      this.beatT = period * rnd(0.97, 1.03);
      if (loud > 0.02) { this.heartbeat(loud, period); }
    }
    // breath: slow and nearly silent at rest, ragged panting when winded, shaking and held when hiding scared
    this.breathT -= dt;
    if (this.breathT <= 0) {
      const e = b.exert, hold = b.crouch && b.still && b.fear > 0.35;
      const rate = 13 + e * 34 + b.fear * 10 + (b.tired ? 8 : 0);       // breaths a minute
      const cyc = 60 / rate;
      this.breathT = cyc * rnd(0.9, 1.15) * (hold ? 1.6 : 1);
      const v = clamp(0.06 + e * 0.75 + b.fear * 0.2 + (b.tired ? 0.25 : 0), 0, 1) * (hold ? 0.45 : 1);
      this.breathe(cyc, v, { tired: b.tired || e > 0.8, shaky: b.fear > 0.5 || hold, wheeze: lowHp > 0.4 });
    }
  }
  heartbeat(v, period) {
    const c = this.ctx, t = c.currentTime + 0.02, out = c.createGain();
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 160 + v * 120;
    out.gain.value = 0.55 * v; lp.connect(out); out.connect(this.bodyG);
    const thump = (at, f, a) => {
      const o = c.createOscillator(), g = c.createGain();
      o.frequency.setValueAtTime(f, at); o.frequency.exponentialRampToValueAtTime(f * 0.55, at + 0.14);
      g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(a, at + 0.012); g.gain.exponentialRampToValueAtTime(0.0005, at + 0.2);
      o.connect(g); g.connect(lp); o.start(at); o.stop(at + 0.25);
      const n = this.src(this.brown), ng = c.createGain();
      ng.gain.setValueAtTime(a * 0.5, at); ng.gain.exponentialRampToValueAtTime(0.0005, at + 0.09);
      n.connect(ng); ng.connect(lp); n.start(at, rnd(0, 2)); n.stop(at + 0.12);
    };
    thump(t, 58, 1); thump(t + Math.min(0.3, period * 0.32), 72, 0.6);
  }
  // one breath: in through the mouth (higher, softer), out (lower, louder)
  breathe(cyc, v, o) {
    if (v < 0.02) return;
    const c = this.ctx, t = c.currentTime + 0.01, inD = cyc * (o.tired ? 0.36 : 0.4), outD = cyc * (o.tired ? 0.48 : 0.5);
    const out = c.createGain(); out.gain.value = v * 0.3; out.connect(this.bodyG);
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 280; hp.connect(out);
    const air = (start, dur, f0, f1, a, q) => {
      const n = this.src(this.pink), f = c.createBiquadFilter(), f2 = c.createBiquadFilter(), g = c.createGain();
      f.type = 'bandpass'; f.Q.value = q; f.frequency.setValueAtTime(f0, start); f.frequency.linearRampToValueAtTime(f1, start + dur);
      f2.type = 'peaking'; f2.frequency.value = f0 * 2.1; f2.gain.value = 6; f2.Q.value = 2;
      g.gain.setValueAtTime(0.0001, start); g.gain.linearRampToValueAtTime(a, start + dur * 0.3); g.gain.linearRampToValueAtTime(a * 0.8, start + dur * 0.65); g.gain.linearRampToValueAtTime(0.0001, start + dur);
      if (o.shaky) for (let k = 1; k < 6; k++) g.gain.setValueAtTime(a * (k % 2 ? 0.45 : 0.9), start + dur * (0.3 + k * 0.1));
      n.connect(f); f.connect(f2); f2.connect(g); g.connect(hp); n.start(start, rnd(0, 2.5)); n.stop(start + dur + 0.05);
    };
    air(t, inD, 1500, 1900, 0.5, 1.2);
    air(t + inD + cyc * 0.03, outD, 900, 620, 1, 1.0);
    if (o.tired) {   // a voiced edge on the out-breath: "hhuh"
      const s = t + inD + cyc * 0.03, osc = c.createOscillator(), g = c.createGain(), f = c.createBiquadFilter();
      osc.type = 'sawtooth'; osc.frequency.setValueAtTime(rnd(125, 150), s); osc.frequency.linearRampToValueAtTime(rnd(95, 110), s + outD);
      f.type = 'bandpass'; f.frequency.value = 650; f.Q.value = 3;
      g.gain.setValueAtTime(0.0001, s); g.gain.linearRampToValueAtTime(0.09, s + outD * 0.15); g.gain.exponentialRampToValueAtTime(0.0005, s + outD * 0.7);
      osc.connect(f); f.connect(g); g.connect(hp); osc.start(s); osc.stop(s + outD);
    }
    if (o.wheeze) air(t, inD, 2600, 2900, 0.25, 9);
  }

  // ------------------------------------------------------------------ the dark
  randomEvent() {
    const c = this.ctx, L = this.listener, r = Math.random();
    const a = Math.random() * Math.PI * 2, far = rnd(25, 70);
    const at = { x: L.x + Math.cos(a) * far, y: L.y + rnd(-1, 8), z: L.z + Math.sin(a) * far };
    const dest = this.spot(at.x, at.y, at.z, 0.9, true, this.musG);
    const t = c.currentTime;
    if (r < 0.16) {             // a long metal groan somewhere in the buildings
      const o = c.createOscillator(), m = c.createOscillator(), mg = c.createGain(), g = c.createGain(), f = c.createBiquadFilter();
      const f0 = rnd(55, 120), dur = rnd(2.5, 4.5);
      o.type = 'sawtooth'; o.frequency.setValueAtTime(f0, t); o.frequency.linearRampToValueAtTime(f0 * rnd(0.6, 1.3), t + dur);
      m.frequency.value = f0 * 1.507; mg.gain.value = f0 * 0.6; m.connect(mg); mg.connect(o.frequency);
      f.type = 'bandpass'; f.frequency.value = rnd(300, 700); f.Q.value = 5;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.12, t + dur * 0.35); g.gain.linearRampToValueAtTime(0, t + dur);
      o.connect(f); f.connect(g); g.connect(dest); o.start(t); m.start(t); o.stop(t + dur); m.stop(t + dur);
    } else if (r < 0.34) {      // water dripping somewhere close by
      const d2 = this.spot(L.x + rnd(-6, 6), L.y + rnd(0, 2), L.z + rnd(-6, 6), 0.6, false, this.musG);
      const n = 3 + ((Math.random() * 5) | 0), f0 = rnd(1400, 2600), gap = rnd(0.5, 1.4);
      for (let i = 0; i < n; i++) {
        const s = t + i * gap * rnd(0.85, 1.15), o = c.createOscillator(), g = c.createGain();
        o.frequency.setValueAtTime(f0 * rnd(0.95, 1.05), s); o.frequency.exponentialRampToValueAtTime(f0 * 0.45, s + 0.05);
        g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(0.16, s + 0.003); g.gain.exponentialRampToValueAtTime(0.0005, s + 0.09);
        o.connect(g); g.connect(d2); o.start(s); o.stop(s + 0.1);
      }
    } else if (r < 0.46) {      // thunder, far off
      const n = this.src(this.brown), f = c.createBiquadFilter(), g = c.createGain(), dur = rnd(4, 7);
      f.type = 'lowpass'; f.frequency.setValueAtTime(700, t); f.frequency.exponentialRampToValueAtTime(90, t + dur);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.5, t + 0.3); for (let k = 1; k < 5; k++) g.gain.linearRampToValueAtTime(rnd(0.15, 0.45), t + k * dur / 6); g.gain.linearRampToValueAtTime(0, t + dur);
      n.connect(f); f.connect(g); g.connect(this.musG); g.connect(this.revOut); n.start(t, rnd(0, 1)); n.stop(t + dur);
    } else if (r < 0.58) {      // the building settles: a slow wooden creak
      this.creak(t, this.spot(L.x + rnd(-8, 8), L.y + rnd(1, 4), L.z + rnd(-8, 8), 0.7, false, this.musG), rnd(0.8, 1.8), 0.3);
    } else if (r < 0.68) {      // something wailing a long way off (a dog? it does not sound like a dog)
      this.throat(t, dest, { f0: rnd(380, 520), f1: rnd(260, 340), dur: rnd(2, 3.2), vowels: ['u', 'o', 'u'], v: 0.18, breath: 0.4, vib: 6 });
    } else if (r < 0.78) {      // chains, or something metal dragged
      for (let i = 0; i < 14; i++) { const s = t + i * rnd(0.05, 0.14); this.N(dest, s, 0.03, 'bandpass', rnd(3000, 6000), 0, 9, 0.25 * rnd(0.4, 1)); this.O(dest, s, 0.12, 'sine', rnd(2100, 3400), 0, 0.03); }
    } else if (r < 0.88) {      // whispering
      this.whisper(t, this.spot(L.x + rnd(-5, 5), L.y + 1.5, L.z + rnd(-5, 5), 0.5, false, this.musG), 0.5);
    } else if (r < 0.95) {      // a music box, far away, out of tune
      const notes = [659.3, 587.3, 523.3, 493.9, 523.3, 440, 392, 415.3];
      const st = (Math.random() * 3) | 0;
      for (let i = 0; i < 5; i++) {
        const f = notes[(st + i) % notes.length] * rnd(0.985, 1.0), s = t + 0.05 + i * 0.42 + rnd(-0.02, 0.04);
        for (const [m, g] of [[1, 0.06], [2.76, 0.02], [5.4, 0.008]]) this.O(dest, s, 1.6, 'sine', f * m, 0, g);
      }
    } else {                    // a scream, cut off
      this.throat(t, dest, { f0: rnd(650, 800), f1: rnd(900, 1100), dur: rnd(0.8, 1.4), vowels: ['a', 'e'], v: 0.2, breath: 0.35, vib: 9, cut: true });
    }
  }

  // an output placed at a world point: gain for distance (0..1 of max), panning, wall muffling, reverb send.
  // Returns the node to connect into, or null if it cannot be heard.
  spot(x, y, z, k = 1, far = false, bus = null) {
    const c = this.ctx, r = this.rel(x, y, z), occ = this.occluded(x, y, z);
    const hrtf = this.live < 14;
    const p = this.panner(hrtf); this.place(p, x, y, z);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.value = (occ ? 900 : 18000) * (far ? 0.45 : 1);
    const g = c.createGain(); g.gain.value = k * (occ ? 0.5 : 1);
    g.connect(lp); lp.connect(p); p.connect(bus || this.sfxG);
    const wet = c.createGain(); wet.gain.value = far ? 1.1 : 0.45; lp.connect(wet); wet.connect(this.outside(x, y, z) ? this.revOut : this.revIn);
    void r;
    return g;
  }

  // ------------------------------------------------------------------ building blocks
  N(out, s, dur, type, f0, f1, q, v, buf) {
    const c = this.ctx, n = this.src(buf || this.white), f = c.createBiquadFilter(), g = c.createGain();
    f.type = type; f.frequency.setValueAtTime(f0, s); if (f1) f.frequency.exponentialRampToValueAtTime(f1, s + dur); f.Q.value = q;
    g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, v), s + Math.min(0.006, dur * 0.2)); g.gain.exponentialRampToValueAtTime(0.0002, s + dur);
    n.connect(f); f.connect(g); g.connect(out); n.start(s, rnd(0, 2.5)); n.stop(s + dur + 0.05);
    return g;
  }
  O(out, s, dur, type, f0, f1, v, att = 0.004) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, s); if (f1) o.frequency.exponentialRampToValueAtTime(f1, s + dur);
    g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, v), s + att); g.gain.exponentialRampToValueAtTime(0.0002, s + dur);
    o.connect(g); g.connect(out); o.start(s); o.stop(s + dur + 0.05);
    return o;
  }
  // a voice: buzzing source through three formant filters that glide through the given vowels
  throat(s, out, o) {
    const c = this.ctx, dur = o.dur, sc = o.size || 1;
    const src = c.createOscillator(); src.type = 'sawtooth';
    src.frequency.setValueAtTime(o.f0, s); src.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), s + dur);
    const vib = c.createOscillator(), vg = c.createGain(); vib.frequency.value = o.vib || 5; vg.gain.value = o.f0 * 0.025; vib.connect(vg); vg.connect(src.frequency);
    const mix = c.createGain(); mix.gain.value = 1;
    let shaper = null;
    if (o.rough) { shaper = c.createWaveShaper(); shaper.curve = this.curve; src.connect(shaper); shaper.connect(mix); } else src.connect(mix);
    if (o.sub) { const sub = c.createOscillator(); sub.type = 'square'; sub.frequency.setValueAtTime(o.f0 / 2, s); sub.frequency.exponentialRampToValueAtTime(Math.max(15, o.f1 / 2), s + dur); const sg = c.createGain(); sg.gain.value = o.sub; sub.connect(sg); sg.connect(shaper || mix); sub.start(s); sub.stop(s + dur + 0.1); }
    if (o.breath) { const n = this.src(this.pink), ng = c.createGain(); ng.gain.value = o.breath * 3; n.connect(ng); ng.connect(mix); n.start(s, rnd(0, 2)); n.stop(s + dur + 0.1); }
    const env = c.createGain();
    env.gain.setValueAtTime(0.0001, s); env.gain.exponentialRampToValueAtTime(o.v, s + (o.att || Math.min(0.15, dur * 0.2)));
    if (o.cut) env.gain.setValueAtTime(o.v, s + dur * 0.92); else env.gain.exponentialRampToValueAtTime(o.v * 0.6, s + dur * 0.7);
    env.gain.exponentialRampToValueAtTime(0.0002, s + dur);
    env.connect(out);
    const vs = o.vowels.map((k) => VOW[k] || VOW.a);
    [1, 0.5, 0.22].forEach((amp, fi) => {
      const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = [6, 9, 11][fi];
      vs.forEach((v, i) => { const tt = s + (vs.length > 1 ? (i / (vs.length - 1)) * dur : 0); if (i === 0) f.frequency.setValueAtTime(v[fi] * sc, tt); else f.frequency.linearRampToValueAtTime(v[fi] * sc, tt); });
      const g = c.createGain(); g.gain.value = amp * 2.2; mix.connect(f); f.connect(g); g.connect(env);
    });
    src.start(s); vib.start(s); src.stop(s + dur + 0.1); vib.stop(s + dur + 0.1);
  }
  // friction: a rough pulse train that slips and sticks, through the resonance of a wooden panel
  creak(s, out, dur, v, f0 = rnd(9, 22)) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain(), b1 = c.createBiquadFilter(), b2 = c.createBiquadFilter();
    o.type = 'sawtooth'; o.frequency.setValueAtTime(f0, s);
    for (let k = 1; k <= 8; k++) o.frequency.linearRampToValueAtTime(f0 * rnd(0.6, 2.4), s + (k / 8) * dur);
    b1.type = 'bandpass'; b1.frequency.value = rnd(500, 900); b1.Q.value = 8; b2.type = 'bandpass'; b2.frequency.value = rnd(1400, 2200); b2.Q.value = 10;
    g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(v, s + dur * 0.15); g.gain.setValueAtTime(v * 0.8, s + dur * 0.8); g.gain.exponentialRampToValueAtTime(0.0002, s + dur);
    o.connect(b1); o.connect(b2); b1.connect(g); b2.connect(g); g.connect(out); o.start(s); o.stop(s + dur + 0.05);
  }
  whisper(s, out, v) {
    const seq = ['i', 'u', 'a', 'e', 'o', 'u', 'i', 'a'];
    let tt = s;
    for (let i = 0; i < 6 + ((Math.random() * 6) | 0); i++) {
      const d = rnd(0.09, 0.22), vw = VOW[pick(seq)];
      for (let fi = 0; fi < 2; fi++) this.N(out, tt, d, 'bandpass', vw[fi] * 1.15, vw[fi] * rnd(0.9, 1.15), 7, v * (fi ? 0.6 : 1), this.pink);
      if (Math.random() < 0.4) this.N(out, tt + d * 0.6, 0.06, 'highpass', 5000, 0, 1, v * 0.18);   // an 's'
      tt += d + rnd(0.02, 0.12);
    }
  }
  // falling bits: grit and small pieces landing for a while after something breaks
  trickle(out, s, dur, n, v, lo = 1500, hi = 5000) {
    for (let i = 0; i < n; i++) { const tt = s + Math.pow(Math.random(), 1.6) * dur; this.N(out, tt, rnd(0.02, 0.07), 'bandpass', rnd(lo, hi), 0, rnd(2, 6), v * rnd(0.2, 1)); }
  }
  bell(out, s, f, v) {
    for (const [m, g, d] of [[0.5, 0.5, 6], [1, 1, 5], [1.19, 0.5, 4], [1.56, 0.4, 3.5], [2, 0.35, 3], [2.66, 0.25, 2.5], [3.01, 0.2, 2], [4.1, 0.1, 1.5]]) this.O(out, s, d, 'sine', f * m, 0, v * g * 0.25, 0.002);
  }

  // ------------------------------------------------------------------ one-shots
  // name, volume, optional world position {x,y,z,max}
  play(name, vol = 1, pos) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime + 0.005;
    let out, far = 0, k = 1;
    if (pos) {
      const max = pos.max || 40, r = this.rel(pos.x, pos.y, pos.z);
      if (r.d > max) return;
      far = r.d / max; k = Math.pow(1 - far, 1.6) * vol;
      if (k < 0.004) return;
      out = this.spot(pos.x, pos.y, pos.z, k, far > 0.5);
      this.live++; setTimeout(() => { this.live--; }, 1500);
    } else {
      out = c.createGain(); out.gain.value = vol;
      out.connect(name === 'ui' ? this.uiG : this.sfxG);
      if (name !== 'ui') { const wet = c.createGain(); wet.gain.value = 0.25; out.connect(wet); wet.connect(this.listener.indoors ? this.revIn : this.revOut); }
    }
    // per-sound trim, so the quiet things (your own feet, a click) sit at a sensible level against the big ones
    const TRIM = { step: 2.6, throw: 4, pick: 3, empty: 2.2, torch: 2, gasp: 3, reach: 2.5, woodbreak: 2, ui: 1.6, skitter: 1.6, closet: 1.4 };
    if (TRIM[name]) out.gain.value *= TRIM[name];
    const N = (...a) => this.N(out, t + (a[6] || 0), a[0], a[1], a[2], a[3], a[4], a[5], a[7]);
    const O = (dur, type, f0, f1, v, delay = 0, att) => this.O(out, t + delay, dur, type, f0, f1, v, att);
    const indoors = this.listener.indoors;
    switch (name) {
      // ---- you
      case 'step':
        if (indoors) {        // boards: a dull thump, sometimes a creak
          O(0.09, 'sine', rnd(85, 110), 55, 0.5); N(0.07, 'lowpass', rnd(700, 1000), 200, 1, 0.45, 0, this.pink); N(0.03, 'bandpass', rnd(2000, 3000), 0, 2, 0.12, 0.01);
          if (Math.random() < 0.18) this.creak(t + 0.02, out, rnd(0.15, 0.3), 0.12, rnd(25, 45));
        } else {              // concrete and grit: heel, then the sole rolling off
          N(0.05, 'bandpass', rnd(1800, 3200), 0, 1.2, 0.35); N(0.08, 'lowpass', rnd(500, 800), 150, 1, 0.5, 0, this.pink); O(0.06, 'sine', rnd(70, 90), 45, 0.3);
          N(0.06, 'highpass', rnd(3500, 6000), 0, 1, 0.12, rnd(0.04, 0.07));
        }
        break;
      case 'land': O(0.2, 'sine', 75, 32, 0.9); N(0.22, 'lowpass', 900, 90, 1, 0.9, 0, this.pink); N(0.15, 'bandpass', 2400, 900, 1.5, 0.3, 0.01); N(0.25, 'highpass', 1800, 0, 0.7, 0.12, 0.04, this.pink); break;
      case 'door':          // latch, the hinge complains, the leaf knocks the frame
        N(0.02, 'bandpass', 3200, 0, 5, 0.5); O(0.03, 'square', 1800, 900, 0.08);
        this.creak(t + 0.04, out, rnd(0.45, 0.8), 0.32);
        O(0.16, 'sine', 120, 60, 0.45, 0.62); N(0.1, 'lowpass', 900, 120, 1, 0.4, 0.62, this.pink); break;
      case 'closet': this.creak(t, out, rnd(0.3, 0.5), 0.22, rnd(18, 30)); O(0.1, 'sine', 160, 80, 0.3, 0.4); N(0.06, 'lowpass', 1100, 200, 1, 0.3, 0.4, this.pink); break;
      case 'doorslam': O(0.3, 'sine', 90, 36, 1); N(0.35, 'lowpass', 1600, 90, 0.8, 1.1, 0, this.pink); N(0.05, 'bandpass', 2600, 0, 3, 0.5); this.creak(t + 0.05, out, 0.3, 0.12, 30); break;
      case 'torch': N(0.012, 'bandpass', 4200, 0, 6, 0.45); O(0.015, 'square', 2600, 1800, 0.05); N(0.012, 'bandpass', 3400, 0, 6, 0.3, 0.07); break;
      case 'gun':           // the crack, the boom off the facades, then the flare burning off
        N(0.025, 'highpass', 2500, 0, 0.7, 1.4); N(0.5, 'lowpass', 5000, 160, 0.7, 1.3, 0.005, this.pink); O(0.35, 'sine', 140, 38, 1.2);
        N(1.4, 'bandpass', 3000, 2200, 2, 0.18, 0.08); this.trickle(out, t + 0.1, 1.2, 10, 0.06, 4000, 8000); break;
      case 'empty': N(0.015, 'bandpass', 3500, 0, 5, 0.4); O(0.02, 'square', 1700, 900, 0.06); break;
      case 'pick': N(0.12, 'bandpass', 2400, 1200, 1.5, 0.2, 0, this.pink); O(0.08, 'triangle', 1200, 1500, 0.06, 0.05); break;
      case 'star': [880, 1318.5, 1760, 2637].forEach((f, i) => { O(1.4, 'sine', f, 0, 0.1 / (i + 1), i * 0.07); O(1.2, 'sine', f * 1.003, 0, 0.05 / (i + 1), i * 0.07 + 0.01); }); break;
      case 'channel': [660, 990, 1320].forEach((f, i) => O(1.1, 'sine', f, f * 1.5, 0.04, i * 0.12, 0.2)); N(1.1, 'bandpass', 2000, 6000, 6, 0.06, 0, this.pink); break;
      case 'starcry':       // the star cries out: a thin voice that is not a voice
        this.throat(t, out, { f0: 980, f1: 1240, dur: 1.5, vowels: ['i', 'e', 'i'], v: 0.12, breath: 0.2, vib: 11 });
        [1760, 2217, 2637].forEach((f, i) => O(1.6, 'sine', f, f * 0.97, 0.05, i * 0.05)); break;
      case 'throw': N(0.22, 'bandpass', 500, 2200, 2, 0.3, 0, this.pink); break;
      case 'hurt':          // the blow, and you grunt
        O(0.18, 'sine', 110, 45, 0.9); N(0.12, 'lowpass', 1000, 150, 1, 0.6, 0, this.pink);
        this.throat(t + 0.02, out, { f0: rnd(150, 175), f1: rnd(100, 115), dur: 0.28, vowels: ['uh', 'u'], v: 0.32, breath: 0.4, rough: true, att: 0.02 }); break;
      case 'gasp': this.N(out, t, 0.35, 'bandpass', 1500, 2200, 1.4, 0.55, this.pink); this.throat(t, out, { f0: 260, f1: 300, dur: 0.3, vowels: ['a', 'aw'], v: 0.08, breath: 0.8, att: 0.03 }); break;
      case 'death':
        this.throat(t, out, { f0: rnd(220, 260), f1: rnd(150, 180), dur: 1.4, vowels: ['a', 'aw', 'u'], v: 0.45, breath: 0.5, rough: true, vib: 7 });
        N(2.2, 'lowpass', 5000, 60, 0.7, 0.9, 0, this.pink); [233, 247, 311, 466, 494].forEach((f) => O(2.6, 'sawtooth', f, f * 0.5, 0.06, 0, 0.05)); O(2.5, 'sine', 55, 20, 1.0); break;
      case 'ui': O(0.04, 'sine', 900, 600, 0.08); N(0.01, 'bandpass', 3000, 0, 4, 0.06); break;
      case 'dawn': for (let i = 0; i < 3; i++) this.bell(out, t + i * 2.4, 196, 0.5); break;   // a church bell across the town
      // ---- it
      case 'mstep':         // a weight landing: felt more than heard, then grit settling
        O(0.9, 'sine', 42, 18, 1.6, 0, 0.008); N(0.6, 'lowpass', 380, 45, 1, 1.4, 0, this.brown); N(0.18, 'bandpass', rnd(900, 1500), 300, 1.2, 0.5, 0.01);
        this.trickle(out, t + 0.05, 0.8, 8, 0.12, 1200, 4000); break;
      case 'slap': N(0.08, 'highpass', 900, 0, 0.8, 0.9); O(0.14, 'sine', 140, 50, 0.7); N(0.18, 'bandpass', 700, 300, 3, 0.5, 0.03, this.pink); break;
      case 'roar':          // a huge throat: low, rough, the vowel opening and closing
        this.throat(t, out, { f0: 92, f1: 58, dur: 2.6, vowels: ['u', 'aw', 'a', 'aw', 'u'], v: 0.75, breath: 0.7, rough: true, sub: 0.5, size: 0.62, vib: 4, att: 0.25 });
        this.throat(t + 0.05, out, { f0: 138, f1: 85, dur: 2.4, vowels: ['o', 'a', 'o'], v: 0.3, breath: 0.4, rough: true, size: 0.7, vib: 5.5, att: 0.3 });
        O(2.6, 'sine', 40, 24, 0.9, 0, 0.3); break;
      case 'spot':          // it has seen you: a short tearing shriek
        this.throat(t, out, { f0: 210, f1: 150, dur: 1.0, vowels: ['e', 'a', 'aw'], v: 0.6, breath: 0.8, rough: true, size: 0.8, vib: 8, att: 0.05 });
        N(0.9, 'bandpass', 600, 2600, 3, 0.4, 0, this.pink); break;
      case 'windup': N(1.4, 'bandpass', 180, 900, 2, 0.45, 0, this.brown); this.throat(t, out, { f0: 60, f1: 90, dur: 1.4, vowels: ['u', 'o'], v: 0.3, breath: 0.6, rough: true, size: 0.6 }); break;
      case 'scratch': for (let i = 0; i < 4; i++) { N(0.2, 'bandpass', rnd(2200, 3600), rnd(800, 1200), 8, 0.4, i * 0.22); N(0.15, 'bandpass', rnd(5000, 7000), 0, 10, 0.12, i * 0.22 + 0.03); } break;
      case 'reach': N(0.8, 'bandpass', 220, 800, 2.5, 0.5, 0, this.pink); this.creak(t, out, 0.6, 0.1, 12); O(0.6, 'sawtooth', 55, 40, 0.12); break;
      case 'bang':          // a fist against a wall: the thud, plaster cracking, bits falling
        O(0.4, 'sine', 68, 28, 1.3); N(0.3, 'lowpass', 600, 80, 1, 1.0, 0, this.brown); N(0.08, 'bandpass', 1800, 600, 3, 0.45, 0.02);
        this.trickle(out, t + 0.06, 0.7, 10, 0.12, 1500, 4500); break;
      case 'lunge': N(0.4, 'bandpass', 250, 1800, 2, 0.6, 0, this.pink); this.throat(t, out, { f0: 80, f1: 120, dur: 0.4, vowels: ['u', 'a'], v: 0.25, breath: 0.8, rough: true, size: 0.6 }); break;
      case 'stun':          // the flare hits: it screams
        this.throat(t, out, { f0: 260, f1: 90, dur: 1.6, vowels: ['i', 'a', 'aw', 'u'], v: 0.6, breath: 0.6, rough: true, size: 0.75, vib: 10, att: 0.03 });
        N(1.2, 'bandpass', 2500, 300, 2, 0.4); break;
      case 'eat':           // bones going, wet, then it swallows
        for (let i = 0; i < 7; i++) { const d = i * rnd(0.16, 0.24); N(0.04, 'highpass', 2500, 0, 1, 0.9, d); O(0.03, 'square', rnd(400, 800), 120, 0.15, d); N(0.18, 'lowpass', 1200, 200, 2, 0.8, d + 0.02, this.pink); }
        this.throat(t + 1.5, out, { f0: 70, f1: 40, dur: 0.7, vowels: ['u', 'o', 'u'], v: 0.4, breath: 0.5, rough: true, size: 0.6 }); O(0.4, 'sine', 160, 50, 0.5, 2.1); break;
      case 'summon':        // it calls: a long horn of a voice, and an answer of clicking from the buildings
        this.throat(t, out, { f0: 55, f1: 82, dur: 3.2, vowels: ['u', 'o', 'a', 'o'], v: 0.6, breath: 0.5, rough: true, sub: 0.6, size: 0.55, vib: 3, att: 0.6 });
        for (let i = 0; i < 26; i++) N(0.025, 'highpass', rnd(2500, 5000), 0, 2, 0.35, 1.4 + Math.random() * 2); break;
      // ---- the crawlers
      case 'skitter': for (let i = 0; i < 3; i++) { N(0.012, 'bandpass', rnd(2500, 5000), 0, 6, 0.4, i * rnd(0.015, 0.03)); } O(0.02, 'square', rnd(1100, 1500), 500, 0.03); break;
      case 'screech': {     // insect and child at once
        const o1 = O(0.9, 'sawtooth', 1500, 2600, 0.14); const am = c.createOscillator(), ag = c.createGain(); am.frequency.value = 34; ag.gain.value = 400; am.connect(ag); ag.connect(o1.frequency); am.start(t); am.stop(t + 1);
        this.throat(t, out, { f0: 900, f1: 1400, dur: 0.9, vowels: ['i', 'e', 'i'], v: 0.2, breath: 0.5, rough: true, vib: 18 }); N(0.9, 'bandpass', 3000, 5200, 5, 0.3); break;
      }
      case 'bite': N(0.03, 'highpass', 3000, 0, 1, 1.0); O(0.04, 'square', 900, 200, 0.2); N(0.2, 'lowpass', 1300, 200, 2, 0.6, 0.04, this.pink); break;
      case 'mdie': this.throat(t, out, { f0: 700, f1: 90, dur: 1.2, vowels: ['i', 'u'], v: 0.18, breath: 0.6, rough: true, vib: 14 }); N(1.0, 'bandpass', 2000, 200, 3, 0.3, 0.1, this.pink); break;
      // ---- things breaking
      case 'smash':
        N(1.8, 'lowpass', 5000, 80, 0.6, 1.5, 0, this.pink); O(1.4, 'sine', 58, 20, 1.5, 0, 0.01); N(1.2, 'lowpass', 300, 40, 1, 1.0, 0, this.brown);
        this.trickle(out, t + 0.1, 2.4, 34, 0.35, 600, 4500); break;
      case 'crash': N(1.0, 'lowpass', 4200, 110, 0.7, 1.3, 0, this.pink); O(0.8, 'sine', 64, 25, 1.1); this.trickle(out, t + 0.06, 1.5, 22, 0.3, 600, 4000); break;
      case 'woodbreak': N(0.06, 'bandpass', 1400, 0, 2, 1.1); O(0.25, 'sawtooth', 190, 60, 0.3); N(0.35, 'bandpass', 800, 300, 2, 0.8, 0.02, this.pink); for (let i = 0; i < 7; i++) N(0.05, 'bandpass', rnd(600, 2200), 0, 5, 0.5, 0.03 + Math.random() * 0.5); break;
      case 'glass':         // the break, then the shards ringing as they scatter
        N(0.08, 'highpass', 2500, 0, 0.8, 1.1); N(0.25, 'bandpass', 5000, 2500, 2, 0.4, 0.01);
        for (let i = 0; i < 18; i++) { const d = Math.pow(Math.random(), 1.5) * 0.7, f = rnd(2500, 8000); O(rnd(0.15, 0.5), 'sine', f, f * 0.99, rnd(0.02, 0.07), d, 0.001); N(0.015, 'highpass', 6000, 0, 1, 0.12, d); } break;
      case 'metalcrash': N(0.7, 'bandpass', 1400, 300, 1.5, 1.2, 0, this.pink); O(0.5, 'square', 140, 55, 0.2); for (const f of [420, 633, 911, 1287]) O(rnd(0.8, 1.6), 'sine', f * rnd(0.98, 1.02), 0, 0.07); O(0.5, 'sine', 58, 28, 0.9); this.trickle(out, t + 0.1, 1, 10, 0.2, 2000, 6000); break;
      case 'snap': N(0.015, 'highpass', 4000, 0, 1, 0.9); O(0.06, 'square', 3000, 400, 0.25); for (let i = 0; i < 14; i++) N(0.02, 'highpass', 5000, 0, 2, 0.5 * Math.random(), 0.05 + Math.random() * 0.9); N(1.0, 'bandpass', 120, 0, 8, 0.25, 0.05); break;
      // ---- things that are not there
      case 'breath': this.breatheAt(out); break;
      case 'whisper': this.whisper(t, out, 0.7); break;
      case 'knock': for (let i = 0; i < 3; i++) { const d = i * rnd(0.28, 0.36); O(0.12, 'sine', rnd(180, 220), 90, 0.8, d); N(0.05, 'bandpass', 400, 0, 3, 0.6, d, this.pink); N(0.01, 'bandpass', 2400, 0, 3, 0.25, d); } break;
      case 'scream': this.throat(t, out, { f0: 700, f1: 1100, dur: 1.6, vowels: ['a', 'e', 'a'], v: 0.4, breath: 0.4, vib: 8, rough: true }); break;
      case 'sting':         // the dissonant stab every horror film has, because it works
        [233, 247, 311, 330, 466, 932].forEach((f) => O(1.8, 'sawtooth', f, f * 1.02, 0.06, 0, 0.01)); N(0.4, 'highpass', 2500, 0, 1, 0.4); O(1.5, 'sine', 46, 28, 0.9, 0, 0.01);
        this.N(out, t, 1.2, 'bandpass', 3500, 5000, 6, 0.25); break;
      case 'alert':         // it knows: a sub drop and a shriek of strings
        O(1.6, 'sine', 70, 25, 1.1, 0, 0.01); [622, 659, 932, 988].forEach((f) => O(1.6, 'sawtooth', f, f * 1.05, 0.06, 0, 0.02)); N(1.4, 'bandpass', 300, 5000, 3, 0.4); break;
    }
  }
  // someone breathing right behind you
  breatheAt(out) {
    const c = this.ctx, t = c.currentTime;
    for (let i = 0; i < 3; i++) {
      const s = t + i * 1.5;
      this.N(out, s, 0.7, 'bandpass', 1300, 1700, 1.5, 0.4, this.pink);
      this.N(out, s + 0.75, 0.6, 'bandpass', 800, 520, 1.5, 0.55, this.pink);
      this.throat(s + 0.75, out, { f0: 95, f1: 80, dur: 0.6, vowels: ['uh', 'u'], v: 0.05, breath: 0.8, rough: true });
    }
  }

  // ------------------------------------------------------------------ it talks
  // The words come from the browser's speech voice, as low and slow as it will go; under them the synth adds
  // the monster's own throat, breathing through every word, so it sounds like it comes out of something big.
  // pos: where it is (sets how loud); far-off lines are quieter. Returns the subtitle text.
  speak(text, pos) {
    if (!this.ctx) return null;
    let k = 1;
    if (pos) { const r = this.rel(pos.x, pos.y, pos.z); k = clamp(1.15 - r.d / 90, 0.25, 1); }
    if (this.onSubtitle) this.onSubtitle(text);
    if (!this.voiceOn || this.paused) return text;
    const words = text.split(/\s+/).length, dur = 0.55 + words * 0.42;
    // the throat bed
    const c = this.ctx, t = c.currentTime + 0.12;
    const out = pos ? this.spot(pos.x, pos.y, pos.z, k * 0.9, false) : (() => { const g = c.createGain(); g.gain.value = k; g.connect(this.sfxG); return g; })();
    const seq = ['u', 'o', 'a', 'aw', 'uh'];
    let tt = t;
    for (let i = 0; i < words; i++) {
      const d = rnd(0.3, 0.45);
      this.throat(tt, out, { f0: rnd(48, 60), f1: rnd(38, 46), dur: d, vowels: [pick(seq), pick(seq)], v: 0.22, breath: 0.9, rough: true, sub: 0.4, size: 0.55, att: 0.05 });
      tt += d + rnd(0.02, 0.08);
    }
    this.N(out, tt, 0.9, 'bandpass', 500, 260, 2, 0.35, this.pink);     // a long breath out after it
    // the words
    try {
      if (typeof speechSynthesis === 'undefined' || typeof SpeechSynthesisUtterance === 'undefined') return text;
      const u = new SpeechSynthesisUtterance(text);
      const vs = speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang));
      const pref = vs.find((v) => /male|daniel|fred|alex|david|george|guy|ryan|google uk english male/i.test(v.name) && !/female/i.test(v.name)) || vs[0];
      if (pref) u.voice = pref;
      u.pitch = 0.05; u.rate = 0.68; u.volume = clamp(k * this.vol.master * this.vol.sfx * 1.1, 0, 1);
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    } catch {}
    void dur;
    return text;
  }
}
