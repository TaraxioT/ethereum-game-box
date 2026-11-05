// Whole matches through the server: injected taps over HTTP, the screen's commands over the link, the core on a fake
// clock, and the ledger on disk at the end.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Seat } from "@egb/sdk";
import type { BoxState, ScreenCommand } from "../core/types.ts";
import { END_HOLD_MS } from "../core/core.ts";
import { reactionMs } from "../games/quick-draw/rules.ts";
import type { Injected } from "./inject.ts";
import { openScreen, post, startTestBox, type TestBox, type TestScreen } from "./testing.ts";

const NOVA = { address: `0x${"a1".repeat(20)}`, name: "NOVA" };
const KITE = { address: `0x${"b2".repeat(20)}`, name: "KITE" };

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const clean of cleanups.splice(0).reverse()) await clean();
});

async function inject(tb: TestBox, seat: Seat, badge: typeof NOVA): Promise<Injected> {
  const res = await post(tb.box, "/api/taps/inject", { seat, badge });
  expect(res.status).toBe(200);
  return (await res.json()) as Injected;
}

/** Sends a command over the link and waits for the core to have it. */
async function command(tb: TestBox, screen: TestScreen, cmd: ScreenCommand, done: (state: BoxState) => boolean): Promise<void> {
  const from = screen.messages.length;
  screen.send(cmd);
  await screen.next((m) => m.t === "event" && done(m.state), from);
  expect(done(tb.box.core.state())).toBe(true);
}

async function seatedAtStake(game: "quick-draw" | "stock-duel"): Promise<{ tb: TestBox; screen: TestScreen }> {
  const tb = await startTestBox();
  cleanups.push(() => tb.stop());
  const screen = await openScreen(tb.box);
  cleanups.push(() => screen.close());
  await screen.next(() => true);
  await command(tb, screen, { type: "booted" }, (s) => s.phase === "attract");
  expect(await inject(tb, 0, NOVA)).toMatchObject({ plan: "identify", accepted: true });
  expect(tb.box.core.state().phase).toBe("home");
  await inject(tb, 0, NOVA);
  await inject(tb, 1, KITE);
  if (tb.box.core.state().focus !== game) await command(tb, screen, { type: "focus", game }, (s) => s.focus === game);
  await command(tb, screen, { type: "play" }, (s) => s.phase === "stake");
  await inject(tb, 0, NOVA);
  await inject(tb, 1, KITE);
  tb.until(() => tb.box.core.state().phase === "playing");
  return { tb, screen };
}

async function settled(tb: TestBox, screen: TestScreen): Promise<BoxState> {
  tb.until(() => tb.box.core.state().phase === "result");
  tb.until(() => tb.box.core.state().txs.every((tx) => tx.step === "paid"));
  const final = tb.box.core.state();
  await screen.next((m) => JSON.stringify(m.state) === JSON.stringify(final));
  return final;
}

async function ledgerOnDisk(tb: TestBox): Promise<unknown> {
  await tb.box.stop();
  return JSON.parse(await readFile(join(tb.dir, "data", "ledger.json"), "utf8"));
}

describe("whole matches over the link", () => {
  it("plays a Quick Draw by injected taps, judged at the touch, to a paid result", async () => {
    const { tb, screen } = await seatedAtStake("quick-draw");
    tb.until(() => {
      const play = tb.box.core.state().match?.play;
      return play?.game === "quick-draw" && play.state.phase === "draw";
    });
    tb.advance(230);
    expect(await inject(tb, 1, KITE)).toEqual({ tap: expect.any(Number), plan: "identify", accepted: true });
    expect(await inject(tb, 0, NOVA)).toMatchObject({ plan: "none", accepted: false });
    const match = tb.box.core.state().match;
    if (match?.play.game !== "quick-draw") throw new Error("no Quick Draw");
    expect(match.outcome).toEqual({ winner: 1 });
    expect(reactionMs(match.play.state, 1)).toBeGreaterThanOrEqual(230);
    tb.advance(END_HOLD_MS);

    const final = await settled(tb, screen);
    expect(final.seats.map((s) => s.balance)).toEqual([90, 110]);
    const phases = screen.messages.flatMap((m) => (m.t === "event" && m.event.type === "phase" ? [m.event.to] : []));
    expect(phases).toEqual(["attract", "home", "stake", "playing", "result"]);
    expect(await ledgerOnDisk(tb)).toEqual({ balances: { [NOVA.address]: 90, [KITE.address]: 110 }, escrow: 0 });
  });

  it("plays a Stock Duel by injected taps, each with its own roll, to a paid result", async () => {
    const { tb, screen } = await seatedAtStake("stock-duel");
    const rolls: number[] = [];
    for (let rounds = 0; tb.box.core.state().phase === "playing" && rounds < 20; rounds++) {
      tb.until(() => {
        const play = tb.box.core.state().match?.play;
        return tb.box.core.state().phase !== "playing" || (play?.game === "stock-duel" && play.state.phase === "pick");
      });
      if (tb.box.core.state().phase !== "playing") break;
      for (const [seat, badge] of [[0, NOVA], [1, KITE]] as const) {
        expect(tb.box.core.plan(seat)).toBe("random");
        expect(await inject(tb, seat, badge)).toMatchObject({ plan: "random", accepted: true });
        const play = tb.box.core.state().match?.play;
        if (play?.game === "stock-duel") rolls.push(play.state.rolls[seat]);
      }
      tb.until(() => {
        const play = tb.box.core.state().match?.play;
        return play?.game !== "stock-duel" || play.state.phase !== "dial";
      });
    }
    // Every roll came from the server's randomness, one per tap.
    expect(new Set(rolls).size).toBe(rolls.length);
    const final = await settled(tb, screen);
    const winner = final.match?.outcome?.winner;
    const expected = winner === null ? [100, 100] : winner === 0 ? [110, 90] : [90, 110];
    expect(final.seats.map((s) => s.balance)).toEqual(expected);
  });
});
