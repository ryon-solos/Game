// Recorded sounds: freesound effects and music, and the monster's Fish Audio voice lines.
// `npm run audio` puts them in public/audio/ with an index.json; this loads and prepares them. Everything is optional:
// a sound that is not here (no index, a file that failed, a browser that cannot decode it) is simply absent, and
// audio.js synthesises it instead.
//
// Preparation, done once after decoding:
//  - beds and music are trimmed to a sensible length and made loopable (the tail crossfaded into the head)
//  - recordings of a run of hits (a heartbeat, footsteps, hammer blows) are sliced into single hits by onset detection,
//    so the game can play one hit at whatever rate it wants
//  - one-shots are trimmed of leading silence and capped in length, positional ones mixed to mono
import { VOICE_IDS, FISH_URL } from './voicelines.js';

// how each slot is prepared. loop: seconds to keep as a loop. slice: min gap between hits (s) and how many to keep.
const PREP = {
  amb_drone: { loop: 40 }, amb_wind: { loop: 40, mono: true }, mus_tension: { loop: 40 }, mus_chase: { loop: 40 },
  breath_scared: { loop: 30, mono: true }, breath_run: { loop: 24, mono: true }, growl: { max: 6, mono: true },
  heart: { slice: [0.42, 6, 0.55] }, step_out: { slice: [0.22, 10, 0.45] }, step_in: { slice: [0.25, 8, 0.7] }, wallhit: { slice: [0.3, 6, 1.6] },
  roar: { max: 6 }, mstep: { max: 3, mono: true }, eat: { max: 3, mono: true }, jumpscream: { max: 3, mono: true },
  skitter: { max: 1.2, mono: true, chop: 0.35 }, chitter: { max: 3, mono: true },
  glass: { max: 3, mono: true }, woodbreak: { max: 3, mono: true }, crash: { max: 6, mono: true },
  door: { max: 3, mono: true }, doorslam: { max: 3, mono: true }, closet: { max: 2.5, mono: true }, gun: { max: 3 },
  thunder: { max: 14 }, bell: { max: 12 }, knock: { max: 3, mono: true }, whisper: { max: 6, mono: true }, scream: { max: 3, mono: true }, musicbox: { max: 10, mono: true },
};

export class Bank {
  constructor(ctx) {
    this.ctx = ctx;
    this.sfx = new Map();       // key -> [AudioBuffer]
    this.voice = new Map();     // 'kind-i' -> AudioBuffer
    this.voiceFile = {};        // 'kind-i' -> local file
    this.pending = new Map();   // 'kind-i' -> Promise
    this.remoteFails = 0;       // Fish's server refused or unreachable this many times: stop asking it
    this.onReady = null;        // (key) => void, as each sfx slot becomes usable
    this.base = 'audio/';
  }
  has(k) { return this.sfx.has(k); }
  any(k) { const l = this.sfx.get(k); return l ? l[(Math.random() * l.length) | 0] : null; }

  async load() {
    let idx = null, ready;
    this.indexReady = new Promise((r) => { ready = r; });       // voice lines asked for early wait for this
    try { const r = await fetch(this.base + 'index.json', { cache: 'no-cache' }); if (r.ok) idx = await r.json(); } catch {}
    if (idx && idx.voice) for (const [kind, files] of Object.entries(idx.voice)) (files || []).forEach((f, i) => { if (f) this.voiceFile[`${kind}-${i}`] = f; });
    ready();
    // loops first (they are what you hear all the time), then everything else, a few at a time
    const jobs = idx && idx.sfx ? Object.entries(idx.sfx) : [];
    jobs.sort((a, b) => (PREP[b[0]] && PREP[b[0]].loop ? 1 : 0) - (PREP[a[0]] && PREP[a[0]].loop ? 1 : 0));
    const run = async ([key, list]) => {
      const out = [];
      for (const e of list || []) {
        try {
          const buf = await this.decode(this.base + e.file);
          out.push(...this.prepare(key, buf));
        } catch {}
      }
      if (out.length) { this.sfx.set(key, out); if (this.onReady) this.onReady(key); }
    };
    for (let i = 0; i < jobs.length; i += 4) await Promise.all(jobs.slice(i, i + 4).map(run));
    // the voice: local files if fetched, otherwise straight from Fish Audio (works where its server allows it)
    this.prefetchVoice();
  }

  async decode(url, opt) {
    const r = await fetch(url, opt);
    if (!r.ok) throw new Error(r.status);
    const ab = await r.arrayBuffer();
    return await new Promise((res, rej) => { const p = this.ctx.decodeAudioData(ab, res, rej); if (p && p.then) p.then(res, rej); });
  }

  // ---- the monster's lines
  voiceKey(kind, i) { return `${kind}-${i}`; }
  getVoice(kind, i) { return this.voice.get(this.voiceKey(kind, i)) || null; }
  loadVoice(kind, i) {
    const k = this.voiceKey(kind, i);
    if (this.voice.has(k)) return Promise.resolve(this.voice.get(k));
    if (this.pending.has(k)) return this.pending.get(k);
    const ids = VOICE_IDS[kind];
    const p = (async () => {
      // the list of downloaded files may not be read yet (it talked straight away): wait for it, then look
      if (this.indexReady) await this.indexReady;
      const local = this.voiceFile[k], remote = ids && ids[i] ? FISH_URL(ids[i]) : null;
      for (const [url, opt] of [[local && this.base + local], [this.remoteFails < 3 && remote, { mode: 'cors', credentials: 'omit' }]]) {
        if (!url) continue;
        try { const b = this.trim(await this.decode(url, opt), 0.01, 12); this.voice.set(k, b); return b; } catch { if (url === remote) this.remoteFails++; }
      }
      return null;
    })();
    this.pending.set(k, p);
    p.then((b) => { if (!b) this.pending.delete(k); });    // a miss is not remembered: asked again next time it is wanted
    return p;
  }
  async prefetchVoice() {
    const all = [];
    for (const [kind, ids] of Object.entries(VOICE_IDS)) ids.forEach((_, i) => all.push([kind, i]));
    // the start-of-night lines first: they are the first thing it says
    all.sort((a, b) => (b[0] === 'night') - (a[0] === 'night'));
    for (let i = 0; i < all.length; i += 3) {
      const got = await Promise.all(all.slice(i, i + 3).map(([k, n]) => this.loadVoice(k, n)));
      if (i === 0 && !got.some(Boolean)) return;   // neither local nor remote works here: stop asking
    }
  }

  // ---- preparing buffers
  prepare(key, buf) {
    const p = PREP[key] || { max: 6 };
    if (p.mono) buf = this.mono(buf);
    if (p.loop) return [this.loopify(buf, p.loop)];
    if (p.slice) { const s = this.slices(buf, ...p.slice); return s.length ? s : [this.trim(buf, 0.02, p.slice[2])]; }
    if (p.chop) { const s = this.slices(buf, 0.08, 6, p.chop); if (s.length > 1) return s; }
    return [this.trim(buf, 0.02, p.max || 6)];
  }
  copy(buf, from, len, ch = buf.numberOfChannels) {
    const c = this.ctx, n = Math.max(1, Math.min(len, buf.length - from)), out = c.createBuffer(ch, n, buf.sampleRate);
    for (let k = 0; k < ch; k++) out.getChannelData(k).set(buf.getChannelData(Math.min(k, buf.numberOfChannels - 1)).subarray(from, from + n));
    return out;
  }
  mono(buf) {
    if (buf.numberOfChannels === 1) return buf;
    const out = this.ctx.createBuffer(1, buf.length, buf.sampleRate), d = out.getChannelData(0);
    const a = buf.getChannelData(0), b = buf.getChannelData(1);
    for (let i = 0; i < d.length; i++) d[i] = (a[i] + b[i]) * 0.5;
    return out;
  }
  peak(buf) { let m = 0; for (let k = 0; k < buf.numberOfChannels; k++) { const d = buf.getChannelData(k); for (let i = 0; i < d.length; i += 2) { const v = Math.abs(d[i]); if (v > m) m = v; } } return m || 1; }
  // cut leading silence (below `thresh` of the peak), cap the length, fade the end, normalise
  trim(buf, thresh, maxSec) {
    const sr = buf.sampleRate, d0 = buf.getChannelData(0), pk = this.peak(buf);
    let s = 0; while (s < d0.length - 1 && Math.abs(d0[s]) < thresh * pk) s++;
    s = Math.max(0, s - Math.floor(sr * 0.005));
    const out = this.copy(buf, s, Math.floor(maxSec * sr));
    this.fade(out, 0.002, Math.min(0.25, out.duration * 0.2));
    this.gain(out, 0.9 / pk);
    return out;
  }
  fade(buf, inS, outS) {
    const sr = buf.sampleRate, ni = Math.floor(inS * sr), no = Math.floor(outS * sr);
    for (let k = 0; k < buf.numberOfChannels; k++) {
      const d = buf.getChannelData(k), n = d.length;
      for (let i = 0; i < ni && i < n; i++) d[i] *= i / ni;
      for (let i = 0; i < no && i < n; i++) d[n - 1 - i] *= i / no;
    }
  }
  gain(buf, g) { for (let k = 0; k < buf.numberOfChannels; k++) { const d = buf.getChannelData(k); for (let i = 0; i < d.length; i++) d[i] *= g; } }
  // RMS envelope of the channel mix, one value per `hop` samples
  envelope(buf, hop, from = 0, to = buf.length) {
    const ch = buf.numberOfChannels, env = [];
    for (let i = from; i + hop <= to; i += hop) {
      let s = 0;
      for (let k = 0; k < ch; k++) { const d = buf.getChannelData(k); for (let j = i; j < i + hop; j += 2) s += d[j] * d[j]; }
      env.push(Math.sqrt((s * 2) / (hop * ch)));
    }
    return env;
  }
  // Keep up to `sec` seconds and make the end flow into the start (equal-power crossfade of the last `xf` s into the head).
  // Recordings are rarely even: music has a quiet intro or a breakdown, breathing has pauses, wind dies away. Looped
  // as is, those become stretches of near silence every time round, so the sound seems to cut out. So: take the
  // stretch of the recording with the fewest quiet holes, then ride its level so quiet passages come up to the rest.
  // cut out the holes: stretches more than 20 dB under the recording's typical level, joined with short crossfades
  closeGaps(buf) {
    const sr = buf.sampleRate, ch = buf.numberOfChannels, hop = Math.floor(sr * 0.1), env = this.envelope(buf, hop);
    if (env.length < 10) return buf;
    const med = env.slice().sort((a, b) => a - b)[Math.floor(env.length * 0.6)] || 0;
    if (med <= 0) return buf;
    const runs = [];
    let s = -1;
    env.forEach((e, i) => { const loud = e > med * 0.1; if (loud && s < 0) s = i; if ((!loud || i === env.length - 1) && s >= 0) { runs.push([s, loud ? i + 1 : i]); s = -1; } });
    const keep = runs.filter(([a, b]) => b - a >= 3);            // ignore loud blips shorter than 0.3 s
    if (keep.length < 2 && keep.length && keep[0][0] === 0 && keep[0][1] === env.length) return buf;   // nothing to cut
    const total = keep.reduce((n, [a, b]) => n + (b - a) * hop, 0);
    if (total < sr * 3) return buf;                              // mostly quiet: leave it alone
    const xn = Math.floor(sr * 0.05), out = this.ctx.createBuffer(ch, total, sr);
    for (let k = 0; k < ch; k++) {
      const src = buf.getChannelData(k), d = out.getChannelData(k);
      let w = 0;
      for (const [a, b] of keep) {
        const from = a * hop, n = (b - a) * hop;
        for (let i = 0; i < n; i++) {
          const v = src[from + i];
          if (w > 0 && i < xn) { const t = i / xn; d[w - xn + i] = d[w - xn + i] * Math.cos(t * Math.PI / 2) + v * Math.sin(t * Math.PI / 2); }
          else d[w - (w > 0 ? xn : 0) + i] = v;
        }
        w += n - (w > 0 ? xn : 0);
      }
    }
    return this.copy(out, 0, out.length - xn * (keep.length - 1));
  }
  loopify(buf, sec) {
    buf = this.closeGaps(buf);
    const sr = buf.sampleRate, ch = buf.numberOfChannels;
    const xf = Math.min(1.5, buf.duration * 0.15), nx = Math.floor(xf * sr);
    const len = Math.min(buf.length, Math.floor((sec + xf) * sr));
    // 1. where to start: the window whose quietest tenth is loudest
    const hop = Math.floor(sr * 0.1), env = this.envelope(buf, hop), wn = Math.max(1, Math.floor(len / hop));
    let start = 0;
    if (env.length > wn) {
      let best = -1;
      for (let s = 0; s + wn <= env.length; s += 5) {
        const w = env.slice(s, s + wn).sort((a, b) => a - b), q = w[Math.floor(w.length * 0.1)];
        if (q > best * 1.05) { best = q; start = s * hop; }
      }
    }
    const seg = this.copy(buf, start, len);
    // 2. ride the level: 0.4 s blocks, each pulled towards the median, at most +15 dB up and -6 dB down, smoothed
    const bh = Math.floor(sr * 0.4), be = this.envelope(seg, bh);
    if (be.length > 2) {
      const med = be.slice().sort((a, b) => a - b)[Math.floor(be.length / 2)] || 1e-6;
      const g = be.map((e) => Math.min(5.6, Math.max(0.5, med / Math.max(e, 1e-6))));
      for (let pass = 0; pass < 2; pass++) for (let i = 1; i < g.length - 1; i++) g[i] = (g[i - 1] + 2 * g[i] + g[i + 1]) / 4;
      for (let k = 0; k < ch; k++) {
        const d = seg.getChannelData(k);
        for (let i = 0; i < d.length; i++) {
          const p = i / bh - 0.5, a = Math.max(0, Math.min(g.length - 1, Math.floor(p))), b = Math.min(g.length - 1, a + 1), f = Math.max(0, Math.min(1, p - a));
          d[i] *= g[a] + (g[b] - g[a]) * f;
        }
      }
    }
    // 3. the seam, placed (within 50 ms) where the tail is in phase with the head, so a tonal drone does not
    //    cancel itself for a moment every time round
    const maxL = Math.min(Math.floor(sr * 0.05), Math.max(0, seg.length - nx * 2)), m0 = seg.getChannelData(0), cn = Math.min(nx, 4096);
    let lag = 0, bestC = -Infinity;
    for (let L = 0; L <= maxL; L += 2) {
      const at = seg.length - nx - L; let cs = 0;
      for (let i = 0; i < cn; i += 2) cs += m0[i] * m0[at + i];
      if (cs > bestC) { bestC = cs; lag = L; }
    }
    const body = seg.length - nx - lag, out = this.ctx.createBuffer(ch, body, sr);
    for (let k = 0; k < ch; k++) {
      const src = seg.getChannelData(k), d = out.getChannelData(k);
      d.set(src.subarray(0, body));
      for (let i = 0; i < nx; i++) { const t = i / nx; d[i] = src[i] * Math.sin(t * Math.PI / 2) + src[body + i] * Math.cos(t * Math.PI / 2); }
    }
    this.gain(out, 0.85 / this.peak(out));
    return out;
  }
  // onset detection: 10 ms RMS envelope; a hit starts where it jumps well above the recent floor
  slices(buf, minGap, keep, maxLen) {
    const sr = buf.sampleRate, hop = Math.floor(sr * 0.01), d = buf.getChannelData(0), env = [];
    for (let i = 0; i + hop <= d.length; i += hop) { let s = 0; for (let j = i; j < i + hop; j++) s += d[j] * d[j]; env.push(Math.sqrt(s / hop)); }
    const top = Math.max(...env, 1e-6), hits = [];
    let floor = 0, last = -1e9;
    for (let i = 1; i < env.length; i++) {
      floor = floor * 0.95 + env[i - 1] * 0.05;
      if (env[i] > top * 0.18 && env[i] > floor * 2.5 && (i - last) * 0.01 >= minGap) { hits.push(i); last = i; }
    }
    // the strongest hits, each up to the next one (or maxLen)
    const out = [];
    hits.map((h, n) => ({ h, n, e: Math.max(...env.slice(h, h + 8)) })).sort((a, b) => b.e - a.e).slice(0, keep).sort((a, b) => a.h - b.h)
      .forEach(({ h, n }) => {
        const from = Math.max(0, h * hop - Math.floor(sr * 0.008));
        const next = hits[n + 1] != null ? hits[n + 1] * hop - Math.floor(sr * 0.01) : d.length;
        const len = Math.min(next - from, Math.floor(maxLen * sr));
        if (len < sr * 0.05) return;
        const b = this.copy(buf, from, len);
        this.fade(b, 0.002, Math.min(0.08, b.duration * 0.3));
        this.gain(b, 0.9 / this.peak(b));
        out.push(b);
      });
    return out;
  }
}
