// For tests: a relayer that records every request and answers from a script, reads that answer from memory, and a
// verifier that does as it is told. With a software signer they make the Sepolia port testable with no network.
import type { TxView } from "@egb/shared/names";
import type { JudgeRequest, JudgeStatus } from "@egb/shared/store";
import type { Address, Hex } from "viem";
import type { Board } from "../core/types.ts";
import type { Reads, Settled } from "./reads.ts";
import type { Relayer, RelayerReply } from "./relayer.ts";
import type { Verifier, VerifierReply } from "./verifier.ts";

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
  /** False: nothing gets an answer, as `relayerAt` says it (status 0), though a POST may still have gone out. */
  reachable: boolean;
}

const hashOf = (n: number): Hex => `0x${n.toString(16).padStart(64, "0")}`;
const UNREACHABLE = { status: 0, error: "the relayer can't be reached: timed out" } as const;

export function mockRelayer(): MockRelayer {
  const posted: Posted[] = [];
  const views = new Map<string, TxView>();
  const order: string[] = [];
  let refusal: { status: number; error: string } | null = null;
  const relayer: MockRelayer = {
    posted,
    reachable: true,
    async post(path, body) {
      posted.push({ path, body: body as Record<string, unknown> });
      if (!relayer.reachable) return UNREACHABLE;
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
      if (!relayer.reachable) return UNREACHABLE;
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
  return relayer;
}

export interface MemoryReads extends Reads {
  readonly balances: Map<Address, number>;
  readonly storeBalances: Map<Address, number>;
  readonly names: Map<Address, string>;
  /** Records by `<game label>|<address>`. */
  readonly records: Map<string, { wins: number; losses: number; draws: number }>;
  /** Rounds the chain has seen, and pots still open. */
  readonly taken: Set<number>;
  readonly openPots: Set<number>;
  readonly openStorePots: Set<number>;
  settledAs: Settled | null;
}

export function memoryReads(): MemoryReads {
  const balances = new Map<Address, number>();
  const storeBalances = new Map<Address, number>();
  const names = new Map<Address, string>();
  const records = new Map<string, { wins: number; losses: number; draws: number }>();
  const taken = new Set<number>();
  const openPots = new Set<number>();
  const openStorePots = new Set<number>();
  const board: Board = { title: null, cup: null };
  const reads: MemoryReads = {
    balances,
    storeBalances,
    names,
    records,
    taken,
    openPots,
    openStorePots,
    settledAs: null,
    head: async () => ({ block: 12_080_000, at: 0, gasGwei: 1 }),
    balance: async (address) => balances.get(address) ?? 0,
    storeBalance: async (address) => storeBalances.get(address) ?? 0,
    nameOf: async (address) => names.get(address) ?? null,
    record: async (address, game) => records.get(`${game}|${address}`) ?? { wins: 0, losses: 0, draws: 0 },
    roundTaken: async (_box, round) => taken.has(round),
    potOpen: async (_box, round) => openPots.has(round),
    storePotOpen: async (_box, round) => openStorePots.has(round),
    board: async () => board,
    boxKey: async () => ({ qx: `0x${"00".repeat(32)}`, qy: `0x${"00".repeat(32)}` }),
    async settled() {
      if (!reads.settledAs) throw new Error("no receipt");
      return reads.settledAs;
    },
  };
  return reads;
}

export interface MockVerifier extends Verifier {
  readonly requests: JudgeRequest[];
  /** What `judge` answers: taken, unless a test says otherwise. */
  reply: VerifierReply;
  /** What `status` answers, by `<box>/<round>`. Absent: it doesn't know the match yet. */
  readonly statuses: Map<string, JudgeStatus>;
}

export function mockVerifier(): MockVerifier {
  const requests: JudgeRequest[] = [];
  const statuses = new Map<string, JudgeStatus>();
  const verifier: MockVerifier = {
    requests,
    reply: { taken: true },
    statuses,
    async judge(request) {
      requests.push(request);
      return verifier.reply;
    },
    status: async (box, round) => statuses.get(`${box}/${round}`) ?? null,
  };
  return verifier;
}
