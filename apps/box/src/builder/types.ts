// The game builder's shared types: the Designer's brief and the Forge's events, as the server, the Forge's child
// process and the screen all see them.

/** What the Designer settles, one question at a time. null: not settled yet. */
export interface GameBrief {
  /** The template game's id from the shelf (`quick-draw` by default). */
  readonly template: string;
  /** How a tap scores: the game's core loop, in a sentence. */
  readonly mechanic: string | null;
  readonly theme: string | null;
  readonly twist: string | null;
  /** EGB per seat, ascending. */
  readonly stakes: readonly number[] | null;
  /** The voice of the game's words (a commentator, a robot, a pirate). */
  readonly voice: string | null;
  readonly title: string | null;
}

export type DesignerStep = "template" | "mechanic" | "theme" | "twist" | "stakes" | "voice" | "title" | "confirm";

export interface DesignerChoice {
  readonly id: string;
  readonly label: string;
}

/** The Designer as the screen draws it. */
export interface DesignerState {
  readonly session: string;
  readonly step: DesignerStep;
  readonly question: string;
  readonly choices: readonly DesignerChoice[];
  readonly brief: GameBrief;
  /** A build is running: edits are locked. */
  readonly locked: boolean;
  /** The model is reading a typed or spoken answer. */
  readonly thinking: boolean;
}

export type ForgeProvider = "claude" | "sim";

export type ForgeStatus = "queued" | "preparing" | "working" | "compiling" | "fixing" | "installing" | "done" | "failed";

export type CompileStep = "manifest" | "typecheck" | "bundle" | "icon";

/** One moment of a build, streamed to the screen. `at` is the server's clock. */
export type ForgeEvent =
  | { readonly type: "status"; readonly job: string; readonly at: number; readonly status: ForgeStatus; readonly text: string }
  /** The agent's own words. */
  | { readonly type: "say"; readonly job: string; readonly at: number; readonly text: string }
  | { readonly type: "tool"; readonly job: string; readonly at: number; readonly id: string; readonly name: string; readonly path: string | null }
  | { readonly type: "tool_done"; readonly job: string; readonly at: number; readonly id: string; readonly ok: boolean }
  | { readonly type: "compile"; readonly job: string; readonly at: number; readonly step: CompileStep; readonly ok: boolean; readonly text: string }
  | {
      readonly type: "result";
      readonly job: string;
      readonly at: number;
      readonly ok: boolean;
      readonly game: string | null;
      readonly error: string | null;
    };

export interface ForgeJob {
  readonly id: string;
  readonly brief: GameBrief;
  readonly provider: ForgeProvider;
  readonly status: ForgeStatus;
  readonly createdAt: number;
  readonly game: string | null;
  readonly error: string | null;
}
