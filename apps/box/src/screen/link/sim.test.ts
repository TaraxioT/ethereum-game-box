import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BoxEvent, BoxState, Cue, Tx } from "../../core/types.ts";
import type { SimLink } from "./control.ts";
import { ANCHOR_AT, BLOCK_MS, blockAt } from "../../core/chain.ts";
import { END_HOLD_MS, REFUND_DONE_MS } from "../../core/core.ts";
import { PAY_MS, SEND_MS } from "../../core/txs.ts";
import { createSimLink } from "./sim.ts";

/** One second after a block, so the first block lands 11 s in. */
const START = ANCHOR_AT + 1_000 * BLOCK_MS + 1_000;

let link: SimLink;
let events: BoxEvent[];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
});

afterEach(() => {
  link.stop();
  vi.useRealTimers();
  vi.doUnmock("../../games/quick-draw/rules.ts");
  vi.resetModules();
});

function open(make: typeof createSimLink = createSimLink, seed = 1): SimLink {
  link = make({ seed });
  events = [];
  link.subscribe((_, event) => events.push(event));
  return link;
}

/** Steps the clock until the state passes `check`, failing after `limit` ms. */
function until(check: (state: BoxState) => boolean, limit = 30_000): void {
  for (let waited = 0; !check(link.state()); waited += 50) {
    if (waited > limit) throw new Error(`still ${link.state().phase} after ${limit} ms`);
    vi.advanceTimersByTime(50);
  }
}

const balances = () => link.state().seats.map((seat) => seat.balance);
const cues = (): Cue[] => events.flatMap((event) => (event.type === "cue" ? [event.cue] : []));
const lastTap = () => events.filter((event) => event.type === "tap").at(-1);
const paidAll = (state: BoxState) => state.txs.every((tx) => tx.step === "paid");

function toHome(): void {
  link.send({ type: "booted" });
  link.tap(0);
  expect(link.state().phase).toBe("home");
}

/** Both sign and the open transaction lands. */
function signAndOpen(): void {
  link.tap(0);
  if (link.opponent() === "hotseat") link.tap(1);
  until((state) => state.phase === "playing");
}

describe("SimLink", () => {
  it("boots to attract and goes Home on a tap, then back to attract after a minute idle", () => {
    open();
    expect(link.state().phase).toBe("boot");
    link.tap(0);
    expect(lastTap()).toEqual({ type: "tap", seat: 0, accepted: false });
    link.send({ type: "booted" });
    expect(link.state().phase).toBe("attract");
    link.send({ type: "start" });
    expect(link.state().phase).toBe("home");
    expect(link.state().focus).toBe("stock-duel");
    vi.advanceTimersByTime(60_000);
    expect(link.state().phase).toBe("attract");
  });

  it("plays Quick Draw against the bot from boot to a paid result", () => {
    open();
    toHome();
    link.tap(0);
    expect(link.state().seats[0].badge?.name).toBe("nova.gamebox.eth");
    vi.advanceTimersByTime(1_600);
    expect(link.state().seats[1].badge?.name).toBe("bot.gamebox.eth");

    link.send({ type: "focus", game: "quick-draw" });
    link.send({ type: "play" });
    expect(link.state().phase).toBe("stake");
    link.send({ type: "stake", amount: 25 });
    expect(link.state().stake).toBe(25);

    signAndOpen();
    expect(link.state().seats.map((seat) => seat.signed)).toEqual([true, true]);
    expect(balances()).toEqual([75, 75]);
    expect(cues()).toContain("boot");

    // Player 1 taps the moment the sign flips (unless the bot jumped the gun first).
    until((state) => state.match?.play.game === "quick-draw" && state.match.play.state.phase !== "wait", 7_000);
    link.tap(0);
    const outcome = link.state().match?.outcome;
    expect(outcome).not.toBeNull();
    const winner = outcome?.winner;

    // The end hold: still playing, and taps mean nothing.
    vi.advanceTimersByTime(END_HOLD_MS - 100);
    expect(link.state().phase).toBe("playing");
    link.tap(0);
    expect(lastTap()).toEqual({ type: "tap", seat: 0, accepted: false });
    vi.advanceTimersByTime(100);
    expect(link.state().phase).toBe("result");
    expect(cues()).toContain(winner === 0 ? "win" : "lose");

    until(paidAll, 14_000);
    expect(balances()).toEqual(winner === 0 ? [125, 75] : [75, 125]);
    const settle = link.state().txs.find((tx) => tx.kind === "settle");
    expect(settle).toMatchObject({ seat: winner, direction: "out", amount: 50, hash: null });

    link.send({ type: "rematch" });
    expect(link.state().phase).toBe("stake");
    expect(link.state().stake).toBe(25);
    expect(link.state().seats.map((seat) => seat.signed)).toEqual([false, false]);
  });

  it("plays a hot-seat Stock Duel to the end", () => {
    open(createSimLink, 3);
    link.setOpponent("hotseat");
    toHome();
    link.tap(0);
    link.send({ type: "play" });
    expect(link.state().phase).toBe("join");
    link.tap(1);
    expect(link.state().seats.map((seat) => seat.badge?.name)).toEqual(["nova.gamebox.eth", "kite.gamebox.eth"]);
    vi.advanceTimersByTime(699);
    expect(link.state().phase).toBe("join");
    vi.advanceTimersByTime(1);
    expect(link.state().phase).toBe("stake");
    signAndOpen();
    expect(link.state().match?.game).toBe("stock-duel");

    // Each player plays whatever card is in front once the drum has turned once.
    for (let t = 0; link.state().phase === "playing" && t < 180_000; t += 50) {
      const play = link.state().match?.play;
      if (play?.game === "stock-duel" && play.state.phase === "pick" && Date.now() - play.state.phaseAt >= 2_500) {
        link.tap(0);
        link.tap(1);
      }
      vi.advanceTimersByTime(50);
    }
    expect(link.state().phase).toBe("result");
    expect(cues()).toEqual(expect.arrayContaining(["flip", "seal", "tick"]));
    const winner = link.state().match?.outcome?.winner;
    until(paidAll, 14_000);
    const expected = winner === null ? [100, 100] : winner === 0 ? [110, 90] : [90, 110];
    expect(balances()).toEqual(expected);
    link.send({ type: "home" });
    expect(link.state().phase).toBe("home");
    expect(link.state().match).toBeNull();
  });

  it("returns both stakes on a draw", async () => {
    vi.resetModules();
    vi.doMock("../../games/quick-draw/rules.ts", async (importOriginal) => {
      const original = await importOriginal<typeof import("../../games/quick-draw/rules.ts")>();
      return {
        ...original,
        rules: { ...original.rules, outcome: (state: { phase: string }) => (state.phase === "done" ? { winner: null } : null) },
      };
    });
    const { createSimLink: make } = await import("./sim.ts");
    open(make);
    link.setOpponent("hotseat");
    toHome();
    link.tap(0);
    link.tap(1);
    link.send({ type: "focus", game: "quick-draw" });
    link.send({ type: "play" });
    signAndOpen();
    link.tap(0);
    vi.advanceTimersByTime(END_HOLD_MS);
    expect(link.state().phase).toBe("result");
    expect(link.state().match?.outcome).toEqual({ winner: null });
    expect(link.state().txs.at(-1)).toMatchObject({ kind: "settle", seat: null, amount: 20 });
    until(paidAll, 14_000);
    expect(balances()).toEqual([100, 100]);
  });

  it("goes to Refund when the power is cut, refuses taps until the timeout, then pays each stake back", () => {
    open();
    toHome();
    link.tap(0);
    vi.advanceTimersByTime(1_600);
    link.send({ type: "focus", game: "quick-draw" });
    link.send({ type: "play" });
    signAndOpen();
    link.setPower(false);
    expect(link.power()).toBe(false);
    until((state) => state.match?.outcome != null, 7_000);
    vi.advanceTimersByTime(END_HOLD_MS);
    const state = link.state();
    expect(state.phase).toBe("refund");
    expect(state.txs.some((tx) => tx.kind === "settle")).toBe(false);
    const match = state.match;
    if (!match) throw new Error("no match");
    expect(match.refundBlock).toBeGreaterThanOrEqual(state.chain.block + 2);
    expect(state.stations[0].big).toBe("OFFLINE");
    expect(balances()).toEqual([90, 90]);

    link.tap(0);
    expect(lastTap()).toEqual({ type: "tap", seat: 0, accepted: false });
    until((s) => s.chain.block >= match.refundBlock, 40_000);
    expect(link.state().stations[0]).toMatchObject({ big: "TAP", small: "to refund" });
    link.tap(0);
    expect(lastTap()).toEqual({ type: "tap", seat: 0, accepted: true });
    link.tap(0);
    expect(lastTap()).toEqual({ type: "tap", seat: 0, accepted: false });

    until((s) => s.match?.refunded.every(Boolean) === true, 15_000);
    expect(balances()).toEqual([100, 100]);
    expect(link.state().phase).toBe("refund");
    vi.advanceTimersByTime(REFUND_DONE_MS);
    expect(link.state().phase).toBe("home");
  });

  it("refunds both stakes from the screen in hot seat, once they unlock, without a tap", () => {
    open();
    link.setOpponent("hotseat");
    toHome();
    link.tap(0);
    link.tap(1);
    link.send({ type: "focus", game: "quick-draw" });
    link.send({ type: "play" });
    signAndOpen();
    link.setPower(false);
    link.tap(0);
    vi.advanceTimersByTime(END_HOLD_MS);
    const match = link.state().match;
    if (!match) throw new Error("no match");
    expect(link.state().phase).toBe("refund");
    link.send({ type: "refund" });
    expect(link.state().txs.some((tx) => tx.kind === "refund")).toBe(false);
    until((s) => s.chain.block >= match.refundBlock, 40_000);
    link.send({ type: "refund" });
    expect(link.state().txs.filter((tx) => tx.kind === "refund").map((tx) => tx.seat)).toEqual([0, 1]);
    until((s) => s.match?.refunded.every(Boolean) === true, 15_000);
    expect(balances()).toEqual([100, 100]);
    vi.advanceTimersByTime(REFUND_DONE_MS);
    expect(link.state().phase).toBe("home");
  });

  it("tops up a spent-out badge on rematch", () => {
    open();
    link.setOpponent("hotseat");
    toHome();
    link.tap(0);
    link.tap(1);
    link.send({ type: "focus", game: "quick-draw" });
    link.send({ type: "play" });
    link.send({ type: "stake", amount: 25 });
    for (let match = 0; match < 4; match++) {
      signAndOpen();
      link.tap(0);
      vi.advanceTimersByTime(END_HOLD_MS);
      until(paidAll, 14_000);
      link.send({ type: "rematch" });
    }
    expect(link.state().txs.some((tx) => tx.kind === "faucet" && tx.seat === 0 && tx.amount === 100)).toBe(true);
    link.tap(0);
    expect(link.state().seats[0].signed).toBe(true);
  });

  it("tops up a seat that can't cover a raised stake, so Stake never deadlocks", () => {
    open();
    link.setOpponent("hotseat");
    toHome();
    link.tap(0);
    link.tap(1);
    link.send({ type: "focus", game: "quick-draw" });
    link.send({ type: "play" });
    link.send({ type: "stake", amount: 10 });
    // Player 1 jumps the gun nine times and loses 10 EGB each time, keeping 10: enough for 10, short of 25.
    for (let match = 0; match < 9; match++) {
      signAndOpen();
      link.tap(0);
      expect(link.state().match?.outcome).toEqual({ winner: 1 });
      vi.advanceTimersByTime(END_HOLD_MS);
      until(paidAll, 14_000);
      link.send({ type: "rematch" });
    }
    expect(balances()).toEqual([10, 190]);
    link.send({ type: "stake", amount: 25 });
    expect(link.state().seats[0].pending).toBe(90);
    link.tap(1);
    link.tap(0);
    expect(link.state().seats.map((s) => s.signed)).toEqual([true, true]);
    until((s) => s.phase === "playing", 30_000);
    expect(link.state().seats[0].balance).toBe(75);
  });

  it("counts a payout still on its way when a rematch is staked at once", () => {
    open();
    link.setOpponent("hotseat");
    toHome();
    link.tap(0);
    link.tap(1);
    link.send({ type: "focus", game: "quick-draw" });
    link.send({ type: "play" });
    link.send({ type: "stake", amount: 25 });
    signAndOpen();
    link.tap(1);
    vi.advanceTimersByTime(END_HOLD_MS);
    link.send({ type: "rematch" });
    link.tap(0);
    link.tap(1);
    until((s) => s.phase === "playing", 40_000);
    const before = link.state().chain.block;
    vi.advanceTimersByTime(30_000);
    expect(link.state().chain.block).toBeGreaterThan(before);
  });

  it("steps a transaction signed, sent, in-block on a block boundary, then paid", () => {
    open();
    toHome();
    link.tap(0);
    const faucet = (): Tx[] =>
      events.flatMap((event) => (event.type === "tx" && event.tx.kind === "faucet" && event.tx.seat === 0 ? [event.tx] : []));
    expect(faucet().map((tx) => tx.step)).toEqual(["signed"]);
    expect(balances()[0]).toBe(0);

    until((state) => state.txs.find((tx) => tx.kind === "faucet" && tx.seat === 0)?.step === "paid");
    const steps = faucet();
    expect(steps.map((tx) => tx.step)).toEqual(["signed", "sent", "in-block", "paid"]);
    const [signed, sent, inBlock, paid] = steps as [Tx, Tx, Tx, Tx];
    expect(sent.stepAt - signed.stepAt).toBe(SEND_MS);
    expect((inBlock.stepAt - ANCHOR_AT) % BLOCK_MS).toBe(0);
    expect(inBlock.block).toBe(blockAt(inBlock.stepAt).block);
    expect(paid.stepAt - inBlock.stepAt).toBe(PAY_MS);
    expect(balances()[0]).toBe(100);

    // The block event comes before the transaction lands in it.
    const blockIndex = events.findIndex((event) => event.type === "block" && event.block === inBlock.block);
    const landIndex = events.findIndex((event) => event.type === "tx" && event.tx.step === "in-block");
    expect(blockIndex).toBeGreaterThanOrEqual(0);
    expect(blockIndex).toBeLessThan(landIndex);

    // It stays on screen a while once paid, then leaves.
    vi.advanceTimersByTime(4_000);
    expect(link.state().txs.some((tx) => tx.kind === "faucet" && tx.seat === 0)).toBe(false);
  });

  it("ignores taps on the bot's seat, and hands it back when the hot seat is chosen", () => {
    open();
    toHome();
    link.tap(1);
    expect(link.state().seats[1].badge).toBeNull();
    link.tap(0);
    vi.advanceTimersByTime(1_600);
    expect(link.state().seats[1].badge).toEqual(link.botBadge);
    link.setOpponent("hotseat");
    expect(link.state().seats[1].badge).toBeNull();
    link.tap(1);
    expect(link.state().seats[1].badge?.name).toBe("kite.gamebox.eth");
  });

  it("stops every timer", () => {
    open();
    link.stop();
    const before = events.length;
    vi.advanceTimersByTime(60_000);
    expect(events.length).toBe(before);
  });
});
