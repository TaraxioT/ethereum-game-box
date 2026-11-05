import { describe, expect, it } from "vitest";
import { createFakeClock } from "../core/fake-clock.ts";
import { NfcError } from "./errors.ts";
import type { ReceiverCommand } from "./lines.ts";
import { Nfc, REQUEST_MS } from "./nfc.ts";

type NfcCommand = Extract<ReceiverCommand, { cmd: "nfc" }>;

function setup() {
  const clock = createFakeClock(0);
  const sent: NfcCommand[] = [];
  let id = 0;
  const nfc = new Nfc({
    clock,
    nextId: () => ++id,
    send: (cmd) => {
      if (cmd.cmd === "nfc") sent.push(cmd);
      return true;
    },
  });
  const timing = { us: 1, wait_us: 1, rtt_us: 1, tries: 1 };
  const ok = (c: NfcCommand, hex = "9000") => nfc.answer({ ev: "nfc_res", st: c.st, id: c.id, op: c.op, ok: true, err: 0, hex, ...timing });
  const err = (c: NfcCommand, code: number) => nfc.answer({ ev: "nfc_res", st: c.st, id: c.id, op: c.op, ok: false, err: code, ...timing });
  return { clock, sent, nfc, ok, err };
}

const kindOf = (p: Promise<unknown>) => p.then(() => "ok", (e: unknown) => (e instanceof NfcError ? e.kind : String(e)));

describe("Nfc", () => {
  it("keeps one request in flight per station, and queues the rest", async () => {
    const { sent, nfc, ok } = setup();
    const a = nfc.request("e4ba70", { op: "apdu", hex: "00" });
    const b = nfc.request("e4ba70", { op: "list" });
    const c = nfc.request("df3d88", { op: "list" });
    expect(sent.map((s) => [s.st, s.op])).toEqual([["e4ba70", "apdu"], ["df3d88", "list"]]);
    ok(sent[0]!, "6D00");
    expect((await a).hex).toBe("6D00");
    expect(sent.map((s) => s.op)).toEqual(["apdu", "list", "list"]);
    ok(sent[2]!);
    ok(sent[1]!);
    await Promise.all([b, c]);
  });

  it("ignores a late answer to a request that timed out", async () => {
    const { clock, sent, nfc, ok } = setup();
    const a = kindOf(nfc.request("e4ba70", { op: "reselect" }));
    clock.advance(REQUEST_MS);
    expect(await a).toBe("transport");
    const b = nfc.request("e4ba70", { op: "list" });
    ok(sent[0]!); // the first one's answer, at last
    ok(sent[1]!);
    expect((await b).tags).toEqual([]);
  });

  it("types the receiver's errors", async () => {
    const { sent, nfc, err } = setup();
    const kinds = [1, 2, 3, 4, 5].map((code, i) => {
      const p = kindOf(nfc.request(`e4ba7${i}`, { op: "apdu", hex: "00" }));
      err(sent[i]!, code);
      return p;
    });
    expect(await Promise.all(kinds)).toEqual(["no-chip", "transport", "no-chip", "reader-dead", "bad-request"]);
    const link = kindOf(nfc.request("e4ba70", { op: "list" }));
    nfc.answer({ ev: "nfc_fail", st: "e4ba70", id: sent.at(-1)!.id, why: "no such station linked" });
    expect(await link).toBe("link");
  });

  it("answers an empty reader's list with no chips", async () => {
    const { sent, nfc, err } = setup();
    const p = nfc.request("e4ba70", { op: "list" });
    err(sent[0]!, 1);
    expect((await p).tags).toEqual([]);
  });

  it("fails everything waiting or in flight when the port closes", async () => {
    const { nfc } = setup();
    const p = [nfc.request("e4ba70", { op: "list" }), nfc.request("e4ba70", { op: "list" })].map(kindOf);
    nfc.closed();
    expect(await Promise.all(p)).toEqual(["closed", "closed"]);
  });
});
