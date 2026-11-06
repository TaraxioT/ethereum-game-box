import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BoxEvent, BoxState, Cue, Tx } from "../../core/types.ts";
import type { SimLink } from "./control.ts";
import { BLOCK_MS, END_HOLD_MS, REFUND_DONE_MS } from "../../core/core.ts";
import { DEMO_REFUND_MS, PAY_MS, SEND_MS } from "../../core/demo-chain.ts";
import { createSimLink } from "./sim.ts";

const START = Date.parse("2026-11-06T12:00:00Z");

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

/** Steps the clock (and the demo chain's reads) until the state passes `check`, failing after `limit` ms. */
async function until(check: (state: BoxState) => boolean, limit = 30_000): Promise<void> {
  for (let waited = 0; !check(link.state()); waited += 50) {
    if (waited > limit) throw new Error(`still ${link.state().phase} after ${limit} ms`);
    await vi.advanceTimersByTimeAsync(50);
  }
}

const settled = () => vi.advanceTimersByTimeAsync(0);
const balances = () => link.state().seats.map((seat) => seat.balance);
const cues = (): Cue[] => events.flatMap((event) => (event.type === "cue" ? [event.cue] : []));
const lastTap = () => events.filter((event) => event.type === "tap").at(-1);
const paidAll = (state: BoxState) => state.txs.every((tx) => tx.step === "paid");

async function toHome(): Promise<void> {
  link.send({ type: "booted" });
  link.tap(0);
  await settled();
  expect(link.state().phase).toBe("home");
}

/** Both sign: the match opens at once, its pot on the way. */
async function signAndOpen(): Promise<void> {
  await until((state) => state.seats.every((s) => s.balance !== null));
  link.tap(0);
  if (link.opponent() === "hotseat") link.tap(1);
  await until((state) => state.phase === "playing");
}

describe("SimLink on the demo chain", () => {
  it("boots to attract and goes Home on a tap, then back to attract after a minute idle", async () => {
    open();
    expect(link.state().phase).toBe("boot");
    link.tap(0);
    expect(lastTap()).toEqual({ type: "tap", seat: 0, accepted: false, meaning: "ignored" });
    link.send({ type: "booted" });
    expect(link.state().phase).toBe("attract");
    link.send({ type: "start" });
    expect(link.state().phase).toBe("home");
    expect(link.state().focus).toBe("stock-duel");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(link.state().phase).toBe("attract");
  });

  it("plays Quick Draw against the bot from boot to a paid result", async () => {
    open();
    await toHome();
    link.tap(0);
    expect(link.state().seats[0].badge?.name).toBe("nova.gamebox.eth");
    await vi.advanceTimersByTimeAsync(1_600);
    expect(link.state().seats[1].badge?.name).toBe("bot.gamebox.eth");

    link.send({ type: "focus", game: "quick-draw" });
    link.send({ type: "play" });
    expect(link.state().phase).toBe("stake");
    link.send({ type: "stake", amount: 25 });
    expect(link.state().stake).toBe(25);

    await signAndOpen();
    expect(link.state().seats.map((seat) => seat.signed)).toEqual([true, true]);
    expect(link.state().match?.stake).toBe(25);
    expect(link.state().txs.find((tx) => tx.kind === "open")).toMatchObject({ seat: null, amount: 50, hash: null });
    expect(cues()).toContain("round");

    await until((state) => state.match?.play.game === "quick-draw" && state.match.play.state.phase !== "wait", 7_000);
    link.tap(0);
    await until((state) => state.match?.outcome != null, 1_000);
    const winner = link.state().match?.outcome?.winner;

    await vi.advanceTimersByTimeAsync(END_HOLD_MS);
    expect(link.state().phase).toBe("result");
    expect(cues()).toContain("over");

    await until((state) => state.txs.some((tx) => tx.kind === "settle") && paidAll(state), 30_000);
    await settled();
    expect(balances()).toEqual(winner === 0 ? [125, 75] : [75, 125]);
    expect(link.state().txs.find((tx) => tx.kind === "settle")).toMatchObject({ seat: winner, amount: 50, hash: null });

    link.send({ type: "rematch" });
    expect(link.state().phase).toBe("stake");
    expect(link.state().stake).toBe(25);
  });

  it("plays a hot-seat Stock Duel to the end and pays the winner", async () => {
    open(createSimLink, 3);
    link.setOpponent("hotseat");
    await toHome();
    link.tap(0);
    link.send({ type: "play" });
    expect(link.state().phase).toBe("join");
    link.tap(1);
    expect(link.state().seats.map((seat) => seat.badge?.name)).toEqual(["nova.gamebox.eth", "kite.gamebox.eth"]);
    await vi.advanceTimersByTimeAsync(700);
    expect(link.state().phase).toBe("stake");
    await signAndOpen();
    expect(link.state().match?.game).toBe("stock-duel");

    for (let t = 0; link.state().phase === "playing" && t < 180_000; t += 50) {
      const play = link.state().match?.play;
      if (play?.game === "stock-duel" && play.state.phase === "pick" && Date.now() - play.state.phaseAt >= 2_500) {
        link.tap(0);
        link.tap(1);
      }
      await vi.advanceTimersByTimeAsync(50);
    }
    expect(link.state().phase).toBe("result");
    expect(cues()).toEqual(expect.arrayContaining(["round", "play", "step"]));
    const winner = link.state().match?.outcome?.winner;
    await until((state) => state.txs.some((tx) => tx.kind === "settle") && paidAll(state), 30_000);
    await settled();
    expect(balances()).toEqual(winner === null ? [100, 100] : winner === 0 ? [110, 90] : [90, 110]);
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
    await toHome();
    link.tap(0);
    link.tap(1);
    link.send({ type: "focus", game: "quick-draw" });
    link.send({ type: "play" });
    await signAndOpen();
    link.tap(0);
    await vi.advanceTimersByTimeAsync(END_HOLD_MS);
    expect(link.state().phase).toBe("result");
    expect(link.state().match?.outcome).toEqual({ winner: null });
    // The result waits for the pot to land, then goes.
    await until((state) => state.txs.some((tx) => tx.kind === "settle"), 20_000);
    expect(link.state().txs.find((tx) => tx.kind === "settle")).toMatchObject({ seat: null, amount: 20 });
    await until(paidAll, 30_000);
    await settled();
    expect(balances()).toEqual([100, 100]);
  });

  it("goes to Refund when the power is cut, refuses taps until the pot unlocks, then sends it back to both", async () => {
    open();
    await toHome();
    link.tap(0);
    await vi.advanceTimersByTimeAsync(1_600);
    link.send({ type: "focus", game: "quick-draw" });
    link.send({ type: "play" });
    await signAndOpen();
    link.setPower(false);
    await until((state) => state.match?.outcome != null, 7_000);
    await vi.advanceTimersByTimeAsync(END_HOLD_MS);
    const state = link.state();
    expect(state.phase).toBe("refund");
    expect(state.txs.some((tx) => tx.kind === "settle")).toBe(false);
    const match = state.match;
    if (!match) throw new Error("no match");
    expect(match.refundAt - Date.now()).toBeGreaterThan(DEMO_REFUND_MS - 20_000);
    expect(state.stations[0].big).toBe("OFFLINE");

    link.tap(0);
    expect(lastTap()).toEqual({ type: "tap", seat: 0, accepted: false, meaning: "ignored" });
    // The stations redraw with the next head after the pot unlocks.
    await until((s) => s.stations[0].big === "TAP", DEMO_REFUND_MS + BLOCK_MS);
    expect(Date.now()).toBeGreaterThanOrEqual(match.refundAt);
    expect(link.state().stations[0]).toMatchObject({ big: "TAP", small: "to refund" });
    link.tap(0);
    expect(lastTap()).toEqual({ type: "tap", seat: 0, accepted: true, meaning: "refund" });
    expect(link.state().txs.filter((tx) => tx.kind === "refund").map((tx) => tx.seat)).toEqual([null]);
    link.tap(0);
    expect(lastTap()).toEqual({ type: "tap", seat: 0, accepted: false, meaning: "ignored" });

    await until((s) => s.match?.refunded.every(Boolean) === true, 15_000);
    await settled();
    expect(balances()).toEqual([100, 100]);
    await vi.advanceTimersByTimeAsync(REFUND_DONE_MS);
    expect(link.state().phase).toBe("home");
  });

  it("sends a seat that can't cover the stake to the lobby, where it tops up and comes back", async () => {
    open();
    link.setOpponent("hotseat");
    await toHome();
    link.tap(0);
    link.tap(1);
    link.send({ type: "focus", game: "quick-draw" });
    link.send({ type: "play" });
    link.send({ type: "stake", amount: 25 });
    // Player 1 jumps the gun four times, losing 25 each time: nothing left.
    for (let match = 0; match < 4; match++) {
      await signAndOpen();
      link.tap(0);
      expect(link.state().match?.outcome).toEqual({ winner: 1 });
      await vi.advanceTimersByTimeAsync(END_HOLD_MS);
      await until((state) => state.txs.some((tx) => tx.kind === "settle") && paidAll(state), 30_000);
      await settled();
      link.send({ type: "rematch" });
    }
    await until((state) => state.seats[0].balance === 0);
    link.tap(0);
    expect(lastTap()).toEqual({ type: "tap", seat: 0, accepted: false, meaning: "refused" });
    expect(link.state().phase).toBe("lobby");
    expect(link.state().lobby).toMatchObject({ from: "stake", badge: { name: "nova.gamebox.eth" } });

    link.send({ type: "topup" });
    expect(link.state().txs.at(-1)).toMatchObject({ kind: "topup", amount: 100, step: "signed" });
    await until((state) => state.lobby.card?.balance === 100, 30_000);
    link.send({ type: "back" });
    expect(link.state().phase).toBe("stake");
    await until((state) => state.seats[0].balance === 100);
    link.tap(0);
    expect(link.state().seats[0].signed).toBe(true);
  });

  it("shows a badge's card in the lobby, proposes its own label first, and claims it", async () => {
    open();
    await toHome();
    link.send({ type: "lobby" });
    expect(link.state().phase).toBe("lobby");
    expect(link.state().lobby.badge).toBeNull();
    link.tap(0);
    await until((state) => state.lobby.card !== null && state.board !== null);
    const { lobby } = link.state();
    expect(lobby.badge?.name).toBe("nova.gamebox.eth");
    expect(lobby.card).toMatchObject({ name: null, balance: 100 });
    expect(lobby.proposal).toBe("nova");
    expect(link.state().board).toEqual({ title: null, cup: null });

    link.send({ type: "propose" });
    expect(link.state().lobby.proposal).toMatch(/^[a-z]+-\d\d$/);
    const label = link.state().lobby.proposal;
    link.send({ type: "claim" });
    await until((state) => state.lobby.card?.name !== null, 30_000);
    expect(link.state().lobby.card?.name).toBe(`${label}.gamebox.eth`);
    expect(link.state().lobby.proposal).toBeNull();

    link.send({ type: "back" });
    expect(link.state().phase).toBe("home");
  });

  it("steps a transaction signed, sent, in the next head, then paid, and drops it a while later", async () => {
    open();
    await toHome();
    link.send({ type: "lobby" });
    link.tap(0);
    await settled();
    link.send({ type: "topup" });
    const topups = (): Tx[] => events.flatMap((event) => (event.type === "tx" && event.tx.kind === "topup" ? [event.tx] : []));
    expect(topups().map((tx) => tx.step)).toEqual(["signed"]);

    await until((state) => state.txs.find((tx) => tx.kind === "topup")?.step === "paid", 20_000);
    const steps = topups();
    expect(steps.map((tx) => tx.step)).toEqual(["signed", "sent", "in-block", "paid"]);
    const [signed, sent, inBlock, paid] = steps as [Tx, Tx, Tx, Tx];
    expect(sent.stepAt - signed.stepAt).toBe(SEND_MS);
    expect((inBlock.stepAt - START) % BLOCK_MS).toBe(0);
    expect(inBlock.block).toBe(link.state().chain.block);
    expect(paid.stepAt - inBlock.stepAt).toBe(PAY_MS);
    expect(paid.hash).toBeNull();

    await vi.advanceTimersByTimeAsync(4_000);
    expect(link.state().txs.some((tx) => tx.kind === "topup")).toBe(false);
  });

  it("ignores taps on the bot's seat, and hands it back when the hot seat is chosen", async () => {
    open();
    await toHome();
    link.tap(1);
    expect(link.state().seats[1].badge).toBeNull();
    link.tap(0);
    await vi.advanceTimersByTimeAsync(1_600);
    expect(link.state().seats[1].badge).toEqual(link.botBadge);
    link.setOpponent("hotseat");
    expect(link.state().seats[1].badge).toBeNull();
    link.tap(1);
    expect(link.state().seats[1].badge?.name).toBe("kite.gamebox.eth");
  });

  it("stops every timer", async () => {
    open();
    link.stop();
    const before = events.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(events.length).toBe(before);
  });
});
