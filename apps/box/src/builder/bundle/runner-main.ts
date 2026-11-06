// The program of a built game's rules child: bundled first into rules.js, ahead of the game's own rules, so the child
// is that one file and needs nothing on disk but itself (`node --permission --allow-fs-read=<rules.js> rules.js`).
//
// Its top level runs before the rules module is evaluated (the entry imports this first, and ES modules evaluate in
// import order). That is when stdout is taken: the protocol owns it, so anything the game prints, with console.log or
// process.stdout.write, goes to stderr instead of tearing a reply line. The jail goes first of all: it closes what
// Node's permission model leaves open (jail.ts).
import "./jail.ts";
import type { BuiltRules, RunnerReply } from "@egb/sdk";
import { createRunnerLoop, encodeReply, isBuiltRules } from "./runner-loop.ts";

const reply = process.stdout.write.bind(process.stdout);
const toStderr = (...args: unknown[]) => void process.stderr.write(`${args.map(String).join(" ")}\n`);
console.log = toStderr;
console.info = toStderr;
console.debug = toStderr;
console.warn = toStderr;
process.stdout.write = process.stderr.write.bind(process.stderr) as typeof process.stdout.write;

/** Answers requests from stdin until it closes. Sends `ready` first, unasked, once the rules have loaded. */
export function serve(rules: BuiltRules<unknown>): void {
  if (!isBuiltRules(rules)) {
    const error: RunnerReply = { t: "error", seq: null, message: "rules.ts must default-export { start, step, outcome, stations }" };
    reply(encodeReply(error));
    process.exitCode = 1;
    return;
  }
  const loop = createRunnerLoop(rules);
  reply(encodeReply({ t: "ready" }));
  let pending = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => {
    pending += chunk;
    for (let end = pending.indexOf("\n"); end >= 0; end = pending.indexOf("\n")) {
      const line = pending.slice(0, end);
      pending = pending.slice(end + 1);
      if (line.trim()) reply(encodeReply(loop.handle(line)));
    }
  });
  // The Box is gone (it closed the pipe, or died): so is the game, even if its code left a timer running.
  process.stdin.on("end", () => process.exit(0));
}
