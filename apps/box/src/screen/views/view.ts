// The view contract: every screen (Home, Join, Stake, a game, Result, Refund) is a View the router mounts on the
// stage when the Box's phase calls for it. Views draw from `BoxState`, animate on `BoxEvent`s, and act only through
// `ctx.link.send`. The Box's own objects (board, core, ports, clock) belong to the machine, not to a view.
import type { BoxEvent, BoxLink, BoxState } from "../link/types.ts";
import type { Layout } from "../shell/layout.ts";
import type { Cue } from "../link/types.ts";

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
  | "page" // the board dimmed, the core and rack sunk back, ports and clock up: Join, Stake, Result, Refund
  | "game"; // the thin overlay only (ports, clock, stake): inside a game

export interface Machine {
  pose(pose: Pose): void;
  /** The core turns once like a coin: a game loads. */
  coin(): void;
  /** Lights the focused cartridge's feed into the core. */
  feed(slot: number | null): void;
}

export interface Sound {
  play(cue: Cue): void;
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
