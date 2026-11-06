// The Designer's fixed keys: the ways a tap can score, places, twists, stake sets and voices. Each carries the words
// that name it in speech, for the keyword reader. Labels are short: the screen engraves them on brass keys.

export interface Option {
  readonly id: string;
  readonly label: string;
  /** What choosing it writes into the brief. */
  readonly value: string;
  /** Words that name it, typed or spoken (matched whole, on normalised text). */
  readonly words: RegExp;
}

export const MECHANICS: readonly Option[] = [
  {
    id: "first-tap",
    label: "First tap wins",
    value: "Wait for the signal; the first tap after it wins the round, and a tap before it is a foul.",
    words: /\b(first tap|first to tap|fastest|quickest|reaction|reflex(es)?|signal|draw)\b/,
  },
  {
    id: "closest",
    label: "Closest to zero",
    value: "A hidden timer counts down; the tap closest to zero wins the round.",
    words: /\b(closest|nearest|count ?down|timer|zero|guess the time)\b/,
  },
  {
    id: "nerve",
    label: "Hold your nerve",
    value: "The prize grows until a hidden buzzer; the last tap before it wins, and a tap after it loses.",
    words: /\b(nerve|brave|chicken|buzzer|wait longest|last tap)\b/,
  },
  {
    id: "lock-in",
    label: "Lock it in",
    value: "Numbers flash past; tap to lock one in, and the higher number wins the round.",
    words: /\b(lock|lock in|locks|flash(es|ing)?|higher number|highest|pick a number)\b/,
  },
];

export const THEMES: readonly Option[] = [
  { id: "wild-west", label: "Wild West", value: "A Wild West showdown", words: /\b(wild west|cowboys?|western|saloon|showdown)\b/ },
  { id: "deep-space", label: "Deep space", value: "Deep space", words: /\b(space|planets?|stars?|rockets?|aliens?|astronauts?)\b/ },
  { id: "pirate-ship", label: "Pirate ship", value: "A pirate ship", words: /\b(pirates?|ships?|treasure|sea)\b/ },
  { id: "neon-arcade", label: "Neon arcade", value: "A neon arcade", words: /\b(neon|arcade|retro)\b/ },
];

/** The brief's twist when the player wants the template's rules as they are. */
export const NO_TWIST = "None: the template's rules as they are";

export const TWISTS: readonly Option[] = [
  { id: "faster", label: "Faster each round", value: "It gets faster every round.", words: /\b(faster|speeds? up|quicker)\b/ },
  { id: "decoys", label: "Decoy signals", value: "Decoy signals flash before the real one.", words: /\b(decoys?|fakes?|tricks?|false)\b/ },
  { id: "sudden-death", label: "Sudden death", value: "A tied match goes to a sudden-death round.", words: /\b(sudden death|tie ?breaker|decider)\b/ },
  { id: "none", label: "No twist", value: NO_TWIST, words: /^\s*(no twist|none|nothing|no|keep it classic|classic|as it is)\s*$/ },
];

/** Stake sets in USDC a seat, ascending: what the game's Stake screen offers (game.json `stakes`, at most four). */
export const STAKE_SETS: readonly (readonly number[])[] = [
  [1, 2, 5],
  [5, 10, 25],
  [10, 25, 50],
  [25, 50, 100],
];

export const stakeId = (set: readonly number[]): string => set.join("-");
export const stakeLabel = (set: readonly number[]): string => `${set.join(" · ")} USDC`;

export const VOICES: readonly Option[] = [
  { id: "commentator", label: "Commentator", value: "A sports commentator", words: /\b(commentator|sports|announcer|caster)\b/ },
  { id: "robot", label: "Robot", value: "A robot", words: /\b(robots?|robotic|machine|computer)\b/ },
  { id: "pirate", label: "Pirate", value: "A pirate", words: /\b(pirate|arr+|captain)\b/ },
  { id: "narrator", label: "Narrator", value: "A calm narrator", words: /\b(narrator|storyteller|calm|documentary)\b/ },
];
