// The game store's on-chain messages, the verifier's HTTP API and what passes between its Worker and its container.
import type { Address, Hex } from "viem";

/** `StorePot`'s `Stake`: signed by the Box's P-256 key. */
export interface StoreStake {
  readonly box: string;
  readonly bundle: Hex;
  readonly round: bigint;
  readonly players: readonly Address[];
  readonly amount: bigint;
  readonly deadline: bigint;
}

/** `StorePot`'s `Verdict`: signed by a key with `VERIFIER_ROLE`. `payouts[i]` goes to the pot's `players[i]`. */
export interface StoreVerdict {
  readonly box: string;
  readonly round: bigint;
  readonly payouts: readonly bigint[];
  readonly record: Hex;
  readonly deadline: bigint;
}

/** `StorePot`'s `Void`: signed by a key with `VERIFIER_ROLE`. Sends each stake back. */
export interface StoreVoid {
  readonly box: string;
  readonly round: bigint;
  readonly record: Hex;
  readonly deadline: bigint;
}

/** `POST /judge` on the verifier. `log` is the exact JSON text of a `MatchLog`; the Box's P-256 key signs `Judge`. */
export interface JudgeRequest {
  readonly log: string;
  readonly deadline: string;
  readonly r: Hex;
  readonly s: Hex;
}

/** `GET /judge/<box>/<round>` on the verifier. */
export interface JudgeStatus {
  readonly state: "judging" | "paying" | "paid" | "refunded" | "failed";
  /** Each player's payout in USDC base units, as decimal strings, once a verdict stands. */
  readonly payouts: readonly string[] | null;
  readonly tx: Hex | null;
  /** The audit record's keccak256. */
  readonly record: Hex | null;
  readonly reason: string | null;
}

/** `POST /run` on the container. It gets no secrets: only what the agent may read. */
export interface AgentRunRequest {
  readonly instructions: string;
  /** The exact JSON text of a `MatchLog`. */
  readonly log: string;
}

/** What the agent proposes. The Worker checks it, and only the Worker signs. */
export type AgentVerdict =
  | { readonly kind: "split"; readonly payouts: readonly string[]; readonly why: string }
  | { readonly kind: "cannot_judge"; readonly why: string };

/** One model turn, recorded by the Worker's proxy rather than by the container. */
export interface AgentTurn {
  readonly chatId: string | null;
  readonly model: string;
  readonly teeVerified: boolean;
  readonly request: unknown;
  readonly response: unknown;
}

/** What goes to 0G Storage. Its keccak256, over the exact JSON text, is the on-chain `record`. */
export interface AuditRecord {
  readonly v: 1;
  readonly bundle: Hex;
  readonly instructions: string;
  readonly log: string;
  readonly attempts: number;
  readonly turns: readonly AgentTurn[];
  readonly verdict: AgentVerdict | { readonly kind: "failed"; readonly why: string };
}
