// The attacks with no jail and no runner: bundled alone by the sandbox test and run with the rules child's exact
// flags, to show what Node's permission model refuses by itself. Targets come as JSON in argv; the verdicts go to
// stdout as one JSON object.
import { runAttacks, type Verdict } from "./hostile/attacks.ts";
import type { Targets } from "./hostile/targets.ts";

const verdicts: Record<string, Verdict> = {};
await runAttacks(JSON.parse(process.argv[2] ?? "{}") as Targets, (name, verdict) => {
  verdicts[name] = verdict;
});
process.stdout.write(`${JSON.stringify({ verdicts, env: Object.keys(process.env) })}\n`);
process.exit(0);
