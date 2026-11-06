// A built game through the core, on a fake rules runner: its child starts at Join, the match opens on the rules'
// first state, taps reach the rules at their touch time (with the roll when the game's taps are `random`), the
// stations show the rules' own views, and any failure voids the match. A built game isn't on chain: it plays for
// nothing, and the Box sends no stake and no result for it.
import { describe, expect, it } from "vitest";
import { mulberry32, stationView, type BuiltEvent, type GameManifest, type Transcript } from "@egb/sdk";
import type { LibraryPort, RulesRunnerPort, RulesSnapshot } from "./ports.ts";
import type { Badge, BoxState, GameInfo } from "./types.ts";
import { createCore, END_HOLD_MS, type Core } from "./core.ts";
import { createFakeClock, type FakeClock } from "./fake-clock.ts";
import { createDemoChain, type DemoChain } from "./demo-chain.ts";
import { TEAM_GAMES } from "./catalogue.ts";
import { DEMO_BADGES } from "./badges.ts";
import { instantTap } from "./instant-tap.ts";

const START = Date.parse("2026-11-06T10:00:00Z");
const [NOVA, KITE] = DEMO_BADGES as [Badge, Badge];

function manifest(taps: GameManifest["taps"]): GameManifest {
  return { id: "tap-three", title: "Tap Three", blurb: "Three taps wins.", players: 2, minutes: 1, stakes: [1, 5], tier: "refereed", taps, kind: "built", budgetMs: 50 };
}

const info = (m: GameManifest): GameInfo => ({ id: m.id, kind: "built", title: m.title, players: 2, minutes: 1, stakes: m.stakes, tier: "refereed", ready: true, sealed: null, icon: "/games/tap-three/icon.svg?v=1", manifest: m });

interface Three {
  readonly taps: [number, number];
  readonly rolls: (number | null)[];
  readonly at: number[];
}

/** Tap Three in-process, answering a tick later as a child would; `fail` makes the next call reject. */
function fakeRunner() {
  let state: Three = { taps: [0, 0], rolls: [], at: [] };
  const calls: string[] = [];
  const events: BuiltEvent[] = [];
  let failNext: string | null = null;
  const snap = (): RulesSnapshot => {
    const winner = state.taps[0] >= 3 ? 0 : state.taps[1] >= 3 ? 1 : null;
    return { state, outcome: winner === null ? null : { winner }, stations: [stationView("P1", String(state.taps[0]), "tap"), stationView("P2", String(state.taps[1]), "tap")] };
  };
  const answer = (): Promise<RulesSnapshot> => {
    const failing = failNext;
    failNext = null;
    return failing ? Promise.reject(new Error(failing)) : Promise.resolve(snap());
  };
  const runner: RulesRunnerPort = {
    prepare: (game) => void calls.push(`prepare ${game}`),
    start(game, _seed, now) {
      calls.push(`start ${game} ${now}`);
      state = { taps: [0, 0], rolls: [], at: [] };
      return answer();
    },
    step(event) {
      events.push(event);
      if (event.type === "tap") {
        const taps: [number, number] = [state.taps[0], state.taps[1]];
        taps[event.seat]++;
        state = { taps, rolls: [...state.rolls, event.roll], at: [...state.at, event.now] };
      }
      return answer();
    },
    stop: () => void calls.push("stop"),
  };
  return { runner, calls, events, fail: (why: string) => void (failNext = why) };
}

interface Rig {
  readonly core: Core;
  readonly clock: FakeClock;
  readonly chain: DemoChain;
  readonly logged: Transcript[];
  readonly fake: ReturnType<typeof fakeRunner>;
}

function rig(taps: GameManifest["taps"] = "identify"): Rig {
  const clock = createFakeClock(START);
  const rnd = mulberry32(3);
  const chain = createDemoChain(clock);
  const logged: Transcript[] = [];
  const fake = fakeRunner();
  const games = [...TEAM_GAMES, info(manifest(taps))];
  const library: LibraryPort = { games: () => games, subscribe: () => () => {} };
  const core = createCore(
    {
      clock,
      stations: { show: () => {}, buzz: () => {}, inUse: () => {} },
      chain,
      library,
      rules: fake.runner,
      log: { record: (t) => void logged.push(t), countedSince: () => 0 },
      random: () => Math.floor(rnd() * 2 ** 32) >>> 0,
    },
    { builder: true },
  );
  return { core, clock, chain, logged, fake };
}

/** Moves the clock in ticks, letting the runner's answers (microtasks) land between them. */
async function until(r: Rig, check: (state: BoxState) => boolean, limit = 60_000): Promise<void> {
  for (let waited = 0; !check(r.core.state()); waited += 50) {
    if (waited > limit) throw new Error(`still ${r.core.state().phase} after ${limit} ms`);
    r.clock.advance(50);
    await Promise.resolve();
    await Promise.resolve();
  }
}

async function toPlaying(r: Rig): Promise<void> {
  const { core } = r;
  core.send({ type: "booted" });
  instantTap(core, 0, NOVA, 1);
  instantTap(core, 0, NOVA, 1);
  instantTap(core, 1, KITE, 1);
  core.send({ type: "focus", game: "tap-three" });
  core.send({ type: "play" });
  expect(r.fake.calls).toEqual(["prepare tap-three"]);
  instantTap(core, 0, NOVA, 1);
  instantTap(core, 1, KITE, 1);
  await until(r, (state) => state.phase === "playing");
}

/** A known badge's whole tap at a station: touch, then done with the roll. */
function stationTap(core: Core, seat: 0 | 1, badge: Badge, roll: number | null, at = core.now()): void {
  const tap = core.nextTap();
  core.tap({ phase: "touch", tap, seat, at, badge }, "station");
  core.tap({ phase: "done", tap, seat, at, badge, roll }, "station");
}

const flush = async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
};

describe("a built game in the core", () => {
  it("starts its child at Join, opens on the rules' first state, plays taps at their touch time and settles", async () => {
    const r = rig("identify");
    await toPlaying(r);
    const { core } = r;
    expect(r.fake.calls[1]).toMatch(/^start tap-three \d+$/);
    expect(core.state().match).toMatchObject({ game: "tap-three", play: { game: "built", id: "tap-three" }, voided: false });
    expect(core.state().stations.map((v) => v.big)).toEqual(["0", "0"]);
    expect(core.plan(0)).toBe("identify");
    // Ticks reach the rules while it plays.
    await until(r, () => r.fake.events.some((e) => e.type === "tick"));

    // A known badge with an identify game is judged at its touch: the rules hear it then, at the touch time.
    const touched = core.now() - 120;
    stationTap(core, 0, NOVA, null, touched);
    await flush();
    expect(r.fake.events.filter((e) => e.type === "tap")).toEqual([{ type: "tap", seat: 0, now: touched, roll: null }]);
    expect(core.state().stations[0].big).toBe("1");
    for (let i = 0; i < 2; i++) stationTap(core, 0, NOVA, null);
    await flush();
    expect(core.state().match?.outcome).toEqual({ winner: 0 });
    await until(r, (state) => state.phase === "result", END_HOLD_MS + 1_000);
    expect(r.logged.at(-1)).toMatchObject({ game: "tap-three", result: { winner: 0 } });
    expect(r.logged.at(-1)?.taps).toHaveLength(3);
    // Played for nothing: no stake, and nothing sent to the chain.
    expect(core.state().match?.stake).toBe(0);
    expect(r.logged.at(-1)?.stake).toBe(0);
    expect(r.chain.sent).toEqual([]);
    expect(core.state().txs).toEqual([]);
  });

  it("sends the badge's verified roll when the game's taps are random", async () => {
    const r = rig("random");
    await toPlaying(r);
    expect(r.core.plan(1)).toBe("random");
    stationTap(r.core, 1, KITE, 0xdeadbeef);
    await flush();
    expect(r.fake.events.filter((e) => e.type === "tap")).toEqual([expect.objectContaining({ seat: 1, roll: 0xdeadbeef })]);
  });

  it("voids the match when the rules fail mid-game", async () => {
    const r = rig();
    await toPlaying(r);
    r.fake.fail("took over its 50 ms budget");
    stationTap(r.core, 0, NOVA, null);
    await flush();
    expect(r.core.state().match).toMatchObject({ voided: true, outcome: { winner: null } });
    expect(r.core.state().stations.map((v) => v.big)).toEqual(["VOID", "VOID"]);
    await until(r, (state) => state.phase === "result", END_HOLD_MS + 1_000);
    expect(r.logged.at(-1)).toMatchObject({ result: "void", counts: false });
    expect(r.chain.sent).toEqual([]);
  });

  it("voids a match whose rules won't start, straight to the result", async () => {
    const r = rig();
    const { core } = r;
    core.send({ type: "booted" });
    instantTap(core, 0, NOVA, 1);
    instantTap(core, 0, NOVA, 1);
    instantTap(core, 1, KITE, 1);
    core.send({ type: "focus", game: "tap-three" });
    core.send({ type: "play" });
    r.fake.fail("exited (1)");
    instantTap(core, 0, NOVA, 1);
    instantTap(core, 1, KITE, 1);
    await until(r, (state) => state.phase === "result");
    expect(core.state().match).toMatchObject({ voided: true, outcome: { winner: null } });
    expect(r.logged.at(-1)?.result).toBe("void");
  });

  it("stops the game's child when the players go Home", async () => {
    const r = rig();
    await toPlaying(r);
    for (let i = 0; i < 3; i++) stationTap(r.core, 1, KITE, null);
    await flush();
    await until(r, (state) => state.phase === "result", END_HOLD_MS + 1_000);
    r.core.send({ type: "home" });
    expect(r.fake.calls.at(-1)).toBe("stop");
    // A rematch starts it again.
    r.core.send({ type: "focus", game: "tap-three" });
    r.core.send({ type: "play" });
    expect(r.fake.calls.at(-1)).toBe("prepare tap-three");
  });
});
