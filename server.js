// Static file server + WebSocket lobby/game server.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Room } from './shared/room.js';
import { dailySeed } from './shared/world.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};
// url prefix -> directory on disk
const MOUNTS = [
  ['/shared/', path.join(ROOT, 'shared')],
  ['/vendor/three/', path.join(ROOT, 'node_modules', 'three')],
  ['/', path.join(ROOT, 'public')],
];

const server = http.createServer((req, res) => {
  let url;
  try { url = decodeURIComponent(req.url.split('?')[0]); } catch { res.writeHead(400); return res.end(); }
  if (url === '/') url = '/index.html';
  for (const [prefix, dir] of MOUNTS) {
    if (!url.startsWith(prefix)) continue;
    const file = path.normalize(path.join(dir, url.slice(prefix.length)));
    if (!file.startsWith(dir + path.sep)) break;          // no path traversal
    return fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  }
  res.writeHead(404); res.end('Not found');
});

// ------------------------------------------------------------------ lobbies
const rooms = new Map();
const clients = new Map();
let nextClient = 1, nextRoom = 1;

const newCode = () => {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let c;
  do { c = Array.from({ length: 5 }, () => A[(Math.random() * A.length) | 0]).join(''); } while ([...rooms.values()].some((r) => r.code === c));
  return c;
};
const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);
const tell = (c, msg) => { if (c.ws.readyState === 1) c.ws.send(JSON.stringify(msg)); };
const roomList = () => ({ t: 'rooms', rooms: [...rooms.values()].filter((r) => r.isPublic).map((r) => r.info()) });

function leave(c) {
  const room = c.room;
  if (!room) return;
  c.room = null;
  room.members.delete(c.id);
  room.removePlayer(c.id);
  if (room.members.size === 0) rooms.delete(room.id);
}

function join(c, room, msg) {
  const err = room.members.size >= room.max ? 'Lobby is full' : null;
  if (err) return tell(c, { t: 'err', msg: err });
  leave(c);
  room.members.set(c.id, c);
  c.room = room;
  tell(c, { t: 'joined', you: c.id, room: room.id });
  const e = room.addPlayer(c.id, clean(msg.name, 16) || 'Player', msg.char);
  if (e) { room.members.delete(c.id); c.room = null; if (!room.members.size) rooms.delete(room.id); tell(c, { t: 'err', msg: e }); }
}

const wss = new WebSocketServer({ server, maxPayload: 4096 });
wss.on('connection', (ws) => {
  const c = { id: 'p' + nextClient++, ws, room: null, alive: true };
  clients.set(c.id, c);
  ws.on('pong', () => { c.alive = true; });
  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    if (!msg || typeof msg.t !== 'string') return;
    switch (msg.t) {
      case 'list': return tell(c, roomList());
      case 'create': {
        if (rooms.size >= 200) return tell(c, { t: 'err', msg: 'Server is full' });
        const id = 'r' + nextRoom++;
        const room = new Room({
          id, name: clean(msg.name, 24) || 'Lobby', code: newCode(), isPublic: !!msg.pub, max: msg.max, seed: dailySeed(),
          send: (pid, m) => {
            const s = JSON.stringify(m);
            if (pid) { const t = room.members.get(pid); if (t && t.ws.readyState === 1) t.ws.send(s); } else for (const t of room.members.values()) if (t.ws.readyState === 1) t.ws.send(s);
          },
        });
        room.members = new Map();
        rooms.set(id, room);
        return join(c, room, { name: msg.pname, char: msg.char });
      }
      case 'join': {
        const code = clean(msg.code, 8).toUpperCase();
        const room = msg.id ? rooms.get(msg.id) : [...rooms.values()].find((r) => r.code === code);
        if (!room || (msg.id && !room.isPublic)) return tell(c, { t: 'err', msg: 'Lobby not found' });
        return join(c, room, msg);
      }
      case 'leave': return leave(c);
      default:
        if (c.room) { try { c.room.handle(c.id, msg); } catch (e) { console.error('room error', e); } }
    }
  });
  ws.on('close', () => { leave(c); clients.delete(c.id); });
  ws.on('error', () => {});
});

const TICK = 0.05;
setInterval(() => {
  for (const room of rooms.values()) {
    try { room.tick(TICK); } catch (e) { console.error('tick error', e); }
  }
}, TICK * 1000);

setInterval(() => {
  for (const c of clients.values()) {
    if (!c.alive) { c.ws.terminate(); continue; }
    c.alive = false; try { c.ws.ping(); } catch {}
  }
}, 30000);

server.listen(PORT, () => console.log(`The Long Street is running on http://localhost:${PORT}`));
