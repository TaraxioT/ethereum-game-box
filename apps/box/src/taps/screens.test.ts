import { describe, expect, it } from "vitest";
import { stationView } from "@egb/sdk";
import { createFakeClock } from "../core/fake-clock.ts";
import { Acks } from "./acks.ts";
import type { ReceiverCommand } from "./lines.ts";
import { PAYLOAD_MAX, screenPayload } from "./screen-payload.ts";
import { REFRESH_MS, Screens } from "./screens.ts";

describe("screenPayload", () => {
  it("writes key=value lines: big always, tag and small when set, then ttl and the overrides", () => {
    expect(screenPayload({ tag: "P1", big: "SIGN", small: "10 EGB", sign: "HOLD STILL|signing", done: "PAID" }, 15)).toBe(
      "tag=P1\nbig=SIGN\nsmall=10 EGB\nttl=15\nsign=HOLD STILL|signing\ndone=PAID",
    );
    expect(screenPayload({ tag: "", big: "", small: "" }, 0)).toBe("big=");
  });

  it("cuts every value to its line and keeps to printable ASCII", () => {
    const payload = screenPayload({ tag: "P12345", big: "WINNER WINNER", small: "naïve and very long name", hold: "a|b|c\nd" }, 0);
    expect(payload).toBe("tag=P12\nbig=WINNER WIN\nsmall=na?ve and very long \nhold=a|b/c?d");
    expect(payload).toMatch(/^[\x20-\x7e\n]*$/);
  });

  it("never goes past 200 bytes; the overrides go last", () => {
    const long = "XXXXXXXXXX|YYYYYYYYYYYYYYYYYYYY";
    const view = { ...stationView("P1", "B".repeat(10), "s".repeat(20)), hold: long, sign: long, done: long, fail: long };
    const payload = screenPayload(view, 15);
    expect(payload.length).toBeLessThanOrEqual(PAYLOAD_MAX);
    expect(payload).toContain("tag=P1\nbig=BBBBBBBBBB\nsmall=ssssssssssssssssssss\nttl=15\nhold=");
    expect(payload).not.toContain("fail=");
  });
});

function setup() {
  const clock = createFakeClock(1_000_000);
  const acks = new Acks(clock);
  const sent: Extract<ReceiverCommand, { cmd: "screen" }>[] = [];
  const up = new Set(["e4ba70"]);
  let id = 0;
  const screens = new Screens({
    clock,
    acks,
    nextId: () => ++id,
    send: (cmd) => {
      if (cmd.cmd === "screen") sent.push(cmd);
      return true;
    },
    isUp: (st) => up.has(st),
  });
  const ack = (ok = true) => {
    const last = sent.at(-1)!;
    acks.answer(ok ? { ev: "screen_ok", st: last.st as string, id: last.id, tries: 1, rtt_us: 3000 } : { ev: "screen_fail", st: last.st as string, id: last.id, why: "no ack" });
  };
  return { clock, sent, up, screens, ack };
}

const view = (big: string) => stationView("P1", big, "nova");
const settle = () => new Promise<void>((r) => setImmediate(r));

describe("Screens", () => {
  it("sends on change, with ttl=15, and not again for the same view", () => {
    const { sent, screens } = setup();
    screens.show("e4ba70", view("TAP"));
    screens.show("e4ba70", view("TAP"));
    expect(sent.map((c) => c.payload)).toEqual(["tag=P1\nbig=TAP\nsmall=nova\nttl=15"]);
    screens.show("e4ba70", view("WAIT"));
    expect(sent).toHaveLength(2);
    expect(sent[1]!.id).not.toBe(sent[0]!.id);
  });

  it("resends every 5 s while the view stays", () => {
    const { clock, sent, screens } = setup();
    screens.show("e4ba70", view("TAP"));
    clock.advance(REFRESH_MS - 1000);
    expect(sent).toHaveLength(1);
    clock.advance(1000);
    expect(sent).toHaveLength(2);
    clock.advance(REFRESH_MS);
    expect(sent).toHaveLength(3);
    expect(new Set(sent.map((c) => c.payload)).size).toBe(1);
  });

  it("waits for a station that isn't linked, and sends again on relink", () => {
    const { sent, up, screens } = setup();
    screens.show("df3d88", view("TAP"));
    expect(sent).toHaveLength(0);
    up.add("df3d88");
    screens.up("df3d88");
    expect(sent.map((c) => c.st)).toEqual(["df3d88"]);
    screens.stale("df3d88");
    screens.up("df3d88");
    expect(sent).toHaveLength(2);
  });

  it("tries a failed screen again after a second, and tracks the ack by id", async () => {
    const { clock, sent, screens, ack } = setup();
    screens.show("e4ba70", view("TAP"));
    ack(false);
    await settle();
    expect(screens.status()[0]!.acked).toBe(false);
    clock.advance(1000);
    expect(sent).toHaveLength(2);
    ack(true);
    await settle();
    expect(screens.status()[0]).toMatchObject({ st: "e4ba70", acked: true });
  });

  it("probes with the station's own screen and returns the answer", async () => {
    const { sent, screens, ack } = setup();
    screens.show("e4ba70", view("TAP"));
    const answer = screens.probe("e4ba70");
    ack(true);
    expect((await answer).event?.ev).toBe("screen_ok");
    expect(sent[1]!.payload).toBe(sent[0]!.payload);
  });
});
