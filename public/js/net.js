// Two transports with the same interface: a WebSocket to the server, or an in-browser room for solo play.
import { Room } from '../shared/room.js';
import { dailySeed } from '../shared/world.js';

// Address of the lobby server: ?server=host in the page URL, else config.js, else the host that served the page.
export function serverUrl() {
  let s = new URLSearchParams(location.search).get('server') || window.GAME_SERVER || '';
  const secure = location.protocol === 'https:';
  if (!s) return (secure ? 'wss://' : 'ws://') + location.host;
  if (/^https?:\/\//.test(s)) return s.replace(/^http/, 'ws').replace(/\/+$/, '');
  if (/^wss?:\/\//.test(s)) return s.replace(/\/+$/, '');
  return (secure || !/^(localhost|127\.|192\.168\.|10\.)/.test(s) ? 'wss://' : 'ws://') + s.replace(/\/+$/, '');
}

export class Net {
  constructor(onMsg, onClose) { this.onMsg = onMsg; this.onClose = onClose; this.ws = null; this.solo = false; }
  connect() {
    return new Promise((res, rej) => {
      const ws = this.ws = new WebSocket(serverUrl());
      ws.onopen = () => res();
      ws.onerror = () => rej(new Error('Could not reach the game server'));
      ws.onclose = () => { this.ws = null; this.onClose && this.onClose(); };
      ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } this.onMsg(m); };
    });
  }
  get open() { return this.ws && this.ws.readyState === 1; }
  send(m) { if (this.open) this.ws.send(JSON.stringify(m)); }
  close() { if (this.ws) { this.ws.onclose = null; this.ws.close(); this.ws = null; } }
}

export class LocalNet {
  constructor(onMsg, name, char) {
    this.solo = true; this.paused = false; this.id = 'me';
    this.room = new Room({ id: 'solo', name: 'Solo', seed: dailySeed(), max: 1, solo: true, send: (pid, m) => onMsg(JSON.parse(JSON.stringify(m))) });
    onMsg({ t: 'joined', you: 'me', room: 'solo' });
    this.room.addPlayer('me', name, char);
    let last = performance.now();
    this.timer = setInterval(() => {
      const now = performance.now(); let dt = (now - last) / 1000; last = now;
      if (this.paused) return;
      dt = Math.min(dt, 0.25);
      while (dt > 0.0001) { const s = Math.min(0.05, dt); this.room.tick(s); dt -= s; }
    }, 50);
  }
  get open() { return true; }
  send(m) { this.room.handle('me', m); }
  close() { clearInterval(this.timer); }
}
