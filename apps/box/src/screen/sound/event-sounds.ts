// What the Box's events sound like: each badge tap by what it did and whose seat it came from, each moment the core
// marks in a match, and whether the music plays in a phase. Pure, so the mapping is tested without audio. Sounds a
// game's screen times to its own animation (Stock Duel's dial and reveal) are that screen's, not these.
import type { BoxEvent, BoxState, Cue, Phase, Seat, TapMeaning } from "../../core/types.ts";
import type { SoundName } from "./catalogue.ts";

export interface Heard {
  readonly name: SoundName;
  readonly seat: Seat | null;
}

const TAP: Readonly<Record<TapMeaning, SoundName | null>> = {
  wake: "wake",
  join: "join",
  again: "again",
  sign: "sign",
  open: "open",
  // The game's own moment (a shot, a card going down) arrives as a cue; a built game's tap is confirmed here.
  play: null,
  "let-go": "let-go",
  rematch: "rematch",
  refund: "refund",
  card: "card",
  refused: "refused",
  ignored: "ignored",
};

const CUE: Readonly<Record<Cue, SoundName>> = {
  round: "round",
  draw: "draw",
  shot: "shot",
  "false-start": "false-start",
  tie: "tie",
  step: "step",
  play: "play",
  over: "over",
  error: "error",
};

/** The sounds one event makes, given the state it left. */
export function soundsFor(state: BoxState, event: BoxEvent): Heard[] {
  switch (event.type) {
    case "touch":
      return [{ name: "touch", seat: event.seat }];
    case "tap": {
      const built = event.meaning === "play" && state.match?.play.game === "built";
      const name = built ? "again" : TAP[event.meaning];
      return name ? [{ name, seat: event.seat }] : [];
    }
    case "cue":
      // A drawn match ends on the neutral fall, not a winner's fanfare.
      if (event.cue === "over" && event.seat === null) return [{ name: "tie", seat: null }];
      return [{ name: CUE[event.cue], seat: event.seat }];
    case "block":
      // Never inside a match: a thud in Quick Draw's silence would make someone draw.
      return state.phase === "playing" ? [] : [{ name: "block", seat: null }];
    default:
      return [];
  }
}

/** The music plays while people gather round the Box, and stops for the business of a match and for the builder. */
export function musicFor(phase: Phase): boolean {
  return phase === "attract" || phase === "home" || phase === "join" || phase === "lobby" || phase === "result";
}
