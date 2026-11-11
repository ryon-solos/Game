// All sound is synthesised with WebAudio: ambience, tension, heartbeat and effects.
export class Sound {
  constructor() { this.ctx = null; this.vol = { master: 0.8, music: 0.7, sfx: 0.9 }; this.tension = 0; this.listener = { x: 0, y: 0, z: 0, yaw: 0 }; }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = this.ctx = new AC();
    this.master = c.createGain(); this.master.connect(c.destination);
    const comp = c.createDynamicsCompressor(); comp.connect(this.master);
    this.sfxG = c.createGain(); this.musG = c.createGain(); this.sfxG.connect(comp); this.musG.connect(comp);
    // reverb
    const len = c.sampleRate * 2.6, ir = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6); }
    this.rev = c.createConvolver(); this.rev.buffer = ir;
    const rg = c.createGain(); rg.gain.value = 0.35; this.rev.connect(rg); rg.connect(this.sfxG);
    // noise buffer
    const nb = this.noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate), nd = nb.getChannelData(0);
    let last = 0;
    for (let i = 0; i < nd.length; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; nd[i] = w * 0.5 + last * 6; }
    this.applyVol();
    this.startAmbience();
  }
  applyVol() {
    if (!this.ctx) return;
    this.master.gain.value = this.vol.master; this.sfxG.gain.value = this.vol.sfx; this.musG.gain.value = this.vol.music;
  }

  noise(loop = false) { const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuf; s.loop = loop; return s; }

  startAmbience() {
    const c = this.ctx, t = c.currentTime;
    // wind
    const wind = this.noise(true), wf = c.createBiquadFilter(); wf.type = 'lowpass'; wf.frequency.value = 320; wf.Q.value = 0.8;
    const wg = c.createGain(); wg.gain.value = 0.16;
    const lfo = c.createOscillator(), lg = c.createGain(); lfo.frequency.value = 0.07; lg.gain.value = 180; lfo.connect(lg); lg.connect(wf.frequency);
    wind.connect(wf); wf.connect(wg); wg.connect(this.musG); wind.start(); lfo.start();
    // low drone
    for (const [f, g] of [[41.2, 0.2], [43.1, 0.14], [61.7, 0.07], [82.9, 0.035]]) {
      const o = c.createOscillator(), og = c.createGain(); o.type = 'sine'; o.frequency.value = f; og.gain.value = g;
      const l = c.createOscillator(), l2 = c.createGain(); l.frequency.value = 0.05 + Math.random() * 0.1; l2.gain.value = g * 0.5; l.connect(l2); l2.connect(og.gain);
      o.connect(og); og.connect(this.musG); o.start(t); l.start(t);
    }
    // tension strings (volume follows this.tension)
    this.tenG = c.createGain(); this.tenG.gain.value = 0;
    const tf = c.createBiquadFilter(); tf.type = 'bandpass'; tf.frequency.value = 1400; tf.Q.value = 1.2;
    for (const f of [466.2, 493.9, 698.5, 739.9, 987.8]) {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = Math.random() * 30 - 15;
      const v = c.createOscillator(), vg = c.createGain(); v.frequency.value = 4 + Math.random() * 3; vg.gain.value = 6; v.connect(vg); vg.connect(o.detune);
      o.connect(tf); o.start(); v.start();
    }
    tf.connect(this.tenG); this.tenG.connect(this.musG); this.tenG.connect(this.rev);
    // breathing growl (when it is close)
    this.growlG = c.createGain(); this.growlG.gain.value = 0;
    const go = c.createOscillator(); go.type = 'sawtooth'; go.frequency.value = 38;
    const gl = c.createOscillator(), gg = c.createGain(); gl.frequency.value = 0.35; gg.gain.value = 9; gl.connect(gg); gg.connect(go.frequency);
    const gf = c.createBiquadFilter(); gf.type = 'lowpass'; gf.frequency.value = 240;
    const gn = this.noise(true), gnf = c.createBiquadFilter(); gnf.type = 'bandpass'; gnf.frequency.value = 500; gnf.Q.value = 2; const gng = c.createGain(); gng.gain.value = 0.5;
    const am = c.createGain(); am.gain.value = 0.5; const aml = c.createOscillator(), amg = c.createGain(); aml.frequency.value = 0.35; amg.gain.value = 0.5; aml.connect(amg); amg.connect(am.gain);
    go.connect(gf); gf.connect(am); gn.connect(gnf); gnf.connect(gng); gng.connect(am); am.connect(this.growlG); this.growlG.connect(this.sfxG); this.growlG.connect(this.rev);
    go.start(); gl.start(); gn.start(); aml.start();
    this.beatT = 0; this.eventT = 6;
  }

  // called every frame
  update(dt, tension, monsterDist) {
    if (!this.ctx) return;
    const c = this.ctx;
    this.tension += (tension - this.tension) * Math.min(1, dt * 1.5);
    this.tenG.gain.setTargetAtTime(this.tension * this.tension * 0.05, c.currentTime, 0.2);
    const near = Math.max(0, 1 - monsterDist / 30);
    this.growlG.gain.setTargetAtTime(near * near * 0.5, c.currentTime, 0.15);
    this.beatT -= dt;
    if (this.tension > 0.25 && this.beatT <= 0) {
      this.beatT = 1.05 - this.tension * 0.6;
      this.thump(0.5 * this.tension, 58, 0.14); setTimeout(() => this.thump(0.35 * this.tension, 50, 0.16), 150);
    }
    this.eventT -= dt;
    if (this.eventT <= 0) { this.eventT = 7 + Math.random() * 16; this.randomEvent(); }
  }

  thump(vol, f, dur) {
    const c = this.ctx, t = c.currentTime, o = c.createOscillator(), g = c.createGain();
    o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 0.5, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.sfxG); o.start(t); o.stop(t + dur + 0.02);
  }

  randomEvent() {
    const c = this.ctx, t = c.currentTime, r = Math.random(), pan = c.createStereoPanner(); pan.pan.value = Math.random() * 2 - 1;
    pan.connect(this.musG); pan.connect(this.rev);
    if (r < 0.35) {          // distant metal groan
      const o = c.createOscillator(), m = c.createOscillator(), mg = c.createGain(), g = c.createGain();
      o.type = 'sawtooth'; const f = 60 + Math.random() * 70; o.frequency.setValueAtTime(f, t); o.frequency.linearRampToValueAtTime(f * (0.7 + Math.random() * 0.5), t + 3);
      m.frequency.value = f * 1.51; mg.gain.value = 40; m.connect(mg); mg.connect(o.frequency);
      const fl = c.createBiquadFilter(); fl.type = 'bandpass'; fl.frequency.value = 400; fl.Q.value = 3;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.07, t + 1); g.gain.linearRampToValueAtTime(0, t + 3.2);
      o.connect(fl); fl.connect(g); g.connect(pan); o.start(t); m.start(t); o.stop(t + 3.3); m.stop(t + 3.3);
    } else if (r < 0.7) {    // whisper
      const n = this.noise(), f = c.createBiquadFilter(), g = c.createGain(); f.type = 'bandpass'; f.Q.value = 6;
      f.frequency.setValueAtTime(1800, t); g.gain.setValueAtTime(0, t);
      for (let i = 0; i < 7; i++) { const tt = t + i * 0.22; f.frequency.linearRampToValueAtTime(1200 + Math.random() * 2200, tt + 0.1); g.gain.linearRampToValueAtTime(0.05 + Math.random() * 0.05, tt + 0.07); g.gain.linearRampToValueAtTime(0.004, tt + 0.2); }
      n.connect(f); f.connect(g); g.connect(pan); n.start(t, Math.random()); n.stop(t + 1.7);
    } else {                 // knock / creak
      for (let i = 0; i < 2 + (Math.random() * 3 | 0); i++) {
        const o = c.createOscillator(), g = c.createGain(), tt = t + i * (0.25 + Math.random() * 0.2);
        o.frequency.setValueAtTime(140, tt); o.frequency.exponentialRampToValueAtTime(60, tt + 0.1);
        g.gain.setValueAtTime(0.12, tt); g.gain.exponentialRampToValueAtTime(0.001, tt + 0.18);
        o.connect(g); g.connect(pan); o.start(tt); o.stop(tt + 0.2);
      }
    }
  }

  // positional helper: returns {g, pan} already attenuated for a world position, or null if inaudible
  at(x, y, z, maxD) {
    const L = this.listener, dx = x - L.x, dz = z - L.z, d = Math.hypot(dx, y - L.y, dz);
    if (d > maxD) return null;
    const v = Math.pow(1 - d / maxD, 1.7);
    const rx = Math.cos(L.yaw) * dx - Math.sin(L.yaw) * dz;   // right-vector component
    return { v, pan: Math.max(-1, Math.min(1, rx / (Math.abs(d) + 2))), d };
  }

  // name, volume, optional world position {x,y,z,max}
  play(name, vol = 1, pos) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    let pan = 0, far = 0;
    if (pos) { const a = this.at(pos.x, pos.y, pos.z, pos.max || 40); if (!a) return; vol *= a.v; pan = a.pan; far = a.d / (pos.max || 40); }
    if (vol < 0.003) return;
    const out = c.createStereoPanner(); out.pan.value = pan;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 18000 * Math.pow(1 - far, 2) + 500;
    out.connect(lp); lp.connect(this.sfxG);
    const wet = c.createGain(); wet.gain.value = 0.5 + far; lp.connect(wet); wet.connect(this.rev);
    const N = (dur, type, f0, f1, q, v, delay = 0) => {
      const n = this.noise(), f = c.createBiquadFilter(), g = c.createGain(), s = t + delay;
      f.type = type; f.frequency.setValueAtTime(f0, s); if (f1) f.frequency.exponentialRampToValueAtTime(f1, s + dur); f.Q.value = q;
      g.gain.setValueAtTime(v * vol, s); g.gain.exponentialRampToValueAtTime(0.0008, s + dur);
      n.connect(f); f.connect(g); g.connect(out); n.start(s, Math.random()); n.stop(s + dur + 0.05);
    };
    const O = (dur, type, f0, f1, v, delay = 0) => {
      const o = c.createOscillator(), g = c.createGain(), s = t + delay;
      o.type = type; o.frequency.setValueAtTime(f0, s); if (f1) o.frequency.exponentialRampToValueAtTime(f1, s + dur);
      g.gain.setValueAtTime(v * vol, s); g.gain.exponentialRampToValueAtTime(0.0008, s + dur);
      o.connect(g); g.connect(out); o.start(s); o.stop(s + dur + 0.05);
    };
    switch (name) {
      case 'step': N(0.09, 'lowpass', 500 + Math.random() * 300, 120, 1, 0.5); O(0.07, 'sine', 90, 50, 0.25); break;
      case 'land': N(0.2, 'lowpass', 600, 80, 1, 0.9); O(0.18, 'sine', 80, 35, 0.7); break;
      case 'door': O(0.5, 'sawtooth', 190 + Math.random() * 80, 330, 0.05); N(0.5, 'bandpass', 900, 1500, 9, 0.25); O(0.12, 'sine', 110, 50, 0.4, 0.45); break;
      case 'doorslam': N(0.3, 'lowpass', 900, 100, 1, 1); O(0.25, 'sine', 95, 38, 0.9); break;
      case 'star': [880, 1318.5, 1760, 2637].forEach((f, i) => O(1.1, 'sine', f, 0, 0.14 / (i + 1), i * 0.06)); break;
      case 'pick': O(0.12, 'triangle', 420, 700, 0.2); N(0.1, 'highpass', 2000, 0, 1, 0.12); break;
      case 'gun': N(0.45, 'lowpass', 6000, 200, 0.5, 1.4); O(0.3, 'sine', 160, 30, 1.1); N(0.05, 'highpass', 3000, 0, 1, 0.9); break;
      case 'empty': O(0.03, 'square', 1500, 700, 0.12); break;
      case 'mstep': O(0.6, 'sine', 52, 20, 1.5); N(0.4, 'lowpass', 260, 50, 1, 1.1); break;
      case 'roar': {
        for (const f of [70, 93, 141, 187]) { O(2.2, 'sawtooth', f * 1.6, f * 0.55, 0.22); }
        N(2.2, 'bandpass', 900, 250, 2, 0.8); O(2.2, 'sine', 45, 28, 0.8); break;
      }
      case 'spot': O(0.9, 'sawtooth', 90, 330, 0.25); O(0.9, 'sawtooth', 95, 349, 0.25); N(0.9, 'bandpass', 500, 2400, 3, 0.5); break;
      case 'smash': N(1.6, 'lowpass', 5000, 90, 0.6, 1.6); O(1.3, 'sine', 62, 22, 1.5); for (let i = 0; i < 12; i++) N(0.07, 'bandpass', 600 + Math.random() * 3000, 0, 4, 0.5, 0.2 + Math.random() * 1.6); break;
      case 'windup': O(1.5, 'sawtooth', 50, 120, 0.3); N(1.5, 'bandpass', 200, 900, 2, 0.5); break;
      case 'scratch': for (let i = 0; i < 4; i++) N(0.16, 'bandpass', 2200 + Math.random() * 1500, 900, 7, 0.45, i * 0.2); break;
      case 'reach': N(0.7, 'bandpass', 250, 900, 2.5, 0.6); O(0.6, 'sawtooth', 60, 44, 0.2); break;
      case 'alert': N(1.4, 'bandpass', 300, 5000, 3, 0.5); [311, 440, 622].forEach((f) => O(1.6, 'sawtooth', f, f * 1.03, 0.1)); break;
      case 'hurt': O(0.2, 'sine', 120, 40, 0.9); N(0.15, 'lowpass', 900, 150, 1, 0.6); break;
      case 'death': N(2.5, 'lowpass', 7000, 60, 0.7, 1.2); [233, 247, 311, 466, 494].forEach((f) => O(2.8, 'sawtooth', f, f * 0.5, 0.16)); O(2.5, 'sine', 55, 20, 1.2); break;
      case 'stun': O(1.4, 'sawtooth', 300, 40, 0.3); N(1.2, 'bandpass', 2500, 300, 2, 0.6); break;
      case 'dawn': [392, 523.3, 659.3, 784].forEach((f, i) => O(3, 'sine', f, 0, 0.12, i * 0.35)); break;
      case 'ui': O(0.05, 'sine', 620, 480, 0.12); break;
      case 'closet': O(0.3, 'sawtooth', 150 + Math.random() * 60, 240, 0.05); N(0.25, 'bandpass', 700, 1200, 8, 0.2); O(0.08, 'sine', 140, 70, 0.3, 0.26); break;
      case 'channel': [660, 990, 1320].forEach((f, i) => O(1.0, 'sine', f, f * 1.5, 0.05, i * 0.12)); N(1.0, 'bandpass', 2000, 6000, 6, 0.08); break;
      case 'starcry': [1760, 2217, 2637].forEach((f, i) => O(1.6, 'sine', f, f * 0.98, 0.08, i * 0.05)); break;
      case 'skitter': N(0.035, 'highpass', 2500 + Math.random() * 2500, 0, 2, 0.35); O(0.03, 'square', 900 + Math.random() * 600, 300, 0.05); break;
      case 'screech': O(0.9, 'sawtooth', 1400, 2600, 0.16); O(0.9, 'square', 1470, 2450, 0.08); N(0.9, 'bandpass', 3000, 5200, 5, 0.5); break;
      case 'bite': N(0.12, 'bandpass', 1800, 500, 3, 0.9); O(0.15, 'sawtooth', 220, 70, 0.4); N(0.1, 'lowpass', 600, 150, 1, 0.6, 0.1); break;
      case 'mdie': O(1.2, 'sawtooth', 900, 60, 0.14); N(1.2, 'bandpass', 2600, 200, 3, 0.4); break;
      case 'summon': for (const f of [55, 82, 110]) O(3.2, 'sawtooth', f, f * 1.5, 0.22); N(3.2, 'bandpass', 300, 1800, 2, 0.6); for (let i = 0; i < 9; i++) N(0.05, 'highpass', 3000, 0, 2, 0.4, 1.2 + i * 0.2); break;
      case 'eat': for (let i = 0; i < 6; i++) { N(0.11, 'lowpass', 1400, 200, 2, 1.1, i * 0.21); O(0.09, 'square', 90 + Math.random() * 50, 40, 0.5, i * 0.21); } O(1.6, 'sawtooth', 70, 40, 0.3); N(0.5, 'bandpass', 500, 300, 2, 0.6, 1.3); break;
      case 'torch': O(0.02, 'square', 2200, 1200, 0.08); break;
    }
  }
}
