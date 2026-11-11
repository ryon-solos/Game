# The Long Street

A browser-based first-person horror game, solo or co-op. A long street of apartment blocks, a
thing with eight hands walking it, ten nights to survive. Built from `GAME_SPEC.md`.

## Run it

```bash
npm install
```

```bash
npm start
```

Then open http://localhost:3000. Set `PORT` to change the port.

- **Play alone** runs the whole simulation inside the browser tab.
- **Multiplayer** needs the Node server (it holds the lobbies and runs the monster). Any host that
  runs a long-lived Node process with WebSockets works (Render, Railway, Fly.io, a VPS). Static
  hosts such as Netlify or GitHub Pages cannot run the multiplayer server.

```bash
npm test
```

runs the headless simulation and physics checks.

## How it plays

| | |
|---|---|
| Goal | Collect the night's quota of stars (street, balconies, terraces, flats). Dawn comes 15 s later. Ten nights. |
| Sound | Sprinting, doors, landings and gunshots are heard. Crouch-walking is silent. |
| Hands | Come in through windows and balcony doors. One touch and you are out for the night. |
| Presence | 30 seconds in the same zone and the monster knows exactly where you are. |
| Flare pistols | Spawn in new places every night. A hit stuns the monster; the shot gives your position away. |
| Health | Lost to falls and to debris when it smashes a flat. Restored by bandages and by being indoors at dawn. |

Controls: `WASD` move, `Shift` sprint, `C`/`Ctrl` crouch, `Space` jump, `E` doors, `F` torch,
left click fire, `Esc` menu.

### Decisions on the spec's open questions

1. **Sharing flats:** allowed. Players are solid and can crowd a room, which is a risk in itself.
2. **Stars:** quota is `4 + night + 2 x (extra players)`; about 40% more than the quota spawn.
3. **Nights 1-2:** the monster is too short to reach the 4th floor and terraces, so it rips the
   front wall off flats it cannot reach (and beats on terraces). Debris damages anyone inside.
4. **Smarter each night:** longer memory and better hearing every night; leads moving targets from
   night 3; remembers favourite hiding flats from night 4; opens doors from night 5; pretends to
   leave and doubles back from night 6. More hands in use, deeper reach, taller, faster throughout.
5. **Outside at dawn:** you survive but get no rest (no +40 health).
6. **Daily layout:** in from the start. The street is generated from the UTC date.

## Layout

```
server.js            static files + WebSocket lobbies
shared/world.js      deterministic street generator (runs on server and client)
shared/room.js       authoritative game simulation and monster AI
public/js/game.js    rendering, input, local player
public/js/*.js       world meshes, physics, monster, avatars, audio, post-processing, menus
test/                headless tests
```

All textures and sounds are generated in code; there are no asset downloads.
