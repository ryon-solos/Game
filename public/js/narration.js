// What the thing says. Short lines, picked to fit what just happened, never too often, never the same twice running.
export const LINES = {
  night: ['Come out, come out, wherever you are.', 'Another night. Another meal.', 'I have been waiting for you.', 'Ten nights. You will not see them all.', 'I know this street. Every door. Every room.', 'Did you miss me?'],
  spot: ['There you are.', 'I see you.', 'Found you.', 'Do not run. It makes the meat tender.', 'Peekaboo.'],
  reveal: ['I know where you are.', 'You stayed too long, little one.', 'I can smell you.', 'You should have kept moving.', 'Your hiding place is mine now.'],
  search: ['Where are you hiding?', 'I can hear your heart.', 'Knock, knock.', 'Is anybody home?', 'I will find you.', 'Every room. Every closet.', 'So warm in here. So close.'],
  star: ['Thief.', 'That was mine.', 'Take them. I will take you.', 'Every star you steal, I hear.'],
  wake: ['That hurt. Now I am hungry.', 'You will pay for that.', 'Clever. But not clever enough.', 'Do that again. I dare you.'],
  grab: ['You will taste delicious.', 'Hello, little one.', 'Shh. It will only hurt a lot.', 'Got you.'],
  ate: ['Delicious.', 'One less.', 'Who is next?', 'More. I want more.'],
  hurt: ['You are bleeding. I can smell it.', 'Your blood smells sweet.', 'Limping already?'],
  summon: ['My children are hungry.', 'Go, my little ones. Bring them to me.', 'They will find you in the dark.'],
  bottle: ['A trick? I like games.', 'I heard that. Did you want me to?'],
  idle: ['I am getting closer.', 'I can hear you breathing.', 'You cannot hide forever.', 'So many doors. So little time.', 'Are you scared? Good.', 'I will be gentle. I promise.', 'Your heart is beating so fast.', 'Hush now. Listen. That is me.', 'I can wait all night.'],
  dawn: ['Tomorrow night, then.', 'Run along. I will be back.', 'Sleep well. You will need it.'],
};
// lines that must be heard even if it spoke a moment ago
const URGENT = new Set(['grab', 'ate', 'night']);

export class Narrator {
  constructor(say) {
    this.say = say;                 // (text, kind) => void
    this.last = -1e9; this.recent = []; this.time = 0;
    this.idleT = 30 + Math.random() * 20;
  }
  reset() { this.last = -1e9; this.idleT = 25 + Math.random() * 20; }
  // kind: a key of LINES. chance: how likely it speaks at all. gap: seconds of quiet needed since the last line.
  line(kind, chance = 1, gap = 12) {
    const bank = LINES[kind];
    if (!bank || Math.random() > chance) return false;
    if (!URGENT.has(kind) && this.time - this.last < gap) return false;
    const fresh = bank.filter((l) => !this.recent.includes(l));
    const text = (fresh.length ? fresh : bank)[(Math.random() * (fresh.length || bank.length)) | 0];
    this.recent.push(text); if (this.recent.length > 10) this.recent.shift();
    this.last = this.time; this.idleT = 28 + Math.random() * 30;
    this.say(text, kind);
    return true;
  }
  // every frame. near: the monster is close enough to be talking to you
  update(dt, near) {
    this.time += dt;
    if (!near) return;
    this.idleT -= dt;
    if (this.idleT <= 0) { this.idleT = 28 + Math.random() * 30; this.line('idle', 0.85, 18); }
  }
}
