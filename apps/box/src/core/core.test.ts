// The core through its ports alone: a fake clock drives whole matches, taps arrive as touch / done / fail, and the
// stations, the ledger store and the library are recorders.
import { describe, expect, it } from "vitest";
import { mulberry32, type Seat, type StationView, type Transcript } from "@egb/sdk";
import type { LedgerData, LibraryPort } from "./ports.ts";
import type { Badge, BoxEvent, BoxState, GameInfo } from "./types.ts";
import { BUILD_IDLE_MS, createCore, END_HOLD_MS, IDLE_MS, type Core } from "./core.ts";
import { REMATCH_TAP_MS } from "./plan.ts";
import type { TapSource } from "./ports.ts";
import { createFakeClock, type FakeClock } from "./fake-clock.ts";
import { memoryLedgerStore } from "./ledger.ts";
import { TEAM_GAMES, teamLibrary } from "./catalogue.ts";
import { DEMO_BADGES } from "./badges.ts";
import { ANCHOR_AT, BLOCK_MS } from "./chain.ts";
import { instantTap } from "./instant-tap.ts";
import { reactionMs } from "../games/quick-draw/rules.ts";
import { frontCard, SHOW_LAG_MS } from "../games/stock-duel/rules.ts";
import { STATS } from "../games/stock-duel/deck.ts";

const START = ANCHOR_AT + 1_000 * BLOCK_MS + 1_000;
const [NOVA, KITE] = DEMO_BADGES as [Badge, Badge];

interface Rig {
  readonly core: Core;
  readonly clock: FakeClock;
  readonly events: BoxEvent[];
  readonly shows: [Seat, StationView][];
  readonly buzzes: [Seat, "ok" | "no"][];
  readonly store: ReturnType<typeof memoryLedgerStore>;
  readonly logged: Transcript[];
}

function rig(options: { ledger?: LedgerData; library?: LibraryPort; builder?: boolean } = {}): Rig {
  const clock = createFakeClock(START);
  const rnd = mulberry32(7);
  const shows: [Seat, StationView][] = [];
  const buzzes: [Seat, "ok" | "no"][] = [];
  const store = memoryLedgerStore(options.ledger);
  const logged: Transcript[] = [];
  const core = createCore({
    clock,
    stations: { show: (seat, view) => shows.push([seat, view]), buzz: (seat, kind) => buzzes.push([seat, kind]) },
    ledger: store,
    library: options.library ?? teamLibrary(),
    log: { record: (t) => void logged.push(t), countedSince: () => 0 },
    random: () => Math.floor(rnd() * 2 ** 32) >>> 0,
  }, { builder: options.builder ?? false });
  const events: BoxEvent[] = [];
  core.subscribe((_, event) => events.push(event));
  return { core, clock, events, shows, buzzes, store, logged };
}

function until(r: Rig, check: (state: BoxState) => boolean, limit = 60_000): void {
  for (let waited = 0; !check(r.core.state()); waited += 50) {
    if (waited > limit) throw new Error(`still ${r.core.state().phase} after ${limit} ms`);
    r.clock.advance(50);
  }
}

function touch(core: Core, seat: Seat, badge: Badge | null, at = core.now(), source: TapSource = "station"): number {
  const tap = core.nextTap();
  core.tap({ phase: "touch", tap, seat, at, badge }, source);
  return tap;
}

/** A known badge's whole tap from a station: touch and done together, as the taps send them. */
function stationTap(core: Core, seat: Seat, badge: Badge, roll: number | null = null): void {
  const tap = touch(core, seat, badge);
  core.tap({ phase: "done", tap, seat, at: core.now(), badge, roll });
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
    expect(r.store.current().escrow).toEqual({ [NOVA.address]: 10, [KITE.address]: 10 });
    expect([core.plan(0), core.plan(1)]).toEqual(["identify", "identify"]);

    until(r, (state) => state.match?.play.game === "quick-draw" && state.match.play.state.phase === "draw");
    const play = core.state().match?.play;
    if (play?.game !== "quick-draw") throw new Error("no Quick Draw");
    const { drawAt } = play.state;
    // Player 2's chip touched 180 ms after the draw; the core hears of it a little later. The touch time counts.
    clock.advance(drawAt + 300 - clock.now());
    const tap = touch(core, 1, KITE, drawAt + 180);
    expect(lastTap(r)).toEqual({ type: "tap", seat: 1, accepted: true });
    // It waits SETTLE_MS from the touch for the other station, then judges.
    expect(core.state().match?.outcome).toBeNull();
    clock.advance(400);
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
    expect(r.store.current()).toEqual({ balances: { [NOVA.address]: 90, [KITE.address]: 110 }, escrow: {} });

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
    const r = rig({ ledger: { balances: { [NOVA.address]: 40 }, escrow: {} } });
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

  it("waits for a chip still being read that touched first, and lets it win when it is the seated player's", () => {
    const r = rig();
    const { core, clock } = r;
    toPlaying(r, "quick-draw");
    until(r, (state) => state.match?.play.game === "quick-draw" && state.match.play.state.phase === "draw");
    const play = core.state().match?.play;
    if (play?.game !== "quick-draw") throw new Error("no Quick Draw");
    const { drawAt } = play.state;
    // Player 1's chip touched at +120 but the roster didn't know it; Player 2's known chip touched at +150.
    const unknown = touch(core, 0, null, drawAt + 120);
    touch(core, 1, KITE, drawAt + 150);
    clock.advance(800);
    expect(core.state().match?.outcome).toBeNull();
    core.tap({ phase: "done", tap: unknown, seat: 0, at: drawAt + 120, badge: NOVA, roll: null });
    clock.advance(50);
    expect(core.state().match?.outcome).toEqual({ winner: 0 });
  });

  it("freezes the Stock Duel card a touch saw, and lets it go when the tap fails", () => {
    const r = rig();
    const { core, clock } = r;
    toPlaying(r, "stock-duel");
    until(r, (state) => state.match?.play.game === "stock-duel" && state.match.play.state.phase === "pick");
    const held = () => {
      const play = core.state().match?.play;
      return play?.game === "stock-duel" ? play.state.held : null;
    };
    const tap = touch(core, 1, KITE);
    expect(held()?.[1]).not.toBeNull();
    clock.advance(600);
    core.tap({ phase: "fail", tap, seat: 1, at: core.now(), badge: KITE, error: { code: "lifted", text: "lifted" } });
    expect(held()).toEqual([null, null]);
    // A stranger's chip at a seat is let go as soon as it is read.
    const stranger = touch(core, 0, null);
    expect(held()?.[0]).not.toBeNull();
    core.tap({ phase: "done", tap: stranger, seat: 0, at: core.now(), badge: DEMO_BADGES[2] as Badge, roll: 7 });
    expect(held()).toEqual([null, null]);
  });

  it("logs each match's transcript, and counts it only on station taps from both badges over 12 s", () => {
    const r = rig();
    const { core, clock } = r;
    core.send({ type: "booted" });
    for (const [seat, badge] of [[0, NOVA], [0, NOVA], [1, KITE]] as const) stationTap(core, seat, badge);
    core.send({ type: "focus", game: "quick-draw" });
    core.send({ type: "play" });
    stationTap(core, 0, NOVA);
    stationTap(core, 1, KITE);
    until(r, (state) => state.phase === "playing");
    clock.advance(12_000);
    until(r, (state) => state.match?.play.game === "quick-draw" && state.match.play.state.phase === "draw");
    stationTap(core, 1, KITE);
    until(r, (state) => state.phase === "result");
    expect(r.logged).toHaveLength(1);
    const [t] = r.logged;
    expect(t).toMatchObject({ v: 1, game: "quick-draw", badges: [NOVA.address, KITE.address], stake: 10, result: { winner: 1 }, counts: true });
    expect(t?.taps).toEqual([{ seat: 1, at: expect.any(Number), roll: null, accepted: true }]);
    expect(t?.endedAt).toBe(core.state().match?.endedAt);

    // The same match from injected taps is played, logged, and doesn't count.
    const injected = rig();
    toPlaying(injected, "quick-draw");
    until(injected, (state) => state.phase === "playing");
    injected.clock.advance(15_000);
    until(injected, (state) => state.match?.play.game === "quick-draw" && state.match.play.state.phase === "draw");
    instantTap(injected.core, 0, NOVA, 1);
    until(injected, (state) => state.phase === "result");
    expect(injected.logged[0]?.counts).toBe(false);
  });

  it("takes a seated badge's tap on the result as a rematch, but only after REMATCH_TAP_MS", () => {
    const r = rig();
    const { core, clock } = r;
    toPlaying(r, "quick-draw");
    instantTap(core, 0, NOVA, 1);
    until(r, (state) => state.phase === "result");
    const endedAt = core.state().match?.endedAt ?? 0;
    expect(core.plan(0)).toBe("none");
    instantTap(core, 0, NOVA, 1);
    expect(core.state().phase).toBe("result");
    clock.advance(endedAt + REMATCH_TAP_MS - clock.now());
    expect(core.plan(0)).toBe("identify");
    instantTap(core, 0, NOVA, 1);
    expect(core.state().phase).toBe("stake");
  });

  it("hands back a stake left in escrow by a match the Box lost when it stopped", () => {
    const ledger = { balances: { [NOVA.address]: 90, [KITE.address]: 90 }, escrow: { [NOVA.address]: 10, [KITE.address]: 10 } };
    const r = rig({ ledger });
    expect(r.store.current()).toEqual({ balances: { [NOVA.address]: 100, [KITE.address]: 100 }, escrow: {} });
  });

  it("resets to Home mid-match with both stakes back, and keeps a stake the open was still carrying", () => {
    const r = rig();
    toPlaying(r, "stock-duel");
    r.core.reset();
    expect(r.core.state()).toMatchObject({ phase: "home", match: null });
    expect(r.store.current()).toEqual({ balances: { [NOVA.address]: 100, [KITE.address]: 100 }, escrow: {} });

    // Reset while the open transaction is on its way: it lands, and locks nothing.
    r.core.send({ type: "play" });
    instantTap(r.core, 0, NOVA, 1);
    instantTap(r.core, 1, KITE, 1);
    r.core.reset();
    until(r, (state) => state.txs.every((tx) => tx.step === "paid"));
    expect(r.core.state().phase).toBe("home");
    expect(r.store.current().escrow).toEqual({});
  });
});

describe("money that never arrives", () => {
  /** A Quick Draw at 10 EGB each that ended with the Box's power off: on Refund, both refunds claimed and on their way. */
  function refunding(): Rig {
    const r = rig({ ledger: { balances: { [NOVA.address]: 20, [KITE.address]: 20 }, escrow: {} } });
    toPlaying(r, "quick-draw");
    r.core.setPower(false);
    instantTap(r.core, 0, NOVA, 1);
    until(r, (state) => state.phase === "refund");
    until(r, (state) => state.chain.block >= (state.match?.refundBlock ?? Infinity));
    r.core.send({ type: "refund" });
    expect(r.core.state().seats.map((seat) => seat.pending)).toEqual([10, 10]);
    return r;
  }

  it("forgets a refund on its way when a reset hands the stake back, and the late refund pays nothing twice", () => {
    const r = refunding();
    r.core.reset();
    expect(r.core.state().seats.map((seat) => seat.pending)).toEqual([0, 0]);
    expect(r.store.current()).toEqual({ balances: { [NOVA.address]: 20, [KITE.address]: 20 }, escrow: {} });
    until(r, (state) => state.txs.every((tx) => tx.step === "paid"));
    expect(r.store.current()).toEqual({ balances: { [NOVA.address]: 20, [KITE.address]: 20 }, escrow: {} });
  });

  it("stakes more than the real balance only with the faucet's top-up, so the open always locks", () => {
    const r = refunding();
    r.core.reset();
    r.core.setPower(true);
    r.core.send({ type: "play" });
    r.core.send({ type: "stake", amount: 25 });
    instantTap(r.core, 0, NOVA, 1);
    instantTap(r.core, 1, KITE, 1);
    until(r, (state) => state.phase === "playing");
    expect(r.store.current().escrow).toEqual({ [NOVA.address]: 25, [KITE.address]: 25 });
    instantTap(r.core, 0, NOVA, 1);
    until(r, (state) => state.phase === "result");
    until(r, (state) => state.txs.length > 0 && state.txs.every((tx) => tx.step === "paid"));
    expect(r.store.current().escrow).toEqual({});
  });
});

describe("the build phase", () => {
  /** Booted, with NOVA seated, on Home. */
  function onHome(builder: boolean): Rig {
    const r = rig({ builder });
    r.core.send({ type: "booted" });
    instantTap(r.core, 0, NOVA, 1); // attract → Home
    instantTap(r.core, 0, NOVA, 1); // seated
    expect(r.core.state().phase).toBe("home");
    return r;
  }

  it("opens from Home only on a Box with the builder, and home or back returns", () => {
    const demo = onHome(false);
    demo.core.send({ type: "build" });
    expect(demo.core.state().phase).toBe("home");

    const { core, events } = onHome(true);
    core.send({ type: "build" });
    expect(core.state().phase).toBe("build");
    expect(events.at(-1)).toEqual({ type: "phase", from: "home", to: "build" });
    core.send({ type: "home" });
    expect(core.state().phase).toBe("home");
    core.send({ type: "build" });
    core.send({ type: "back" });
    expect(core.state().phase).toBe("home");
    // Only from Home: not mid-flow.
    core.send({ type: "play" });
    core.send({ type: "build" });
    expect(core.state().phase).toBe("join");
  });

  it("plans no taps while building, ignores the ones that come, and keeps the seats", () => {
    const r = onHome(true);
    r.core.send({ type: "build" });
    expect([r.core.plan(0), r.core.plan(1)]).toEqual(["none", "none"]);
    instantTap(r.core, 1, KITE, 1);
    expect(lastTap(r)).toEqual({ type: "tap", seat: 1, accepted: false });
    expect(r.buzzes.at(-1)).toEqual([1, "no"]);
    expect(r.core.state().seats[1].badge).toBeNull();
    expect(r.core.state().seats[0].badge).toEqual(NOVA);
    expect(r.core.state().stations.map((view) => view.big)).toEqual(["NEW GAME", "NEW GAME"]);
  });

  it("goes back to Home after BUILD_IDLE_MS with no command, and each build command holds it there", () => {
    const r = onHome(true);
    r.core.send({ type: "build" });
    r.clock.advance(IDLE_MS + 1);
    expect(r.core.state().phase).toBe("build");
    r.clock.advance(BUILD_IDLE_MS - IDLE_MS - 2);
    r.core.send({ type: "build" });
    r.clock.advance(BUILD_IDLE_MS - 1);
    expect(r.core.state().phase).toBe("build");
    r.clock.advance(1);
    expect(r.core.state().phase).toBe("home");
  });
});
