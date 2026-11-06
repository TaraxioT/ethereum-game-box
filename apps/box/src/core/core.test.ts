// The core through its ports alone: a fake clock drives whole matches, taps arrive as touch / done / fail, the stations
// and the library are recorders, and the chain is the demo's in-memory chain, or a recording port whose transactions
// a test moves step by step.
import { describe, expect, it } from "vitest";
import { mulberry32, type Seat, type StationView, type Transcript } from "@egb/sdk";
import type { ChainHead, ChainPort, LibraryPort, ResultOrder, StakeOrder, TxWatch } from "./ports.ts";
import type { Badge, Board, BoxEvent, BoxState, GameInfo } from "./types.ts";
import { BUILD_IDLE_MS, createCore, END_HOLD_MS, IDLE_MS, REFUND_DONE_MS, TOPUP_USDC, type Core } from "./core.ts";
import { REMATCH_TAP_MS } from "./plan.ts";
import type { TapSource } from "./ports.ts";
import { createFakeClock, type FakeClock } from "./fake-clock.ts";
import { createDemoChain, DEMO_REFUND_MS, type DemoChain } from "./demo-chain.ts";
import { chainLabel, TEAM_GAMES, teamLibrary } from "./catalogue.ts";
import { DEMO_BADGES } from "./badges.ts";
import { instantTap } from "./instant-tap.ts";
import { reactionMs } from "../games/quick-draw/rules.ts";
import { frontCard, SHOW_LAG_MS } from "../games/stock-duel/rules.ts";
import { STATS } from "../games/stock-duel/deck.ts";

const START = Date.parse("2026-11-06T10:00:00Z");
const [NOVA, KITE, JUNO] = DEMO_BADGES as [Badge, Badge, Badge];
const HASH = `0x${"cd".repeat(32)}` as const;
const LABEL = /^[a-z0-9]([a-z0-9-]{1,30}[a-z0-9])$/;

/** One request a recording port took, with the watch the test moves it on with. */
interface Sent {
  readonly kind: "open" | "settle" | "refund" | "topup" | "claim";
  readonly order: unknown;
  readonly watch: TxWatch;
}

/** A chain port that records every request and leaves each transaction where it is until the test moves it. */
interface Recording extends ChainPort {
  readonly sent: Sent[];
  readonly outcomes: (readonly [ResultOrder, string | null])[];
  readonly boards: string[];
  readonly balances: Map<string, number>;
  readonly names: Map<string, string>;
  head(head: ChainHead): void;
}

function recordingPort(): Recording {
  const sent: Sent[] = [];
  const outcomes: (readonly [ResultOrder, string | null])[] = [];
  const boards: string[] = [];
  const balances = new Map<string, number>();
  const names = new Map<string, string>();
  const heads = new Set<(head: ChainHead) => void>();
  // The port's rounds start where it says, not at 1: the core takes them as they come.
  let round = 40;
  const take = (kind: Sent["kind"]) => (order: unknown, watch: TxWatch) => void sent.push({ kind, order, watch });
  return {
    sent,
    outcomes,
    boards,
    balances,
    names,
    onChain: (game) => chainLabel(game) !== null,
    nextRound: () => ++round,
    refundAfterMs: 3_600_000,
    balance: (address) => Promise.resolve(balances.get(address) ?? 100),
    player: (address) => Promise.resolve({ address, name: names.get(address) ?? null, balance: balances.get(address) ?? 100 }),
    board(game): Promise<Board> {
      boards.push(game);
      return Promise.resolve({ title: { name: "champion.stockduel.gamebox.eth", holder: "kite.gamebox.eth", streak: 2 }, cup: null });
    },
    open: take("open"),
    settle: take("settle"),
    refund: (round, watch) => void sent.push({ kind: "refund", order: round, watch }),
    topup: (address, watch) => void sent.push({ kind: "topup", order: address, watch }),
    claim: (label, address, watch) => void sent.push({ kind: "claim", order: { label, address }, watch }),
    outcome(order, hash) {
      outcomes.push([order, hash]);
      return Promise.resolve(["nova.gamebox.eth +20 USDC", "nova.gamebox.eth now holds champion.quickdraw.gamebox.eth"]);
    },
    watchHead(listener) {
      heads.add(listener);
      return () => void heads.delete(listener);
    },
    head: (head) => heads.forEach((listener) => listener(head)),
  };
}

/** Moves a recorded transaction through to paid, or fails it. */
function pay(sent: Sent | undefined, block = 7): void {
  if (!sent) throw new Error("nothing was sent");
  sent.watch({ step: "sent", hash: HASH, etherscan: `https://sepolia.etherscan.io/tx/${HASH}`, block: null, error: null });
  sent.watch({ step: "in-block", hash: HASH, etherscan: null, block, error: null });
  sent.watch({ step: "paid", hash: HASH, etherscan: null, block, error: null });
}

function fail(sent: Sent | undefined, error = "reverted"): void {
  if (!sent) throw new Error("nothing was sent");
  sent.watch({ step: "failed", hash: null, etherscan: null, block: null, error });
}

interface Rig<C extends ChainPort = DemoChain> {
  readonly core: Core;
  readonly clock: FakeClock;
  readonly chain: C;
  readonly events: BoxEvent[];
  readonly shows: [Seat, StationView][];
  readonly buzzes: [Seat, "ok" | "no"][];
  readonly logged: Transcript[];
}

function rigOn<C extends ChainPort>(chainOf: (clock: FakeClock) => C, options: { library?: LibraryPort; builder?: boolean } = {}): Rig<C> {
  const clock = createFakeClock(START);
  const rnd = mulberry32(7);
  const shows: [Seat, StationView][] = [];
  const buzzes: [Seat, "ok" | "no"][] = [];
  const logged: Transcript[] = [];
  const chain = chainOf(clock);
  const core = createCore({
    clock,
    stations: { show: (seat, view) => shows.push([seat, view]), buzz: (seat, kind) => buzzes.push([seat, kind]) },
    chain,
    library: options.library ?? teamLibrary(),
    log: { record: (t) => void logged.push(t), countedSince: () => 0 },
    random: () => Math.floor(rnd() * 2 ** 32) >>> 0,
  }, { builder: options.builder ?? false });
  const events: BoxEvent[] = [];
  core.subscribe((_, event) => events.push(event));
  return { core, clock, chain, events, shows, buzzes, logged };
}

/** A Box on the demo's in-memory chain. */
const rig = (options: { library?: LibraryPort; builder?: boolean } = {}): Rig => rigOn(createDemoChain, options);

/** Lets the chain's reads (promises) land. */
async function flush(): Promise<void> {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

/** Moves the clock in ticks, letting the chain's reads land between them. */
async function until<C extends ChainPort>(r: Rig<C>, check: (state: BoxState) => boolean, limit = 60_000): Promise<void> {
  for (let waited = 0; !check(r.core.state()); waited += 50) {
    if (waited > limit) throw new Error(`still ${r.core.state().phase} after ${limit} ms`);
    r.clock.advance(50);
    await flush();
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

/** Boots and seats NOVA and KITE on Home, their balances read. */
async function seated<C extends ChainPort>(r: Rig<C>): Promise<void> {
  r.core.send({ type: "booted" });
  instantTap(r.core, 0, NOVA, 1);
  instantTap(r.core, 0, NOVA, 1);
  instantTap(r.core, 1, KITE, 1);
  await flush();
}

/** Seats NOVA and KITE, picks the game and opens a match at 10 USDC each. */
async function toPlaying<C extends ChainPort>(r: Rig<C>, game: "quick-draw" | "stock-duel"): Promise<void> {
  const { core } = r;
  await seated(r);
  core.send({ type: "focus", game });
  core.send({ type: "play" });
  expect(core.state().phase).toBe("stake");
  await flush();
  instantTap(core, 0, NOVA, 1);
  instantTap(core, 1, KITE, 1);
  expect(core.state().phase).toBe("playing");
}

/** Plays the running Quick Draw to a win for `seat` and waits out the end hold. */
async function quickWin<C extends ChainPort>(r: Rig<C>, seat: Seat): Promise<void> {
  await until(r, (state) => state.match?.play.game === "quick-draw" && state.match.play.state.phase === "draw");
  instantTap(r.core, seat, seat === 0 ? NOVA : KITE, 1);
  await until(r, (state) => state.phase === "result");
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

  it("runs a whole Quick Draw on the fake clock, judged by the touch time, and settles it on chain", async () => {
    const r = rig();
    const { core, clock } = r;
    await toPlaying(r, "quick-draw");
    expect([core.plan(0), core.plan(1)]).toEqual(["identify", "identify"]);

    await until(r, (state) => state.match?.play.game === "quick-draw" && state.match.play.state.phase === "draw");
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
    // The pot lands in the next head; the result goes then, and its lines come from the chain once it is paid.
    await until(r, (state) => state.match?.lines !== null);
    expect(r.chain.sent).toEqual(["open 1", "settle 1"]);
    expect(await r.chain.balance(NOVA.address)).toBe(90);
    expect(await r.chain.balance(KITE.address)).toBe(110);
    expect(core.state().seats.map((seat) => seat.balance)).toEqual([90, 110]);
    expect(core.state().match?.lines?.[0]).toMatch(/\+20 USDC$/);

    core.stop();
    r.chain.stop();
    expect(clock.pending()).toBe(0);
  });

  it("waits for a Stock Duel tap's done, and plays the card in front at its touch with the badge's roll", async () => {
    const r = rig();
    const { core, clock } = r;
    await toPlaying(r, "stock-duel");
    expect(core.plan(0)).toBe("none");
    await until(r, (state) => state.match?.play.game === "stock-duel" && state.match.play.state.phase === "pick");
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

  it("ends a tap that fails with a refusal and changes nothing", async () => {
    const r = rig();
    const { core } = r;
    await toPlaying(r, "stock-duel");
    await until(r, (state) => state.match?.play.game === "stock-duel" && state.match.play.state.phase === "pick");
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

  it("reads a seated badge's balance and player name from chain", async () => {
    const r = rigOn(recordingPort);
    r.chain.balances.set(NOVA.address, 40);
    r.chain.names.set(NOVA.address, "nova.gamebox.eth");
    r.core.send({ type: "booted" });
    instantTap(r.core, 0, NOVA, 1);
    instantTap(r.core, 0, NOVA, 1);
    // Unread until the chain answers: no balance yet, and the station says so.
    expect(r.core.state().seats[0]).toMatchObject({ balance: null, ens: null });
    expect(r.core.state().stations[0].small).toBe("... USDC");
    await flush();
    expect(r.core.state().seats[0]).toMatchObject({ balance: 40, ens: "nova.gamebox.eth" });
    expect(r.core.state().stations[0].small).toBe("40 USDC");
    // Nothing is sent to the chain for a seat: no faucet, no top-up.
    expect(r.chain.sent).toEqual([]);
  });

  it("follows the chain's head for the block clock and the gas", () => {
    const r = rigOn(recordingPort);
    expect(r.core.state().chain.block).toBe(0);
    r.chain.head({ block: 12_080_000, at: START + 5, gasGwei: 1.5 });
    expect(r.core.state().chain).toMatchObject({ block: 12_080_000, blockAt: START + 5, gasGwei: 1.5 });
    expect(r.events.slice(-3)).toEqual([{ type: "block", block: 12_080_000 }, { type: "cue", cue: "block" }, { type: "gas", gwei: 1.5 }]);
    // An older head (a lagging RPC) changes nothing.
    const count = r.events.length;
    r.chain.head({ block: 12_079_999, at: START + 6, gasGwei: 2 });
    expect(r.events.length).toBe(count);
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

  it("waits for a chip still being read that touched first, and lets it win when it is the seated player's", async () => {
    const r = rig();
    const { core, clock } = r;
    await toPlaying(r, "quick-draw");
    await until(r, (state) => state.match?.play.game === "quick-draw" && state.match.play.state.phase === "draw");
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

  it("freezes the Stock Duel card a touch saw, and lets it go when the tap fails", async () => {
    const r = rig();
    const { core, clock } = r;
    await toPlaying(r, "stock-duel");
    await until(r, (state) => state.match?.play.game === "stock-duel" && state.match.play.state.phase === "pick");
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

  it("logs each match's transcript, and counts it only on station taps from both badges over 12 s", async () => {
    const r = rig();
    const { core, clock } = r;
    core.send({ type: "booted" });
    for (const [seat, badge] of [[0, NOVA], [0, NOVA], [1, KITE]] as const) stationTap(core, seat, badge);
    core.send({ type: "focus", game: "quick-draw" });
    core.send({ type: "play" });
    await flush();
    stationTap(core, 0, NOVA);
    stationTap(core, 1, KITE);
    await until(r, (state) => state.phase === "playing");
    clock.advance(12_000);
    await until(r, (state) => state.match?.play.game === "quick-draw" && state.match.play.state.phase === "draw");
    stationTap(core, 1, KITE);
    await until(r, (state) => state.phase === "result");
    expect(r.logged).toHaveLength(1);
    const [t] = r.logged;
    expect(t).toMatchObject({ v: 1, game: "quick-draw", badges: [NOVA.address, KITE.address], stake: 10, result: { winner: 1 }, counts: true });
    expect(t?.taps).toEqual([{ seat: 1, at: expect.any(Number), roll: null, accepted: true }]);
    expect(t?.endedAt).toBe(core.state().match?.endedAt);

    // The same match from injected taps is played, logged, and doesn't count.
    const injected = rig();
    await toPlaying(injected, "quick-draw");
    injected.clock.advance(15_000);
    await until(injected, (state) => state.match?.play.game === "quick-draw" && state.match.play.state.phase === "draw");
    instantTap(injected.core, 0, NOVA, 1);
    await until(injected, (state) => state.phase === "result");
    expect(injected.logged[0]?.counts).toBe(false);
  });

  it("takes a seated badge's tap on the result as a rematch, but only after REMATCH_TAP_MS", async () => {
    const r = rig();
    const { core, clock } = r;
    await toPlaying(r, "quick-draw");
    instantTap(core, 0, NOVA, 1);
    await until(r, (state) => state.phase === "result");
    const endedAt = core.state().match?.endedAt ?? 0;
    expect(core.plan(0)).toBe("none");
    instantTap(core, 0, NOVA, 1);
    expect(core.state().phase).toBe("result");
    clock.advance(endedAt + REMATCH_TAP_MS - clock.now());
    expect(core.plan(0)).toBe("identify");
    instantTap(core, 0, NOVA, 1);
    expect(core.state().phase).toBe("stake");
  });

  it("resets to Home mid-match and leaves the pot on chain, for the server to refund once its delay has run", async () => {
    const r = rig();
    await toPlaying(r, "stock-duel");
    r.core.reset();
    expect(r.core.state()).toMatchObject({ phase: "home", match: null });
    await until(r, (state) => state.txs.length > 0 && state.txs.every((tx) => tx.step === "paid"));
    expect(r.chain.sent).toEqual(["open 1"]);
    expect(await r.chain.balance(NOVA.address)).toBe(90);
  });
});

describe("stakes on chain", () => {
  it("opens the match the moment both seats sign, and the transaction bar follows the pot", async () => {
    const r = rigOn(recordingPort);
    await toPlaying(r, "quick-draw");
    const [open] = r.chain.sent;
    expect(open).toMatchObject({ kind: "open", order: { round: 41, game: "quick-draw", badges: [NOVA.address, KITE.address], amount: 10 } satisfies StakeOrder });
    expect(r.core.state().match).toMatchObject({ round: 41, stake: 10 });
    const bar = () => r.core.state().txs.map((tx) => [tx.kind, tx.amount, tx.step]);
    expect(bar()).toEqual([["open", 20, "signed"]]);
    pay(open, 9);
    expect(r.core.state().txs[0]).toMatchObject({ step: "paid", hash: HASH, block: 9, etherscan: `https://sepolia.etherscan.io/tx/${HASH}` });
    const steps = r.events.flatMap((event) => (event.type === "tx" ? [event.tx.step] : []));
    expect(steps).toEqual(["signed", "sent", "in-block", "paid"]);
  });

  it("sends the result only once the pot has landed, with the same round, and shows what the chain says it did", async () => {
    const r = rigOn(recordingPort);
    await toPlaying(r, "quick-draw");
    await quickWin(r, 1);
    // The game is over, but the pot is still on its way: no result yet.
    expect(r.chain.sent.map((sent) => sent.kind)).toEqual(["open"]);
    pay(r.chain.sent[0]);
    const settle = r.chain.sent[1];
    const order: ResultOrder = { round: 41, game: "quick-draw", badges: [NOVA.address, KITE.address], winner: 1 };
    expect(settle).toMatchObject({ kind: "settle", order });
    expect(r.core.state().txs.at(-1)).toMatchObject({ kind: "settle", amount: 20, seat: 1 });
    expect(r.core.state().seats[1].pending).toBe(20);
    expect(r.core.state().match?.lines).toBeNull();
    pay(settle);
    await flush();
    expect(r.chain.outcomes).toEqual([[order, HASH]]);
    expect(r.core.state().match?.lines).toEqual(["nova.gamebox.eth +20 USDC", "nova.gamebox.eth now holds champion.quickdraw.gamebox.eth"]);
    expect(r.core.state().seats[1].pending).toBe(0);
  });

  it("plays a match whose pot failed to open, and still reports its result, with nothing paid", async () => {
    const r = rigOn(recordingPort);
    await toPlaying(r, "quick-draw");
    fail(r.chain.sent[0], "PotExists");
    expect(r.core.state().phase).toBe("playing");
    await quickWin(r, 0);
    expect(r.chain.sent.map((sent) => sent.kind)).toEqual(["open", "settle"]);
    expect(r.chain.sent[1]?.order).toMatchObject({ round: 41, winner: 0 });
    expect(r.core.state().txs.at(-1)).toMatchObject({ kind: "settle", amount: 0 });
    expect(r.core.state().seats[0].pending).toBe(0);
  });

  it("still sends a result decided before its pot landed after a rematch", async () => {
    const r = rigOn(recordingPort);
    await toPlaying(r, "quick-draw");
    await quickWin(r, 0);
    r.core.send({ type: "rematch" });
    expect(r.core.state().phase).toBe("stake");
    pay(r.chain.sent[0]);
    expect(r.chain.sent[1]).toMatchObject({ kind: "settle", order: { round: 41, winner: 0 } });
  });

  it("takes a fresh round from the port for each match", async () => {
    const r = rigOn(recordingPort);
    await toPlaying(r, "quick-draw");
    pay(r.chain.sent[0]);
    await quickWin(r, 0);
    pay(r.chain.sent[1]);
    r.core.send({ type: "rematch" });
    await flush();
    instantTap(r.core, 0, NOVA, 1);
    instantTap(r.core, 1, KITE, 1);
    expect(r.chain.sent.filter((sent) => sent.kind === "open").map((sent) => (sent.order as StakeOrder).round)).toEqual([41, 42]);
    expect(r.core.state().match?.round).toBe(42);
  });

  it("sends a badge that can't cover the stake to the lobby, and Back returns to Stake with both seats", async () => {
    const r = rigOn(recordingPort);
    r.chain.balances.set(KITE.address, 4);
    await seated(r);
    r.core.send({ type: "play" });
    await flush();
    instantTap(r.core, 0, NOVA, 1);
    expect(r.core.state().seats[0].signed).toBe(true);
    instantTap(r.core, 1, KITE, 1);
    expect(r.buzzes.at(-1)).toEqual([1, "no"]);
    expect(r.core.state()).toMatchObject({ phase: "lobby", lobby: { badge: KITE, from: "stake" } });
    expect(r.chain.sent).toEqual([]);
    r.core.send({ type: "back" });
    expect(r.core.state().phase).toBe("stake");
    expect(r.core.state().seats.map((seat) => [seat.badge, seat.signed])).toEqual([[NOVA, false], [KITE, false]]);
  });

  it("sends a badge whose balance isn't read yet to the lobby too", () => {
    const r = rigOn(recordingPort);
    r.core.send({ type: "booted" });
    instantTap(r.core, 0, NOVA, 1);
    instantTap(r.core, 0, NOVA, 1);
    instantTap(r.core, 1, KITE, 1);
    r.core.send({ type: "play" });
    instantTap(r.core, 0, NOVA, 1);
    expect(r.core.state()).toMatchObject({ phase: "lobby", lobby: { badge: NOVA, from: "stake" } });
  });
});

describe("the lobby", () => {
  it("opens from Home and shows the card of whoever taps, at either station, with their own label to claim", async () => {
    const r = rig();
    r.core.send({ type: "booted" });
    r.core.send({ type: "start" });
    r.core.send({ type: "lobby" });
    expect(r.core.state()).toMatchObject({ phase: "lobby", lobby: { badge: null, from: "home" } });
    expect([r.core.plan(0), r.core.plan(1)]).toEqual(["identify", "identify"]);
    const proposals: (string | null)[] = [];
    for (const [seat, badge] of [[1, NOVA], [0, KITE], [1, JUNO]] as const) {
      instantTap(r.core, seat, badge, 1);
      expect(r.buzzes.at(-1)).toEqual([seat, "ok"]);
      await flush();
      expect(r.core.state().lobby.card).toEqual({ address: badge.address, name: null, balance: 100 });
      proposals.push(r.core.state().lobby.proposal);
    }
    expect(proposals).toEqual(["nova", "kite", "juno"]);
    // Nobody was seated by it.
    expect(r.core.state().seats.map((seat) => seat.badge)).toEqual([null, null]);
  });

  it("proposes another label on request, then claims the one on show", async () => {
    const r = rig();
    r.core.send({ type: "booted" });
    r.core.send({ type: "lobby" });
    instantTap(r.core, 0, NOVA, 1);
    await flush();
    r.core.send({ type: "propose" });
    const another = r.core.state().lobby.proposal ?? "";
    expect(another).toMatch(/^[a-z]+-\d\d$/);
    expect(another).toMatch(LABEL);
    r.core.send({ type: "claim" });
    expect(r.core.state().txs.at(-1)).toMatchObject({ kind: "claim", amount: 0, step: "signed" });
    await until(r, (state) => state.lobby.card?.name !== null);
    expect(r.chain.sent).toEqual([`claim ${another}`]);
    expect(r.core.state().lobby).toMatchObject({ card: { name: `${another}.gamebox.eth` }, proposal: null });
    // A badge with a name has nothing to claim.
    r.core.send({ type: "claim" });
    expect(r.chain.sent).toHaveLength(1);
  });

  it("claims the badge's own label: NOVA becomes nova.gamebox.eth, and a seat shows it", async () => {
    const r = rig();
    r.core.send({ type: "booted" });
    r.core.send({ type: "lobby" });
    instantTap(r.core, 1, NOVA, 1);
    await flush();
    r.core.send({ type: "claim" });
    await until(r, (state) => state.lobby.card?.name !== null);
    expect(r.core.state().lobby.card?.name).toBe("nova.gamebox.eth");
    r.core.send({ type: "back" });
    instantTap(r.core, 0, NOVA, 1);
    await flush();
    expect(r.core.state().seats[0].ens).toBe("nova.gamebox.eth");
  });

  it("tops up 100 USDC and reads the balance again once it is paid", async () => {
    const r = rig();
    r.core.send({ type: "booted" });
    r.core.send({ type: "lobby" });
    instantTap(r.core, 0, KITE, 1);
    await flush();
    r.core.send({ type: "topup" });
    expect(r.core.state().txs.at(-1)).toMatchObject({ kind: "topup", amount: TOPUP_USDC });
    await until(r, (state) => state.lobby.card?.balance === 200);
    expect(r.chain.sent).toEqual([`topup ${KITE.address}`]);
  });

  it("reads the title and the championship of the focused game, or Stock Duel's for a game not on chain", async () => {
    const built: GameInfo = { ...TEAM_GAMES[0], id: "coin-rush", kind: "built", title: "Coin Rush" } as GameInfo;
    const library: LibraryPort = { games: () => [...TEAM_GAMES, built], subscribe: () => () => {} };
    const r = rigOn(recordingPort, { library });
    r.core.send({ type: "booted" });
    r.core.send({ type: "start" });
    for (const game of ["quick-draw", "coin-rush"]) {
      r.core.send({ type: "focus", game });
      r.core.send({ type: "lobby" });
      await flush();
      r.core.send({ type: "back" });
    }
    expect(r.chain.boards).toEqual(["quick-draw", "stock-duel"]);
    r.core.send({ type: "lobby" });
    await flush();
    expect(r.core.state().lobby.board?.title).toEqual({ name: "champion.stockduel.gamebox.eth", holder: "kite.gamebox.eth", streak: 2 });
  });

  it("goes back Home after IDLE_MS with nobody there", () => {
    const r = rig();
    r.core.send({ type: "booted" });
    r.core.send({ type: "lobby" });
    r.clock.advance(IDLE_MS - 1);
    expect(r.core.state().phase).toBe("lobby");
    r.clock.advance(1);
    expect(r.core.state().phase).toBe("home");
  });
});

describe("refund", () => {
  /** A Quick Draw at 10 USDC each, its pot open, that ended with the Box's power off. */
  async function offline(): Promise<Rig> {
    const r = rig();
    await toPlaying(r, "quick-draw");
    r.core.setPower(false);
    await until(r, (state) => state.txs[0]?.step === "paid");
    instantTap(r.core, 0, NOVA, 1);
    await until(r, (state) => state.phase === "refund");
    return r;
  }

  it("opens once the pot's refund delay has run, sends one refund for both, then goes Home", async () => {
    const r = await offline();
    const match = r.core.state().match;
    expect(match?.refundAt).toBe(START + DEMO_REFUND_MS);
    expect(r.core.plan(0)).toBe("none");
    instantTap(r.core, 0, NOVA, 1);
    expect(r.chain.sent).toEqual(["open 1"]);
    await until(r, () => r.core.now() >= (match?.refundAt ?? Infinity));
    expect(r.core.plan(1)).toBe("identify");
    instantTap(r.core, 1, KITE, 1);
    instantTap(r.core, 0, NOVA, 1);
    expect(r.chain.sent).toEqual(["open 1", "refund 1"]);
    expect(r.core.state().txs.at(-1)).toMatchObject({ kind: "refund", amount: 20 });
    expect(r.core.state().seats.map((seat) => seat.pending)).toEqual([10, 10]);
    await until(r, (state) => state.match?.refunded[0] === true);
    expect(r.core.state().match?.refunded).toEqual([true, true]);
    expect([await r.chain.balance(NOVA.address), await r.chain.balance(KITE.address)]).toEqual([100, 100]);
    r.clock.advance(REFUND_DONE_MS);
    expect(r.core.state().phase).toBe("home");
  });

  it("lets the players leave Refund for Home before it opens", async () => {
    const r = await offline();
    r.core.send({ type: "home" });
    expect(r.core.state().phase).toBe("home");
    expect(r.chain.sent).toEqual(["open 1"]);
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
