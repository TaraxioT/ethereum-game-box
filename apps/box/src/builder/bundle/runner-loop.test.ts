import { stationView, type BuiltRules } from "@egb/sdk";
import { describe, expect, it } from "vitest";
import { createRunnerLoop, encodeReply, isBuiltRules } from "./runner-loop.ts";

/** Counts taps; the third tap from a seat wins. Throws on a tick at now 666. */
const rules: BuiltRules<{ taps: [number, number] }> = {
  start: () => ({ taps: [0, 0] }),
  step(state, event) {
    if (event.type === "tick" && event.now === 666) throw new Error("bad tick");
    if (event.type !== "tap") return state;
    const taps: [number, number] = [...state.taps];
    taps[event.seat] += 1;
    return { taps };
  },
  outcome: (s) => (s.taps[0] >= 3 ? { winner: 0 } : null),
  stations: (s) => [stationView("P1", String(s.taps[0]), ""), stationView("P2", String(s.taps[1]), "")],
};

const line = (o: object) => JSON.stringify(o);

describe("the runner loop", () => {
  it("answers start and steps with the whole state, outcome, stations and time", () => {
    let t = 0;
    const loop = createRunnerLoop(rules, () => (t += 2));
    expect(loop.handle(line({ t: "start", seq: 0, seed: 1, now: 100 }))).toEqual({
      t: "state", seq: 0, state: { taps: [0, 0] }, outcome: null, stations: [stationView("P1", "0", ""), stationView("P2", "0", "")], ms: 2,
    });
    for (let i = 1; i <= 3; i++) loop.handle(line({ t: "step", seq: i, event: { type: "tap", seat: 0, now: 100 + i, roll: null } }));
    const r = loop.handle(line({ t: "step", seq: 4, event: { type: "tick", now: 200 } }));
    expect(r).toMatchObject({ t: "state", seq: 4, state: { taps: [3, 0] }, outcome: { winner: 0 } });
  });

  it("refuses a step before start and unreadable lines", () => {
    const loop = createRunnerLoop(rules);
    expect(loop.handle(line({ t: "step", seq: 3, event: { type: "tick", now: 1 } }))).toEqual({ t: "error", seq: 3, message: "step before start" });
    expect(loop.handle("not json")).toEqual({ t: "error", seq: null, message: "unreadable request" });
    expect(loop.handle(line({ t: "start", seq: 1.5, seed: 1, now: 1 }))).toMatchObject({ t: "error", seq: null });
    expect(loop.handle(line({ t: "launch", seq: 1 }))).toMatchObject({ t: "error", seq: null });
  });

  it("reports a throw with its seq and keeps the last good state", () => {
    const loop = createRunnerLoop(rules);
    loop.handle(line({ t: "start", seq: 0, seed: 1, now: 0 }));
    loop.handle(line({ t: "step", seq: 1, event: { type: "tap", seat: 1, now: 5, roll: null } }));
    expect(loop.handle(line({ t: "step", seq: 2, event: { type: "tick", now: 666 } }))).toEqual({ t: "error", seq: 2, message: "Error: bad tick" });
    expect(loop.handle(line({ t: "step", seq: 3, event: { type: "tick", now: 7 } }))).toMatchObject({ seq: 3, state: { taps: [0, 1] } });
  });

  it("encodes one line per reply; a state JSON can't carry becomes an error line", () => {
    expect(encodeReply({ t: "ready" })).toBe('{"t":"ready"}\n');
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const text = encodeReply({ t: "state", seq: 9, state: cyclic, outcome: null, stations: [stationView("", "", ""), stationView("", "", "")], ms: 0 });
    expect(text.endsWith("\n")).toBe(true);
    expect(JSON.parse(text)).toMatchObject({ t: "error", seq: 9 });
  });

  it("knows a rules module by its four functions", () => {
    expect(isBuiltRules(rules)).toBe(true);
    expect(isBuiltRules({ start() {}, step() {}, outcome() {} })).toBe(false);
    expect(isBuiltRules(undefined)).toBe(false);
  });
});
