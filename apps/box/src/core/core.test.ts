// The core through its ports alone: a fake clock drives whole matches, taps arrive as touch / done / fail, the stations
// and the library are recorders, and the chain is the demo's in-memory chain, or a recording port whose transactions
// a test moves step by step.
import { describe, expect, it } from "vitest";
import { mulberry32, type Seat, type StationView, type Transcript } from "@egb/sdk";
import type { ChainHead, ChainPort, LibraryPort, ResultOrder, StakeOrder, TxWatch } from "./ports.ts";
import type { Badge, Board, BoxEvent, BoxState, GameInfo } from "./types.ts";
import { BOARD_MS, BUILD_IDLE_MS, createCore, END_HOLD_MS, IDLE_MS, REFUND_DONE_MS, REREAD_MS, SEATED_IDLE_MS, TOPUP_USDC, type Core } from "./core.ts";
import { REMATCH_TAP_MS } from "./plan.ts";
import type { TapSource } from "./ports.ts";
import { createFakeClock, type FakeClock } from "./fake-clock.ts";
import { createDemoChain, DEMO_REFUND_MS, type DemoChain } from "./demo-chain.ts";
import { chainLabel, TEAM_GAMES, teamLibrary } from "./catalogue.ts";
import { DEMO_BADGES } from "./badges.ts";
import { instantTap } from "./instant-tap.ts";
import { reactionMs } from "../games/quick-draw/rules.ts";
import type { QuickDrawState } from "../games/quick-draw/types.ts";
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
  /** Each player read, with the block it was read at (null: the latest). */
  readonly reads: (readonly [string, number | null])[];
  /** The node's newest block: a read at a later one rejects, as a node behind the relayer's does. */
  nodeAt: number;
  head(head: ChainHead): void;
}

function recordingPort(): Recording {
  const sent: Sent[] = [];
  const outcomes: (readonly [ResultOrder, string | null])[] = [];
  const boards: string[] = [];
  const balances = new Map<string, number>();
  const names = new Map<string, string>();
  const reads: (readonly [string, number | null])[] = [];
  const heads = new Set<(head: ChainHead) => void>();
  // The port's rounds start where it says, not at 1: the core takes them as they come.
  let round = 40;
  const take = (kind: Sent["kind"]) => (order: unknown, watch: TxWatch) => void sent.push({ kind, order, watch });
  const port: Recording = {
    sent,
    outcomes,
    boards,
    balances,
    names,
    reads,
    nodeAt: Number.MAX_SAFE_INTEGER,
    onChain: (game) => chainLabel(game) !== null,
    nextRound: () => ++round,
    refundAfterMs: 3_600_000,
    stakeNeedsName: false,
    player(address, block) {
      reads.push([address, block ?? null]);
      if (block !== undefined && block > port.nodeAt) return Promise.reject(new Error(`header not found: ${block}`));
      return Promise.resolve({ address, name: names.get(address) ?? null, balance: balances.get(address) ?? 100, record: null });
    },
    board(game): Promise<Board> {
      boards.push(game);
      return Promise.resolve({ title: { name: "champion.stockduel.gamebox.eth", holder: "kite.gamebox.eth", streak: 2, expires: Number.MAX_SAFE_INTEGER }, cup: null, leaders: [], won: [] });
    },
    open: take("open"),
    settle: take("settle"),
    refund: (round, watch) => void sent.push({ kind: "refund", order: round, watch }),
    topup: (address, watch) => void sent.push({ kind: "topup", order: address, watch }),
    claim: (label, address, watch) => void sent.push({ kind: "claim", order: { label, address }, watch }),
    outcome(order, hash) {
      outcomes.push([order, hash]);
      return Promise.resolve({
        lines: ["nova.gamebox.eth +20 USDC", "nova.gamebox.eth now holds champion.quickdraw.gamebox.eth"],
        names: ["nova.gamebox.eth", null],
        paid: 20,
        title: { name: "champion.quickdraw.gamebox.eth", streak: 1 },
        cup: null,
        stats: [null, null],
      });
    },
    watchHead(listener) {
      heads.add(listener);
      return () => void heads.delete(listener);
    },
    head: (head) => heads.forEach((listener) => listener(head)),
  };
  return port;
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
    stations: { show: (seat, view) => shows.push([seat, view]), buzz: (seat, kind) => buzzes.push([seat, kind]), inUse: () => {} },
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
  await potConfirmed(r);
  expect(core.state().phase).toBe("playing");
}

/** Both seats signed: the Box waits on Stake until the pot's open is confirmed, then the match begins. */
async function potConfirmed<C extends ChainPort>(r: Rig<C>): Promise<void> {
  expect(r.core.state().phase).toBe("stake");
  expect(r.core.state().txs.at(-1)).toMatchObject({ kind: "open" });
  const recorded = (r.chain as Partial<Recording>).sent?.findLast((sent) => sent.kind === "open");
  if (recorded) {
    recorded.watch({ step: "in-block", hash: HASH, etherscan: null, block: 7, error: null });
    recorded.watch({ step: "paid", hash: HASH, etherscan: null, block: 7, error: null });
  } else await until(r, (state) => state.phase === "playing");
}

/** The running Quick Draw's state, or null. */
const qd = (state: BoxState): QuickDrawState | null => (state.match?.play.game === "quick-draw" ? state.match.play.state : null);

/** Plays the running Quick Draw until `seat` takes the match, drawing first in every round, and waits out the end hold. */
async function quickWin<C extends ChainPort>(r: Rig<C>, seat: Seat): Promise<void> {
  while (!r.core.state().match?.outcome) {
    await until(r, (state) => qd(state)?.phase === "draw");
    instantTap(r.core, seat, seat === 0 ? NOVA : KITE, 1);
    await until(r, (state) => qd(state)?.phase !== "draw");
  }
  await until(r, (state) => state.phase === "result");
}

const lastTap = (r: Rig) => r.events.filter((event) => event.type === "tap").at(-1);

describe("the hall", () => {
  it("opens from Home, seats a tap, and plays a title from its card at the title's stake", async () => {
    const r = rig();
    r.core.send({ type: "booted" });
    r.core.send({ type: "start" });
    r.core.send({ type: "hall" });
    expect(r.core.state().phase).toBe("hall");
    await flush();
    instantTap(r.core, 0, NOVA, 1);
    instantTap(r.core, 1, KITE, 1);
    expect(r.core.state().seats.map((s) => s.badge?.address)).toEqual([NOVA.address, KITE.address]);
    // No cup is open on the demo chain: a cup card can't be played.
    r.core.send({ type: "challenge", game: "quick-draw", target: "cup" });
    expect(r.core.state().phase).toBe("hall");
    r.core.send({ type: "challenge", game: "quick-draw", target: "title" });
    expect(r.core.state()).toMatchObject({ phase: "stake", focus: "quick-draw", playFor: "title" });
  });

  it("goes back Home on BACK, and by itself after IDLE_MS", () => {
    const r = rig();
    r.core.send({ type: "booted" });
    r.core.send({ type: "start" });
    r.core.send({ type: "hall" });
    r.core.send({ type: "back" });
    expect(r.core.state().phase).toBe("home");
    r.core.send({ type: "hall" });
    r.clock.advance(IDLE_MS);
    expect(r.core.state().phase).toBe("home");
  });
});

describe("players who walk away", () => {
  async function toStake(r: Rig<Recording>): Promise<void> {
    await seated(r);
    r.core.send({ type: "focus", game: "quick-draw" });
    r.core.send({ type: "play" });
    await flush();
    expect(r.core.state().phase).toBe("stake");
  }

  it("leave Stake for Home after SEATED_IDLE_MS, and a sign tap holds it there", async () => {
    const r = rigOn(recordingPort);
    await toStake(r);
    r.clock.advance(SEATED_IDLE_MS - 1);
    instantTap(r.core, 0, NOVA, 1);
    expect(r.core.state().seats[0].signed).toBe(true);
    r.clock.advance(SEATED_IDLE_MS - 1);
    expect(r.core.state().phase).toBe("stake");
    r.clock.advance(1);
    expect(r.core.state().phase).toBe("home");
    expect(r.core.state().seats.map((seat) => seat.signed)).toEqual([false, false]);
  });

  it("stay on Stake while both have signed and the pot is opening", async () => {
    const r = rigOn(recordingPort);
    await toStake(r);
    instantTap(r.core, 0, NOVA, 1);
    instantTap(r.core, 1, KITE, 1);
    r.clock.advance(SEATED_IDLE_MS * 3);
    expect(r.core.state().phase).toBe("stake");
    await potConfirmed(r);
    expect(r.core.state().phase).toBe("playing");
  });
});

describe("EXIT", () => {
  it("calls a match off as a draw: it settles on chain and both stakes go back", async () => {
    const r = rig();
    await toPlaying(r, "quick-draw");
    r.core.send({ type: "quit" });
    expect(r.core.state()).toMatchObject({ phase: "result", match: { calledOff: true, outcome: { winner: null } } });
    await until(r, (state) => state.txs.some((tx) => tx.kind === "settle" && tx.step === "paid"));
    expect(r.core.state().seats.map((s) => s.balance)).toEqual([100, 100]);
    // Nothing to call off once it is over.
    r.core.send({ type: "quit" });
    expect(r.core.state().phase).toBe("result");
  });
});

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
    expect(lastTap(r)).toEqual({ type: "tap", seat: 1, accepted: true, meaning: "play" });
    // It waits SETTLE_MS from the touch for the other station, then judges.
    expect(core.state().match?.outcome).toBeNull();
    clock.advance(400);
    const after = qd(core.state());
    // Player 2 takes the first round; the match goes on to the best of three.
    expect(after).toMatchObject({ phase: "round", took: 1, score: [0, 1] });
    expect(core.state().match?.outcome).toBeNull();
    if (after) expect(reactionMs(after, 1)).toBe(180);
    expect(lastTap(r)).toEqual({ type: "tap", seat: 1, accepted: true, meaning: "play" });
    expect(r.buzzes.at(-1)).toEqual([1, "ok"]);
    expect([core.plan(0), core.plan(1)]).toEqual(["none", "none"]);
    // The chip's answer arrives afterwards and changes nothing.
    const count = r.events.length;
    core.tap({ phase: "done", tap, seat: 1, at: drawAt + 180, badge: KITE, roll: null });
    expect(r.events.length).toBe(count);

    // The next round is counted in, and Player 2 takes it and the match.
    await until(r, (state) => qd(state)?.phase === "count");
    expect(qd(core.state())).toMatchObject({ round: 2, score: [0, 1] });
    expect([core.plan(0), core.plan(1)]).toEqual(["identify", "identify"]);
    await quickWin(r, 1);
    expect(core.state().match?.outcome).toEqual({ winner: 1 });
    // The pot lands in the next head; the result goes then, and its lines come from the chain once it is paid.
    await until(r, (state) => state.match?.settlement !== null);
    expect(r.chain.sent).toEqual(["open 1", "settle 1"]);
    expect((await r.chain.player(NOVA.address)).balance).toBe(90);
    expect((await r.chain.player(KITE.address)).balance).toBe(110);
    expect(core.state().seats.map((seat) => seat.balance)).toEqual([90, 110]);
    expect(core.state().match?.settlement?.lines[0]).toMatch(/\+20 USDC$/);

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
    expect(lastTap(r)).toEqual({ type: "tap", seat: 0, accepted: false, meaning: "let-go" });
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
    expect(lastTap(r)).toEqual({ type: "tap", seat: 1, accepted: false, meaning: "ignored" });
  });

  it("sends each station its view only when it changes", () => {
    const r = rig();
    const { core } = r;
    expect(r.shows).toEqual([
      [0, { tag: "", big: "", small: "", mode: "shut" }],
      [1, { tag: "", big: "", small: "", mode: "shut" }],
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
    expect(r.core.state().stations[0].big).toBe("NOVA.GAMEBOX.ETH");
    // Nothing is sent to the chain for a seat: no faucet, no top-up.
    expect(r.chain.sent).toEqual([]);
  });

  it("follows the chain's head for the block clock and the gas", () => {
    const r = rigOn(recordingPort);
    expect(r.core.state().chain.block).toBe(0);
    r.chain.head({ block: 12_080_000, at: START + 5, gasGwei: 1.5 });
    expect(r.core.state().chain).toMatchObject({ block: 12_080_000, blockAt: START + 5, gasGwei: 1.5 });
    expect(r.events.slice(-3)).toEqual([{ type: "block", block: 12_080_000 }, { type: "gas", gwei: 1.5 }]);
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
    expect(qd(core.state())).toMatchObject({ phase: "round", took: 0 });
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
    while (!core.state().match?.outcome) {
      await until(r, (state) => qd(state)?.phase === "draw");
      stationTap(core, 1, KITE);
      await until(r, (state) => qd(state)?.phase !== "draw");
    }
    await until(r, (state) => state.phase === "result");
    expect(r.logged).toHaveLength(1);
    const [t] = r.logged;
    expect(t).toMatchObject({ v: 1, game: "quick-draw", badges: [NOVA.address, KITE.address], stake: 10, result: { winner: 1 }, counts: true });
    const good = { seat: 1, at: expect.any(Number), roll: null, accepted: true };
    expect(t?.taps).toEqual([good, good]);
    expect(t?.endedAt).toBe(core.state().match?.endedAt);

    // The same match from injected taps is played, logged, and doesn't count.
    const injected = rig();
    await toPlaying(injected, "quick-draw");
    injected.clock.advance(15_000);
    await quickWin(injected, 0);
    expect(injected.logged[0]?.counts).toBe(false);
  });

  it("takes a seated badge's tap on the result as a rematch, but only after REMATCH_TAP_MS", async () => {
    const r = rig();
    const { core, clock } = r;
    await toPlaying(r, "quick-draw");
    await quickWin(r, 0);
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
    expect((await r.chain.player(NOVA.address)).balance).toBe(90);
  });
});

describe("what the screen hears", () => {
  const meanings = (r: Rig) => r.events.flatMap((event) => (event.type === "tap" ? [event.meaning] : []));
  const moments = (r: Rig) => r.events.flatMap((event) => (event.type === "cue" ? [[event.cue, event.seat]] : []));
  const touches = (r: Rig) => r.events.flatMap((event) => (event.type === "touch" ? [event.seat] : []));

  it("says what each tap did, from waking the Box to the stakes going in", async () => {
    const r = rig();
    const { core } = r;
    await seated(r);
    core.send({ type: "play" });
    await flush();
    instantTap(core, 0, NOVA, 1);
    instantTap(core, 0, NOVA, 1);
    instantTap(core, 1, KITE, 1);
    expect(meanings(r)).toEqual(["wake", "join", "join", "sign", "ignored", "open"]);
    await potConfirmed(r);
    expect(moments(r)).toContainEqual(["round", null]);
  });

  it("tells a badge tapping its own seat again from one taking it", async () => {
    const r = rig();
    await seated(r);
    instantTap(r.core, 1, KITE, 1);
    expect(meanings(r)).toEqual(["wake", "join", "join", "again"]);
  });

  it("hears a chip land while it is still being read, but not one judged at its touch", async () => {
    const r = rig();
    const { core } = r;
    core.send({ type: "booted" });
    instantTap(core, 0, NOVA, 1);
    expect(touches(r)).toEqual([]);
    const tap = touch(core, 1, null);
    expect(touches(r)).toEqual([1]);
    core.tap({ phase: "done", tap, seat: 1, at: core.now(), badge: KITE, roll: null });
    expect(meanings(r).at(-1)).toBe("join");
  });

  it("marks Quick Draw's draw, the winner's shot with its seat, and the match's end", async () => {
    const r = rig();
    await toPlaying(r, "quick-draw");
    await quickWin(r, 1);
    expect(moments(r)).toEqual(expect.arrayContaining([["draw", null], ["shot", 1], ["over", 1]]));
  });

  it("marks a foul with the seat that jumped, and counts the next round in", async () => {
    const r = rig();
    await toPlaying(r, "quick-draw");
    // A tap in the countdown is ignored; one on WAIT… is a foul.
    instantTap(r.core, 0, NOVA, 1);
    expect(meanings(r).at(-1)).toBe("ignored");
    await until(r, (state) => qd(state)?.phase === "wait");
    instantTap(r.core, 0, NOVA, 1);
    expect(qd(r.core.state())).toMatchObject({ phase: "round", took: 1, reason: "early" });
    expect(moments(r)).toContainEqual(["false-start", 0]);
    expect(moments(r).map(([cue]) => cue)).not.toContain("draw");
    await until(r, (state) => qd(state)?.phase === "count");
    expect(moments(r).filter(([cue]) => cue === "round")).toHaveLength(2);
  });

  it("marks each Stock Duel card going down with its seat", async () => {
    const r = rig();
    await toPlaying(r, "stock-duel");
    await until(r, (state) => state.match?.play.game === "stock-duel" && state.match.play.state.phase === "pick");
    instantTap(r.core, 1, KITE, 5);
    expect(meanings(r).at(-1)).toBe("play");
    expect(moments(r)).toContainEqual(["play", 1]);
  });
});

describe("stakes on chain", () => {
  it("shows each seat's stats, read from chain: none before a first result, then the new ones after a match", async () => {
    const r = rig();
    await toPlaying(r, "quick-draw");
    expect(r.core.state().seats.map((seat) => seat.record)).toEqual([null, null]);
    await quickWin(r, 1);
    await until(r, (state) => state.txs.some((tx) => tx.kind === "settle" && tx.step === "paid"));
    r.core.send({ type: "rematch" });
    await flush();
    expect(r.core.state().seats.map((seat) => seat.record)).toEqual([
      { played: 1, wins: 0, losses: 1, draws: 0, streak: 0, best: 0 },
      { played: 1, wins: 1, losses: 0, draws: 0, streak: 1, best: 1 },
    ]);
  });

  it("waits on Stake while the pot opens, begins the match once it is in a block, and the bar follows the pot", async () => {
    const r = rigOn(recordingPort);
    await seated(r);
    r.core.send({ type: "focus", game: "quick-draw" });
    r.core.send({ type: "play" });
    await flush();
    instantTap(r.core, 0, NOVA, 1);
    instantTap(r.core, 1, KITE, 1);
    const [open] = r.chain.sent;
    expect(open).toMatchObject({ kind: "open", order: { round: 41, game: "quick-draw", badges: [NOVA.address, KITE.address], amount: 10 } satisfies StakeOrder });
    const bar = () => r.core.state().txs.map((tx) => [tx.kind, tx.amount, tx.step]);
    expect(bar()).toEqual([["open", 20, "signed"]]);
    // Signed and sent: still on Stake, both seats signed, no match yet.
    open?.watch({ step: "sent", hash: HASH, etherscan: `https://sepolia.etherscan.io/tx/${HASH}`, block: null, error: null });
    expect(r.core.state()).toMatchObject({ phase: "stake", match: null });
    expect(r.core.state().seats.map((seat) => seat.signed)).toEqual([true, true]);
    // A tap or Back while it waits changes nothing.
    instantTap(r.core, 0, NOVA, 1);
    r.core.send({ type: "back" });
    expect(r.core.state().phase).toBe("stake");
    // In a block isn't confirmed: the match waits for the confirmation.
    open?.watch({ step: "in-block", hash: HASH, etherscan: null, block: 9, error: null });
    expect(r.core.state()).toMatchObject({ phase: "stake", match: null });
    open?.watch({ step: "paid", hash: HASH, etherscan: null, block: 9, error: null });
    expect(r.core.state().phase).toBe("playing");
    expect(r.core.state().match).toMatchObject({ round: 41, stake: 10 });
    expect(r.core.state().txs[0]).toMatchObject({ step: "paid", hash: HASH, block: 9, etherscan: `https://sepolia.etherscan.io/tx/${HASH}` });
    const steps = r.events.flatMap((event) => (event.type === "tx" ? [event.tx.step] : []));
    expect(steps).toEqual(["signed", "sent", "in-block", "paid"]);
  });

  it("sends both players back to sign when the pot fails to open, with nothing staked", async () => {
    const r = rigOn(recordingPort);
    await seated(r);
    r.core.send({ type: "focus", game: "quick-draw" });
    r.core.send({ type: "play" });
    await flush();
    instantTap(r.core, 0, NOVA, 1);
    instantTap(r.core, 1, KITE, 1);
    fail(r.chain.sent[0], "NotAPlayer");
    expect(r.core.state()).toMatchObject({ phase: "stake", match: null });
    expect(r.core.state().seats.map((seat) => seat.signed)).toEqual([false, false]);
    expect(r.core.state().txs.at(-1)).toMatchObject({ kind: "open", step: "failed", error: "NotAPlayer" });
    // Signing again opens a fresh round.
    instantTap(r.core, 0, NOVA, 1);
    instantTap(r.core, 1, KITE, 1);
    await potConfirmed(r);
    expect(r.core.state().match?.round).toBe(42);
  });

  it("sends the result when the match ends, with the same round, and shows what the chain says it did", async () => {
    const r = rigOn(recordingPort);
    await toPlaying(r, "quick-draw");
    await quickWin(r, 1);
    expect(r.chain.sent.map((sent) => sent.kind)).toEqual(["open", "settle"]);
    const settle = r.chain.sent[1];
    const order: ResultOrder = { round: 41, game: "quick-draw", badges: [NOVA.address, KITE.address], winner: 1 };
    expect(settle).toMatchObject({ kind: "settle", order });
    expect(r.core.state().txs.at(-1)).toMatchObject({ kind: "settle", amount: 20, seat: 1 });
    expect(r.core.state().seats[1].pending).toBe(20);
    expect(r.core.state().match?.settlement).toBeNull();
    pay(settle);
    await flush();
    expect(r.chain.outcomes).toEqual([[order, HASH]]);
    expect(r.core.state().match?.settlement?.lines).toEqual(["nova.gamebox.eth +20 USDC", "nova.gamebox.eth now holds champion.quickdraw.gamebox.eth"]);
    expect(r.core.state().seats[1].pending).toBe(0);
  });

  it("reads both players again at the result's block, and every board, the moment it is paid", async () => {
    const r = rigOn(recordingPort);
    await toPlaying(r, "quick-draw");
    await quickWin(r, 1);
    const boardsBefore = r.chain.boards.length;
    r.chain.reads.length = 0;
    // The RPC node is a block behind the relayer's: a read at the result's block fails until it catches up.
    r.chain.nodeAt = 11;
    r.chain.balances.set(KITE.address, 120);
    pay(r.chain.sent[1], 12);
    await flush();
    expect(r.chain.reads).toEqual([
      [NOVA.address, 12],
      [KITE.address, 12],
    ]);
    expect(r.chain.boards.length).toBeGreaterThan(boardsBefore);
    expect(r.core.state().seats[1].balance).toBe(100);
    r.chain.nodeAt = 12;
    r.clock.advance(REREAD_MS);
    await flush();
    expect(r.chain.reads.slice(2)).toEqual([
      [NOVA.address, 12],
      [KITE.address, 12],
    ]);
    expect(r.core.state().seats[1].balance).toBe(120);
  });

  it("takes a fresh round from the port for each match", async () => {
    const r = rigOn(recordingPort);
    await toPlaying(r, "quick-draw");
    await quickWin(r, 0);
    pay(r.chain.sent[1]);
    r.core.send({ type: "rematch" });
    await flush();
    instantTap(r.core, 0, NOVA, 1);
    instantTap(r.core, 1, KITE, 1);
    await potConfirmed(r);
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

  it("sends a badge with no player name to the lobby when the chain stakes only named badges", async () => {
    const r = rigOn(() => ({ ...recordingPort(), stakeNeedsName: true }));
    r.chain.names.set(NOVA.address, "nova.gamebox.eth");
    await seated(r);
    r.core.send({ type: "play" });
    await flush();
    instantTap(r.core, 0, NOVA, 1);
    expect(r.core.state().seats[0].signed).toBe(true);
    instantTap(r.core, 1, KITE, 1);
    expect(r.core.state()).toMatchObject({ phase: "lobby", lobby: { badge: KITE, from: "stake" } });
    expect(r.chain.sent).toEqual([]);
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
      expect(r.core.state().lobby.card).toEqual({ address: badge.address, name: null, balance: 100, record: null });
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

  it("claims a label typed on the screen instead of the one proposed", async () => {
    const r = rig();
    r.core.send({ type: "booted" });
    r.core.send({ type: "lobby" });
    instantTap(r.core, 0, NOVA, 1);
    await flush();
    r.core.send({ type: "claim", label: "alice" });
    await until(r, (state) => state.lobby.card?.name !== null);
    expect(r.chain.sent).toEqual(["claim alice"]);
    expect(r.core.state().lobby.card?.name).toBe("alice.gamebox.eth");
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
    expect(new Set(r.chain.boards)).toEqual(new Set(["quick-draw", "stock-duel"]));
    r.core.send({ type: "lobby" });
    await flush();
    expect(r.core.state().board?.title).toEqual({ name: "champion.stockduel.gamebox.eth", holder: "kite.gamebox.eth", streak: 2, expires: Number.MAX_SAFE_INTEGER });
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
  async function offline(): Promise<Rig & { readonly began: number }> {
    const r = rig();
    await toPlaying(r, "quick-draw");
    const began = r.core.now();
    r.core.setPower(false);
    await until(r, (state) => state.txs[0]?.step === "paid");
    while (!r.core.state().match?.outcome) {
      await until(r, (state) => qd(state)?.phase === "draw");
      instantTap(r.core, 0, NOVA, 1);
      await until(r, (state) => qd(state)?.phase !== "draw");
    }
    await until(r, (state) => state.phase === "refund");
    return { ...r, began };
  }

  it("opens once the pot's refund delay has run, sends one refund for both, then goes Home", async () => {
    const r = await offline();
    const match = r.core.state().match;
    expect(match?.refundAt).toBe(r.began + DEMO_REFUND_MS);
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
    expect([(await r.chain.player(NOVA.address)).balance, (await r.chain.player(KITE.address)).balance]).toEqual([100, 100]);
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
    expect(lastTap(r)).toEqual({ type: "tap", seat: 1, accepted: false, meaning: "ignored" });
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

describe("what a match is played for", () => {
  /** A recording port whose game has a championship open until `ends`. */
  const withCup = (ends: number) => (): Recording => {
    const port = recordingPort();
    const cup = { name: "cup-1.quickdraw.gamebox.eth", ends, prize: 50, standings: [] };
    return { ...port, board: (game) => port.board(game).then((board) => ({ ...board, cup })) };
  };

  async function toStake<C extends ChainPort>(r: Rig<C>): Promise<void> {
    await seated(r);
    r.core.send({ type: "focus", game: "quick-draw" });
    r.core.send({ type: "play" });
    await flush();
  }

  it("starts every game at 10 USDC, played for USDC, whatever the last match was played for", async () => {
    const r = rigOn(recordingPort);
    await toStake(r);
    expect(r.core.state()).toMatchObject({ phase: "stake", stake: 10, playFor: "usdc" });
    r.core.send({ type: "stake", amount: 25 });
    r.core.send({ type: "back" });
    r.core.send({ type: "play" });
    expect(r.core.state()).toMatchObject({ stake: 10, playFor: "usdc" });
    r.core.send({ type: "play-for", target: "title" });
    expect(r.core.state().playFor).toBe("title");
    r.core.send({ type: "stake", amount: 10 });
    expect(r.core.state()).toMatchObject({ stake: 10, playFor: "usdc" });
  });

  it("stakes the title's and the championship's own amounts, apart from the USDC choices", async () => {
    const r = rigOn(withCup(START + 600_000));
    r.chain.balances.set(KITE.address, 18);
    await toStake(r);
    r.core.send({ type: "play-for", target: "title" });
    expect(r.core.state().stations[0].big).toBe("SIGN");
    instantTap(r.core, 0, NOVA, 1);
    // 18 USDC covers the cup's 15 but not the title's 20: KITE is sent to top up.
    instantTap(r.core, 1, KITE, 1);
    expect(r.core.state()).toMatchObject({ phase: "lobby", lobby: { badge: KITE, from: "stake" } });
    r.core.send({ type: "back" });
    r.core.send({ type: "play-for", target: "cup" });
    instantTap(r.core, 0, NOVA, 1);
    instantTap(r.core, 1, KITE, 1);
    expect(r.chain.sent.map((sent) => [sent.kind, (sent.order as StakeOrder).amount])).toEqual([["open", 15]]);
  });

  it("offers the championship only while one is open, and falls back to the title once it closes", async () => {
    const closed = rigOn(recordingPort);
    await toStake(closed);
    closed.core.send({ type: "play-for", target: "cup" });
    expect(closed.core.state().playFor).toBe("usdc");

    const r = rigOn(withCup(START + 60_000));
    await toStake(r);
    r.core.send({ type: "play-for", target: "cup" });
    expect(r.core.state().playFor).toBe("cup");
    await until(r, (state) => state.playFor !== "cup", 120_000);
    expect(r.core.state().playFor).toBe("title");
  });

  it("reads the game's board on Stake and every few seconds after, and stops off it", async () => {
    const r = rigOn(recordingPort);
    await toStake(r);
    expect(r.core.state().board?.title?.holder).toBe("kite.gamebox.eth");
    // Every on-chain game is read together: what a tapped badge holds shows in any of them.
    const games = TEAM_GAMES.filter((g) => chainLabel(g.id) !== null).length;
    const reads = r.chain.boards.length;
    r.clock.advance(BOARD_MS);
    expect(r.chain.boards.length).toBe(reads + games);
    r.core.send({ type: "back" });
    r.clock.advance(BOARD_MS * 3);
    expect(r.chain.boards.length).toBe(reads + games);
  });
});

describe("naming whoever taps", () => {
  it("keeps each station's last tap with its ENS name, read from chain if the Box didn't know it", async () => {
    const r = rigOn(recordingPort);
    r.chain.names.set(NOVA.address, "nova.gamebox.eth");
    r.core.send({ type: "booted" });
    instantTap(r.core, 0, NOVA, 1);
    expect(r.core.state().taps[0]).toMatchObject({ badge: NOVA, read: false, ens: null });
    await flush();
    expect(r.core.state().taps[0]).toMatchObject({ badge: NOVA, read: true, ens: "nova.gamebox.eth" });
    expect(r.events).toContainEqual({ type: "name", address: NOVA.address });
    expect(r.core.state().taps[1]).toBeNull();
  });
});
