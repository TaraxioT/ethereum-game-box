// Every sound the Box makes: its name, what it means, what it sounds like, and how it is played. Each is layered (a
// body, a texture and a voice) and differs from the others in both timbre and contour (rising, falling, struck,
// held), so a player can tell it in mono through a small speaker. A seat's sound leans to its side of the screen and
// is pitched or voiced differently from the other seat's, since the speaker is mono. Badge taps are short (under
// ~400 ms) and louder than screen touches; fanfares and the match's end run longer.
import type { Seat } from "../../core/types.ts";
import type { Synth } from "./synth.ts";

export type SoundGroup = "badge" | "game" | "screen" | "box";

/** Every sound by name, in the order the sound board plays them. */
export const SOUND_NAMES = [
  "touch", "wake", "join", "again", "card", "sign", "open", "refused", "ignored", "rematch", "refund",
  "pace", "cock", "draw", "shot", "false-start", "tie", "step", "play", "let-go", "bell", "deal", "reel", "land", "flip", "count", "round-won", "over", "round",
  "ui-focus", "ui-select", "ui-back", "ui-up", "ui-down",
  "boot", "block", "error",
] as const;

export type SoundName = (typeof SOUND_NAMES)[number];

export interface SoundOptions {
  /** Whose sound it is: it leans to that side and takes that seat's pitch. */
  readonly seat?: Seat | null;
  /** 0..1: where a rising sound (a count, a stake) has got to. */
  readonly pitch?: number;
}

/** Schedules the sound from `t` (AudioContext seconds) into `out`. */
type Recipe = (s: Synth, out: AudioNode, t: number, o: SoundOptions) => void;

export interface SoundEntry {
  readonly name: SoundName;
  readonly group: SoundGroup;
  /** Its name in plain words. */
  readonly label: string;
  /** When it plays. */
  readonly meaning: string;
  /** What it sounds like. */
  readonly sounds: string;
  /** It takes a seat: the board plays it for Player 1, then Player 2. */
  readonly seated?: boolean;
  /** It rises with `pitch`: the board plays it climbing. */
  readonly rising?: boolean;
  readonly play: Recipe;
}

/** Note frequencies (Hz). */
const N = {
  E4: 329.63, A4: 440, C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, A5: 880,
  C6: 1046.5, D6: 1174.66, E6: 1318.51, G6: 1567.98, A6: 1760, B6: 1975.53, C7: 2093, E7: 2637.02,
} as const;

/** Player 1's value, Player 2's, and the value for nobody's (Player 1's unless given). */
const bySeat = (seat: Seat | null | undefined, one: number, two: number, none = one): number =>
  seat === 0 ? one : seat === 1 ? two : none;

const clamp01 = (x: number | undefined): number => Math.max(0, Math.min(1, x ?? 0));

/** A heavy stamp: a thunk, a slap of noise and a short bright chime at `chime` Hz. */
function stamp(s: Synth, o: AudioNode, t: number, chime: number): void {
  s.thump(o, t, 120, 40, 0.6, 0.2);
  s.noise(o, t, { filter: "lowpass", freq: 900, to: 220, dur: 0.08, gain: 0.34 });
  s.noise(o, t, { filter: "highpass", freq: 3000, dur: 0.012, gain: 0.12, attack: 0.001 });
  s.bell(o, t + 0.05, chime, 0.08, 0.3);
}

/** A bright coin: a high bell with a clink of square on top. */
function coin(s: Synth, o: AudioNode, t: number, freq: number, gain: number): void {
  s.bell(o, t, freq, gain, 0.14);
  s.tone(o, t, { type: "square", freq: freq * 1.5, dur: 0.02, gain: gain * 0.25, attack: 0.001, lowpass: 7000 });
}

/** A noise riser `dur` long into a hit with a chime at `chime` Hz that rings for `ring` seconds. */
function riserHit(s: Synth, o: AudioNode, t: number, dur: number, chime: number, ring = 0.25): void {
  s.noise(o, t, { filter: "highpass", freq: 300, to: 6000, dur, gain: 0.12, attack: dur * 0.9 });
  s.tone(o, t, { type: "sawtooth", freq: 200, to: 800, dur, gain: 0.03, attack: dur * 0.9, lowpass: 1800 });
  const hit = t + dur;
  s.thump(o, hit, 150, 50, 0.45, Math.min(0.22, ring));
  s.noise(o, hit, { filter: "lowpass", freq: 2000, to: 400, dur: 0.1, gain: 0.2 });
  s.tone(o, hit, { type: "triangle", freq: chime, dur: ring, gain: 0.07 });
  s.tone(o, hit, { type: "triangle", freq: chime * 1.5, dur: ring, gain: 0.05 });
}

/** A short major fanfare on `root`. */
function fanfare(s: Synth, o: AudioNode, t: number, root: number): void {
  [1, 1.26, 1.5].forEach((r, i) => s.brass(o, t + i * 0.085, root * r, 0.05, 0.16));
  const held = t + 0.255;
  s.thump(o, held, 140, 60, 0.25, 0.2);
  s.brass(o, held, root * 2, 0.06, 0.6);
  s.brass(o, held, root * 1.5, 0.035, 0.55);
  s.brass(o, held, root * 1.26, 0.03, 0.5);
  s.bell(o, held + 0.05, root * 4, 0.03, 0.5);
}

export const SOUNDS: readonly SoundEntry[] = [
  // ── Badge taps on the stations ──────────────────────────────────────────────────────────────────────────────────
  {
    name: "touch", group: "badge", seated: true, label: "Chip lands",
    meaning: "A chip lands on a reader, before its read finishes; in Stock Duel, the touch that freezes the lit card",
    sounds: "A quick rising zip with a contact click. Player 1 low, Player 2 high",
    play(s, o, t, { seat }) {
      const k = bySeat(seat, 0.8, 1.26, 1);
      s.noise(o, t, { filter: "highpass", freq: 4500, dur: 0.015, gain: 0.08, attack: 0.001 });
      s.thump(o, t, 240 * k, 120 * k, 0.16, 0.05);
      s.tone(o, t, { type: "sawtooth", freq: 280 * k, to: 1500 * k, dur: 0.13, gain: 0.07, lowpass: 2400 * k });
      s.tone(o, t, { freq: 600 * k, to: 2400 * k, dur: 0.12, gain: 0.06 });
    },
  },
  {
    name: "wake", group: "badge", label: "Wakes the Box",
    meaning: "A tap on the attract screen wakes the Box to Home",
    sounds: "A bright power-up shimmer: a sweep up into three rising bells",
    play(s, o, t) {
      s.thump(o, t, 90, 50, 0.35, 0.22);
      s.noise(o, t, { filter: "bandpass", freq: 600, to: 6000, dur: 0.3, gain: 0.1, attack: 0.2, q: 1.2 });
      s.tone(o, t, { type: "sawtooth", freq: 220, to: 880, dur: 0.26, gain: 0.035, lowpass: 3000, attack: 0.1 });
      s.bell(o, t + 0.08, N.E6, 0.06, 0.25);
      s.bell(o, t + 0.13, N.B6, 0.05, 0.25);
      s.bell(o, t + 0.18, N.E7, 0.04, 0.25);
    },
  },
  {
    name: "join", group: "badge", seated: true, label: "Takes a seat",
    meaning: "A badge takes a seat on Home or Join",
    sounds: "A two-note bell chime: Player 1 a fifth (C, G), Player 2 a sixth (E, C) that completes the chord",
    play(s, o, t, { seat }) {
      const [a, b] = seat === 1 ? [N.E6, N.C7] : [N.C6, N.G6];
      s.thump(o, t, 180, 90, 0.2, 0.08);
      s.noise(o, t, { filter: "highpass", freq: 5000, dur: 0.03, gain: 0.05 });
      s.bell(o, t, a, 0.1, 0.35);
      s.bell(o, t + 0.09, b, 0.1, 0.4);
    },
  },
  {
    name: "again", group: "badge", seated: true, label: "Already seated",
    meaning: "A badge taps the seat it already holds (and a built game takes a tap)",
    sounds: "A soft single tick of wood and triangle. Player 1 lower, Player 2 higher",
    play(s, o, t, { seat }) {
      const f = bySeat(seat, 1320, 1760, 1540);
      s.thump(o, t, 300, 200, 0.08, 0.03);
      s.noise(o, t, { filter: "bandpass", freq: 3000, dur: 0.015, gain: 0.05, q: 1.4 });
      s.tone(o, t, { type: "triangle", freq: f, dur: 0.07, gain: 0.07, attack: 0.002 });
    },
  },
  {
    name: "card", group: "badge", seated: true, label: "Shows a card",
    meaning: "A badge taps in the lobby: its card (name, balance) comes up",
    sounds: "A card drawn from a deck: a quick double flick, then one soft bell. Player 1 lower, Player 2 higher",
    play(s, o, t, { seat }) {
      s.thump(o, t, 200, 120, 0.12, 0.05);
      s.noise(o, t, { filter: "bandpass", freq: 2600, to: 1500, dur: 0.05, gain: 0.16, q: 1.4 });
      s.noise(o, t + 0.06, { filter: "bandpass", freq: 3400, to: 2000, dur: 0.05, gain: 0.12, q: 1.4 });
      s.bell(o, t + 0.11, bySeat(seat, N.A5, N.D6), 0.07, 0.3);
    },
  },
  {
    name: "sign", group: "badge", seated: true, label: "Signs the stake",
    meaning: "A seated badge signs the stake",
    sounds: "A stamp coming down: a heavy thunk, a slap of noise and a short bright chime (G for Player 1, B for Player 2)",
    play(s, o, t, { seat }) {
      stamp(s, o, t, bySeat(seat, N.G6, N.B6));
    },
  },
  {
    name: "open", group: "badge", seated: true, label: "Stakes lock",
    meaning: "The second signature: the stakes lock and the match opens",
    sounds: "The stamp, then a rising cascade of coins into a hit",
    play(s, o, t, { seat }) {
      stamp(s, o, t, bySeat(seat, N.G6, N.B6));
      for (let i = 0; i < 6; i++) coin(s, o, t + 0.09 + i * 0.026, 1760 * Math.pow(2, i / 6), 0.045);
      const hit = t + 0.25;
      s.thump(o, hit, 140, 45, 0.45, 0.16);
      s.noise(o, hit, { filter: "lowpass", freq: 2500, to: 400, dur: 0.1, gain: 0.2 });
      s.tone(o, hit, { type: "triangle", freq: N.G5, dur: 0.18, gain: 0.07 });
      s.tone(o, hit, { type: "triangle", freq: N.D6, dur: 0.18, gain: 0.05 });
    },
  },
  {
    name: "refused", group: "badge", seated: true, label: "Refused",
    meaning: "The badge can't cover the stake (it is sent to the lobby)",
    sounds: "A low double buzz, square and soft, with a dull body under each",
    play(s, o, t, { seat }) {
      const f = bySeat(seat, 165, 196);
      for (const d of [0, 0.14]) {
        s.thump(o, t + d, 120, 80, 0.12, 0.08);
        s.tone(o, t + d, { type: "square", freq: f, to: f * 0.91, dur: 0.09, gain: 0.08, lowpass: 900, attack: 0.006 });
      }
    },
  },
  {
    name: "ignored", group: "badge", seated: true, label: "Meant nothing",
    meaning: "The chip was read and the tap meant nothing here",
    sounds: "A dull short knock on wood",
    play(s, o, t, { seat }) {
      const k = bySeat(seat, 1, 1.2);
      s.thump(o, t, 260 * k, 140 * k, 0.28, 0.06);
      s.noise(o, t, { filter: "lowpass", freq: 700, dur: 0.03, gain: 0.14 });
      s.tone(o, t, { type: "triangle", freq: 420 * k, dur: 0.04, gain: 0.04 });
    },
  },
  {
    name: "rematch", group: "badge", label: "Rematch",
    meaning: "A seated badge asks for a rematch on the result",
    sounds: "A short noise riser into a hit, the new round's family",
    play(s, o, t) {
      riserHit(s, o, t, 0.22, N.C6, 0.18);
    },
  },
  {
    name: "refund", group: "badge", seated: true, label: "Refund",
    meaning: "A seated badge claims its refund",
    sounds: "A falling cascade of bright coins that lands in the hand",
    play(s, o, t, { seat }) {
      const top = bySeat(seat, 3520, 3950);
      for (let i = 0; i < 7; i++) coin(s, o, t + i * 0.045, top * Math.pow(2, -i / 7), 0.05);
      s.thump(o, t + 0.32, 200, 100, 0.15, 0.08);
    },
  },

  // ── The games ───────────────────────────────────────────────────────────────────────────────────────────────────
  {
    name: "pace", group: "game", label: "A pace",
    meaning: "Quick Draw: the gunslingers' boots land as they pace apart while the stakes go in",
    sounds: "A boot heel on dry ground with a faint jingle of spurs",
    play(s, o, t) {
      s.thump(o, t, 110, 55, 0.3, 0.08);
      s.noise(o, t, { filter: "lowpass", freq: 1400, to: 300, dur: 0.09, gain: 0.22 });
      s.noise(o, t + 0.01, { filter: "bandpass", freq: 2600, dur: 0.05, gain: 0.05, q: 1.2 });
      s.bell(o, t + 0.03, 3900, 0.012, 0.12);
      s.bell(o, t + 0.07, 4700, 0.008, 0.1);
    },
  },
  {
    name: "cock", group: "game", seated: true, label: "Hammer back",
    meaning: "Quick Draw: a gunslinger thumbs the revolver's hammer back before the standoff",
    sounds: "A two-part metal click, the cylinder turning and the hammer catching. Player 1 lower, Player 2 higher",
    play(s, o, t, { seat }) {
      const k = bySeat(seat, 0.9, 1.15);
      s.noise(o, t, { filter: "bandpass", freq: 3200 * k, dur: 0.018, gain: 0.2, q: 3, attack: 0.001 });
      s.tone(o, t, { type: "square", freq: 1900 * k, dur: 0.012, gain: 0.03, attack: 0.001 });
      s.noise(o, t + 0.07, { filter: "bandpass", freq: 4600 * k, dur: 0.022, gain: 0.26, q: 4, attack: 0.001 });
      s.tone(o, t + 0.07, { type: "square", freq: 2700 * k, dur: 0.014, gain: 0.035, attack: 0.001 });
      s.thump(o, t + 0.07, 400 * k, 260 * k, 0.06, 0.03);
    },
  },
  {
    name: "draw", group: "game", label: "DRAW",
    meaning: "Quick Draw: the sign turns to DRAW",
    sounds: "A card-flip whoosh up into a sharp crack of an accent",
    play(s, o, t) {
      s.noise(o, t, { filter: "bandpass", freq: 500, to: 4500, dur: 0.18, gain: 0.18, q: 0.9, attack: 0.08 });
      const hit = t + 0.16;
      s.thump(o, hit, 200, 80, 0.28, 0.08);
      s.noise(o, hit, { filter: "highpass", freq: 3000, dur: 0.025, gain: 0.25, attack: 0.001 });
      s.tone(o, hit, { type: "square", freq: 2200, dur: 0.03, gain: 0.05, attack: 0.001, lowpass: 5000 });
    },
  },
  {
    name: "shot", group: "game", seated: true, label: "Good draw",
    meaning: "Quick Draw: the winner's good draw",
    sounds: "A gunshot: a crack of noise over a fast thump, and its echo. Player 1 deeper, Player 2 higher",
    play(s, o, t, { seat }) {
      const k = bySeat(seat, 1, 1.45);
      s.thump(o, t, 180 * k, 50 * k, 0.7, 0.14);
      s.noise(o, t, { filter: "lowpass", freq: 7000, to: 1500, dur: 0.09, gain: 0.55, attack: 0.001 });
      s.noise(o, t + 0.04, { filter: "bandpass", freq: 1400 * k, to: 400 * k, dur: 0.25, gain: 0.08, q: 0.7 });
    },
  },
  {
    name: "false-start", group: "game", seated: true, label: "Foul",
    meaning: "Quick Draw: a tap before DRAW, and the fouler's gun blows up in the hand",
    sounds: "A muffled bang and a burst of crackle, then a sour, detuned fall: clearly a mistake",
    play(s, o, t, { seat }) {
      const k = bySeat(seat, 0.9, 1.1);
      s.thump(o, t, 140 * k, 40, 0.6, 0.22);
      s.noise(o, t, { filter: "lowpass", freq: 2400, to: 300, dur: 0.35, gain: 0.45, attack: 0.001 });
      for (let i = 0; i < 6; i++) s.noise(o, t + 0.05 + i * 0.035, { filter: "bandpass", freq: 3000 + i * 400, dur: 0.02, gain: 0.08, q: 2, attack: 0.001 });
      for (const f of [440, 466.16]) s.tone(o, t + 0.18, { type: "sawtooth", freq: f * k, to: f * k * 0.7, dur: 0.4, gain: 0.05, lowpass: 1600 });
    },
  },
  {
    name: "tie", group: "game", label: "Dead heat",
    meaning: "Quick Draw: a dead heat, or nobody drew; a Stock Duel round tied; a drawn match",
    sounds: "A neutral falling fourth on soft triangles",
    play(s, o, t) {
      s.thump(o, t, 160, 90, 0.12, 0.1);
      s.tone(o, t, { type: "triangle", freq: N.A4, dur: 0.22, gain: 0.1 });
      s.tone(o, t + 0.2, { type: "triangle", freq: N.E4, dur: 0.35, gain: 0.1 });
      s.noise(o, t + 0.2, { filter: "lowpass", freq: 900, dur: 0.05, gain: 0.04 });
    },
  },
  {
    name: "step", group: "game", seated: true, label: "Spotlight steps",
    meaning: "Stock Duel: a seat's spotlight steps to its next card",
    sounds: "A tiny soft blip, quiet enough to run for minutes. Player 1 lower, Player 2 higher",
    play(s, o, t, { seat }) {
      const f = bySeat(seat, 1500, 2000, 1750);
      s.tone(o, t, { freq: f, to: f * 0.82, dur: 0.035, gain: 0.06, attack: 0.002 });
    },
  },
  {
    name: "play", group: "game", seated: true, label: "Card played",
    meaning: "Stock Duel: a seat's card goes down",
    sounds: "A card slammed on the desk: a thunk, a slap of noise and a chime (E for Player 1, A for Player 2)",
    play(s, o, t, { seat }) {
      const chime = bySeat(seat, N.E6, N.A6);
      s.thump(o, t, 150, 46, 0.55, 0.22);
      s.noise(o, t, { filter: "lowpass", freq: 1200, to: 300, dur: 0.07, gain: 0.3 });
      s.bell(o, t + 0.06, chime, 0.07, 0.4);
      s.tone(o, t + 0.06, { type: "triangle", freq: chime * 1.5, dur: 0.3, gain: 0.04 });
    },
  },
  {
    name: "let-go", group: "game", seated: true, label: "Card let go",
    meaning: "Stock Duel: a tap that played nothing lets the held card go",
    sounds: "A soft falling deflate",
    play(s, o, t, { seat }) {
      const k = bySeat(seat, 1, 1.2);
      s.tone(o, t, { freq: 700 * k, to: 220 * k, dur: 0.22, gain: 0.07, attack: 0.01 });
      s.tone(o, t, { type: "triangle", freq: 350 * k, to: 120 * k, dur: 0.2, gain: 0.04, attack: 0.01 });
      s.noise(o, t, { filter: "lowpass", freq: 1500, to: 200, dur: 0.2, gain: 0.05, attack: 0.02 });
    },
  },
  {
    name: "bell", group: "game", label: "Opening bell",
    meaning: "Stock Duel: the stakes are in a block and the market opens",
    sounds: "A trading floor's opening bell: a fast run of bright struck strokes on one bell",
    play(s, o, t) {
      for (let i = 0; i < 8; i++) {
        const at = t + i * 0.085;
        s.bell(o, at, N.E6, 0.07 - i * 0.004, 0.5);
        s.noise(o, at, { filter: "highpass", freq: 5000, dur: 0.01, gain: 0.04, attack: 0.001 });
      }
    },
  },
  {
    name: "deal", group: "game", label: "Card dealt",
    meaning: "Stock Duel: a card lands on a drum's rail",
    sounds: "A crisp flick",
    play(s, o, t) {
      s.noise(o, t, { filter: "bandpass", freq: 3200, to: 1300, dur: 0.07, gain: 0.22, q: 1.4 });
      s.tone(o, t + 0.01, { freq: 900, to: 700, dur: 0.03, gain: 0.04 });
    },
  },
  {
    name: "reel", group: "game", label: "Dial click",
    meaning: "Stock Duel: the dial's pointer passes a mark as it turns",
    sounds: "One slot-reel click",
    play(s, o, t) {
      s.tone(o, t, { type: "square", freq: 2400, dur: 0.012, gain: 0.035, attack: 0.001 });
      s.noise(o, t, { filter: "highpass", freq: 3500, dur: 0.01, gain: 0.08, attack: 0.001 });
    },
  },
  {
    name: "land", group: "game", label: "Dial lands",
    meaning: "Stock Duel: the dial settles on the round's stat",
    sounds: "A boom and a bell",
    play(s, o, t) {
      s.thump(o, t, 110, 38, 0.6, 0.45);
      s.noise(o, t, { filter: "lowpass", freq: 600, to: 120, dur: 0.18, gain: 0.32 });
      s.bell(o, t + 0.02, N.C6, 0.11, 0.9);
      s.bell(o, t + 0.02, N.G6, 0.05, 0.7);
    },
  },
  {
    name: "flip", group: "game", label: "Cards turn",
    meaning: "Stock Duel: both cards turn over",
    sounds: "A paper whoosh",
    play(s, o, t) {
      s.noise(o, t, { filter: "bandpass", freq: 800, to: 3500, dur: 0.14, gain: 0.16, q: 0.8, attack: 0.03 });
      s.tone(o, t + 0.12, { freq: 700, to: 500, dur: 0.03, gain: 0.03 });
    },
  },
  {
    name: "count", group: "game", rising: true, label: "Counting up",
    meaning: "Stock Duel: the round's number counts up on the cards. Quick Draw: each beat of the 3-2-1 before a round",
    sounds: "A blip that rises with the value (A4 to A6)",
    play(s, o, t, { pitch }) {
      const f = N.A4 * Math.pow(2, clamp01(pitch) * 2);
      s.tone(o, t, { type: "triangle", freq: f, dur: 0.05, gain: 0.09, attack: 0.002 });
      s.tone(o, t, { freq: f * 2, dur: 0.02, gain: 0.015, attack: 0.001 });
    },
  },
  {
    name: "round-won", group: "game", seated: true, label: "Round won",
    meaning: "A round won (and a game built)",
    sounds: "A short major brass fanfare from the winner's side: Player 1 in C, Player 2 a step up in D",
    play(s, o, t, { seat }) {
      fanfare(s, o, t, bySeat(seat, N.C5, N.D5));
    },
  },
  {
    name: "over", group: "game", seated: true, label: "Match over",
    meaning: "The match is over: the winner's sound",
    sounds: "An arpeggio up into a held chord, with a boom and sparkles. Player 1 in C, Player 2 in D",
    play(s, o, t, { seat }) {
      const k = bySeat(seat, 1, 1.1225);
      [N.C5, N.E5, N.G5, N.C6, N.E6, N.G6].forEach((f, i) => s.brass(o, t + i * 0.1, f * k, 0.04, 0.2));
      const c = t + 0.62;
      s.thump(o, c, 120, 40, 0.55, 0.6);
      s.noise(o, c, { filter: "lowpass", freq: 1500, to: 200, dur: 0.3, gain: 0.15 });
      for (const f of [N.C5, N.E5, N.G5, N.C6]) s.brass(o, c, f * k, 0.035, 1.4);
      s.bell(o, c + 0.05, N.C7 * k, 0.04, 0.8);
      s.bell(o, c + 0.35, N.G6 * k, 0.03, 0.8);
      s.bell(o, c + 0.65, N.E7 * k, 0.025, 0.9);
    },
  },
  {
    name: "round", group: "game", label: "New round",
    meaning: "A match opens, or a new Stock Duel round begins",
    sounds: "A noise riser into a hit",
    play(s, o, t) {
      riserHit(s, o, t, 0.5, N.G5);
    },
  },

  // ── Fingers on the screen ───────────────────────────────────────────────────────────────────────────────────────
  {
    name: "ui-focus", group: "screen", label: "Focus moves",
    meaning: "A touch or arrow key moves the focus (a program on Home)",
    sounds: "A faint glassy tick",
    play(s, o, t) {
      s.tone(o, t, { freq: 1100, to: 1250, dur: 0.04, gain: 0.035, attack: 0.002 });
      s.tone(o, t, { type: "triangle", freq: 2200, dur: 0.02, gain: 0.01, attack: 0.001 });
    },
  },
  {
    name: "ui-select", group: "screen", label: "Select",
    meaning: "A key pressed on the screen: Play, Start, Rematch, Send",
    sounds: "A soft rising pop",
    play(s, o, t) {
      s.tone(o, t, { freq: 660, to: 990, dur: 0.07, gain: 0.05 });
      s.tone(o, t + 0.04, { freq: 1320, dur: 0.06, gain: 0.02 });
    },
  },
  {
    name: "ui-back", group: "screen", label: "Back",
    meaning: "Back, Home or cancel on the screen",
    sounds: "A lower falling pop",
    play(s, o, t) {
      s.tone(o, t, { freq: 520, to: 350, dur: 0.08, gain: 0.045 });
      s.tone(o, t, { type: "triangle", freq: 260, dur: 0.06, gain: 0.02 });
    },
  },
  {
    name: "ui-up", group: "screen", rising: true, label: "Stake up",
    meaning: "A bigger stake picked on the screen",
    sounds: "A small blip that glides up, higher for a bigger stake",
    play(s, o, t, { pitch }) {
      const f = 600 * Math.pow(2, clamp01(pitch));
      s.tone(o, t, { type: "triangle", freq: f, to: f * 1.12, dur: 0.05, gain: 0.045, attack: 0.002 });
    },
  },
  {
    name: "ui-down", group: "screen", rising: true, label: "Stake down",
    meaning: "A smaller stake picked on the screen",
    sounds: "A small blip that glides down, lower for a smaller stake",
    play(s, o, t, { pitch }) {
      const f = 600 * Math.pow(2, clamp01(pitch));
      s.tone(o, t, { type: "triangle", freq: f, to: f * 0.89, dur: 0.05, gain: 0.045, attack: 0.002 });
    },
  },

  // ── The Box ─────────────────────────────────────────────────────────────────────────────────────────────────────
  {
    name: "boot", group: "box", label: "Boot",
    meaning: "The Box powers on",
    sounds: "Dark detuned saws under a low-pass that opens over 1.6 s, a rising hiss, and a bell shimmer as it peaks",
    play(s, o, t) {
      s.thump(o, t, 70, 35, 0.4, 0.8);
      for (const [freq, gain, detune] of [[55, 0.08, -8], [55, 0.08, 8], [110, 0.05, 0]] as const) {
        // The low-pass opens as the saws swell: a filter of its own, swept.
        const lp = s.ctx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.setValueAtTime(180, t);
        lp.frequency.exponentialRampToValueAtTime(2600, t + 1.6);
        lp.connect(o);
        s.tone(lp, t, { type: "sawtooth", freq, dur: 2.8, gain, attack: 0.6, detune });
      }
      s.noise(o, t + 0.3, { filter: "highpass", freq: 400, to: 5000, dur: 1.3, gain: 0.05, attack: 1.2 });
      s.bell(o, t + 1.5, N.E6, 0.04, 1.2);
      s.bell(o, t + 1.62, N.A6, 0.03, 1.2);
    },
  },
  {
    name: "block", group: "box", label: "Block sealed",
    meaning: "A new block on Sepolia (outside a match)",
    sounds: "A low soft thud with a click and a faint high ping",
    play(s, o, t) {
      s.thump(o, t, 70, 45, 0.24, 0.16);
      s.noise(o, t, { filter: "highpass", freq: 3000, dur: 0.01, gain: 0.06, attack: 0.001 });
      s.bell(o, t + 0.01, N.C7, 0.01, 0.15);
    },
  },
  {
    name: "error", group: "box", label: "Trouble",
    meaning: "The Box hit trouble: the stakes couldn't lock, a build failed, a settle was missed",
    sounds: "A low dissonant saw buzz, twice, with a muffled thud",
    play(s, o, t) {
      for (const at of [0, 0.22]) {
        s.thump(o, t + at, 90, 50, 0.2, 0.14);
        s.noise(o, t + at, { filter: "lowpass", freq: 400, dur: 0.12, gain: 0.08 });
        for (const freq of [98, 104]) s.tone(o, t + at, { type: "sawtooth", freq, dur: 0.16, gain: 0.1, lowpass: 900 });
      }
    },
  },
];

const BY_NAME: ReadonlyMap<string, SoundEntry> = new Map(SOUNDS.map((entry) => [entry.name, entry]));

/** The sound called `name`; undefined for a name the Box doesn't have (a caller's typo stays silent). */
export function soundEntry(name: string): SoundEntry | undefined {
  return BY_NAME.get(name);
}
