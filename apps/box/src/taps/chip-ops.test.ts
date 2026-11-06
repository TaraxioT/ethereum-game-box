// Chip operations against a simulated badge through the real NFC client and libhalo exec: real keys, real APDUs.
import { HaloTagError } from "@arx-research/libhalo/api/common";
import { describe, expect, it } from "vitest";
import { createFakeClock } from "../core/fake-clock.ts";
import { readKeys, rollRandom } from "./chip-ops.ts";
import { NotHaloError, VerifyError } from "./errors.ts";
import { SimBadge } from "./fake/sim-badge.ts";
import { AidMemory, ChipSession, type HaloExec } from "./halo-exec.ts";
import { Nfc } from "./nfc.ts";

/** A station with `badge` on its reader, answering at once. Returns the session and the APDUs it got. */
function onReader(badge: SimBadge, opts: { sak?: string; aids?: AidMemory } = {}) {
  const clock = createFakeClock(0);
  const apdus: string[] = [];
  let id = 0;
  const nfc: Nfc = new Nfc({
    clock,
    nextId: () => ++id,
    send(cmd) {
      if (cmd.cmd !== "nfc" || (cmd.op !== "apdu" && cmd.op !== "sign")) throw new Error(`unexpected ${cmd.cmd}`);
      apdus.push(cmd.hex);
      const hex = badge.apdu(cmd.hex);
      queueMicrotask(() => nfc.answer({ ev: "nfc_res", st: cmd.st, id: cmd.id, op: cmd.op, ok: true, err: 0, hex, us: 1, wait_us: 1, rtt_us: 1, tries: 1 }));
      return true;
    },
  });
  badge.powerUp();
  const target = { st: "e4ba70", uid: badge.uid, sak: opts.sak ?? "20", selected: false, present: () => true, whenUp: async () => {} };
  return { session: new ChipSession(nfc, opts.aids ?? new AidMemory(), target, clock), apdus };
}

describe("chip ops", () => {
  it("reads both keys' addresses", async () => {
    const badge = new SimBadge("ada");
    const keys = await readKeys(onReader(badge).session.exec);
    expect(keys.key2).toBe(badge.identity);
    expect(keys.key1).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(keys.key1).not.toBe(keys.key2);
  });

  it("verifies a roll against the badge's key 2, and the counter goes up", async () => {
    const badge = new SimBadge("ada");
    const { exec } = onReader(badge).session;
    const first = await rollRandom(exec, badge.identity);
    const second = await rollRandom(exec, badge.identity);
    expect([first.counter, second.counter]).toEqual([1, 2]);
    expect(first.value).toBe(Buffer.from(first.payload, "hex").readUInt32BE(4));
    expect(first.payload).not.toBe(second.payload);
  });

  it("fails a roll signed by another key than the roster's", async () => {
    const badge = new SimBadge("ada");
    await expect(rollRandom(onReader(badge).session.exec, new SimBadge("bo").identity)).rejects.toBeInstanceOf(VerifyError);
  });

  it("fails a roll whose payload was changed after signing", async () => {
    const badge = new SimBadge("ada");
    const { exec } = onReader(badge).session;
    const lying: HaloExec = async (cmd) => {
      const res = (await exec(cmd)) as { payload: string };
      return { ...res, payload: `ff${res.payload.slice(2)}` };
    };
    await expect(rollRandom(lying, badge.identity)).rejects.toBeInstanceOf(VerifyError);
  });

  it("is refused by key 1, like a real chip", async () => {
    const { exec } = onReader(new SimBadge("ada")).session;
    await expect(exec({ name: "sign_random", keyNo: 1 })).rejects.toBeInstanceOf(HaloTagError);
  });
});

describe("the applet select", () => {
  it("refuses a card without ISO-DEP without sending anything", async () => {
    const { session, apdus } = onReader(new SimBadge("ada"), { sak: "08" });
    await expect(session.select()).rejects.toBeInstanceOf(NotHaloError);
    expect(apdus).toEqual([]);
  });

  it("tries the AID each chip answered last first", async () => {
    const aids = new AidMemory();
    const legacy = new SimBadge("eve", "legacy");
    const first = onReader(legacy, { aids });
    await first.session.select();
    expect(first.apdus.map((a) => a.slice(0, 12))).toEqual(["00A404000AA0", "00A404000748"]);
    const again = onReader(legacy, { aids });
    await again.session.select();
    expect(again.apdus.map((a) => a.slice(0, 12))).toEqual(["00A404000748"]);
    // An unseen chip starts with the AID that worked last.
    expect(aids.order("04FFFFFFFFFFFF")).toEqual([1, 0]);
  });
});
