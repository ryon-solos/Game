// Recorded sounds: the downloader reads licences and previews correctly and refuses NonCommercial sounds (against a
// fake freesound and a fake Fish Audio on localhost), and the game's sample preparation slices a run of hits into
// single hits and makes loops the right length.
import assert from 'node:assert';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { licenceOf, parsePage } from '../scripts/fetch-audio.mjs';
import { SFX, VOICE } from '../scripts/audio-sources.mjs';
import { LINES } from '../public/js/narration.js';
import { Bank } from '../public/js/samples.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---- licences
assert.strictEqual(licenceOf('http://creativecommons.org/publicdomain/zero/1.0/'), 'cc0');
assert.strictEqual(licenceOf('https://creativecommons.org/licenses/by/4.0/'), 'by');
assert.strictEqual(licenceOf('https://creativecommons.org/licenses/by-nc/4.0/'), null, 'NonCommercial is refused');
assert.strictEqual(licenceOf('http://creativecommons.org/licenses/sampling+/1.0/'), null, 'Sampling+ is refused');
assert.strictEqual(licenceOf('Attribution NonCommercial 4.0'), null);
assert.strictEqual(licenceOf('Creative Commons 0'), 'cc0');

// ---- every narration line has a recording, and the manifest is sane
for (const k of Object.keys(LINES)) assert.strictEqual(VOICE[k] && VOICE[k].length, LINES[k].length, `a recording for every "${k}" line`);
for (const [k, s] of Object.entries(SFX)) assert.ok(s.ids.length && s.keep >= 1 && s.ids.every(Number.isInteger), `slot ${k}`);

// ---- reading a sound page
const page = (id, user, lic, name = 'Some sound') => `<!doctype html><html><head><title>Freesound - ${name} by ${user}</title>
<meta property="og:audio" content="https://cdn.freesound.org/previews/${(id / 1000) | 0}/${id}_99887-hq.mp3"></head><body>
<div class="player" data-mp3="https://cdn.freesound.org/previews/${(id / 1000) | 0}/${id}_99887-lq.mp3" data-ogg="https://cdn.freesound.org/previews/${(id / 1000) | 0}/${id}_99887-hq.ogg"></div>
<a href="${lic}">licence</a><p>Description mentioning <a href="https://creativecommons.org/licenses/by-nc/4.0/">another sound</a>.</p></body></html>`;
const p = parsePage(page(332820, 'loudernoises', 'http://creativecommons.org/publicdomain/zero/1.0/', 'heartbeat-80bpm.wav'), 332820);
assert.strictEqual(p.name, 'heartbeat-80bpm.wav'); assert.strictEqual(p.user, 'loudernoises'); assert.strictEqual(p.licence, 'cc0');
assert.strictEqual(p.preview, 'https://cdn.freesound.org/previews/332/332820_99887-hq.mp3', 'takes the HQ MP3 preview');
assert.strictEqual(parsePage(page(5, 'x', 'https://creativecommons.org/licenses/by-nc/3.0/'), 5).licence, null);

// ---- end to end against fake servers
const mp3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(4000, 7)]);
const nc = new Set([SFX.amb_drone.ids[0]]);        // pretend the first drone has gone NonCommercial: the next is used
const srv = http.createServer((req, res) => {
  let m;
  if ((m = req.url.match(/^\/s\/(\d+)\/$/))) {
    const id = +m[1];
    const html = page(id, 'user' + id, nc.has(id) ? 'https://creativecommons.org/licenses/by-nc/4.0/' : id % 2 ? 'https://creativecommons.org/licenses/by/4.0/' : 'http://creativecommons.org/publicdomain/zero/1.0/')
      .replace(/https:\/\/cdn\.freesound\.org/g, `http://127.0.0.1:${srv.address().port}`);
    res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(html);
  }
  if (/\/previews\/|\/fish\//.test(req.url)) { res.writeHead(200, { 'Content-Type': 'audio/mpeg' }); return res.end(mp3); }
  res.writeHead(404); res.end();
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const port = srv.address().port, out = fs.mkdtempSync(path.join(os.tmpdir(), 'tls-audio-'));
await new Promise((resolve, reject) => execFile(process.execPath, [path.join(ROOT, 'scripts', 'fetch-audio.mjs')], {
  env: { ...process.env, AUDIO_OUT: out, FREESOUND_BASE: `http://127.0.0.1:${port}`, FISH_BASE: `http://127.0.0.1:${port}/fish`, FREESOUND_API_KEY: '', AUDIO_FETCH_GAP: '0' }, timeout: 120000,
}, (err, so, se) => (err ? reject(new Error(err.message + '\n' + so + se)) : resolve())));
srv.close();
const idx = JSON.parse(fs.readFileSync(path.join(out, 'index.json'), 'utf8'));
for (const k of Object.keys(SFX)) assert.ok(idx.sfx[k] && idx.sfx[k].length === Math.min(SFX[k].keep, SFX[k].ids.length - (k === 'amb_drone' ? 1 : 0)), `slot ${k} fetched`);
assert.notStrictEqual(idx.sfx.amb_drone[0].id, SFX.amb_drone.ids[0], 'a NonCommercial sound is skipped');
for (const e of Object.values(idx.sfx).flat()) assert.ok(fs.existsSync(path.join(out, e.file)), e.file);
assert.strictEqual(Object.values(idx.voice).flat().filter(Boolean).length, Object.values(VOICE).flat().length, 'every line downloaded');
const credits = fs.readFileSync(path.join(out, 'CREDITS.md'), 'utf8');
assert.ok(/CC BY/.test(credits) && /Fish Audio/.test(credits), 'credits list attribution sounds and the voice');
fs.rmSync(out, { recursive: true, force: true });

// ---- preparing samples (a stand-in for the browser's AudioBuffer)
class Buf {
  constructor(ch, n, sr) { this.numberOfChannels = ch; this.length = n; this.sampleRate = sr; this.d = Array.from({ length: ch }, () => new Float32Array(n)); }
  get duration() { return this.length / this.sampleRate; }
  getChannelData(k) { return this.d[k]; }
}
const bank = new Bank({ createBuffer: (ch, n, sr) => new Buf(ch, n, sr) });
const sr = 22050, beat = (b, at, f) => { const d = b.getChannelData(0); for (let i = 0; i < sr * 0.12; i++) d[Math.floor(at * sr) + i] += Math.sin(i / sr * 2 * Math.PI * f) * Math.exp(-i / (sr * 0.03)); };
const hb = new Buf(1, sr * 6, sr);
for (let i = 0; i < 6; i++) { beat(hb, 0.3 + i * 0.95, 60); beat(hb, 0.3 + i * 0.95 + 0.28, 70); }   // lub-dub, ~63 bpm
const beats = bank.slices(hb, 0.42, 6, 0.55);
assert.strictEqual(beats.length, 6, 'one slice per heartbeat (lub and dub together), got ' + beats.length);
assert.ok(beats.every((b) => b.duration <= 0.56 && b.duration > 0.3), 'each beat holds its lub-dub');
const long = new Buf(2, sr * 60, sr); for (let k = 0; k < 2; k++) long.getChannelData(k).fill(0.3);
const lp = bank.loopify(long, 40);
assert.ok(Math.abs(lp.duration - 40) < 0.01, 'loops are cut to length (' + lp.duration + ')');
assert.ok(lp.getChannelData(0).every(Number.isFinite), 'loop is finite');
const m = bank.mono(long); assert.strictEqual(m.numberOfChannels, 1);
console.log('audio: ok');
