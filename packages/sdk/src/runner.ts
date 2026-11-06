// The rules-runner protocol: JSON lines over a built game's child process's stdio. The Box sends requests on stdin;
// the child answers each with exactly one reply on stdout, in order. Nothing else is written to stdout.
import type { BuiltEvent, Outcome } from "./rules.ts";
import type { StationView } from "./station.ts";

export type RunnerRequest =
  | { readonly t: "start"; readonly seq: number; readonly seed: number; readonly now: number }
  | { readonly t: "step"; readonly seq: number; readonly event: BuiltEvent };

export type RunnerReply =
  /** Sent once, unasked, when the child has loaded the rules and is ready for `start`. */
  | { readonly t: "ready" }
  | {
      readonly t: "state";
      readonly seq: number;
      readonly state: unknown;
      readonly outcome: Outcome | null;
      readonly stations: readonly [StationView, StationView];
      /** How long the rules took, in ms, measured in the child. */
      readonly ms: number;
    }
  | { readonly t: "error"; readonly seq: number | null; readonly message: string };
