# The Long Street

A browser-based first-person horror game, solo or co-op. A long street of apartment blocks, a
thing with eight hands walking it, ten nights to survive. Built from `GAME_SPEC.md`.

## Run it on your own computer

You need [Node.js](https://nodejs.org) 18 or newer and Git. First time only:

```bash
git clone https://github.com/ryon-solos/Game.git
```

```bash
cd Game
```

After that, one command pulls the latest code from GitHub, installs anything new, downloads the game's sounds and
starts the game:

```bash
npm run play
```

Then open http://localhost:3000. (`./play.sh` on macOS/Linux and double-clicking `play.bat` on
Windows do the same thing.) Other commands:

| Command | What it does |
|---|---|
| `npm start` | Run the game without updating |
| `npm run dev` | Run it and restart the server whenever server code changes (browser code only needs a page refresh) |
| `npm run update` | Only pull the latest code and install dependencies |
| `npm run audio` | Download the recorded sounds and the monster's voice into `public/audio/` |
| `npm test` | Headless simulation, physics, crawler and audio-download checks |
| `PORT=4000 npm start` | Use another port |

### Playing with friends from your computer

- **Same Wi-Fi:** when the server starts it prints an "on your network" address such as
  `http://192.168.1.20:3000`. Friends on the same network open that.
- **Over the internet, no account, free:** install
  [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
  and, while the game is running, run the command below. It prints a temporary public
  `https://….trycloudflare.com` address that anyone can open. It lasts until you close it.

```bash
cloudflared tunnel --url http://localhost:3000
```

## Hosting

The game has two parts. The **front-end** is static files. The **multiplayer server** (`server.js`)
is a long-running Node process that keeps WebSocket connections open; it also serves the
front-end, so hosting the server alone is enough.

| Host | Solo | Multiplayer | Notes |
|---|---|---|---|
| **Render** (free web service) | yes | yes | Runs `server.js` as is. Config is in `render.yaml`. Sleeps after 15 minutes without traffic and takes about a minute to wake. |
| **GitHub Pages** (free) | yes | only with a server elsewhere | Static only. Deployed automatically from `main` by `.github/workflows/pages.yml`. |
| **Netlify** (any plan) | yes | only with a server elsewhere | Static only: Netlify cannot run a WebSocket server on any plan. Config is in `netlify.toml`. |

### Free, everything in one place: Render

1. Sign in at https://render.com with GitHub.
2. New > Blueprint, pick this repository. Render reads `render.yaml` and creates the service.
3. It gives you an address like `https://the-long-street.onrender.com`. That is the whole game,
   solo and multiplayer. Every push to `main` redeploys it.

### Static front-end (GitHub Pages or Netlify) + server on Render

Set the server's address as `GAME_SERVER` (for example `the-long-street.onrender.com`):

- **GitHub Pages:** repository Settings > Secrets and variables > Actions > Variables.
- **Netlify:** Site configuration > Environment variables.

Without it the static site still plays solo. For a quick test you can also add
`?server=the-long-street.onrender.com` to the page address.

```bash
npm run build:static
```

builds the static front-end into `dist/` (set `GAME_SERVER` in the environment to bake the
address in).

## How it plays

| | |
|---|---|
| Goal | Take the night's quota of stars (street, balconies, terraces, flats, inside closets). Dawn comes 15 s later. Ten nights. |
| Stars | Face one and press `E`. It takes about a second, and the star cries out: the monster learns where it was taken. |
| Sound | Sprinting, doors, landings and gunshots are heard. Crouch-walking is silent. |
| Patrol | With nothing to go on, the monster walks its rounds from one end of the street to the other, stopping to listen. |
| Hands | Solid. They come in through windows and balcony doors and reach every room, but walls, doors and furniture are in their way: a hand that hits a wall strains at it, pulls back once, then punches through. Glass and furniture are simply smashed. One touch and it carries you out through the hole it made, lifts you to its face and eats you. |
| Destruction | Every wall section, pane, door, wardrobe, piece of furniture, car, lamp and cable can be broken, by its hands or by its body walking through. The pieces fall, bounce and stay where they land, and the damage lasts for the rest of the game. Standing next to a wall that is punched in hurts. |
| Bottles | Pick them up with `E` (up to 3), throw with `G`. The smash is loud: it goes to look. |
| Closets | Open with `E`, step in, press `E` to shut it. A hand that is only feeling around passes over a closed closet; one that knows you are there opens it. |
| Presence | 30 seconds in the same zone (closet or not) and the monster knows exactly where you are. |
| Speed | The monster roams slowly, hurries to a sound (x1.7) and, when it has seen you or knows where you are, drops onto all ten limbs and runs (x1.9). |
| Crawlers | From night 3 the monster summons them into the buildings: at half the star quota, after being stunned, and periodically. They hunt stairwells and flats for about a minute, bite (30+ damage), shriek your position to the street, and nose at a shut closet with someone inside, pulling it open about half the time. 1 on nights 3-4, 2 on nights 5-7, 3 on nights 8-10. |
| Flare pistols | Spawn in new places every night. A hit stuns the monster; it wakes up knowing where the shot came from. |
| Health | Lost to falls, debris and crawler bites. Restored by bandages and by being indoors at dawn. |

Controls: `WASD` move, `Shift` sprint, `C`/`Ctrl` crouch, `Space` jump, `Q`/`R` lean round a corner,
`E` doors / closets / stars / pick up, `F` torch, `G` throw a bottle, left click fire, `Esc` menu.

Things that are only in your head (and only on your screen): whispers and knocks, a figure in a
doorway that is gone when you look straight at it, tailor's dummies that have turned to face you
when you look back, and a torch that gutters when it is close.

### Graphics settings

| | Meant for | What it turns on |
|---|---|---|
| Low | weak laptops, integrated graphics | 75% resolution, small textures, flat surfaces, a 1024 moon shadow round the player, 4 live lights, flat-edged geometry, interiors drawn only close by |
| Medium | an ordinary PC | full resolution, normal-mapped surfaces, a 2048 moon shadow round the player, bloom, anti-aliasing, reflections, sharpening, one shadow-casting lamp |
| High | a real graphics card | large textures with 16x anisotropic filtering, half-resolution ambient occlusion, torch shadows, stronger sharpening, the most rubble; supersamples up to 1.3x when there is headroom |

Every tier uses **dynamic resolution**: once a second it checks the frame rate, drops the render scale when it
falls under about 50 fps and creeps back up when there is room, so the game holds its frame rate instead of
lagging. Turn on **Show FPS** in Settings to see the frame rate and current render scale. All tiers share an
exponential height fog (thick in the street, thinning towards the roofs, drifting in slow banks), and the moon's
shadow map follows the player instead of covering the whole street, which makes shadows several times sharper
for the same cost. Shaders are compiled while the menu loads, so nothing hitches the first time it comes into view.

The game starts on Medium; change it under Settings. From the menu the street is rebuilt at once; changed mid-game, it applies when you return to the menu.

### Sound

The game uses **recorded sounds** where they have been downloaded and **synthesises** everything else in the
browser with WebAudio, so it always has sound, files or no files.

- **Recordings:** footsteps, doors, glass, wood and masonry breaking, the flare pistol, the monster's roars, growl,
  stomps and eating, the crawlers' skittering, a heartbeat, heavy and scared breathing, night wind, a dark drone, a
  suspense loop and a chase loop, thunder, a church bell, knocking, whispers, a far scream and a music box. All are
  from [freesound.org](https://freesound.org) under Creative Commons 0 or Attribution; credits are written to
  `public/audio/CREDITS.md`. The sources are listed in `scripts/audio-sources.mjs`.
- **The monster's voice:** 59 lines ("You will taste delicious.", "I can hear your heart.", "Thief.") recorded with
  [Fish Audio](https://fish.audio) in a deep, raspy voice, played from its mouth, slowed a little, with weight and grit
  added and its own throat breathing under the words. Lines are always subtitled; switch the voice off under
  Settings > Monster voice. There is no computer voice: without the recordings the lines are subtitles and a growl.
- **Music that follows the danger:** the drone is always there; the suspense loop swells in as the monster gets
  close; the chase loop takes over when it drops onto all ten limbs and runs at you.
- **Your body:** the heartbeat is single recorded beats played at your heart rate (calm 62 bpm, past 160 running
  scared, louder with fear, exertion and low health); heavy panting comes in after a sprint and shaking, scared
  breathing when it is close, quieter when you crouch still and hold it.
- **3D sound:** effects are placed round you with HRTF panning (you can tell front from behind), muffled when a
  wall is between you and them, and sent to the reverb of the space they happen in: the long street, with its
  slap echo between the facades, or a small room.

**Getting the recordings.** They are downloaded, not stored in the code:

```bash
npm run audio
```

This fetches whatever is missing into `public/audio/` (about 10 MB) and is safe to run again. `npm run play`, the
GitHub Pages workflow, Netlify and Render run it for you. To put the files in the repository once for everyone, run
the **Fetch game audio** workflow from the Actions tab: it downloads them and commits them to the branch. Each
freesound sound's licence is checked when it is downloaded; anything that is not CC0 or CC BY is skipped and the next
choice for that slot is used. A free `FREESOUND_API_KEY` (https://freesound.org/apiv2/apply) makes the download use
freesound's API instead of its web pages.

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
play.sh / play.bat   update from GitHub and run locally
render.yaml          Render (server) deployment
netlify.toml         Netlify (static front-end) deployment
.github/workflows/   GitHub Pages deployment of the static front-end; "Fetch game audio" (commits the sounds)
scripts/             static build, audio download (fetch-audio.mjs) and its source list (audio-sources.mjs)
public/audio/        downloaded sounds and their credits (made by npm run audio)
public/config.js     address of the multiplayer server for static hosting
shared/world.js      deterministic street generator (runs on server and client)
shared/room.js       authoritative game simulation and monster AI
public/js/game.js    rendering, input, local player
public/js/*.js       world meshes and breakage, rubble physics, monster, crawlers, avatars, audio, the monster's lines, post-processing, menus
test/                headless tests (simulation, physics, crawler renderer, audio download and sample slicing)
```

All textures are generated in code. Sounds are recordings fetched by `npm run audio` (see Sound above), with every
sound also synthesised in code as a fallback.
