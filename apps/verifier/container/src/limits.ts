// The hard limits on a run. Passing a run limit fails the run; the shell's limits only stop that one call.

export interface Limits {
  /** Model replies in a run. */
  readonly turns: number;
  /** Wall time for a run. */
  readonly runMs: number;
  /** Wall time for one model reply. */
  readonly modelMs: number;
  /** Tokens across a run, counting each turn's whole prompt. */
  readonly tokens: number;
  /** Tokens in one model reply. */
  readonly replyTokens: number;
  /** Wall time for one shell call. */
  readonly shellMs: number;
  /** Output from one shell call. */
  readonly shellBytes: number;
  /** The size of `POST /run`'s body: a log's 1 MiB, with room for its instructions. */
  readonly requestBytes: number;
}

export const LIMITS: Limits = {
  turns: 16,
  runMs: 5 * 60_000,
  modelMs: 60_000,
  tokens: 200_000,
  replyTokens: 2_048,
  shellMs: 20_000,
  shellBytes: 16 * 1024,
  requestBytes: 2 * 1024 * 1024,
};
