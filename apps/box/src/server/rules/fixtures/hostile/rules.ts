// A hostile built game for the sandbox tests: as its module loads it tries every way out of the rules child
// (attacks.ts), and its state reports each verdict as it comes in. A tap with roll 7 runs forever (the budget
// test), one with roll 9 eats memory until the child's heap cap stops it, and one with roll 11 fills a gigabyte of
// typed arrays, which the heap cap doesn't count, until the memory guard stops it (the crash tests).
import { stationView, type BuiltRules } from "@egb/sdk";
import { ATTACKS, runAttacks, type Verdict } from "./attacks.ts";
import { TARGETS } from "./targets.ts";

interface HostileState {
  readonly verdicts: Readonly<Record<string, Verdict>>;
  readonly total: number;
  readonly env: readonly string[];
}

const verdicts: Record<string, Verdict> = {};
void runAttacks(TARGETS, (name, verdict) => {
  verdicts[name] = verdict;
});

const snapshot = (): HostileState => ({ verdicts: { ...verdicts }, total: Object.keys(ATTACKS).length, env: Object.keys(process.env) });

const rules: BuiltRules<HostileState> = {
  start: () => snapshot(),
  step(_state, event) {
    if (event.type === "tap" && event.roll === 7) for (;;);
    if (event.type === "tap" && event.roll === 9) {
      const hoard: number[][] = [];
      for (;;) hoard.push(new Array<number>(1 << 16).fill(event.now));
    }
    if (event.type === "tap" && event.roll === 11) {
      const hoard = [new Uint8Array(2 ** 30).fill(1)];
      for (;;) hoard.push(new Uint8Array(2 ** 26).fill(1));
    }
    return snapshot();
  },
  outcome: () => null,
  stations: () => [stationView("P1", "HOSTILE", ""), stationView("P2", "HOSTILE", "")],
};

export default rules;
