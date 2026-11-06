// A built game's match, driven through the rules runner (RulesRunnerPort): a start, then a step for each tick and each
// tap. The runner answers asynchronously, in order; this hands each snapshot on, and the first failure.
//
// - A tick is skipped while a step is still out: ticks only move the clock on, and the next one carries a later time.
//   A tap is never skipped: it goes into the runner's queue, judged at its touch time.
// - Once stopped (the match ended, voided, or was overtaken), nothing more is sent and nothing that comes back is
//   handed on: a snapshot or a failure from an old match never reaches a new one.
import type { BuiltEvent, DuelSeat } from "@egb/sdk";
import type { RulesRunnerPort, RulesSnapshot } from "./ports.ts";

export interface BuiltHooks {
  snapshot(snapshot: RulesSnapshot): void;
  /** The rules failed (over budget, threw, crashed): the match is void. Called at most once. */
  failed(error: unknown): void;
}

export interface BuiltDriver {
  /** A tick at `now`, unless a step is already out. */
  tick(now: number): void;
  /** A finished tap: touched at `at`, with the badge's verified roll when the game's taps are `random`. */
  tap(seat: DuelSeat, at: number, roll: number | null): void;
  stop(): void;
}

/** Starts the game's rules; `hooks.snapshot` hears the first state, then every step's. */
export function startBuilt(rules: RulesRunnerPort, game: string, seed: number, now: number, hooks: BuiltHooks): BuiltDriver {
  let live = true;
  let out = 0;

  function track(call: Promise<RulesSnapshot>): void {
    out++;
    call.then(
      (snapshot) => {
        out--;
        if (live) hooks.snapshot(snapshot);
      },
      (error: unknown) => {
        out--;
        if (!live) return;
        live = false;
        hooks.failed(error);
      },
    );
  }

  const step = (event: BuiltEvent) => {
    if (live) track(rules.step(event));
  };

  track(rules.start(game, seed, now));
  return {
    tick(at) {
      if (out === 0) step({ type: "tick", now: at });
    },
    tap: (seat, at, roll) => step({ type: "tap", seat, now: at, roll }),
    stop() {
      live = false;
    },
  };
}
