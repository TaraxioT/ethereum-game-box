// The tap machine on its own, with a station whose answers the test sends by hand: what a tap that has already ended
// does with an answer that comes late.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createFakeClock } from "../core/fake-clock.ts";
import type { TapEvent } from "../core/ports.ts";
import { SimBadge } from "./fake/sim-badge.ts";
import { AidMemory } from "./halo-exec.ts";
import type { ReceiverCommand, ReceiverEvent } from "./lines.ts";
import { Nfc } from "./nfc.ts";
import { Roster } from "./roster.ts";
import { Stations } from "./stations.ts";
import { REJOIN_MS, TapMachine } from "./tap-machine.ts";

const P1 = "e4ba70";

const flush = async () => {
  for (let i = 0; i < 4; i++) await new Promise<void>((r) => setImmediate(r));
};

function machine() {
  const clock = createFakeClock(0);
  const sent: Extract<ReceiverCommand, { cmd: "nfc" }>[] = [];
  let id = 0;
  const nfc = new Nfc({
    clock,
    nextId: () => ++id,
    send(cmd) {
      if (cmd.cmd === "nfc") sent.push(cmd);
      return true;
    },
  });
  const roster = Roster.load(join(mkdtempSync(join(tmpdir(), "egb-tap-machine-")), "badges.json"), () => {});
  const stations = new Stations([P1, "df3d88"], clock, { up() {}, down() {}, lost() {}, changed() {} });
  const events: TapEvent[] = [];
  const m = new TapMachine({ clock, roster, stations, nfc, aids: new AidMemory(), plan: () => "identify", emit: (e) => events.push(e), log: () => {} });
  const badge = new SimBadge("ada");
  /** The chip on the reader answers the request in flight. */
  const answer = (): void => {
    const cmd = sent.shift()!;
    if (cmd.op !== "apdu" && cmd.op !== "sign") throw new Error(`unexpected ${cmd.op}`);
    nfc.answer({ ev: "nfc_res", st: P1, id: cmd.id, op: cmd.op, ok: true, err: 0, hex: badge.apdu(cmd.hex), us: 1, wait_us: 1, rtt_us: 1, tries: 1 });
  };
  const tap: Extract<ReceiverEvent, { ev: "tap" }> = {
    ev: "tap", st: P1, id: 1, uid: badge.uid, atqa: "0044", sak: "20", ats: "78807002", read_us: 27_400, gap_us: 20_000, tries: 1, at_us: 0,
  };
  return { m, events, roster, answer, tap, clock };
}

describe("TapMachine", () => {
  it("records nothing for a tap that ended while its chip was read", async () => {
    const { m, events, roster, answer, tap } = machine();
    m.tap(tap, 0);
    await flush();
    answer(); // the applet select
    await flush();
    // The link's grace runs out while get_pkeys is on its way; its answer still comes back.
    m.lost(P1);
    answer();
    await flush();
    expect(events.map((e) => e.phase)).toEqual(["touch", "fail"]);
    expect(roster.entries()).toEqual([]);
  });

  it("fails a tap `lifted` when its chip left before the answer came back", async () => {
    const { m, events, roster, answer, tap, clock } = machine();
    m.tap(tap, 0);
    await flush();
    answer();
    await flush();
    m.gone({ ev: "gone", st: P1, id: 1, uid: tap.uid, at_us: 10 });
    answer();
    await flush();
    // It may yet come back (a flapping station): it fails once that window has passed.
    expect(events.at(-1)?.phase).toBe("touch");
    for (let t = 0; t <= REJOIN_MS + 100; t += 25) {
      clock.advance(25);
      await flush();
    }
    expect(events.at(-1)).toMatchObject({ phase: "fail", error: { code: "lifted" } });
    expect(roster.entries()).toEqual([]);
  });
});
