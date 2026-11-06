// The whole Box with EGB_RECEIVER=fake: simulated badges (real secp256k1 keys answering real APDUs) on simulated
// stations, through the real server, the taps library and the core, on a fake clock. Join, the simulated stake, both
// games, the result, Refund by the power switch, and the taps' promises: a known badge costs no chip command, and
// every touch ends in done or fail even when the receiver is unplugged.
import { FREE_MIN_MATCH_MS } from "../core/transcript.ts";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Transcript } from "@egb/sdk";
import type { BoxEvent, BoxState } from "../core/types.ts";
import { STATS } from "../games/stock-duel/deck.ts";
import type { BoxReply } from "../test-page/wire.ts";
import { flush, post, startTestBox, type TestBox } from "./testing.ts";

const P1 = "e4ba70";
const P2 = "df3d88";
const GET_PKEYS = "B0510000010200";
const ARX_SELECT = "00A404000AA0000009490148614C6F00";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const clean of cleanups.splice(0).reverse()) await clean();
});

interface Rig {
  readonly tb: TestBox;
  readonly events: BoxEvent[];
  state(): BoxState;
  /** A simulated badge lands on a station's reader and stays until its tap has ended. */
  tap(badge: string, st: string): Promise<void>;
  /** The chip commands (`nfc … apdu`) the fake receiver got since the last call. */
  apdus(): string[];
}

async function fakeBox(timeScale = 0): Promise<Rig> {
  const tb = await startTestBox({ receiver: { kind: "fake" }, fake: { timeScale } });
  cleanups.push(() => tb.stop());
  const events: BoxEvent[] = [];
  tb.box.core.subscribe((_, event) => events.push(event));
  const taps = tb.box.taps();
  if (!taps?.fake) throw new Error("no fake receiver");
  const fake = taps.fake;
  await tb.settle(() => taps.status().receiver.open && taps.probe.linked().length === 2);
  let heard = fake.heard().length;
  return {
    tb,
    events,
    state: () => tb.box.core.state(),
    async tap(badge, st) {
      // stats() hands out the live counters: keep a copy.
      const before = structuredClone(taps.stats().taps);
      const ended = () => {
        const now = taps.stats().taps;
        const fails = Object.values(now.fail).reduce((a, b) => a + b, 0) - Object.values(before.fail).reduce((a, b) => a + b, 0);
        return now.touch > before.touch && now.done - before.done + fails === now.touch - before.touch && taps.status().running === 0;
      };
      fake.lift(badge);
      fake.place(badge, st);
      await tb.settle(ended, 5_000, 5);
      fake.lift(badge);
      await tb.settle(() => fake.status().badges.every((b) => b.name !== badge || b.station === null), 1_000, 5);
    },
    apdus() {
      const all = fake.heard();
      const fresh = all.slice(heard).filter((line) => line.startsWith("nfc ") && line.includes(" apdu "));
      heard = all.length;
      return fresh;
    },
  };
}

/**
 * Boots, reads ada at P1 (attract → Home), seats ada and bo, focuses the game and stakes 10 USDC each. bo signs a
 * while after ada: the match opens at once, and a result counts only once FREE_MIN_MATCH_MS have passed since the first
 * tap the Box saw from Stake on.
 */
async function staked(rig: Rig, game: "quick-draw" | "stock-duel"): Promise<void> {
  const { tb } = rig;
  tb.box.core.send({ type: "booted" });
  await rig.tap("ada", P1);
  expect(rig.state().phase).toBe("home");
  await rig.tap("ada", P1);
  await rig.tap("bo", P2);
  expect(rig.state().seats.map((s) => s.badge?.name)).toEqual(["nova", "orbit"]);
  if (rig.state().focus !== game) tb.box.core.send({ type: "focus", game });
  tb.box.core.send({ type: "play" });
  expect(rig.state().phase).toBe("stake");
  await rig.tap("ada", P1);
  rig.tb.advance(FREE_MIN_MATCH_MS);
  await rig.tap("bo", P2);
  expect(rig.state().seats.map((s) => s.signed)).toEqual([true, true]);
  await rig.tb.settle(() => rig.state().phase === "playing", 30_000, 50);
}

async function paid(rig: Rig): Promise<void> {
  await rig.tb.settle(() => rig.state().phase === "result" && rig.state().txs.every((tx) => tx.step === "paid"), 30_000, 50);
}

async function transcripts(tb: TestBox): Promise<Transcript[]> {
  await tb.box.stop();
  const dir = join(tb.dir, "data", "sessions");
  const files = await readdir(dir);
  const text = (await Promise.all(files.map((f) => readFile(join(dir, f), "utf8")))).join("");
  return text.trim().split("\n").map((line) => JSON.parse(line) as Transcript);
}

describe("the Box on the fake receiver", () => {
  it("reads an unknown badge once; after that its identify costs no chip command", async () => {
    const rig = await fakeBox();
    rig.tb.box.core.send({ type: "booted" });
    await rig.tap("ada", P1);
    expect(rig.apdus().some((line) => line.endsWith(GET_PKEYS))).toBe(true);
    await rig.tap("ada", P1);
    await rig.tap("ada", P1);
    // Only the applet select after each tap, off the tap's clock: the station answers it from its own select.
    expect(rig.apdus().map((line) => line.split(" ").slice(3).join(" "))).toEqual([`apdu ${ARX_SELECT}`, `apdu ${ARX_SELECT}`]);
    expect(rig.state().seats[0].badge?.name).toBe("nova");
  });

  it("plays a Quick Draw from join to a paid result, judged at the touch, and logs a counted transcript", async () => {
    const rig = await fakeBox();
    await staked(rig, "quick-draw");
    await rig.tb.settle(() => {
      const play = rig.state().match?.play;
      return play?.game === "quick-draw" && play.state.phase === "draw";
    }, 10_000, 20);
    // The touch time is worked out from the station's line (the read and the radio before it), some 40 ms before the
    // line arrives: a chip put down the moment the sign flips was a false start.
    rig.tb.advance(200, 10);
    await rig.tap("bo", P2);
    await paid(rig);
    const match = rig.state().match;
    expect(match?.outcome).toEqual({ winner: 1 });
    expect(rig.state().seats.map((s) => s.balance)).toEqual([90, 110]);
    const box = (await (await fetch(`${rig.tb.box.url}/api/box`)).json()) as BoxReply;
    const bo = rig.state().seats[1].badge?.address.toLowerCase() ?? "";
    expect(box.records[bo]).toEqual({ wins: 1, losses: 0, draws: 0 });

    const [t] = await transcripts(rig.tb);
    expect(t).toMatchObject({ v: 1, game: "quick-draw", stake: 10, result: { winner: 1 }, counts: true });
    expect(t?.taps).toEqual([{ seat: 1, at: expect.any(Number), roll: null, accepted: true }]);
  });

  it("plays a Stock Duel to a paid result, each card played with its badge's verified roll", async () => {
    const rig = await fakeBox();
    await staked(rig, "stock-duel");
    const duel = () => {
      const play = rig.state().match?.play;
      return play?.game === "stock-duel" ? play.state : null;
    };
    for (let round = 0; rig.state().phase === "playing" && round < 12; round++) {
      await rig.tb.settle(() => rig.state().phase !== "playing" || duel()?.phase === "pick", 20_000, 50);
      if (rig.state().phase !== "playing") break;
      expect(rig.tb.box.core.plan(0)).toBe("random");
      await rig.tap("ada", P1);
      await rig.tap("bo", P2);
      const dial = duel();
      if (dial?.phase === "dial") expect(dial.stat).toBe(STATS[((dial.rolls[0] + dial.rolls[1]) >>> 0) % STATS.length]);
      await rig.tb.settle(() => rig.state().phase !== "playing" || duel()?.phase !== "dial", 20_000, 50);
    }
    await paid(rig);
    const [t] = await transcripts(rig.tb);
    expect(t?.game).toBe("stock-duel");
    // Every played card's roll is a chip's: a uint32 that isn't the deal's.
    const rolls = (t?.taps ?? []).filter((tap) => tap.accepted).map((tap) => tap.roll);
    expect(rolls.length).toBeGreaterThanOrEqual(4);
    expect(rolls.every((roll) => typeof roll === "number" && roll >= 0 && roll <= 0xffffffff)).toBe(true);
    expect(new Set(rolls).size).toBe(rolls.length);
  });

  it("goes to Refund with the power cut, and pays both stakes back on a tap once the refund opens", async () => {
    const rig = await fakeBox();
    await staked(rig, "quick-draw");
    expect((await post(rig.tb.box, "/api/box/power", { on: false })).status).toBe(204);
    await rig.tb.settle(() => {
      const play = rig.state().match?.play;
      return play?.game === "quick-draw" && play.state.phase === "draw";
    }, 10_000, 20);
    await rig.tap("ada", P1);
    await rig.tb.settle(() => rig.state().phase === "refund", 10_000, 50);
    expect(rig.state().stations[0].big).toBe("OFFLINE");
    const match = rig.state().match;
    await rig.tb.settle(() => rig.tb.box.core.now() >= (match?.refundAt ?? 0), 120_000, 500);
    // One tap refunds the whole pot to both badges.
    await rig.tap("ada", P1);
    await rig.tb.settle(() => rig.state().phase === "home", 30_000, 50);
    expect(rig.state().seats.map((s) => s.balance)).toEqual([100, 100]);
  });

  it("ends every touch in done or fail when the receiver is unplugged mid-roll, and lets the held card go", async () => {
    const rig = await fakeBox(1);
    await staked(rig, "stock-duel");
    const taps = rig.tb.box.taps();
    if (!taps?.fake) throw new Error("no fake receiver");
    await rig.tb.settle(() => {
      const play = rig.state().match?.play;
      return play?.game === "stock-duel" && play.state.phase === "pick";
    }, 20_000, 50);
    const held = () => {
      const play = rig.state().match?.play;
      return play?.game === "stock-duel" ? play.state.held : null;
    };
    taps.fake.place("ada", P1);
    await rig.tb.settle(() => held()?.[0] !== null, 2_000, 5);
    expect(taps.status().running).toBe(1);
    taps.fake.unplug();
    await flush();
    await rig.tb.settle(() => taps.status().running === 0, 2_000, 5);
    const counts = taps.stats().taps;
    expect(counts.touch).toBe(counts.done + Object.values(counts.fail).reduce((a, b) => a + b, 0));
    expect(held()).toEqual([null, null]);
    expect(rig.events.filter((e) => e.type === "tap").at(-1)).toEqual({ type: "tap", seat: 0, accepted: false });
    taps.fake.plug();
  });
});
