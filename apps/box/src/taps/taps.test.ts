// The whole taps library against the fake receiver, on a fake clock: the tap state machine, the stations port, the
// test page's calls and the receiver's drop and return.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stationView } from "@egb/sdk";
import { afterEach, describe, expect, it } from "vitest";
import { createFakeClock } from "../core/fake-clock.ts";
import type { TapEvent, TapPlan } from "../core/ports.ts";
import { VerifyError } from "./errors.ts";
import type { FakeOptions } from "./fake/fake-receiver.ts";
import { createTaps, type Taps } from "./taps.ts";

const P1 = "e4ba70";
const P2 = "df3d88";
const GET_PKEYS = "B0510000010200";
const ARX_SELECT = "00A404000AA0000009490148614C6F00";

const open: Taps[] = [];
afterEach(async () => {
  for (const taps of open.splice(0)) await taps.close();
});

const flush = async (rounds = 8) => {
  for (let i = 0; i < rounds; i++) await new Promise<void>((r) => setImmediate(r));
};

async function boot(fake: FakeOptions = {}, dataDir = mkdtempSync(join(tmpdir(), "egb-taps-"))) {
  const clock = createFakeClock(1_700_000_000_000);
  const events: TapEvent[] = [];
  const env = { plan: "identify" as TapPlan, events, clock, dataDir };
  const taps = createTaps({
    receiver: "fake",
    stations: [P1, P2],
    dataDir,
    clock,
    plan: () => env.plan,
    onTap: (e) => events.push(e),
    log: () => {},
    fake: { timeScale: 0, ...fake },
  });
  open.push(taps);
  await flush();
  /** Moves the fake clock on in 5 ms steps, letting I/O run between them. */
  const step = async (ms: number) => {
    for (let t = 0; t < ms; t += 5) {
      clock.advance(5);
      await flush(2);
    }
  };
  /** NFC commands the fake receiver got since the last call. */
  let seen = 0;
  const nfcSent = () => {
    const heard = taps.fake!.heard();
    const fresh = heard.slice(seen).filter((l) => l.startsWith("nfc "));
    seen = heard.length;
    return fresh.map((l) => l.split(" ").slice(3).join(" "));
  };
  return { ...env, env, taps, fake: taps.fake!, step, nfcSent };
}

/** Every touch has exactly one done or fail after it, and nothing else shares its tap. */
function expectWhole(events: readonly TapEvent[]): void {
  const byTap = new Map<number, TapEvent[]>();
  for (const e of events) byTap.set(e.tap, [...(byTap.get(e.tap) ?? []), e]);
  for (const group of byTap.values()) {
    expect(group.map((e) => e.phase)).toEqual(["touch", group[1]!.phase]);
    expect(group[1]!.phase).toMatch(/^(done|fail)$/);
  }
}

describe("the tap state machine", () => {
  it("reads an unknown chip, then knows it: identify is done before any chip command", async () => {
    const t = await boot();
    const ada = t.fake.badge("ada");
    t.fake.place("ada", P1);
    await flush();
    expect(t.events.map((e) => e.phase)).toEqual(["touch", "done"]);
    expect(t.events[0]).toMatchObject({ phase: "touch", seat: 0, badge: null });
    expect(t.events[1]).toMatchObject({ phase: "done", seat: 0, badge: { address: ada.identity, name: "nova" }, roll: null });
    expect(t.nfcSent()).toEqual([`apdu ${ARX_SELECT}`, `apdu ${GET_PKEYS}`]);

    t.fake.lift("ada");
    t.fake.place("ada", P1);
    await new Promise<void>((r) => setImmediate(r));
    expect(t.events.slice(2)).toMatchObject([
      { phase: "touch", badge: { name: "nova" } },
      { phase: "done", badge: { name: "nova" }, roll: null },
    ]);
    // Then, off the tap's clock, the applet select alone (the station answers it from its kept answer).
    await flush();
    expect(t.nfcSent()).toEqual([`apdu ${ARX_SELECT}`]);
    expectWhole(t.events);
  });

  it("is done the moment the line arrives for a known chip: touch and done together", async () => {
    const t = await boot();
    t.fake.place("bo", P2);
    await flush();
    t.events.length = 0;
    t.fake.lift("bo");
    t.fake.place("bo", P2);
    await new Promise<void>((r) => setImmediate(r));
    expect(t.events.map((e) => e.phase)).toEqual(["touch", "done"]);
    expect(t.events[0]!.at).toBe(t.events[1]!.at);
    expect(t.events[0]!.at).toBeLessThanOrEqual(t.clock.now());
  });

  it("reads an unknown chip whatever the plan, even `none`", async () => {
    const t = await boot();
    t.env.plan = "none";
    t.fake.place("cy", P1);
    await flush();
    expect(t.nfcSent()).toEqual([`apdu ${ARX_SELECT}`, `apdu ${GET_PKEYS}`]);
    expect(t.events[1]).toMatchObject({ phase: "done", badge: { name: "nova" } });
    expect(t.taps.roster().map((e) => e.uid)).toEqual([t.fake.badge("cy").uid]);
  });

  it("gets its SELECT answered from the station's own select: no second exchange with the chip", async () => {
    const t = await boot({ timeScale: 1 });
    const placed = t.clock.now();
    t.fake.place("ada", P1);
    while (t.events.length < 2) await t.step(5);
    // The read (27.4 ms), the station's select (45), the kept answer (3), get_pkeys (110 + 3): not a second select.
    const took = t.clock.now() - placed;
    expect(took).toBeGreaterThanOrEqual(27.4 + 45 + 3 + 113);
    expect(took).toBeLessThan(27.4 + 45 + 3 + 113 + 30);
    expect(t.events[1]).toMatchObject({ phase: "done", badge: { name: "nova" } });
  });

  it("remembers which applet ID a chip answers, so its next tap skips the miss", async () => {
    const t = await boot();
    t.env.plan = "random";
    t.fake.place("eve", P1); // a legacy-AID badge
    await flush();
    expect(t.nfcSent().filter((c) => c.startsWith("apdu 00A4"))).toHaveLength(2);
    t.fake.lift("eve");
    t.fake.place("eve", P1);
    await flush();
    expect(t.nfcSent().filter((c) => c.startsWith("apdu 00A4"))).toEqual(["apdu 00A4040007481199130E9F0100"]);
    expect(t.events.filter((e) => e.phase === "done")).toHaveLength(2);
  });

  it("rolls with key 2's sign_random, verified, and sends it as a sign request", async () => {
    const t = await boot();
    t.env.plan = "random";
    t.fake.place("di", P2);
    await flush();
    const sent = t.nfcSent();
    expect(sent).toEqual([`apdu ${ARX_SELECT}`, `apdu ${GET_PKEYS}`, "sign B051000002080200"]);
    const done = t.events[1]!;
    expect(done.phase).toBe("done");
    const roll = done.phase === "done" ? done.roll : null;
    expect(Number.isInteger(roll) && roll! >= 0 && roll! <= 0xffff_ffff).toBe(true);
  });

  it("fails `verify` when the roll is signed by another key than the roster's", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "egb-taps-"));
    const first = await boot({}, dataDir);
    first.fake.place("ada", P1);
    first.fake.place("bo", P2);
    await flush();
    await first.taps.close();
    // The roster now says ada's UID has bo's keys: a chip that answers with another key must not pass.
    const file = join(dataDir, "badges.fake.json");
    const data = JSON.parse(readFileSync(file, "utf8")) as { badges: { uid: string; key2: string }[] };
    const [ada, bo] = [first.fake.badge("ada").uid, first.fake.badge("bo").uid].map((uid) => data.badges.find((b) => b.uid === uid)!);
    ada!.key2 = bo!.key2;
    writeFileSync(file, JSON.stringify(data));

    const t = await boot({}, dataDir);
    t.env.plan = "random";
    t.fake.place("ada", P1);
    await flush();
    expect(t.events[1]).toMatchObject({ phase: "fail", error: { code: "verify" } });
    await expect(t.taps.roll(P1)).rejects.toBeInstanceOf(VerifyError);
  });

  it("fails `lifted` when the chip leaves mid-roll", async () => {
    const t = await boot({ timeScale: 1 });
    t.fake.place("ada", P1);
    await t.step(200);
    t.env.plan = "random";
    t.fake.lift("ada");
    await t.step(100);
    t.fake.place("ada", P1);
    await t.step(100);
    t.fake.lift("ada");
    await t.step(1500);
    expect(t.events.at(-1)).toMatchObject({ phase: "fail", error: { code: "lifted" } });
    expectWhole(t.events);
  });

  it("carries a roll on when the station counts a still badge gone and reads it again at once", async () => {
    // On the Box, a HaLo with SAK 28 resting on the reader flaps `gone` then `tap` within a few ms; every roll it
    // interrupted failed `lifted`, so Stock Duel's picks failed with the badge held still.
    const t = await boot({ timeScale: 1 });
    t.fake.place("ada", P1);
    await t.step(200);
    t.fake.lift("ada");
    await t.step(100);
    t.env.plan = "random";
    t.fake.place("ada", P1);
    await t.step(300);
    t.fake.lift("ada");
    await t.step(60);
    t.fake.place("ada", P1);
    await t.step(2500);
    expectWhole(t.events);
    expect(t.events.filter((e) => e.phase === "touch")).toHaveLength(2);
    const roll = t.events.at(-1)!;
    expect(roll).toMatchObject({ phase: "done", tap: t.events[2]!.tap });
    expect(roll.phase === "done" && roll.roll !== null).toBe(true);
  });

  it("still fails `lifted` when the chip comes back too late", async () => {
    const t = await boot({ timeScale: 1 });
    t.fake.place("ada", P1);
    await t.step(200);
    t.fake.lift("ada");
    await t.step(100);
    t.env.plan = "random";
    t.fake.place("ada", P1);
    await t.step(300);
    t.fake.lift("ada");
    await t.step(1500);
    t.fake.place("ada", P1);
    await t.step(2500);
    expectWhole(t.events);
    expect(t.events[3]).toMatchObject({ phase: "fail", error: { code: "lifted" } });
    expect(t.events.filter((e) => e.phase === "touch")).toHaveLength(3);
  });

  it("fails every open tap at once when the receiver drops, then reopens", async () => {
    const t = await boot({ timeScale: 1 });
    t.env.plan = "random";
    t.fake.place("ada", P1);
    t.fake.place("bo", P2);
    await t.step(100);
    expect(t.events.filter((e) => e.phase === "touch")).toHaveLength(2);
    t.fake.unplug();
    await flush();
    expect(t.events.filter((e) => e.phase === "fail").map((e) => e.phase === "fail" && e.error.code)).toEqual(["link", "link"]);
    expect(t.taps.status().receiver.open).toBe(false);
    expectWhole(t.events);
    t.fake.plug();
    await t.step(300);
    expect(t.taps.status().receiver.open).toBe(true);
    expect(t.taps.status().stations.filter((s) => s.up).map((s) => s.st)).toEqual([P1, P2]);
  });

  it("gives a dropped link 2 s of grace, then fails the open tap with `link`", async () => {
    const t = await boot({ timeScale: 1 });
    t.env.plan = "random";
    t.fake.place("ada", P1);
    await t.step(100);
    t.fake.linkDown(P1);
    await t.step(2500 + 1900);
    expect(t.events.map((e) => e.phase)).toEqual(["touch"]);
    await t.step(200);
    expect(t.events[1]).toMatchObject({ phase: "fail", error: { code: "link" } });
  });

  it("carries on when the link comes back within its grace", async () => {
    const t = await boot({ timeScale: 1 });
    t.env.plan = "random";
    t.fake.place("ada", P1);
    await t.step(100);
    t.fake.linkDown(P1);
    await t.step(2500 + 500);
    t.fake.linkUp(P1);
    await t.step(4000);
    expect(t.events[1]).toMatchObject({ phase: "done", badge: { name: "nova" } });
  });

  it("ignores a resend of an older tap that reaches the Pi after a newer one", async () => {
    const t = await boot({ timeScale: 1 });
    const ada = t.fake.badge("ada");
    t.fake.place("ada", P1);
    await t.step(300);
    t.env.plan = "random";
    t.fake.lift("ada");
    await t.step(100);
    t.fake.place("ada", P1);
    await t.step(50);
    // The first tap's line again (its ack was lost), while the second tap's roll is running.
    const resend = { ev: "tap", st: P1, id: 1, uid: ada.uid, atqa: "0044", sak: "20", ats: "78807002", read_us: 27_400, gap_us: 20_000, tries: 3 };
    (t.fake as unknown as { emit(line: object): void }).emit({ ...resend, at_us: 1 });
    await t.step(1500);
    expect(t.events.map((e) => e.phase)).toEqual(["touch", "done", "touch", "done"]);
    expect(t.events[3]).toMatchObject({ phase: "done", tap: t.events[2]!.tap });
  });

  it("starts a fresh tap after a `ready` in the same chunk", async () => {
    const t = await boot();
    t.fake.place("ada", P1);
    await flush();
    t.events.length = 0;
    t.env.plan = "random";
    t.fake.lift("ada");
    await flush();
    const ada = t.fake.badge("ada");
    // The fake's station put the chip back (its tap 2), and the receiver's reboot line came in the same chunk.
    const tap = { ev: "tap", st: P1, id: 2, uid: ada.uid, atqa: "0044", sak: "20", ats: "78807002", read_us: 27_400, gap_us: 20_000, tries: 1, at_us: 5 };
    const stream = (t.fake as unknown as { stream: { push(text: string): void } }).stream;
    (t.fake as unknown as { stations: Map<string, { badge: unknown; tapId: number }> }).stations.get(P1)!.badge = ada;
    stream.push(`${JSON.stringify({ ev: "ready", mac: "7CDFA1D504CC", fw: "1.0.0" })}\n${JSON.stringify(tap)}\n`);
    await flush();
    expect(t.events.map((e) => e.phase)).toEqual(["touch", "done"]);
    expect(t.events[1]).toMatchObject({ phase: "done", badge: { name: "nova" } });
  });

  it("ignores taps on a station no seat uses, but shows the chip in its status", async () => {
    const t = await boot({ stations: [P1, P2, "0a0b0c"] });
    t.fake.place("ada", "0a0b0c");
    await flush();
    expect(t.events).toEqual([]);
    expect(t.taps.status().stations.find((s) => s.st === "0a0b0c")).toMatchObject({ seat: null, chip: { uid: t.fake.badge("ada").uid } });
  });
});

describe("the stations port and the test page's calls", () => {
  it("shows a seat's view on its station and buzzes ok / no", async () => {
    const t = await boot();
    t.taps.show(1, stationView("P2", "TAP", "to join"));
    t.taps.buzz(0, "ok");
    t.taps.buzz(1, "no");
    await flush();
    expect(t.fake.status().stations.find((s) => s.st === P2)!.screen).toBe("tag=P2\nbig=TAP\nsmall=to join\nttl=15");
    expect(t.fake.heard().filter((l) => l.startsWith("buzz")).map((l) => l.replace(/ \d+ /, " # "))).toEqual([`buzz ${P1} # 80`, `buzz ${P2} # 80 2`]);
    expect(t.taps.stats().buzz).toEqual({ sent: 2, ok: 2, failed: 0 });
    expect(t.taps.status().stations.find((s) => s.st === P2)!.screen).toMatchObject({ acked: true });
  });

  it("identifies, rolls and lists the badge on a station", async () => {
    const t = await boot();
    t.fake.place("bo", P1);
    await flush();
    const read = await t.taps.identify(P1);
    expect(read).toMatchObject({ uid: t.fake.badge("bo").uid, badge: { address: t.fake.badge("bo").identity } });
    const rolled = await t.taps.roll(P1);
    expect(rolled.roll.counter).toBe(1);
    expect(await t.taps.list(P1)).toEqual([{ uid: t.fake.badge("bo").uid, atqa: "0044", sak: "20", ats: "78807002" }]);
    await expect(t.taps.identify(P2)).rejects.toThrow(/no badge/);
  });

  it("measures a press both ways round the receiver", async () => {
    const t = await boot();
    const press = await t.taps.press();
    expect(press).toMatchObject({ st: P1, rttUs: 2400 });
    expect(press.echoMs).not.toBeNull();
  });

  it("keeps the roster in badges.fake.json for the fake, written atomically", async () => {
    const t = await boot();
    t.fake.place("ada", P1);
    await flush();
    await t.taps.close();
    const saved = JSON.parse(readFileSync(join(t.dataDir, "badges.fake.json"), "utf8"));
    expect(saved).toMatchObject({ v: 1, badges: [{ uid: t.fake.badge("ada").uid, label: "nova" }] });
  });
});
