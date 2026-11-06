// The view contract: every screen (Home, Join, Stake, a game, Result, Refund, the lobby) is a View the router mounts on the
// stage when the Box's phase calls for it. Views draw from `BoxState`, animate on `BoxEvent`s, and act only through
// `ctx.link.send`. The Box's own objects (Grid, core, ports, clock) belong to the machine, not to a view.
import type { BoxEvent, BoxLink, BoxState } from "../../core/types.ts";
import type { SoundName, SoundOptions } from "../sound/catalogue.ts";
import type { Layout } from "../shell/layout.ts";
import type { RunOptions } from "../shell/packets.ts";
import type { TraceName } from "../shell/traces.ts";

export interface View {
  /** The view's root, absolutely positioned on the stage (stage pixels). */
  readonly el: HTMLElement;
  /** Draw from the state; `event` says what just changed. Called once with `{ type: "init" }` after mounting. */
  update(state: BoxState, event: BoxEvent): void;
  /** Free timers and listeners. */
  dispose?(): void;
}

/** How much of the Box shows behind a view. */
export type Pose =
  | "home" // the whole machine: Home and attract
  | "page" // the Grid dimmed, the core and rack sunk back, ports and clock up: Join, Stake, Result, Refund, the lobby
  | "game" // the thin overlay only (ports, clock, stake): inside a game
  | "full"; // nothing of the machine: a game that draws the whole stage, the top band included

export interface Machine {
  pose(pose: Pose): void;
  /** The core turns once like a coin: a game loads. */
  coin(): void;
  /** Lights the focused cartridge's feed into the core. */
  feed(slot: number | null): void;
  /** Runs a packet of light along a trace of the Grid into the core (out of it with `reverse`); resolves on landing. */
  run(trace: TraceName, options?: RunOptions): Promise<void>;
  /** The core's glass swells once: something landed in it. */
  swell(): void;
}

export interface PlayOptions extends SoundOptions {
  /** 0..1, scales the sound. */
  readonly volume?: number;
}

/** The Box's sounds (`sound/`): the cues by name, the music loop, the mute. */
export interface Sound {
  play(name: SoundName, options?: PlayOptions): void;
  /** The music loop on (fades in) or off (fades out, then pauses). Safe to call on every change. */
  music(on: boolean): void;
  /** Sinks the music under a spoken clip, and brings it back. */
  duck(on: boolean): void;
  readonly muted: boolean;
  setMuted(muted: boolean): void;
}

export interface ViewContext {
  readonly link: BoxLink;
  readonly machine: Machine;
  readonly sound: Sound;
  readonly layout: Layout;
  /** prefers-reduced-motion: show end states. */
  readonly calm: boolean;
}

export type ViewFactory = (ctx: ViewContext) => View;
