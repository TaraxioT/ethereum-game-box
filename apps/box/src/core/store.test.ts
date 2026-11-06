// A store game through the core, on fakes: the bundle fetched at Join and gone after the match, the pot opened with its
// hash, the log the Box writes (its taps and the game's claims, labelled), the three ways a match closes, and what the
// verifier says: a split on Result, a refund as a refund, and silence as Refund. Nothing here runs on a Box with no store.
import { describe, expect, it } from "vitest";
import { LOG_LIMITS, mulberry32, type LogEntry, type Seat, type Transcript } from "@egb/sdk";
import type { BundlePort, ChainPort, JudgeOrder, JudgeWatch, LibraryPort, StoreBundle, StoreChainPort, StoreStakeOrder, TxWatch } from "./ports.ts";
import type { Badge, BoxEvent, BoxState, GameInfo, Judged, StorePlay } from "./types.ts";
import { createCore, END_HOLD_MS, JOIN_SETTLE_MS, REFUND_DONE_MS, TOPUP_USDC, type Core } from "./core.ts";
import { REMATCH_TAP_MS } from "./plan.ts";
import { createFakeClock, type FakeClock } from "./fake-clock.ts";
import { createDemoChain, DEMO_REFUND_MS, type DemoChain } from "./demo-chain.ts";
import { TEAM_GAMES } from "./catalogue.ts";
import { DEMO_BADGES } from "./badges.ts";
import { instantTap } from "./instant-tap.ts";
import { stationViews } from "./stations.ts";

const START = Date.parse("2026-11-06T10:00:00Z");
const [NOVA, KITE, JUNO] = DEMO_BADGES as [Badge, Badge, Badge];
const ORION: Badge = { address: `0x${"d4".repeat(20)}`, name: "orion.gamebox.eth" };
const HASH = `0x${"ab".repeat(32)}` as const;
const FACTS: StoreBundle = { minutes: 2, taps: "identify" };
const TX = `0x${"cd".repeat(32)}` as const;

const STORE_GAME: GameInfo = { id: "tap-rush", kind: "store", title: "Tap Rush", players: 2, minutes: 0, stakes: [5, 10, 25], tier: "judged", ready: true, sealed: null, icon: "/games/icon.svg", manifest: null, bundle: HASH };

/** A game for two to four, on a Box with four stations. */
const FOUR_SEATS = { stations: 4, game: { ...STORE_GAME, players: 4, minPlayers: 2 } };

function fakeBundles() {
  const fetched: string[] = [];
  let drops = 0;
  const waiting: { resolve: (facts: StoreBundle) => void; reject: (why: Error) => void }[] = [];
  const port: BundlePort = {
    fetch(game, hash) {
      fetched.push(`${game} ${hash}`);
      return new Promise((resolve, reject) => waiting.push({ resolve, reject }));
    },
    drop: () => void drops++,
  };
  return { port, fetched, drops: () => drops, arrive: (facts = FACTS) => waiting.shift()?.resolve(facts), fail: (why: string) => waiting.shift()?.reject(new Error(why)) };
}

function fakeStoreChain() {
  const opens: { order: StoreStakeOrder; watch: TxWatch }[] = [];
  const refunds: { round: number; watch: TxWatch }[] = [];
  const topups: { address: string; watch: TxWatch }[] = [];
  const judges: { order: JudgeOrder; watch: JudgeWatch }[] = [];
  const balances = new Map<string, number>();
  const port: StoreChainPort = {
    balance: (address) => Promise.resolve(balances.get(address) ?? 100),
    open: (order, watch) => void opens.push({ order, watch }),
    refund: (round, watch) => void refunds.push({ round, watch }),
    topup: (address, watch) => void topups.push({ address, watch }),
    judge: (order, watch) => void judges.push({ order, watch }),
  };
  return { port, opens, refunds, topups, judges, balances };
}

const paid = (step: "paid" | "sent" | "failed" = "paid") => ({ step, hash: TX, etherscan: `https://sepolia.etherscan.io/tx/${TX}`, block: null, error: null });
const said = (step: Judged["step"], over: Partial<Judged> = {}): Judged => ({ step, payouts: null, hash: null, etherscan: null, reason: null, ...over });

interface Rig {
  readonly core: Core;
  readonly clock: FakeClock;
  readonly chain: DemoChain;
  readonly bundles: ReturnType<typeof fakeBundles>;
  readonly store: ReturnType<typeof fakeStoreChain>;
  readonly logged: Transcript[];
  readonly events: BoxEvent[];
  readonly buzzes: string[];
  /** Each time the stations were told which seats are in use. */
  readonly inUse: (readonly Seat[])[];
  /** Replaces the rack, as a store index that changed or vanished would. */
  rack(games: readonly GameInfo[]): void;
}

function rig(options: { bundles?: boolean; name?: boolean; stations?: number; game?: GameInfo } = {}): Rig {
  const clock = createFakeClock(START);
  const rnd = mulberry32(5);
  const chain = createDemoChain(clock);
  const store = fakeStoreChain();
  const bundles = fakeBundles();
  const logged: Transcript[] = [];
  const events: BoxEvent[] = [];
  const buzzes: string[] = [];
  const inUse: (readonly Seat[])[] = [];
  let games: readonly GameInfo[] = [...TEAM_GAMES, options.game ?? STORE_GAME];
  const listeners = new Set<() => void>();
  const library: LibraryPort = {
    games: () => games,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const port: ChainPort = { ...chain, store: store.port, stakeNeedsName: options.name ?? false };
  const core = createCore({
    clock,
    stations: { show: () => {}, buzz: (seat, kind) => void buzzes.push(`${seat} ${kind}`), inUse: (seats) => void inUse.push(seats) },
    chain: port,
    library,
    ...(options.bundles === false ? {} : { bundles: bundles.port }),
    log: { record: (t) => void logged.push(t), countedSince: () => 0 },
    random: () => Math.floor(rnd() * 2 ** 32) >>> 0,
  }, options.stations ? { stations: options.stations } : {});
  core.subscribe((_, event) => void events.push(event));
  return {
    core,
    clock,
    chain,
    bundles,
    store,
    logged,
    events,
    buzzes,
    inUse,
    rack(next) {
      games = next;
      for (const listener of listeners) listener();
    },
  };
}

/** Lets promises land, then moves the clock on. */
async function settle(r: Rig, ms = 0): Promise<void> {
  for (let i = 0; i < 6; i++) await Promise.resolve();
  if (ms > 0) r.clock.advance(ms);
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

async function tap(r: Rig, seat: Seat, badge: Badge, roll: number | null = null): Promise<void> {
  instantTap(r.core, seat, badge, roll ?? 0);
  await settle(r);
}

async function toJoin(r: Rig): Promise<void> {
  r.core.send({ type: "booted" });
  r.core.send({ type: "start" });
  r.core.send({ type: "focus", game: "tap-rush" });
  r.core.send({ type: "play" });
  await settle(r);
}

async function toStake(r: Rig): Promise<void> {
  await toJoin(r);
  await tap(r, 0, NOVA);
  await tap(r, 1, KITE);
  r.bundles.arrive();
  await settle(r, JOIN_SETTLE_MS);
}

async function toPlaying(r: Rig): Promise<void> {
  await toStake(r);
  await tap(r, 0, NOVA);
  await tap(r, 1, KITE);
  r.store.opens[0]?.watch(paid());
  await settle(r);
}

const play = (state: BoxState): StorePlay => {
  const found = state.match?.play;
  if (found?.game !== "store") throw new Error("no store match");
  return found;
};

describe("a store game", () => {
  it("plays whole: fetched at Join, staked by hash, logged, closed by its end, judged, and paid on Result", async () => {
    const r = rig();
    const { core } = r;
    await toJoin(r);
    // Fetched at Join, and Stake waits for it even with both seats full.
    expect(r.bundles.fetched).toEqual([`tap-rush ${HASH}`]);
    expect(core.state()).toMatchObject({ phase: "join", fetching: true });
    await tap(r, 0, NOVA);
    await tap(r, 1, KITE);
    await settle(r, JOIN_SETTLE_MS * 3);
    expect(core.state().phase).toBe("join");
    r.bundles.arrive();
    await settle(r, JOIN_SETTLE_MS);
    expect(core.state()).toMatchObject({ phase: "stake", fetching: false, stake: 10 });

    // Both sign: Store USDC goes in through StorePot, by the bundle's hash, and the match waits for it.
    await tap(r, 0, NOVA);
    await tap(r, 1, KITE);
    expect(core.state().phase).toBe("stake");
    expect(r.store.opens[0]?.order).toEqual({ round: 1, bundle: HASH, badges: [NOVA.address, KITE.address], amount: 10 });
    expect(r.chain.sent.filter((s) => s.startsWith("open"))).toEqual([]);
    expect(core.state().txs.map((t) => [t.kind, t.amount])).toEqual([["open", 20]]);
    r.store.opens[0]?.watch(paid());
    await settle(r);
    expect(core.state().phase).toBe("playing");
    expect(play(core.state())).toMatchObject({ id: "tap-rush", title: "Tap Rush", bundle: HASH, taps: "identify", endsAt: r.clock.now() + 120_000, judged: null });
    const startedAt = r.clock.now();

    // The Box's taps and the game's claims go in the log, labelled; the frame hears each tap.
    r.clock.advance(1_000);
    await tap(r, 0, NOVA);
    core.send({ type: "frame", word: { t: "event", name: "score", data: { seat: 0, points: 1 } } });
    r.clock.advance(1_000);
    await tap(r, 1, KITE);
    expect(r.events.filter((e) => e.type === "game-tap")).toEqual([
      { type: "game-tap", seat: 0, at: startedAt + 1_000, roll: null },
      { type: "game-tap", seat: 1, at: startedAt + 2_000, roll: null },
    ]);
    expect(r.buzzes.slice(-2)).toEqual(["0 ok", "1 ok"]);

    // The game ends the match, which is all it can do; the frame holds a moment, then the log goes to the verifier.
    r.clock.advance(500);
    core.send({ type: "frame", word: { t: "end", why: "game" } });
    expect(core.state().match).toMatchObject({ outcome: { winner: null }, endedAt: startedAt + 2_500 });
    await tap(r, 0, NOVA);
    r.clock.advance(END_HOLD_MS);
    await settle(r);
    expect(core.state().phase).toBe("judging");
    expect(r.bundles.drops()).toBe(1);
    expect(r.store.judges).toHaveLength(1);
    const { order, watch } = r.store.judges[0]!;
    expect(order).toMatchObject({ round: 1, bundle: HASH, game: "tap-rush", badges: [NOVA.address, KITE.address], amount: 10, startedAt });
    expect(order.entries).toEqual([
      { src: "box", t: "tap", seat: 0, at: startedAt + 1_000, roll: null },
      { src: "game", t: "event", at: startedAt + 1_000, name: "score", data: { seat: 0, points: 1 } },
      { src: "box", t: "tap", seat: 1, at: startedAt + 2_000, roll: null },
      { src: "box", t: "end", at: startedAt + 2_500, why: "game" },
    ] satisfies LogEntry[]);
    expect(stationViews(core.state(), r.clock.now()).map((v) => [v.big, v.mode])).toEqual([["JUDGING", "shut"], ["JUDGING", "shut"]]);
    expect(core.plan(0)).toBe("none");

    // The verdict stands: the verifier's transaction shows, and the seats wait for what they are owed.
    watch(said("judging"));
    expect(play(core.state()).judged?.step).toBe("judging");
    watch(said("paying", { payouts: [15, 5], hash: TX, etherscan: "e" }));
    expect(core.state().phase).toBe("judging");
    expect(core.state().txs.at(-1)).toMatchObject({ kind: "settle", step: "sent", amount: 20, hash: TX });
    expect(core.state().seats.map((s) => s.pending)).toEqual([15, 5]);
    r.store.balances.set(NOVA.address, 105).set(KITE.address, 95);
    watch(said("paid", { payouts: [15, 5], hash: TX, etherscan: "e" }));
    await settle(r);
    expect(core.state().phase).toBe("result");
    expect(play(core.state()).judged).toMatchObject({ step: "paid", payouts: [15, 5] });
    expect(core.state().seats.map((s) => [s.pending, s.balance])).toEqual([[0, 105], [0, 95]]);
    expect(core.state().txs.at(-1)).toMatchObject({ kind: "settle", step: "paid" });
    expect(stationViews(core.state(), r.clock.now()).map((v) => v.big)).toEqual(["+15 USDC", "+5 USDC"]);

    // Nothing was sent as a team game's result, and it never counts toward records.
    expect(r.chain.sent).toEqual([]);
    expect(r.logged).toHaveLength(1);
    expect(r.logged[0]).toMatchObject({ game: "tap-rush", stake: 10, result: "void", counts: false });
    expect(r.logged[0]?.taps.map((t) => [t.seat, t.accepted])).toEqual([[0, true], [1, true], [0, false]]);
  });

  it("runs out of time at the manifest's limit, with the taps asked for by its manifest", async () => {
    const r = rig();
    await toJoin(r);
    await tap(r, 0, NOVA);
    await tap(r, 1, KITE);
    r.bundles.arrive({ minutes: 0.5, taps: "random" });
    await settle(r, JOIN_SETTLE_MS);
    await tap(r, 0, NOVA);
    await tap(r, 1, KITE);
    r.store.opens[0]?.watch(paid());
    await settle(r);
    const startedAt = r.clock.now();
    expect(r.core.plan(0)).toBe("random");
    // A `random` tap goes to the log when the chip answers, with its roll, at its touch time.
    r.core.tap({ phase: "touch", tap: 900, seat: 1, at: startedAt + 40, badge: KITE }, "station");
    r.clock.advance(100);
    expect(r.events.some((e) => e.type === "game-tap")).toBe(false);
    r.core.tap({ phase: "done", tap: 900, seat: 1, at: startedAt + 40, badge: KITE, roll: 77 }, "station");
    r.clock.advance(29_899);
    expect(r.core.state().match?.outcome).toBeNull();
    r.clock.advance(1);
    expect(r.core.state().match?.outcome).toEqual({ winner: null });
    await settle(r, END_HOLD_MS);
    expect(r.core.state().phase).toBe("judging");
    expect(r.store.judges[0]?.order.entries).toEqual([
      { src: "box", t: "tap", seat: 1, at: startedAt + 40, roll: 77 },
      { src: "box", t: "end", at: startedAt + 30_000, why: "time" },
    ]);
  });

  it("closes at once when its frame dies, and still goes to the verifier", async () => {
    const r = rig();
    await toPlaying(r);
    const startedAt = r.clock.now();
    r.clock.advance(3_000);
    r.core.send({ type: "frame", word: { t: "end", why: "lost" } });
    await settle(r, END_HOLD_MS);
    expect(r.core.state().phase).toBe("judging");
    expect(r.store.judges[0]?.order.entries).toEqual([{ src: "box", t: "end", at: startedAt + 3_000, why: "lost" }]);
    // The time limit went with it: nothing closes the match twice.
    r.clock.advance(FACTS.minutes * 60_000);
    expect(r.store.judges).toHaveLength(1);
  });

  it("shows a verifier's refund as a refund", async () => {
    const r = rig();
    await toPlaying(r);
    r.core.send({ type: "frame", word: { t: "end", why: "game" } });
    await settle(r, END_HOLD_MS);
    const { watch } = r.store.judges[0]!;
    watch(said("paying", { hash: TX }));
    expect(r.core.state().txs.at(-1)).toMatchObject({ kind: "refund", step: "sent", amount: 20 });
    expect(r.core.state().seats.map((s) => s.pending)).toEqual([10, 10]);
    watch(said("refunded", { hash: TX, reason: "the agent couldn't judge" }));
    await settle(r);
    expect(r.core.state().phase).toBe("result");
    expect(play(r.core.state()).judged).toMatchObject({ step: "refunded", reason: "the agent couldn't judge" });
    expect(stationViews(r.core.state(), r.clock.now()).map((v) => [v.big, v.small])).toEqual([["REFUNDED", "+10 USDC"], ["REFUNDED", "+10 USDC"]]);
    expect(r.core.state().seats.map((s) => s.pending)).toEqual([0, 0]);
  });

  it("waits out the pot's delay on Refund when the verifier fails, and then sends it back through StorePot", async () => {
    const r = rig();
    await toPlaying(r);
    r.core.send({ type: "frame", word: { t: "end", why: "game" } });
    await settle(r, END_HOLD_MS);
    r.store.judges[0]?.watch(said("failed", { reason: "no answer from the verifier" }));
    await settle(r);
    expect(r.core.state().phase).toBe("refund");
    expect(r.events.filter((e) => e.type === "cue" && e.cue === "error")).toHaveLength(1);
    expect(r.core.state().txs.filter((t) => t.kind !== "open")).toEqual([]);

    await tap(r, 0, NOVA);
    expect(r.store.refunds).toEqual([]);
    r.clock.advance(DEMO_REFUND_MS);
    await tap(r, 0, NOVA);
    expect(r.store.refunds.map((x) => x.round)).toEqual([1]);
    expect(r.chain.sent).toEqual([]);
    r.store.refunds[0]?.watch(paid());
    await settle(r);
    expect(r.core.state().match?.refunded).toEqual([true, true]);
    await settle(r, REFUND_DONE_MS);
    expect(r.core.state().phase).toBe("home");
  });

  it("leaves the Box free to go Home while the judge works, and a late verdict changes nothing there", async () => {
    const r = rig();
    await toPlaying(r);
    r.core.send({ type: "frame", word: { t: "end", why: "game" } });
    await settle(r, END_HOLD_MS);
    r.core.send({ type: "home" });
    expect(r.core.state()).toMatchObject({ phase: "home", match: null });
    r.store.judges[0]?.watch(said("paying", { payouts: [20, 0], hash: TX }));
    r.store.judges[0]?.watch(said("paid", { payouts: [20, 0], hash: TX }));
    await settle(r);
    expect(r.core.state()).toMatchObject({ phase: "home", match: null });
    expect(r.core.state().seats.map((s) => s.pending)).toEqual([0, 0]);
  });

  it.each(["paid", "refunded"] as const)("holds the rematch tap from when Result opens, not from the game's end: %s", async (step) => {
    const r = rig();
    await toPlaying(r);
    r.core.send({ type: "frame", word: { t: "end", why: "game" } });
    await settle(r, END_HOLD_MS);
    // Judging takes far longer than the guard, and the players are waiting with their badges.
    r.clock.advance(REMATCH_TAP_MS * 10);
    r.store.judges[0]?.watch(said(step, { payouts: step === "paid" ? [15, 5] : null, hash: TX }));
    await settle(r);
    expect(r.core.state().phase).toBe("result");
    expect(r.core.plan(0)).toBe("none");
    await tap(r, 0, NOVA);
    expect(r.core.state().phase).toBe("result");
    r.clock.advance(REMATCH_TAP_MS - 1);
    await tap(r, 1, KITE);
    expect(r.core.state().phase).toBe("result");
    r.clock.advance(1);
    expect(r.core.plan(0)).toBe("identify");
    await tap(r, 0, NOVA);
    expect(r.core.state()).toMatchObject({ phase: "join", fetching: true });
  });

  it("goes to Refund with the power off, and sends no log", async () => {
    const r = rig();
    await toPlaying(r);
    r.core.setPower(false);
    r.core.send({ type: "frame", word: { t: "end", why: "game" } });
    await settle(r, END_HOLD_MS);
    expect(r.core.state().phase).toBe("refund");
    expect(r.store.judges).toEqual([]);
  });

  it("goes Home with nothing staked when the bundle fails, and can't be played sealed", async () => {
    const r = rig();
    await toJoin(r);
    await tap(r, 0, NOVA);
    await tap(r, 1, KITE);
    r.bundles.fail("the hash doesn't match");
    // The server has sealed it by now: the rack says so.
    r.rack([...TEAM_GAMES, { ...STORE_GAME, ready: false, sealed: "the hash doesn't match" }]);
    await settle(r);
    expect(r.core.state().phase).toBe("home");
    expect(r.events.filter((e) => e.type === "cue" && e.cue === "error")).toHaveLength(1);
    expect(r.store.opens).toEqual([]);
    expect(r.bundles.drops()).toBe(1);
    r.core.send({ type: "play" });
    expect(r.core.state().phase).toBe("home");
    expect(r.bundles.fetched).toHaveLength(1);
  });

  it("forgets a bundle when the players leave before staking, and hears nothing more of it", async () => {
    const r = rig();
    await toJoin(r);
    r.core.send({ type: "back" });
    expect(r.bundles.drops()).toBe(1);
    r.bundles.arrive();
    await settle(r);
    expect(r.core.state()).toMatchObject({ phase: "home", fetching: false });
    // Fetched and gone from Stake too.
    r.core.send({ type: "play" });
    await tap(r, 0, NOVA);
    await tap(r, 1, KITE);
    r.bundles.arrive();
    await settle(r, JOIN_SETTLE_MS);
    expect(r.core.state().phase).toBe("stake");
    r.core.send({ type: "back" });
    expect(r.bundles.drops()).toBe(2);
  });

  it("downloads again for a rematch, and goes Home if the game has gone", async () => {
    const r = rig();
    await toPlaying(r);
    r.core.send({ type: "frame", word: { t: "end", why: "game" } });
    await settle(r, END_HOLD_MS);
    r.store.judges[0]?.watch(said("paid", { payouts: [10, 10], hash: TX }));
    await settle(r);
    r.core.send({ type: "rematch" });
    expect(r.core.state()).toMatchObject({ phase: "join", fetching: true });
    expect(r.bundles.fetched).toHaveLength(2);
    r.bundles.arrive();
    await settle(r, JOIN_SETTLE_MS);
    expect(r.core.state().phase).toBe("stake");
    await tap(r, 0, NOVA);
    await tap(r, 1, KITE);
    expect(r.store.opens[1]?.order.round).toBe(2);
    r.store.opens[1]?.watch(paid());
    await settle(r);
    r.core.send({ type: "frame", word: { t: "end", why: "game" } });
    await settle(r, END_HOLD_MS);
    r.store.judges[1]?.watch(said("paid", { payouts: [10, 10], hash: TX }));
    await settle(r);
    // Gone from the rack and back again takes the focus away; the rematch brings it back.
    r.rack(TEAM_GAMES);
    r.rack([...TEAM_GAMES, STORE_GAME]);
    expect(r.core.state().phase).toBe("result");
    r.core.send({ type: "rematch" });
    expect(r.core.state()).toMatchObject({ phase: "join", focus: "tap-rush" });
    r.core.send({ type: "back" });
    r.core.send({ type: "play" });
    r.bundles.arrive();
    await settle(r, JOIN_SETTLE_MS);
    await tap(r, 0, NOVA);
    await tap(r, 1, KITE);
    r.store.opens[2]?.watch(paid());
    await settle(r);
    r.core.send({ type: "frame", word: { t: "end", why: "game" } });
    await settle(r, END_HOLD_MS);
    r.store.judges[2]?.watch(said("paid", { payouts: [10, 10], hash: TX }));
    await settle(r);
    r.rack(TEAM_GAMES);
    r.core.send({ type: "rematch" });
    expect(r.core.state().phase).toBe("home");
    expect(r.bundles.fetched).toHaveLength(4);
  });

  it("goes back to sign when the pot's open fails, with the bundle kept", async () => {
    const r = rig();
    await toStake(r);
    await tap(r, 0, NOVA);
    await tap(r, 1, KITE);
    r.store.opens[0]?.watch({ ...paid("failed"), error: "BundleNotListed" });
    await settle(r);
    expect(r.core.state()).toMatchObject({ phase: "stake", match: null });
    expect(r.core.state().seats.map((s) => s.signed)).toEqual([false, false]);
    expect(r.bundles.drops()).toBe(0);
  });

  it("reads Store USDC, and sends a seat short of the stake to top it up", async () => {
    const r = rig();
    r.store.balances.set(NOVA.address, 3);
    await toStake(r);
    expect(r.core.state().seats.map((s) => s.balance)).toEqual([3, 100]);
    await tap(r, 0, NOVA);
    expect(r.core.state()).toMatchObject({ phase: "lobby", lobby: { from: "stake", badge: NOVA, card: { balance: 3 } } });
    r.core.send({ type: "topup" });
    expect(r.store.topups.map((t) => t.address)).toEqual([NOVA.address]);
    expect(r.chain.sent).toEqual([]);
    r.store.balances.set(NOVA.address, 3 + TOPUP_USDC);
    r.store.topups[0]?.watch(paid());
    await settle(r);
    expect(r.core.state().lobby.card?.balance).toBe(103);
    r.core.send({ type: "back" });
    await settle(r);
    expect(r.core.state().phase).toBe("stake");
    await tap(r, 0, NOVA);
    expect(r.core.state().seats[0].signed).toBe(true);
  });

  it("still asks for a player name where the port stakes only named badges", async () => {
    const r = rig({ name: true });
    await toStake(r);
    await tap(r, 0, NOVA);
    expect(r.core.state()).toMatchObject({ phase: "lobby", lobby: { from: "stake", badge: NOVA } });
  });

  it("offers no title or championship", async () => {
    const r = rig();
    await toStake(r);
    r.core.send({ type: "play-for", target: "title" });
    expect(r.core.state().playFor).toBe("usdc");
    r.core.send({ type: "stake", amount: 25 });
    expect(r.core.state().stake).toBe(25);
    await tap(r, 0, NOVA);
    await tap(r, 1, KITE);
    expect(r.store.opens[0]?.order.amount).toBe(25);
  });

  it("shows the game's station lines and buzzes under the Box's own tag, and drops words for seats it hasn't", async () => {
    const r = rig();
    await toPlaying(r);
    const views = () => stationViews(r.core.state(), r.clock.now());
    expect(views().map((v) => [v.tag, v.big, v.small, v.mode])).toEqual([["P1", "PLAY", "Tap Rush", "play"], ["P2", "PLAY", "Tap Rush", "play"]]);
    r.core.send({ type: "frame", word: { t: "station", seat: 1, text: "3 taps" } });
    expect(views()[1]?.big).toBe("3 TAPS");
    expect(r.events.at(-1)).toEqual({ type: "stations" });
    r.core.send({ type: "frame", word: { t: "buzz", seat: 0 } });
    expect(r.buzzes.at(-1)).toBe("0 ok");
    const before = r.buzzes.length;
    r.core.send({ type: "frame", word: { t: "buzz", seat: 3 } });
    r.core.send({ type: "frame", word: { t: "station", seat: 2, text: "nope" } });
    expect(r.buzzes).toHaveLength(before);
  });

  it("takes a frame's words only while the match plays", async () => {
    const r = rig();
    await toStake(r);
    r.core.send({ type: "frame", word: { t: "event", name: "early", data: 1 } });
    r.core.send({ type: "frame", word: { t: "end", why: "game" } });
    expect(r.core.state().phase).toBe("stake");
    await tap(r, 0, NOVA);
    await tap(r, 1, KITE);
    r.store.opens[0]?.watch(paid());
    await settle(r);
    r.core.send({ type: "frame", word: { t: "end", why: "game" } });
    r.core.send({ type: "frame", word: { t: "event", name: "late", data: 1 } });
    r.core.send({ type: "frame", word: { t: "end", why: "lost" } });
    await settle(r, END_HOLD_MS);
    expect(r.store.judges[0]?.order.entries.map((e) => e.t)).toEqual(["end"]);
    expect(r.store.judges[0]?.order.entries[0]).toMatchObject({ why: "game" });
  });

  it("closes the match when taps fill the log, so the judge misses none", async () => {
    const r = rig();
    await toPlaying(r);
    for (let i = 0; i < LOG_LIMITS.entries - 1; i++) r.core.tap({ phase: "touch", tap: 1_000 + i, seat: 0, at: r.clock.now(), badge: NOVA }, "station");
    expect(r.core.state().match?.outcome).toEqual({ winner: null });
    await settle(r, END_HOLD_MS);
    const entries = r.store.judges[0]?.order.entries ?? [];
    expect(entries).toHaveLength(LOG_LIMITS.entries);
    expect(entries.at(-1)).toMatchObject({ t: "end", why: "time" });
  });

  it("keeps the log within its limit when the page times an event just before the tap that fills it", async () => {
    const r = rig();
    await toPlaying(r);
    const half = LOG_LIMITS.entries / 2;
    const event = (n: number) => r.core.send({ type: "frame", word: { t: "event", name: "score", data: n } });
    const stationTap = (n: number) => r.core.tap({ phase: "touch", tap: 1_000 + n, seat: 0, at: r.clock.now(), badge: NOVA }, "station");
    for (let i = 0; i < half - 1; i++) {
      stationTap(i);
      event(i);
    }
    event(half);
    stationTap(half);
    expect(r.core.state().match?.outcome).toEqual({ winner: null });
    await settle(r, END_HOLD_MS);
    const entries = r.store.judges[0]?.order.entries ?? [];
    expect(entries).toHaveLength(LOG_LIMITS.entries);
    expect(entries.at(-1)).toMatchObject({ t: "end", why: "time" });
  });

  it("leaves the rack with the index: back Home before anyone stakes, on to the end once they have", async () => {
    const before = rig();
    await toJoin(before);
    before.rack(TEAM_GAMES);
    await settle(before);
    expect(before.core.state().phase).toBe("home");
    expect(before.bundles.drops()).toBe(1);

    const staking = rig();
    await toStake(staking);
    await tap(staking, 0, NOVA);
    staking.rack(TEAM_GAMES);
    expect(staking.core.state().phase).toBe("home");

    const opening = rig();
    await toStake(opening);
    await tap(opening, 0, NOVA);
    await tap(opening, 1, KITE);
    opening.rack(TEAM_GAMES);
    expect(opening.core.state()).toMatchObject({ phase: "stake", focus: "tap-rush" });
    opening.store.opens[0]?.watch(paid());
    await settle(opening);
    expect(opening.core.state().phase).toBe("playing");

    const playing = rig();
    await toPlaying(playing);
    playing.rack(TEAM_GAMES);
    await tap(playing, 0, NOVA);
    playing.core.send({ type: "frame", word: { t: "end", why: "game" } });
    await settle(playing, END_HOLD_MS);
    expect(playing.store.judges[0]?.order.entries.map((e) => e.t)).toEqual(["tap", "end"]);
    // The money is still Store USDC, with the game gone from the rack.
    playing.store.balances.set(NOVA.address, 120);
    playing.store.judges[0]?.watch(said("paid", { payouts: [20, 0], hash: TX }));
    await settle(playing);
    expect(playing.core.state().phase).toBe("result");
    expect(playing.core.state().seats[0].balance).toBe(120);
    // Home is the first place it must let go of the focus.
    playing.core.send({ type: "home" });
    expect(TEAM_GAMES.map((g) => g.id)).toContain(playing.core.state().focus);
  });

  it("goes Home after a failed open if the game left the rack while it was in flight", async () => {
    const r = rig();
    await toStake(r);
    await tap(r, 0, NOVA);
    await tap(r, 1, KITE);
    r.rack(TEAM_GAMES);
    expect(r.core.state().phase).toBe("stake");
    r.store.opens[0]?.watch({ ...paid("failed"), error: "the relayer can't be reached" });
    await settle(r);
    expect(r.core.state()).toMatchObject({ phase: "home", match: null });
    expect(r.core.state().seats.map((s) => s.signed)).toEqual([false, false]);
    expect(r.bundles.drops()).toBe(1);
    expect(TEAM_GAMES.map((g) => g.id)).toContain(r.core.state().focus);
  });

  it("plays the staked store game when a built game takes its id while the stakes go in", async () => {
    const r = rig();
    await toStake(r);
    await tap(r, 0, NOVA);
    await tap(r, 1, KITE);
    r.rack([...TEAM_GAMES, { ...STORE_GAME, kind: "built", tier: "refereed", icon: "/games/tap-rush/icon.svg" }]);
    r.store.opens[0]?.watch(paid());
    await settle(r);
    expect(r.core.state().phase).toBe("playing");
    expect(play(r.core.state())).toMatchObject({ id: "tap-rush", bundle: HASH });
    r.core.send({ type: "frame", word: { t: "end", why: "game" } });
    await settle(r, END_HOLD_MS);
    expect(r.core.state().phase).toBe("judging");
    expect(r.store.judges[0]?.order).toMatchObject({ round: 1, bundle: HASH, amount: 10 });
  });

  it("can't play on a Box with no bundle port", async () => {
    const r = rig({ bundles: false });
    await toJoin(r);
    expect(r.core.state().phase).toBe("home");
  });
});

describe("a store game for more than two", () => {
  /** Seats these players, in order, each at their seat, with the bundle here. */
  async function seat(r: Rig, players: readonly (readonly [Seat, Badge])[]): Promise<void> {
    await toJoin(r);
    r.bundles.arrive();
    await settle(r);
    for (const [at, badge] of players) await tap(r, at, badge);
  }

  async function sign(r: Rig, players: readonly (readonly [Seat, Badge])[]): Promise<void> {
    for (const [at, badge] of players) await tap(r, at, badge);
    r.store.opens[0]?.watch(paid());
    await settle(r);
  }

  const ALL: readonly (readonly [Seat, Badge])[] = [[0, NOVA], [1, KITE], [2, JUNO], [3, ORION]];
  const THREE = ALL.slice(0, 3);
  /** Player 2's seat left empty. */
  const GAP: readonly (readonly [Seat, Badge])[] = [[0, NOVA], [2, KITE], [3, JUNO]];

  it("opens the game's seats at Play, and gives them back at Home", async () => {
    const r = rig(FOUR_SEATS);
    r.core.send({ type: "booted" });
    r.core.send({ type: "start" });
    r.core.send({ type: "focus", game: "tap-rush" });
    // Home stands on two seats, whatever is focused, and the others' stations say so.
    expect(r.core.state().seats).toHaveLength(2);
    expect(r.core.plan(2)).toBe("none");
    expect(r.core.state().stations[2]).toMatchObject({ tag: "P3", big: "NEXT", small: "this game seats 2", mode: "shut" });
    r.core.send({ type: "play" });
    await settle(r);
    expect(r.core.state()).toMatchObject({ phase: "join", fewest: 2 });
    expect(r.core.state().seats).toHaveLength(4);
    expect(r.core.plan(3)).toBe("identify");
    await tap(r, 3, ORION);
    expect(r.core.state().seats[3]?.badge).toEqual(ORION);
    r.core.send({ type: "back" });
    expect(r.core.state().phase).toBe("home");
    expect(r.core.state().seats).toHaveLength(2);
    // Nobody is left in a seat that has gone: the next game starts with it empty.
    r.core.send({ type: "play" });
    await settle(r);
    expect(r.core.state().seats[3]?.badge).toBeNull();
  });

  it("moves on by itself with every seat full, stakes them all, logs each by place and splits four ways", async () => {
    const r = rig(FOUR_SEATS);
    await seat(r, ALL);
    await settle(r, JOIN_SETTLE_MS);
    expect(r.core.state().phase).toBe("stake");
    for (const [at, badge] of ALL.slice(0, 3)) await tap(r, at, badge);
    expect(r.store.opens).toHaveLength(0);
    expect(r.core.state().stations[0]).toMatchObject({ big: "SIGNED", small: "waiting" });
    await tap(r, 3, ORION);
    expect(r.store.opens[0]?.order).toMatchObject({ bundle: HASH, badges: ALL.map(([, b]) => b.address), amount: 10 });
    expect(r.core.state().txs.at(-1)).toMatchObject({ kind: "open", amount: 40 });
    r.store.opens[0]?.watch(paid());
    await settle(r);
    expect(r.core.state().phase).toBe("playing");
    expect(play(r.core.state()).lines).toEqual(["PLAY", "PLAY", "PLAY", "PLAY"]);
    expect(r.core.state().match?.refunded).toEqual([false, false, false, false]);

    await tap(r, 3, ORION);
    await tap(r, 2, JUNO);
    expect(r.events.filter((e) => e.type === "game-tap").map((e) => e.seat)).toEqual([3, 2]);
    r.core.send({ type: "frame", word: { t: "station", seat: 3, text: "FOUR" } });
    r.core.send({ type: "frame", word: { t: "buzz", seat: 2 } });
    expect(r.core.state().stations[3]?.big).toBe("FOUR");
    expect(r.buzzes.at(-1)).toBe("2 ok");
    // Only a seat the match has.
    r.core.send({ type: "frame", word: { t: "buzz", seat: 4 } });
    expect(r.buzzes.at(-1)).toBe("2 ok");

    r.core.send({ type: "frame", word: { t: "end", why: "game" } });
    await settle(r, END_HOLD_MS);
    const { order, watch } = r.store.judges[0] as (typeof r.store.judges)[number];
    expect(order.badges).toEqual(ALL.map(([, b]) => b.address));
    expect(order.entries.flatMap((e) => (e.t === "tap" ? [e.seat] : []))).toEqual([3, 2]);
    expect(r.logged.at(-1)).toMatchObject({ badges: ALL.map(([, b]) => b.address), result: "void", counts: false });

    watch(said("paying", { payouts: [25, 5, 5, 5], hash: TX }));
    expect(r.core.state().seats.map((s) => s.pending)).toEqual([25, 5, 5, 5]);
    watch(said("paid", { payouts: [25, 5, 5, 5], hash: TX }));
    await settle(r);
    expect(r.core.state().phase).toBe("result");
    expect(r.core.state().stations.map((v) => v.big)).toEqual(["+25 USDC", "+5 USDC", "+5 USDC", "+5 USDC"]);
  });

  it("waits for START with seats to spare, and takes it only with enough seated and the bundle here", async () => {
    const r = rig(FOUR_SEATS);
    await toJoin(r);
    await tap(r, 0, NOVA);
    r.core.send({ type: "begin" });
    expect(r.core.state().phase).toBe("join");
    await tap(r, 2, KITE);
    // Two have joined, but the bundle isn't here.
    r.core.send({ type: "begin" });
    expect(r.core.state().phase).toBe("join");
    r.bundles.arrive();
    await settle(r, JOIN_SETTLE_MS * 3);
    expect(r.core.state().phase).toBe("join");
    r.core.send({ type: "begin" });
    expect(r.core.state().phase).toBe("stake");
    // From here the players are fixed: a new badge can't join.
    await tap(r, 1, JUNO);
    expect(r.core.state().seats[1]?.badge).toBeNull();
  });

  it("tells the stations which seats need one: those on show, the players from Stake on, and two again at Home", async () => {
    const r = rig(FOUR_SEATS);
    await seat(r, [[0, NOVA], [2, KITE]]);
    expect(r.inUse.at(-1)).toEqual([0, 1, 2, 3]);
    r.core.send({ type: "begin" });
    expect(r.inUse.at(-1)).toEqual([0, 2]);
    r.core.reset();
    expect(r.inUse.at(-1)).toEqual([0, 1]);
    // Only when they change.
    expect(r.inUse.map((seats) => seats.join())).toEqual(["0,1", "0,1,2,3", "0,2", "0,1"]);
  });

  it("won't START a team game, whose every seat must fill", async () => {
    const r = rig(FOUR_SEATS);
    r.core.send({ type: "booted" });
    r.core.send({ type: "start" });
    r.core.send({ type: "play" });
    await tap(r, 0, NOVA);
    r.core.send({ type: "begin" });
    expect(r.core.state()).toMatchObject({ phase: "join", fewest: 2 });
    expect(r.core.state().seats).toHaveLength(2);
  });

  it("closes up a seat left empty: the pot, the log, the page and the split count players", async () => {
    const r = rig(FOUR_SEATS);
    await seat(r, GAP);
    r.core.send({ type: "begin" });
    await settle(r);
    await sign(r, GAP);
    expect(r.store.opens[0]?.order.badges).toEqual(GAP.map(([, b]) => b.address));
    expect(r.core.state().stations[1]).toMatchObject({ big: "NEXT", small: "next match", mode: "shut" });
    expect(r.core.plan(1)).toBe("none");

    await tap(r, 3, JUNO);
    expect(r.events.findLast((e) => e.type === "game-tap")).toMatchObject({ seat: 2 });
    // The page's second player sits at the Box's third seat.
    r.core.send({ type: "frame", word: { t: "station", seat: 1, text: "HERE" } });
    r.core.send({ type: "frame", word: { t: "buzz", seat: 1 } });
    expect(r.core.state().stations[2]?.big).toBe("HERE");
    expect(r.core.state().stations[1]?.big).toBe("NEXT");
    expect(r.buzzes.at(-1)).toBe("2 ok");
    r.core.send({ type: "frame", word: { t: "buzz", seat: 3 } });
    expect(r.buzzes.at(-1)).toBe("2 ok");

    r.core.send({ type: "frame", word: { t: "end", why: "game" } });
    await settle(r, END_HOLD_MS);
    expect(r.store.judges[0]?.order.entries.filter((e) => e.t === "tap")).toMatchObject([{ seat: 2 }]);
    r.store.judges[0]?.watch(said("paid", { payouts: [0, 30, 0], hash: TX }));
    await settle(r);
    expect(r.core.state().stations.map((v) => v.big)).toEqual(["+0 USDC", "NEXT", "+30 USDC", "+0 USDC"]);
  });

  it("refunds everyone from Refund: one tap, the whole pot", async () => {
    const r = rig(FOUR_SEATS);
    await seat(r, THREE);
    r.core.send({ type: "begin" });
    await settle(r);
    await sign(r, THREE);
    r.core.send({ type: "frame", word: { t: "end", why: "game" } });
    await settle(r, END_HOLD_MS);
    r.store.judges[0]?.watch(said("failed", { reason: "the verifier is gone" }));
    await settle(r);
    expect(r.core.state().phase).toBe("refund");
    r.clock.advance(DEMO_REFUND_MS);
    expect(r.core.plan(2)).toBe("identify");
    await tap(r, 2, JUNO);
    expect(r.store.refunds).toHaveLength(1);
    expect(r.core.state().txs.at(-1)).toMatchObject({ kind: "refund", amount: 30 });
    expect(r.core.state().seats.map((s) => s.pending)).toEqual([10, 10, 10, 0]);
    r.store.refunds[0]?.watch(paid());
    await settle(r);
    expect(r.core.state().match?.refunded).toEqual([true, true, true]);
    expect(r.core.state().stations.map((v) => v.big)).toEqual(["REFUNDED", "REFUNDED", "REFUNDED", "NEXT"]);
    expect(r.core.plan(0)).toBe("none");
  });

  it("keeps the table through the lobby, and a rematch back at Join", async () => {
    const r = rig(FOUR_SEATS);
    r.store.balances.set(JUNO.address, 0);
    await seat(r, THREE);
    r.core.send({ type: "begin" });
    await settle(r);
    await tap(r, 2, JUNO);
    expect(r.core.state().phase).toBe("lobby");
    expect(r.core.state().seats).toHaveLength(4);
    r.store.balances.set(JUNO.address, 100);
    r.core.send({ type: "back" });
    await settle(r);
    expect(r.core.state().phase).toBe("stake");
    await sign(r, THREE);
    r.core.send({ type: "frame", word: { t: "end", why: "game" } });
    await settle(r, END_HOLD_MS);
    r.store.judges[0]?.watch(said("paid", { payouts: [10, 10, 10], hash: TX }));
    await settle(r);
    r.core.send({ type: "rematch" });
    await settle(r);
    expect(r.core.state()).toMatchObject({ phase: "join", fewest: 2 });
    expect(r.core.state().seats.map((s) => s.badge)).toEqual([NOVA, KITE, JUNO, null]);
    r.bundles.arrive();
    await settle(r, JOIN_SETTLE_MS * 2);
    expect(r.core.state().phase).toBe("join");
    r.core.send({ type: "begin" });
    expect(r.core.state().phase).toBe("stake");
  });

  it("sends a seated player who moves station to the new seat", async () => {
    const r = rig(FOUR_SEATS);
    await seat(r, [[0, NOVA], [1, KITE]]);
    await tap(r, 3, NOVA);
    expect(r.core.state().seats.map((s) => s.badge)).toEqual([null, KITE, null, NOVA]);
  });

  it("offers a game for three seats no more than three", async () => {
    const r = rig({ stations: 3, game: { ...STORE_GAME, players: 3 } });
    await toJoin(r);
    r.bundles.arrive();
    await settle(r);
    expect(r.core.state()).toMatchObject({ fewest: 3 });
    expect(r.core.state().seats).toHaveLength(3);
    for (const [at, badge] of THREE) await tap(r, at, badge);
    await settle(r, JOIN_SETTLE_MS);
    expect(r.core.state().phase).toBe("stake");
  });
});
