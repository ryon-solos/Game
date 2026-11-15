// Where the game's recorded sounds come from. `npm run audio` (scripts/fetch-audio.mjs) downloads them into
// public/audio/ and writes public/audio/index.json, which the game reads at start-up. Anything that is not there is
// synthesised in the browser instead (public/js/audio.js), so the game never depends on these files.
//
// Sound effects and music: freesound.org. Each slot lists sound ids in order of preference; the fetcher checks the
// licence on each sound's page and only takes Creative Commons 0 or Attribution (never NonCommercial, never Sampling+),
// so a listing whose licence has changed is skipped and the next id is tried. `keep` is how many to take (variants
// the game picks between); `maxMB` skips previews too big for the slot.
//
// Narration: the monster's lines were generated with Fish Audio (voice "Monster", model drama-3); the ids are the
// generation task ids, kept in public/js/voicelines.js (in the order of LINES in public/js/narration.js).

export const SFX = {
  // ---- music and beds (looped in the game)
  amb_drone:     { ids: [457046, 567220, 512510], keep: 1, maxMB: 5, note: 'dark pulsing drone under everything' },
  amb_wind:      { ids: [640219, 697217, 662575], keep: 1, maxMB: 3, note: 'night wind in the street' },
  mus_tension:   { ids: [387223, 372602], keep: 1, maxMB: 3, note: 'suspense loop, swells as it gets close' },
  mus_chase:     { ids: [422274, 155139, 479260], keep: 1, maxMB: 3, note: 'action loop while it runs at you' },
  // ---- your body
  heart:         { ids: [688735, 369017, 332821], keep: 1, maxMB: 3, note: 'sliced into single beats and played at your heart rate' },
  breath_scared: { ids: [554307, 151206], keep: 1, maxMB: 2, note: 'shaking, scared breathing while it is close' },
  breath_run:    { ids: [456037, 408835, 85536], keep: 1, maxMB: 2, note: 'heavy panting after a sprint' },
  step_out:      { ids: [535052, 545543, 272253], keep: 1, maxMB: 2, note: 'footsteps on concrete, sliced into single steps' },
  step_in:       { ids: [502507, 874897, 575898], keep: 1, maxMB: 2, note: 'footsteps on creaking boards, sliced into single steps' },
  // ---- the monster
  roar:          { ids: [466830, 837799], keep: 2, maxMB: 2, note: 'roars, also pitched for its shriek and its stunned scream' },
  growl:         { ids: [797697, 442817, 366671], keep: 2, maxMB: 2, note: 'its breathing growl and short snarls' },
  mstep:         { ids: [721601, 622737, 542858], keep: 2, maxMB: 2, note: 'a giant footstep' },
  eat:           { ids: [445987, 574752], keep: 2, maxMB: 1, note: 'bones going' },
  jumpscream:    { ids: [587354, 618112], keep: 1, maxMB: 1, note: 'distorted scream when a flare hits it' },
  // ---- the crawlers
  skitter:       { ids: [521869, 202108, 175228], keep: 2, maxMB: 1, note: 'legs on floorboards' },
  chitter:       { ids: [417299, 467700], keep: 1, maxMB: 1, note: 'insect clicking under the screech' },
  // ---- things breaking
  glass:         { ids: [613879, 389804, 221528, 203368], keep: 2, maxMB: 1, note: 'windows and bottles' },
  woodbreak:     { ids: [443293, 520720, 115917], keep: 2, maxMB: 1, note: 'furniture and doors smashed' },
  crash:         { ids: [703247, 712918, 487142], keep: 2, maxMB: 2, note: 'masonry and debris coming down' },
  wallhit:       { ids: [640198], keep: 1, maxMB: 3, note: 'hammer blows on brick, sliced into single hits (a fist against the wall)' },
  // ---- doors and you
  door:          { ids: [367052, 346267, 414493], keep: 1, maxMB: 1, note: 'a wooden door creaking open' },
  doorslam:      { ids: [402465, 452600], keep: 1, maxMB: 1, note: 'a heavy door slammed' },
  closet:        { ids: [644430, 346267], keep: 1, maxMB: 1, note: 'a small door with a creak' },
  gun:           { ids: [427594, 427592, 402789], keep: 1, maxMB: 1, note: 'the flare pistol' },
  // ---- the dark
  thunder:       { ids: [486557, 647422, 249508], keep: 1, maxMB: 2, note: 'far thunder' },
  bell:          { ids: [149057, 425172, 390120], keep: 1, maxMB: 2, note: 'the church bell at dawn' },
  knock:         { ids: [256513, 662966, 567607, 458007], keep: 1, maxMB: 1, note: 'knocking that is not there' },
  whisper:       { ids: [234044, 339827, 316797, 194628], keep: 2, maxMB: 2, note: 'whispering that is not there' },
  scream:        { ids: [609973, 384213, 673427], keep: 1, maxMB: 1, note: 'a scream far off down the street' },
  musicbox:      { ids: [414490, 274379, 236813], keep: 1, maxMB: 2, note: 'a music box somewhere in the flats' },
};

export const FISH_VOICE = { id: '80d671cd611e4bf2813816b68810b052', title: 'Monster', model: 'drama-3' };
// the line ids and Fish's address are shared with the game
export { VOICE_IDS as VOICE, FISH_URL } from '../public/js/voicelines.js';
