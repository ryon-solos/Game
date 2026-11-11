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
| Goal | Take the night's quota of stars (street, balconies, terraces, flats, inside closets). Dawn comes 15 s later. Ten nights. |
| Stars | Face one and press `E`. It takes about a second, and the star cries out: the monster learns where it was taken. |
| Sound | Sprinting, doors, landings and gunshots are heard. Crouch-walking is silent. |
| Hands | Come in through windows and balcony doors and reach every room. A closed door only delays a hand. One touch and it lifts you to its mouth and eats you. |
| Closets | Open with `E`, step in, press `E` to shut it. A hand that is only feeling around passes over a closed closet; one that knows you are there opens it. |
| Presence | 30 seconds in the same zone (closet or not) and the monster knows exactly where you are. |
| Speed | The monster roams slowly, hurries to a sound (x1.7) and charges when it has seen you or knows where you are (x1.9). |
| Crawlers | From night 3 the monster summons them into the buildings: at half the star quota, after being stunned, and periodically. They hunt stairwells and flats for about a minute, bite (30+ damage), shriek your position to the street, and sometimes pull closets open. 1 on nights 3-4, 2 on nights 5-7, 3 on nights 8-10. |
| Flare pistols | Spawn in new places every night. A hit stuns the monster; it wakes up knowing where the shot came from. |
| Health | Lost to falls, debris and crawler bites. Restored by bandages and by being indoors at dawn. |

Controls: `WASD` move, `Shift` sprint, `C`/`Ctrl` crouch, `Space` jump, `E` doors / closets / stars,
`F` torch, left click fire, `Esc` menu.

### Decisions on the spec's open questions

1. **Sharing flats:** allowed. Players are solid and can crowd a room, which is a risk in itself.
2. **Stars:** quota is `4 + night + 2 x (extra players)`; about 40% more than the quota spawn.
3. **Nights 1-2:** the monster (9.3 m and 10.6 m tall) cannot reach the 4th floor and terraces, so
   it tears the front wall off flats it cannot reach, knocks down terrace parapets and breaks open
   stairwell walls. Debris damages anyone inside. By night 10 it is 21 m tall.
4. **Smarter each night:** longer memory and better hearing every night; leads moving targets from
   night 3 and starts summoning crawlers; remembers favourite hiding flats from night 4; opens
   doors instantly from night 5; pretends to leave and doubles back from night 6.
5. **Outside at dawn:** you survive but get no rest (no +40 health).
6. **Daily layout:** in from the start. The street is generated from the UTC date.

## Layout

```
server.js            static files + WebSocket lobbies
shared/world.js      deterministic street generator (runs on server and client)
shared/room.js       authoritative game simulation and monster AI
public/js/game.js    rendering, input, local player
public/js/*.js       world meshes, physics, monster, crawlers, avatars, audio, post-processing, menus
test/                headless tests
```

All textures and sounds are generated in code; there are no asset downloads.
