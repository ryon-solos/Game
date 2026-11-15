#!/usr/bin/env node
// Downloads the game's recorded sounds (see scripts/audio-sources.mjs) into public/audio/ and writes
// public/audio/index.json (what the game loads) and public/audio/CREDITS.md (who made what, under which licence).
//
//   npm run audio              fetch whatever is missing
//   npm run audio -- --force   fetch everything again
//   npm run audio -- --strict  exit with an error if anything could not be fetched (default: warn and carry on,
//                              so a build never fails because freesound is down; the game synthesises what is missing)
//
// Freesound: by default each sound's public page is read for its licence and its preview file (the 128 kbps MP3
// freesound serves to everyone). With FREESOUND_API_KEY set (free, https://freesound.org/apiv2/apply) the API is used
// instead, which is sturdier. Only Creative Commons 0 and Attribution sounds are accepted.
// No dependencies: Node 18+.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SFX, VOICE, FISH_URL, FISH_VOICE } from './audio-sources.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.AUDIO_OUT ? path.resolve(process.env.AUDIO_OUT) : path.join(ROOT, 'public', 'audio');
const args = new Set(process.argv.slice(2));
const FORCE = args.has('--force'), STRICT = args.has('--strict');
// overridable for tests
const FS_BASE = (process.env.FREESOUND_BASE || 'https://freesound.org').replace(/\/$/, '');
const KEY = process.env.FREESOUND_API_KEY || '';
const fishUrl = process.env.FISH_BASE ? (id) => `${process.env.FISH_BASE.replace(/\/$/, '')}/${id}.mp3` : FISH_URL;
const GAP = process.env.AUDIO_FETCH_GAP != null ? +process.env.AUDIO_FETCH_GAP : KEY ? 250 : 600;
const UA = { 'User-Agent': 'the-long-street-audio-fetch/1.0 (+game asset download)' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// a site that cannot be reached at all (offline, blocked) is given up on after a few failures instead of being
// asked for every sound in turn
const down = new Map();   // host -> consecutive network failures
const reachable = (url) => (down.get(new URL(url).host) || 0) < 3;
async function get(url, type = 'text', tries = 3) {
  const host = new URL(url).host;
  if (!reachable(url)) throw new Error(`${host} unreachable`);
  let err;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: UA, redirect: 'follow', signal: AbortSignal.timeout(30000) });
      down.set(host, 0);
      if (r.status === 404) throw Object.assign(new Error(`404 ${url}`), { fatal: true });
      if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
      if (type === 'text') return await r.text();
      if (type === 'json') return await r.json();
      return { buf: Buffer.from(await r.arrayBuffer()), type: r.headers.get('content-type') || '' };
    } catch (e) {
      err = e; if (e.fatal) break;
      if (e.name === 'TypeError' || e.name === 'TimeoutError') { down.set(host, (down.get(host) || 0) + 1); if (!reachable(url)) break; }
      await sleep(800 * (i + 1));
    }
  }
  throw err;
}

// licence from a URL or name: 'cc0' | 'by' | null (refused)
export function licenceOf(s) {
  s = String(s || '').toLowerCase();
  if (/noncommercial|-nc|sampling/.test(s)) return null;
  if (/publicdomain\/zero|creative commons 0|\bcc0\b/.test(s)) return 'cc0';
  if (/licenses\/by\/|attribution/.test(s)) return 'by';
  return null;
}

// read a freesound sound page: { name, user, licence, preview, page }
export function parsePage(html, id) {
  const title = (html.match(/<title>\s*Freesound\s*-\s*([\s\S]*?)<\/title>/i) || [])[1] || '';
  const tm = title.replace(/\s+/g, ' ').trim().match(/^(.*) by ([^ ]+)$/);
  const name = tm ? tm[1] : `sound ${id}`, user = tm ? tm[2] : '';
  const unesc = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  // the preview of this sound, wherever it is on the page (player attributes, og:audio meta, ...)
  const pv = [...html.matchAll(new RegExp(`https?:\\/\\/[^"'\\s<>]*?\\/previews\\/\\d+\\/${id}_\\d+-(hq|lq)\\.(mp3|ogg)`, 'g'))].map((m) => m[0]);
  const preview = pv.find((u) => /-hq\.mp3$/.test(u)) || pv.find((u) => /\.mp3$/.test(u)) || pv[0] || null;
  // the sound's own licence is the first Creative Commons link on its page (a description can link others further down)
  const link = (html.match(/creativecommons\.org\/(?:publicdomain\/zero|licenses\/[a-z+-]+)\/[\d.]+/i) || [])[0];
  const licence = link ? licenceOf(link) : null;
  return { name: unesc(name), user, licence, licenceUrl: link ? 'https://' + link.toLowerCase() : null, preview };
}

async function freesound(id) {
  if (KEY) {
    const j = await get(`${FS_BASE}/apiv2/sounds/${id}/?fields=id,name,username,license,previews,url&token=${encodeURIComponent(KEY)}`, 'json');
    return { name: j.name, user: j.username, licence: licenceOf(j.license), licenceUrl: j.license, preview: j.previews && (j.previews['preview-hq-mp3'] || j.previews['preview-lq-mp3']), page: j.url };
  }
  const html = await get(`${FS_BASE}/s/${id}/`);
  const p = parsePage(html, id);
  return { ...p, page: p.user ? `https://freesound.org/people/${p.user}/sounds/${id}/` : `https://freesound.org/s/${id}/` };
}

function readIndex() { try { return JSON.parse(fs.readFileSync(path.join(OUT, 'index.json'), 'utf8')); } catch { return null; } }
const isAudio = (b, type) => /audio|octet-stream/.test(type) && b.length > 2000 && (b.slice(0, 3).toString() === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) || b.slice(0, 4).toString() === 'OggS');

async function main() {
  fs.mkdirSync(path.join(OUT, 'sfx'), { recursive: true });
  fs.mkdirSync(path.join(OUT, 'voice'), { recursive: true });
  const prev = (!FORCE && readIndex()) || { sfx: {}, voice: {} };
  const index = { sfx: {}, voice: {}, credits: [] };
  const missing = [];

  // ---- freesound
  for (const [key, slot] of Object.entries(SFX)) {
    const have = (prev.sfx[key] || []).filter((e) => fs.existsSync(path.join(OUT, e.file)));
    if (have.length >= Math.min(slot.keep, slot.ids.length)) { index.sfx[key] = have; continue; }
    const got = [];
    for (const id of slot.ids) {
      if (got.length >= slot.keep) break;
      try {
        const s = await freesound(id);
        if (!s.licence) { console.warn(`  - ${key}: #${id} skipped (licence not CC0/CC-BY)`); continue; }
        if (!s.preview) { console.warn(`  - ${key}: #${id} skipped (no preview found)`); continue; }
        const { buf, type } = await get(s.preview, 'bin');
        if (!isAudio(buf, type)) { console.warn(`  - ${key}: #${id} skipped (not an audio file)`); continue; }
        if (buf.length > (slot.maxMB || 3) * 1048576) { console.warn(`  - ${key}: #${id} skipped (${(buf.length / 1048576).toFixed(1)} MB is too big)`); continue; }
        const file = `sfx/${key}-${got.length + 1}.mp3`;
        fs.writeFileSync(path.join(OUT, file), buf);
        got.push({ file, id, name: s.name, user: s.user, licence: s.licence, licenceUrl: s.licenceUrl, page: s.page });
        console.log(`  + ${key}: #${id} "${s.name}" by ${s.user} (${s.licence === 'cc0' ? 'CC0' : 'CC BY'}, ${(buf.length / 1024) | 0} KB)`);
      } catch (e) { console.warn(`  - ${key}: #${id} failed: ${e.message}`); }
      if (reachable(FS_BASE)) await sleep(GAP);   // be gentle with freesound
    }
    if (got.length) index.sfx[key] = got; else missing.push(key);
  }

  // ---- the monster's lines (Fish Audio)
  for (const [kind, ids] of Object.entries(VOICE)) {
    index.voice[kind] = [];
    for (let i = 0; i < ids.length; i++) {
      const file = `voice/${kind}-${i}.mp3`, full = path.join(OUT, file);
      if (!FORCE && fs.existsSync(full) && fs.statSync(full).size > 2000) { index.voice[kind][i] = file; continue; }
      try {
        const { buf, type } = await get(fishUrl(ids[i]), 'bin');
        if (!isAudio(buf, type)) throw new Error('not an audio file');
        fs.writeFileSync(full, buf); index.voice[kind][i] = file;
      } catch (e) { index.voice[kind][i] = null; missing.push(`${kind}-${i}`); console.warn(`  - voice ${kind}-${i} failed: ${e.message}`); }
    }
  }
  const voiceN = Object.values(index.voice).flat().filter(Boolean).length;
  console.log(`  voice: ${voiceN} of ${Object.values(VOICE).flat().length} lines`);

  // ---- credits
  const rows = [];
  for (const [key, list] of Object.entries(index.sfx)) for (const e of list) rows.push(`| ${key} | [${e.name}](${e.page}) | ${e.user} | ${e.licence === 'cc0' ? '[CC0](https://creativecommons.org/publicdomain/zero/1.0/)' : `[CC BY](${e.licenceUrl})`} |`);
  // written only when they change, so a run that fetches nothing new leaves the files (and git) untouched
  const put = (f, text) => { const full = path.join(OUT, f); if (!fs.existsSync(full) || fs.readFileSync(full, 'utf8') !== text) fs.writeFileSync(full, text); };
  put('CREDITS.md', [
    '# Sound credits', '',
    'Downloaded by `npm run audio` (scripts/fetch-audio.mjs). Sound effects and music are from [freesound.org](https://freesound.org), used under the licence shown. Sounds marked CC BY require this credit to stay with the game.', '',
    '| Used for | Sound | By | Licence |', '|---|---|---|---|', ...rows, '',
    `The monster's voice lines were generated with [Fish Audio](https://fish.audio) (voice "${FISH_VOICE.title}", model ${FISH_VOICE.model}).`, '',
  ].join('\n'));
  index.credits = Object.values(index.sfx).flat().filter((e) => e.licence === 'by').map((e) => `${e.name} by ${e.user}`);
  put('index.json', JSON.stringify(index, null, 1) + '\n');

  const sfxN = Object.keys(index.sfx).length;
  console.log(`\nSound effects: ${sfxN} of ${Object.keys(SFX).length} slots. Wrote ${path.relative(ROOT, OUT) || OUT}/index.json and CREDITS.md.`);
  if (missing.length) {
    console.warn(`Not fetched (the game synthesises these instead): ${missing.join(', ')}`);
    if (STRICT) process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e); process.exit(STRICT ? 1 : 0); });
