// Runs a built rules.js the way the Box's rules runner will (its own child, Node's permission model, reading only
// itself) and plays a short scripted match through the runner protocol: start, a tick, a tap from each seat, a late
// tick. A bundle that type-checks can still throw on its first step, print to stdout, or show a station line too
// long for the OLED; this catches that before the game is installed, and tells the agent in words it can fix.
import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { BIG_CHARS, SMALL_CHARS, TAG_CHARS, type BuiltEvent, type RunnerReply, type TapNeed } from "@egb/sdk";

/**
 * The rules child's whole command line after `node`: it may read its own file and nothing else. The path is made real
 * first: Node checks the permission against the file's real path, so a symlink anywhere above it would lock the child
 * out of its own program.
 */
export function rulesChildArgs(rulesJs: string): string[] {
  const real = realpathSync(rulesJs);
  return ["--permission", `--allow-fs-read=${real}`, real];
}

/** Start-up plus five replies, on a Pi busy with a build. A hung loop fails here instead of hanging the build. */
const CHECK_TIMEOUT_MS = 8_000;
const PRINTABLE = /^[\x20-\x7e]*$/;

/** What's wrong with a stations(state) value, in words for the agent. Empty when both views fit a station. */
export function stationProblems(value: unknown): string[] {
  if (!Array.isArray(value) || value.length !== 2) return ["stations(state) must return two views: [Player 1's, Player 2's]"];
  const problems: string[] = [];
  value.forEach((view: unknown, seat) => {
    const name = `stations(state)[${seat}]`;
    if (typeof view !== "object" || view === null) return void problems.push(`${name} must be a StationView object`);
    const v = view as Record<string, unknown>;
    for (const [key, max] of [["tag", TAG_CHARS], ["big", BIG_CHARS], ["small", SMALL_CHARS]] as const) {
      const text = v[key];
      if (typeof text !== "string") problems.push(`${name}.${key} must be a string`);
      else if (text.length > max || !PRINTABLE.test(text)) problems.push(`${name}.${key} "${text.slice(0, 24)}" must be at most ${max} printable ASCII characters (build views with stationView from @egb/sdk)`);
    }
    for (const key of ["hold", "sign", "done", "fail"] as const) {
      const text = v[key];
      if (text === undefined) continue;
      if (typeof text !== "string" || text.length > BIG_CHARS + 1 + SMALL_CHARS || !PRINTABLE.test(text)) {
        problems.push(`${name}.${key} must be "BIG|small" text (at most ${BIG_CHARS} and ${SMALL_CHARS} printable characters)`);
      }
    }
  });
  return problems;
}

function outcomeProblem(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value === "object" && value !== null && [0, 1, null].includes((value as { winner?: unknown }).winner as number | null)) return null;
  return "outcome(state) must return null while the game runs, or { winner: 0 | 1 | null }";
}

/** The scripted match: what each request is, for the error lines. */
function script(taps: TapNeed, now: number): { label: string; line: object }[] {
  const roll = (n: number) => (taps === "random" ? n : null);
  const steps: { label: string; event: BuiltEvent }[] = [
    { label: "a tick", event: { type: "tick", now: now + 500 } },
    { label: "Player 1's tap", event: { type: "tap", seat: 0, now: now + 1_200, roll: roll(0x9e3779b9) } },
    { label: "Player 2's tap", event: { type: "tap", seat: 1, now: now + 1_450, roll: roll(0x7f4a7c15) } },
    { label: "a tick 30 s later", event: { type: "tick", now: now + 30_000 } },
  ];
  return [
    { label: "start", line: { t: "start", seq: 0, seed: 0x2545f491, now } },
    ...steps.map((s, i) => ({ label: `step (${s.label})`, line: { t: "step", seq: i + 1, event: s.event } })),
  ];
}

/** Plays the scripted match against `rulesJs`. Empty when every reply was a good state. */
export function checkRulesBundle(rulesJs: string, taps: TapNeed, now = Date.now()): Promise<string[]> {
  const requests = script(taps, now);
  return new Promise((resolve) => {
    const child = spawn(process.execPath, rulesChildArgs(rulesJs), { stdio: ["pipe", "pipe", "pipe"], env: {} });
    const problems: string[] = [];
    let stdout = "";
    let stderr = "";
    let ready = false;
    let answered = 0;
    let settled = false;
    const finish = (extra?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill("SIGKILL");
      if (extra) problems.push(extra);
      resolve(problems);
    };
    const timer = setTimeout(() => finish(`rules.js didn't answer within ${CHECK_TIMEOUT_MS / 1000} s (${ready ? `stuck on the ${requests[answered]?.label ?? "last request"}` : "it never said ready"})`), CHECK_TIMEOUT_MS);

    const onReply = (reply: RunnerReply) => {
      if (reply.t === "ready") {
        ready = true;
        for (const r of requests) child.stdin.write(`${JSON.stringify(r.line)}\n`);
        return;
      }
      const label = requests[answered]?.label ?? "an extra reply";
      if (reply.t === "error") return finish(`rules.${label.startsWith("start") ? "start" : "step"} threw on ${label}: ${reply.message}`);
      if (reply.seq !== answered) return finish(`rules.js answered out of order (expected ${answered}, got ${reply.seq})`);
      problems.push(...stationProblems(reply.stations).map((p) => `after ${label}: ${p}`));
      const outcome = outcomeProblem(reply.outcome);
      if (outcome) problems.push(`after ${label}: ${outcome}`);
      answered++;
      if (problems.length > 0 || answered === requests.length) finish();
    };

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      for (let end = stdout.indexOf("\n"); end >= 0 && !settled; end = stdout.indexOf("\n")) {
        const line = stdout.slice(0, end);
        stdout = stdout.slice(end + 1);
        let reply: RunnerReply;
        try {
          reply = JSON.parse(line) as RunnerReply;
        } catch {
          return finish(`rules.js wrote something that isn't a protocol reply: ${line.slice(0, 80)}`);
        }
        onReply(reply);
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-2_000);
    });
    child.on("error", (err) => finish(`couldn't start rules.js: ${err.message}`));
    child.on("exit", (code) => {
      const why = stderr.split("\n").map((l) => l.trim()).find((l) => /Error|error:/.test(l)) ?? stderr.trim().split("\n")[0] ?? "";
      finish(`rules.js stopped (exit ${code}) before answering every request${why ? `: ${why.slice(0, 200)}` : ""}`);
    });
  });
}
