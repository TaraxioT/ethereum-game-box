// The core through its ports alone: a fake clock drives whole matches, taps arrive as touch / done / fail, and the
// stations, the ledger store and the library are recorders.
import { describe, expect, it } from "vitest";
import { mulberry32, type Seat, type StationView } from "@egb/sdk";
import type { LedgerData, LibraryPort } from "./ports.ts";
import type { Badge, BoxEvent, BoxState, GameInfo } from "./types.ts";
import { createCore, END_HOLD_MS, type Core } from "./core.ts";
import { createFakeClock, type FakeClock } from "./fake-clock.ts";
import { memoryLedgerStore } from "./ledger.ts";
import { TEAM_GAMES, teamLibrary } from "./catalogue.ts";
import { DESK_BADGES } from "./badges.ts";
import { ANCHOR_AT, BLOCK_MS } from "./chain.ts";
import { instantTap } from "./instant-tap.ts";
import { reactionMs } from "../games/quick-draw/rules.ts";
import { frontCard, SHOW_LAG_MS } from "../games/stock-duel/rules.ts";
import { STATS } from "../games/stock-duel/deck.ts";

const START = ANCHOR_AT + 1_000 * BLOCK_MS + 1_000;
const [NOVA, KITE] = DESK_BADGES as [Badge, Badge];

interface Rig {
  readonly core: Core;
  readonly clock: FakeClock;
  readonly events: BoxEvent[];
  readonly shows: [Seat, StationView][];
  readonly buzzes: [Seat, "ok" | "no"][];
  readonly store: ReturnType<typeof memoryLedgerStore>;
}

function rig(options: { ledger?: LedgerData; library?: LibraryPort } = {}): Rig {
  const clock = createFakeClock(START);
  const rnd = mulberry32(7);
  const shows: [Seat, StationView][] = [];
  const buzzes: [Seat, "ok" | "no"][] = [];
  const store = memoryLedgerStore(options.ledger);
  const core = createCore({
    clock,
    stations: { show: (seat, view) => shows.push([seat, view]), buzz: (seat, kind) => buzzes.push([seat, kind]) },
    ledger: store,
    library: options.library ?? teamLibrary(),
    log: { record() {} },
    random: () => Math.floor(rnd() * 2 ** 32) >>> 0,
  });
  const events: BoxEvent[] = [];
  core.subscribe((_, event) => events.push(event));
  return { core, clock, events, shows, buzzes, store };
}

function until(r: Rig, check: (state: BoxState) => boolean, limit = 60_000): void {
  for (let waited = 0; !check(r.core.state()); waited += 50) {
    if (waited > limit) throw new Error(`still ${r.core.state().phase} after ${limit} ms`);
    r.clock.advance(50);
  }
}

function touch(core: Core, seat: Seat, badge: Badge | null, at = core.now()): number {
  const tap = core.nextTap();
  core.tap({ phase: "touch", tap, seat, at, badge });
  return tap;
}

/** Boots, seats NOVA and KITE, picks the game and opens a match at 10 EGB each. */
function toPlaying(r: Rig, game: "quick-draw" | "stock-duel"): void {
  const { core } = r;
  core.send({ type: "booted" });
  instantTap(core, 0, NOVA, 1);
  instantTap(core, 0, NOVA, 1);
  instantTap(core, 1, KITE, 1);
  core.send({ type: "focus", game });
  core.send({ type: "play" });
  expect(core.state().phase).toBe("stake");
  instantTap(core, 0, NOVA, 1);
  instantTap(core, 1, KITE, 1);
  until(r, (state) => state.phase === "playing");
}

const lastTap = (r: Rig) => r.events.filter((event) => event.type === "tap").at(-1);

describe("the core on its ports", () => {
  it("plans each seat's taps from the phase", () => {
    const { core } = rig();
    expect([core.plan(0), core.plan(1)]).toEqual(["none", "none"]);
    core.send({ type: "booted" });
    expect(core.plan(0)).toBe("identify");
    instantTap(core, 0, NOVA, 1);
    expect(core.state().phase).toBe("home");
    expect([core.plan(0), core.plan(1)]).toEqual(["identify", "identify"]);
  });

  it("runs a whole Quick Draw on the fake clock, judged by the touch time, and settles it", () => {
    const r = rig();
    const { core, clock } = r;
    toPlaying(r, "quick-draw");
    expect(r.store.current().escrow).toBe(20);
    expect([core.plan(0), core.plan(1)]).toEqual(["identify", "identify"]);

    until(r, (state) => state.match?.play.game === "quick-draw" && state.match.play.state.phase === "draw");
    const play = core.state().match?.play;
    if (play?.game !== "quick-draw") throw new Error("no Quick Draw");
    const { drawAt } = play.state;
    // Player 2's chip touched 180 ms after the draw; the core hears of it a little later. The touch time counts.
    clock.advance(drawAt + 300 - clock.now());
    const tap = touch(core, 1, KITE, drawAt + 180);
    const after = core.state().match;
    if (after?.play.game !== "quick-draw") throw new Error("no Quick Draw");
    expect(after.outcome).toEqual({ winner: 1 });
    expect(reactionMs(after.play.state, 1)).toBe(180);
    expect(lastTap(r)).toEqual({ type: "tap", seat: 1, accepted: true });
    expect(r.buzzes.at(-1)).toEqual([1, "ok"]);
    expect(core.plan(1)).toBe("none");
    // The chip's answer arrives afterwards and changes nothing.
    const count = r.events.length;
    core.tap({ phase: "done", tap, seat: 1, at: drawAt + 180, badge: KITE, roll: null });
    expect(r.events.length).toBe(count);

    clock.advance(END_HOLD_MS);
    expect(core.state().phase).toBe("result");
    until(r, (state) => state.txs.every((tx) => tx.step === "paid"));
    expect(r.store.current()).toEqual({ balances: { [NOVA.address]: 90, [KITE.address]: 110 }, escrow: 0 });

    core.stop();
    expect(clock.pending()).toBe(0);
  });

  it("waits for a Stock Duel tap's done, and plays the card in front at its touch with the badge's roll", () => {
    const r = rig();
    const { core, clock } = r;
    toPlaying(r, "stock-duel");
    expect(core.plan(0)).toBe("none");
    until(r, (state) => state.match?.play.game === "stock-duel" && state.match.play.state.phase === "pick");
    expect([core.plan(0), core.plan(1)]).toEqual(["random", "random"]);

    const duelAt = (state: BoxState) => {
      const play = state.match?.play;
      if (play?.game !== "stock-duel") throw new Error("no Stock Duel");
      return play.state;
    };
    clock.advance(1_000);
    const touchedAt = clock.now();
    const pick = duelAt(core.state());
    const expected = frontCard(pick, 0, Math.max(pick.phaseAt, touchedAt - SHOW_LAG_MS));
    const tap = touch(core, 0, NOVA);
    expect(duelAt(core.state()).played[0]).toBeNull();
    // The chip signs its roll for most of a second; the drum may turn meanwhile.
    clock.advance(1_800);
    core.tap({ phase: "done", tap, seat: 0, at: touchedAt, badge: NOVA, roll: 0xdeadbeef });
    expect(duelAt(core.state()).played[0]).toBe(expected);
    expect(duelAt(core.state()).rolls[0]).toBe(0xdeadbeef);
    expect(core.plan(0)).toBe("none");

    const second = touch(core, 1, KITE);
    core.tap({ phase: "done", tap: second, seat: 1, at: clock.now(), badge: KITE, roll: 3 });
    const dial = duelAt(core.state());
    expect(dial.phase).toBe("dial");
    expect(dial.stat).toBe(STATS[((0xdeadbeef + 3) >>> 0) % STATS.length]);
  });

  it("ends a tap that fails with a refusal and changes nothing", () => {
    const r = rig();
    const { core } = r;
    toPlaying(r, "stock-duel");
    until(r, (state) => state.match?.play.game === "stock-duel" && state.match.play.state.phase === "pick");
    const tap = touch(core, 0, NOVA);
    core.tap({ phase: "fail", tap, seat: 0, at: core.now(), badge: NOVA, error: { code: "lifted", text: "lifted" } });
    expect(lastTap(r)).toEqual({ type: "tap", seat: 0, accepted: false });
    expect(r.buzzes.at(-1)).toEqual([0, "no"]);
    expect(core.plan(0)).toBe("random");
  });

  it("waits for the done of a chip the roster didn't know, then seats it", () => {
    const { core } = rig();
    core.send({ type: "booted" });
    instantTap(core, 0, NOVA, 1);
    const tap = touch(core, 1, null);
    expect(core.state().seats[1].badge).toBeNull();
    core.tap({ phase: "done", tap, seat: 1, at: core.now(), badge: KITE, roll: null });
    expect(core.state().seats[1].badge).toEqual(KITE);
  });

  it("drops a tap that touched before the phase changed", () => {
    const r = rig();
    const { core } = r;
    core.send({ type: "booted" });
    instantTap(core, 0, NOVA, 1);
    const tap = touch(core, 1, null);
    core.send({ type: "play" });
    expect(core.state().phase).toBe("join");
    core.tap({ phase: "done", tap, seat: 1, at: core.now(), badge: KITE, roll: null });
    expect(core.state().seats[1].badge).toBeNull();
    expect(lastTap(r)).toEqual({ type: "tap", seat: 1, accepted: false });
  });

  it("sends each station its view only when it changes", () => {
    const r = rig();
    const { core } = r;
    expect(r.shows).toEqual([
      [0, { tag: "", big: "", small: "" }],
      [1, { tag: "", big: "", small: "" }],
    ]);
    core.send({ type: "booted" });
    const count = r.shows.length;
    r.clock.advance(30_000);
    expect(r.shows.length).toBe(count);
    for (const seat of [0, 1] as const) {
      const mine = r.shows.filter(([s]) => s === seat).map(([, view]) => JSON.stringify(view));
      expect(mine.every((view, i) => i === 0 || view !== mine[i - 1])).toBe(true);
      expect(JSON.parse(mine.at(-1) ?? "{}")).toEqual(core.state().stations[seat]);
    }
  });

  it("starts from the ledger its store kept, and saves every change to it", () => {
    const r = rig({ ledger: { balances: { [NOVA.address]: 40 }, escrow: 0 } });
    const { core } = r;
    core.send({ type: "booted" });
    instantTap(core, 0, NOVA, 1);
    instantTap(core, 0, NOVA, 1);
    instantTap(core, 1, KITE, 1);
    expect(core.state().seats[0].balance).toBe(40);
    expect(core.state().txs.map((tx) => [tx.kind, tx.seat])).toEqual([["faucet", 1]]);
    until(r, (state) => state.txs[0]?.step === "paid");
    expect(r.store.current().balances).toEqual({ [NOVA.address]: 40, [KITE.address]: 100 });
  });

  it("takes the library's games, and hears when one is installed", () => {
    let games: readonly GameInfo[] = TEAM_GAMES;
    let changed = () => {};
    const library: LibraryPort = {
      games: () => games,
      subscribe(listener) {
        changed = listener;
        return () => {};
      },
    };
    const r = rig({ library });
    const built: GameInfo = { ...TEAM_GAMES[0], id: "coin-rush", kind: "built", title: "Coin Rush", icon: "/games/coin-rush/icon.svg" } as GameInfo;
    games = [...TEAM_GAMES, built];
    changed();
    expect(r.events.at(-1)).toEqual({ type: "games" });
    expect(r.core.state().games.map((g) => g.id)).toContain("coin-rush");
    r.core.send({ type: "booted" });
    r.core.send({ type: "start" });
    r.core.send({ type: "focus", game: "coin-rush" });
    expect(r.core.state().focus).toBe("coin-rush");
    r.core.send({ type: "play" });
    expect(r.core.state().phase).toBe("home");
  });
});
