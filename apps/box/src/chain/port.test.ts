// The Sepolia chain port against a mocked relayer, with a software key standing in for the HYP2003: the messages it
// signs match the shared digest vectors byte for byte, every request has the relayer's shape, each one is followed on
// /tx/:id to paid or failed, the rounds file keeps the pots, and the sweep refunds a pot left open.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  P256_VECTOR_KEY,
  RESULT_VECTOR,
  SEAT_VECTOR,
  STAKE_VECTOR,
  resultDigest,
  seatDigest,
  stakeDigest,
  verifyP256,
} from "@egb/shared/names";
import { hexToBytes, type Address, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import type { ChainTxUpdate, ResultOrder } from "../core/ports.ts";
import { createFakeClock } from "../core/fake-clock.ts";
import { softwareSigner } from "../signer/software.ts";
import type { BoxSigner } from "../signer/signer.ts";
import { createSepoliaChain, outcomeLines, POLL_MS, REFUND_AFTER_MS, resultOf, seatOf, stakeOf } from "./port.ts";
import { roundsFile } from "./rounds.ts";
import { memoryReads, mockRelayer } from "./testing.ts";

const A = STAKE_VECTOR.stake.a;
const B = STAKE_VECTOR.stake.b;
const DEADLINE = STAKE_VECTOR.stake.deadline;
/** The vectors' deadline is 600 s (the port's) after this. */
const NOW = (Number(DEADLINE) - 600) * 1000;
const KEY = { qx: P256_VECTOR_KEY.qx, qy: P256_VECTOR_KEY.qy };

const flush = async (rounds = 8): Promise<void> => {
  for (let i = 0; i < rounds; i++) await new Promise<void>((resolve) => setImmediate(resolve));
};

function rig(signer: BoxSigner = softwareSigner(P256_VECTOR_KEY.privateKey)) {
  const clock = createFakeClock(NOW);
  const relayer = mockRelayer();
  const reads = memoryReads();
  const file = join(mkdtempSync(join(tmpdir(), "egb-chain-")), "rounds.json");
  const rounds = roundsFile(file);
  const logs: string[] = [];
  const chain = createSepoliaChain({
    box: "mumbai-01",
    signer,
    relayer,
    reads,
    rounds,
    clock,
    log: (text) => logs.push(text),
    contracts: { duelPot: STAKE_VECTOR.duelPot, boxResults: RESULT_VECTOR.boxResults, boxSeats: SEAT_VECTOR.boxSeats },
  });
  const steps: ChainTxUpdate[] = [];
  const watch = (update: ChainTxUpdate) => void steps.push(update);
  /** Moves the clock one poll on, letting the relayer's answers land. */
  const poll = async () => {
    clock.advance(POLL_MS);
    await flush();
  };
  return { clock, relayer, reads, rounds, file, logs, chain, steps, watch, poll };
}

const signatureOf = (body: Record<string, unknown>) => ({ r: BigInt(body.r as Hex), s: BigInt(body.s as Hex) });

describe("the messages the Box signs", () => {
  it("are the shared vectors' Stake, Result and Seat, digest for digest", () => {
    const stake = stakeOf("mumbai-01", { round: 3, game: "stock-duel", badges: [A, B], amount: 10 }, DEADLINE);
    expect(stake).toEqual(STAKE_VECTOR.stake);
    expect(stakeDigest(stake, STAKE_VECTOR.duelPot, STAKE_VECTOR.chainId)).toBe(STAKE_VECTOR.digest);

    const result = resultOf("mumbai-01", { round: 3, game: "quick-draw", badges: [A, B], winner: 0 }, DEADLINE);
    expect(result).toEqual(RESULT_VECTOR.result);
    expect(resultDigest(result, RESULT_VECTOR.boxResults, RESULT_VECTOR.chainId)).toBe(RESULT_VECTOR.digest);

    const seat = seatOf("mumbai-01", "nova", A, DEADLINE);
    expect(seat).toEqual(SEAT_VECTOR.seat);
    expect(seatDigest(seat, SEAT_VECTOR.boxSeats, SEAT_VECTOR.chainId)).toBe(SEAT_VECTOR.digest);
  });

  it("puts the winner first and names a draw by Player 1, Player 2", () => {
    const order = { round: 1, game: "stock-duel", badges: [A, B] as const };
    expect(resultOf("b", { ...order, winner: 1 }, 1n)).toMatchObject({ winner: B, loser: A, draw: false });
    expect(resultOf("b", { ...order, winner: null }, 1n)).toMatchObject({ winner: A, loser: B, draw: true });
    expect(() => stakeOf("b", { ...order, game: "lantern-race", amount: 5 }, 1n)).toThrow(/isn't on chain/);
  });
});

describe("the Sepolia port on a mocked relayer", () => {
  it("opens a pot with a Box-signed Stake, and follows it to paid", async () => {
    const r = rig();
    r.chain.open({ round: 3, game: "stock-duel", badges: [A, B], amount: 10 }, r.watch);
    await flush();
    const [open] = r.relayer.posted;
    expect(open?.path).toBe("/duel/open");
    expect(open?.body.stake).toEqual({ box: "mumbai-01", game: "stockduel", round: "3", a: A, b: B, amount: "10000000", deadline: String(DEADLINE) });
    const { r: sr, s } = signatureOf(open!.body);
    expect(verifyP256(KEY, sr, s, hexToBytes(STAKE_VECTOR.digest))).toBe(true);
    expect(r.steps.map((u) => u.step)).toEqual(["sent"]);
    expect(r.steps[0]?.hash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(r.steps[0]?.etherscan).toMatch(/^https:\/\/sepolia\.etherscan\.io\/tx\//);
    expect([...r.rounds.open().keys()]).toEqual([3]);

    const [id] = r.relayer.ids();
    await r.poll();
    r.relayer.advance(id!, "in-block");
    await r.poll();
    r.relayer.advance(id!, "done");
    await r.poll();
    await r.poll();
    expect(r.steps.map((u) => u.step)).toEqual(["sent", "in-block", "paid"]);
    expect(r.steps[1]?.block).toBe(12_080_000);
    // The pot stays open on the rounds file until its result settles it.
    expect([...r.rounds.open().keys()]).toEqual([3]);
  });

  it("fails a refused open at once, with the relayer's reason, and forgets its pot", async () => {
    const r = rig();
    r.relayer.refuseNext(409, "a pot for round 4 of mumbai-01 already exists (PotExists)");
    r.chain.open({ round: 4, game: "quick-draw", badges: [A, B], amount: 5 }, r.watch);
    await flush();
    expect(r.steps).toEqual([{ step: "failed", hash: null, etherscan: null, block: null, error: "a pot for round 4 of mumbai-01 already exists (PotExists)" }]);
    expect(r.rounds.open().size).toBe(0);
  });

  it("settles with a Box-signed Result of the same round and badges, and closes the pot once paid", async () => {
    const r = rig();
    r.chain.open({ round: 3, game: "quick-draw", badges: [A, B], amount: 10 }, () => {});
    r.chain.settle({ round: 3, game: "quick-draw", badges: [A, B], winner: 0 }, r.watch);
    await flush();
    const result = r.relayer.posted[1];
    expect(result?.path).toBe("/box/result");
    expect(result?.body.result).toEqual({ box: "mumbai-01", game: "quickdraw", round: "3", winner: A, loser: B, draw: false, deadline: String(DEADLINE) });
    const { r: sr, s } = signatureOf(result!.body);
    expect(verifyP256(KEY, sr, s, hexToBytes(RESULT_VECTOR.digest))).toBe(true);
    r.relayer.advance(r.relayer.ids()[1]!, "done");
    await r.poll();
    expect(r.steps.at(-1)?.step).toBe("paid");
    expect(r.rounds.open().size).toBe(0);
    expect(JSON.parse(readFileSync(r.file, "utf8"))).toEqual({ next: 1, pots: {} });
  });

  it("claims a name with a Box-signed Seat, tops up and refunds through their routes", async () => {
    const r = rig();
    r.chain.claim("nova", A, r.watch);
    r.chain.topup(B, r.watch);
    r.chain.refund(7, r.watch);
    await flush();
    const at = (path: string) => r.relayer.posted.find((p) => p.path === path);
    const [claim, topup, refund] = [at("/players/box-claim"), at("/usdc/topup"), at("/duel/refund")];
    expect(claim?.path).toBe("/players/box-claim");
    expect(claim?.body.seat).toEqual({ label: "nova", badge: A, box: "mumbai-01", deadline: String(DEADLINE) });
    const { r: sr, s } = signatureOf(claim!.body);
    expect(verifyP256(KEY, sr, s, hexToBytes(SEAT_VECTOR.digest))).toBe(true);
    expect(topup).toEqual({ path: "/usdc/topup", body: { player: B } });
    expect(refund).toEqual({ path: "/duel/refund", body: { box: "mumbai-01", round: "7" } });
  });

  it("fails a request the key can't sign, and sends nothing", async () => {
    const r = rig({
      sign: () => Promise.reject(new Error("the signer isn't ready")),
      publicKey: () => Promise.reject(new Error("no")),
      stop() {},
    });
    r.chain.settle({ round: 1, game: "stock-duel", badges: [A, B], winner: null }, r.watch);
    await flush();
    expect(r.relayer.posted).toEqual([]);
    expect(r.steps).toMatchObject([{ step: "failed", error: "the signer isn't ready" }]);
  });

  it("reports a request the relayer marks failed, with its revert", async () => {
    const r = rig();
    r.chain.topup(A, r.watch);
    await flush();
    r.relayer.advance(r.relayer.ids()[0]!, "failed", { error: "reverted with RateLimited" });
    await r.poll();
    expect(r.steps.map((u) => [u.step, u.error])).toEqual([["sent", null], ["failed", "reverted with RateLimited"]]);
  });

  it("takes rounds from the file, past every round the chain has seen", async () => {
    const r = rig();
    r.reads.taken.add(1).add(2);
    await r.chain.syncRounds();
    expect(r.chain.nextRound()).toBe(3);
    expect(r.chain.nextRound()).toBe(4);
    // A restart reads the file: no round repeats.
    expect(roundsFile(r.file).take()).toBe(5);
  });

  it("refunds a pot left open past its delay, and drops one that has settled", async () => {
    const r = rig();
    r.rounds.opened(8, NOW);
    r.rounds.opened(9, NOW);
    r.rounds.opened(10, NOW + REFUND_AFTER_MS);
    r.reads.openPots.add(8);
    r.clock.advance(REFUND_AFTER_MS);
    await r.chain.sweep();
    await flush();
    expect(r.relayer.posted).toEqual([{ path: "/duel/refund", body: { box: "mumbai-01", round: "8" } }]);
    expect([...r.rounds.open().keys()].sort()).toEqual([10, 8]);
    r.relayer.advance(r.relayer.ids()[0]!, "done");
    await r.poll();
    expect([...r.rounds.open().keys()]).toEqual([10]);
  });

  it("says whether the signer's key is the Box's registered one", async () => {
    const r = rig();
    expect(await r.chain.checkKey()).toBe(false);
    expect(r.logs.at(-1)).toMatch(/is not mumbai-01's/);
    r.reads.boxKey = async () => KEY;
    expect(await r.chain.checkKey()).toBe(true);
    expect(r.logs.at(-1)).toMatch(/is mumbai-01's/);
  });

  it("reads the board and the head through its reads, and stops polling on stop", async () => {
    const r = rig();
    expect(await r.chain.board("stock-duel")).toEqual({ title: null, cup: null });
    await expect(r.chain.board("lantern-race")).rejects.toThrow(/isn't on chain/);
    const heads: number[] = [];
    const unwatch = r.chain.watchHead((head) => heads.push(head.block));
    await flush();
    expect(heads).toEqual([12_080_000]);
    unwatch();
    r.chain.stop();
  });
});

describe("the result's lines", () => {
  const order: ResultOrder = { round: 3, game: "stock-duel", badges: [A, B], winner: 1 };
  const names = ["nova.gamebox.eth", "kite.gamebox.eth"] as const;

  it("say the payout, the title and each player's place, from what the chain says", () => {
    const lines = outcomeLines(order, {
      block: 1n,
      pot: 10,
      names,
      title: { name: "champion.stockduel.gamebox.eth", holder: B, streak: 2 },
      cup: {
        label: "mumbai-cup",
        standings: [
          { name: "nova.gamebox.eth", addr: A as Address, points: 6, wins: 2, draws: 0, losses: 0 },
          { name: "kite.gamebox.eth", addr: B as Address, points: 3, wins: 1, draws: 0, losses: 2 },
        ],
      },
    });
    expect(lines).toEqual([
      "kite.gamebox.eth +20 USDC",
      "kite.gamebox.eth now holds champion.stockduel.gamebox.eth, streak 2",
      "mumbai-cup: nova.gamebox.eth 1st, 6 pts",
      "mumbai-cup: kite.gamebox.eth 2nd, 3 pts",
    ]);
  });

  it("say only what happened: no pot, no title move, a draw, a badge with no name", () => {
    expect(outcomeLines(order, { block: 1n, pot: null, names: [null, null], title: { name: "t", holder: A, streak: 1 }, cup: null })).toEqual([
      `${B.slice(0, 6)}…${B.slice(-4)} wins`,
    ]);
    expect(outcomeLines({ ...order, winner: null }, { block: 1n, pot: 10, names, title: null, cup: null })).toEqual(["A draw: 10 USDC back to each"]);
  });
});
