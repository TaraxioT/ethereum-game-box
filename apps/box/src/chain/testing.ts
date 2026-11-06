// For tests: a relayer that records every request and answers from a script, and reads that answer from memory. With a
// software signer they make the Sepolia port testable with no network.
import type { TxView } from "@egb/shared/names";
import type { Address, Hex } from "viem";
import type { Board } from "../core/types.ts";
import type { Reads, Settled } from "./reads.ts";
import type { Relayer, RelayerReply } from "./relayer.ts";

export interface Posted {
  readonly path: string;
  readonly body: Record<string, unknown>;
}

export interface MockRelayer extends Relayer {
  readonly posted: Posted[];
  /** The next POST's answer: a refusal, or (default) 202 with a fresh id, sent with a hash. */
  refuseNext(status: number, error: string): void;
  /** Moves a request on: `GET /tx/:id` answers this from now on. */
  advance(id: string, status: TxView["status"], extra?: Partial<TxView>): void;
  /** Every request id in the order posted. */
  ids(): string[];
}

const hashOf = (n: number): Hex => `0x${n.toString(16).padStart(64, "0")}`;

export function mockRelayer(): MockRelayer {
  const posted: Posted[] = [];
  const views = new Map<string, TxView>();
  const order: string[] = [];
  let refusal: { status: number; error: string } | null = null;
  return {
    posted,
    async post(path, body) {
      posted.push({ path, body: body as Record<string, unknown> });
      if (refusal) {
        const { status, error } = refusal;
        refusal = null;
        return { status, error };
      }
      const n = order.length + 1;
      const id = `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
      const view: TxView = { id, kind: "result", status: "sent", hash: hashOf(n), etherscan: `https://sepolia.etherscan.io/tx/${hashOf(n)}` };
      views.set(id, view);
      order.push(id);
      return { status: 202, tx: view } satisfies RelayerReply;
    },
    async tx(id) {
      const view = views.get(id);
      return view ? { status: 200, tx: view } : { status: 404, error: "no request with that id" };
    },
    refuseNext(status, error) {
      refusal = { status, error };
    },
    advance(id, status, extra = {}) {
      const view = views.get(id);
      if (!view) throw new Error(`no request ${id}`);
      views.set(id, { ...view, status, ...(status === "in-block" || status === "done" ? { block: 12_080_000 } : {}), ...extra });
    },
    ids: () => [...order],
  };
}

export interface MemoryReads extends Reads {
  readonly balances: Map<Address, number>;
  readonly names: Map<Address, string>;
  /** Rounds the chain has seen, and pots still open. */
  readonly taken: Set<number>;
  readonly openPots: Set<number>;
  settledAs: Settled | null;
}

export function memoryReads(): MemoryReads {
  const balances = new Map<Address, number>();
  const names = new Map<Address, string>();
  const taken = new Set<number>();
  const openPots = new Set<number>();
  const board: Board = { title: null, cup: null };
  const reads: MemoryReads = {
    balances,
    names,
    taken,
    openPots,
    settledAs: null,
    head: async () => ({ block: 12_080_000, at: 0, gasGwei: 1 }),
    balance: async (address) => balances.get(address) ?? 0,
    nameOf: async (address) => names.get(address) ?? null,
    roundTaken: async (_box, round) => taken.has(round),
    potOpen: async (_box, round) => openPots.has(round),
    board: async () => board,
    boxKey: async () => ({ qx: `0x${"00".repeat(32)}`, qy: `0x${"00".repeat(32)}` }),
    async settled() {
      if (!reads.settledAs) throw new Error("no receipt");
      return reads.settledAs;
    },
  };
  return reads;
}
