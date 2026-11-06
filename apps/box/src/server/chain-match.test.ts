// A whole match on the Box with stakes on Sepolia, through the real chain port on a mocked relayer (the Box's key a
// software one): both seats sign and the match opens at once with a Box-signed Stake sent; the result goes only once
// that open is done, with the same round and badges; the result screen's lines are read from the chain after it.
import type { Seat } from "@egb/sdk";
import { P256_VECTOR_KEY } from "@egb/shared/names";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Address } from "viem";
import { afterEach, describe, expect, it } from "vitest";
import { END_HOLD_MS } from "../core/core.ts";
import { SETTLE_MS } from "../games/quick-draw/rules.ts";
import { createSepoliaChain, POLL_MS } from "../chain/port.ts";
import { roundsFile } from "../chain/rounds.ts";
import { memoryReads, mockRelayer } from "../chain/testing.ts";
import { softwareSigner } from "../signer/software.ts";
import { flush, post, startTestBox, type TestBox } from "./testing.ts";

const NOVA = `0x${"a1".repeat(20)}` as Address;
const KITE = `0x${"b2".repeat(20)}` as Address;

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const clean of cleanups.splice(0).reverse()) await clean();
});

async function rig() {
  const relayer = mockRelayer();
  const reads = memoryReads();
  reads.balances.set(NOVA, 100).set(KITE, 100);
  reads.names.set(NOVA, "nova.gamebox.eth").set(KITE, "kite.gamebox.eth");
  const rounds = roundsFile(join(mkdtempSync(join(tmpdir(), "egb-rounds-")), "rounds.json"));
  const tb = await startTestBox({
    chain: (clock) =>
      createSepoliaChain({
        box: "mumbai-01",
        signer: softwareSigner(P256_VECTOR_KEY.privateKey),
        relayer,
        reads,
        rounds,
        clock,
        log: () => {},
        contracts: { duelPot: `0x${"11".repeat(20)}`, boxResults: `0x${"22".repeat(20)}`, boxSeats: `0x${"33".repeat(20)}` },
      }),
  });
  cleanups.push(() => tb.stop());
  return { tb, relayer, reads };
}

async function inject(tb: TestBox, seat: Seat, badge: Address): Promise<void> {
  const res = await post(tb.box, "/api/taps/inject", { seat, badge });
  expect(res.status).toBe(200);
  await flush();
}

describe("a match with its stakes on Sepolia", () => {
  it("waits on Stake until the pot is confirmed, not just in a block, sends the result when the match ends, and reads its lines from the chain", async () => {
    const { tb, relayer, reads } = await rig();
    const core = tb.box.core;
    core.send({ type: "booted" });
    await inject(tb, 0, NOVA);
    await inject(tb, 0, NOVA);
    await inject(tb, 1, KITE);
    expect(core.state().seats.map((s) => [s.ens, s.balance])).toEqual([["nova.gamebox.eth", 100], ["kite.gamebox.eth", 100]]);
    core.send({ type: "focus", game: "quick-draw" });
    core.send({ type: "play" });
    await inject(tb, 0, NOVA);
    await inject(tb, 1, KITE);
    // Both signed: the Box waits on Stake with only the open out, until the open is confirmed.
    expect(core.state().phase).toBe("stake");
    expect(relayer.posted.map((p) => p.path)).toEqual(["/duel/open"]);
    const stake = relayer.posted[0]!.body.stake as Record<string, string>;
    expect(stake).toMatchObject({ box: "mumbai-01", game: "quickdraw", round: "1", a: NOVA, b: KITE, amount: "10000000" });
    expect(core.state().txs.map((t) => [t.kind, t.step, t.amount])).toEqual([["open", "sent", 20]]);
    const [open] = relayer.ids();
    relayer.advance(open!, "in-block");
    await tb.settle(() => core.state().txs[0]?.step === "in-block", POLL_MS * 2, 100);
    // In a block isn't confirmed: still on Stake, no match.
    expect(core.state()).toMatchObject({ phase: "stake", match: null });
    relayer.advance(open!, "done");
    reads.balances.set(NOVA, 90).set(KITE, 90);
    await tb.settle(() => core.state().phase === "playing", POLL_MS * 2, 100);
    expect(core.state().txs[0]?.step).toBe("paid");

    // Player 2 wins the draw; the game ends and holds, and the result goes.
    await tb.settle(() => {
      const play = core.state().match?.play;
      return play?.game === "quick-draw" && play.state.phase === "draw";
    });
    tb.advance(200);
    await inject(tb, 1, KITE);
    tb.advance(SETTLE_MS + END_HOLD_MS + 100);
    await flush();
    expect(core.state().phase).toBe("result");
    await tb.settle(() => relayer.posted.length === 2, POLL_MS * 2, 100);
    const result = relayer.posted[1]!;
    expect(result.path).toBe("/box/result");
    expect(result.body.result).toMatchObject({ box: "mumbai-01", game: "quickdraw", round: "1", winner: KITE, loser: NOVA, draw: false });

    // Paid: the lines come from the receipt, and the balances are read again.
    reads.settledAs = { block: 1n, pot: 10, names: ["nova.gamebox.eth", "kite.gamebox.eth"], title: { name: "champion.quickdraw.gamebox.eth", holder: KITE, streak: 1 }, cup: null };
    reads.balances.set(KITE, 110);
    relayer.advance(relayer.ids()[1]!, "done");
    await tb.settle(() => core.state().match?.lines !== null, POLL_MS * 2, 100);
    expect(core.state().match?.lines).toEqual(["kite.gamebox.eth +20 USDC", "kite.gamebox.eth now holds champion.quickdraw.gamebox.eth"]);
    expect(core.state().seats.map((s) => s.balance)).toEqual([90, 110]);
    // The open was confirmed before the match began, so only the settle is still on screen.
    expect(core.state().txs.map((t) => [t.kind, t.step, t.hash !== null])).toEqual([["settle", "paid", true]]);
  });

  it("sends a seat short of the stake to the lobby, where it tops up and claims its name", async () => {
    const { tb, relayer, reads } = await rig();
    reads.balances.set(NOVA, 0);
    reads.names.delete(NOVA);
    const core = tb.box.core;
    core.send({ type: "booted" });
    await inject(tb, 0, NOVA);
    await inject(tb, 0, NOVA);
    await inject(tb, 1, KITE);
    core.send({ type: "play" });
    await inject(tb, 0, NOVA);
    expect(core.state().phase).toBe("lobby");
    expect(core.state().lobby).toMatchObject({ from: "stake", badge: { address: NOVA }, card: { name: null, balance: 0 }, proposal: "0xa1a1" });
    core.send({ type: "topup" });
    core.send({ type: "claim" });
    await flush();
    expect(relayer.posted.map((p) => p.path)).toEqual(["/usdc/topup", "/players/box-claim"]);
    expect(relayer.posted[0]!.body).toEqual({ player: NOVA });
  });
});
