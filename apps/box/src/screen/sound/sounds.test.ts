// The sounds' names and meanings, and what each of the Box's events sounds like. No audio: the mapping is pure.
import { describe, expect, it } from "vitest";
import type { BoxEvent, BoxState, Cue, Phase, TapMeaning } from "../../core/types.ts";
import { SOUND_NAMES, SOUNDS, soundEntry } from "./catalogue.ts";
import { musicFor, soundsFor } from "./event-sounds.ts";

const state = (phase: Phase, game: "quick-draw" | "built" = "quick-draw"): BoxState =>
  ({ phase, match: { play: { game } } }) as unknown as BoxState;

const MEANINGS: readonly TapMeaning[] = ["wake", "join", "again", "card", "sign", "open", "let-go", "rematch", "refund", "refused", "ignored"];
const CUES: readonly Cue[] = ["round", "draw", "shot", "false-start", "tie", "step", "play", "over", "error"];

describe("the sounds", () => {
  it("names every sound once, each with its meaning and what it sounds like", () => {
    expect(SOUNDS.map((entry) => entry.name)).toEqual([...SOUND_NAMES]);
    for (const entry of SOUNDS) {
      expect(entry.label, entry.name).not.toBe("");
      expect(entry.meaning, entry.name).not.toBe("");
      expect(entry.sounds, entry.name).not.toBe("");
    }
    expect(soundEntry("no-such-sound")).toBeUndefined();
  });

  it("gives every tap that did something, and every one that didn't, a sound of its own", () => {
    const heard = MEANINGS.map((meaning) => soundsFor(state("home"), { type: "tap", seat: 0, accepted: true, meaning })[0]?.name);
    expect(heard.every(Boolean)).toBe(true);
    expect(new Set(heard).size).toBe(MEANINGS.length);
  });

  it("never sounds a badge tap like a screen touch", () => {
    const badge = new Set(SOUNDS.filter((entry) => entry.group === "badge").map((entry) => entry.name));
    const screen = SOUNDS.filter((entry) => entry.group === "screen").map((entry) => entry.name);
    expect(screen.length).toBeGreaterThan(0);
    for (const name of screen) expect(badge.has(name)).toBe(false);
  });

  it("keeps the seat a tap or a moment came from", () => {
    expect(soundsFor(state("join"), { type: "tap", seat: 1, accepted: true, meaning: "join" })).toEqual([{ name: "join", seat: 1 }]);
    expect(soundsFor(state("playing"), { type: "cue", cue: "shot", seat: 0 })).toEqual([{ name: "shot", seat: 0 }]);
    expect(soundsFor(state("playing"), { type: "touch", seat: 1 })).toEqual([{ name: "touch", seat: 1 }]);
  });

  it("leaves a team game's tap to the game's own moment, and confirms a built game's", () => {
    const tap: BoxEvent = { type: "tap", seat: 0, accepted: true, meaning: "play" };
    expect(soundsFor(state("playing"), tap)).toEqual([]);
    expect(soundsFor(state("playing", "built"), tap)).toEqual([{ name: "again", seat: 0 }]);
  });

  it("sounds every moment, a drawn match as a tie", () => {
    for (const cue of CUES) expect(soundsFor(state("playing"), { type: "cue", cue, seat: 0 }), cue).toHaveLength(1);
    expect(soundsFor(state("result"), { type: "cue", cue: "over", seat: null })).toEqual([{ name: "tie", seat: null }]);
  });

  it("keeps the block's thud out of a match", () => {
    expect(soundsFor(state("home"), { type: "block", block: 9 })).toEqual([{ name: "block", seat: null }]);
    expect(soundsFor(state("playing"), { type: "block", block: 9 })).toEqual([]);
  });

  it("plays the music while people gather, and stops it for a match's business and the builder", () => {
    const on: Phase[] = ["attract", "home", "join", "lobby", "result"];
    const off: Phase[] = ["boot", "stake", "playing", "build", "refund"];
    for (const phase of on) expect(musicFor(phase), phase).toBe(true);
    for (const phase of off) expect(musicFor(phase), phase).toBe(false);
  });
});
