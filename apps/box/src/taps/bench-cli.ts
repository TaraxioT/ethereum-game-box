// `pnpm taps:bench`: the taps bench on the Pi. The Box server owns the receiver's port, so by default this asks the
// running server to run it (POST /api/taps/bench on its port) and prints the table. With the server stopped,
// `--direct` opens the port itself (EGB_RECEIVER's, or the path given). Settings come from the server's env files.
//
//   pnpm taps:bench [--count 200]
//   pnpm taps:bench --direct [auto|fake|/dev/serial/by-id/…] [--count 200]
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";
import { monotonicClock } from "../core/system-clock.ts";
import { loadEnv } from "../server/env.ts";
import { readSettings, type Settings } from "../server/settings.ts";
import { formatReport, runBench, type BenchReport } from "./bench.ts";
import { createTaps } from "./taps.ts";

/** How long a direct run waits for the port and a station's first ping. */
const READY_MS = 5000;

async function viaServer(settings: Settings, count: number): Promise<BenchReport> {
  const origin = `http://127.0.0.1:${settings.port}`;
  const res = await fetch(`${origin}/api/taps/bench`, {
    method: "POST",
    // The server takes non-GET requests from its own origin only.
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ count }),
  }).catch((e: unknown) => {
    throw new Error(`no Box server on ${origin} (${e instanceof Error ? e.message : String(e)}); with it stopped, use --direct`);
  });
  if (!res.ok) throw new Error(`the Box server answered ${res.status}: ${await res.text()}`);
  return (await res.json()) as BenchReport;
}

async function direct(settings: Settings, receiver: string, count: number): Promise<BenchReport> {
  const taps = createTaps({
    receiver,
    stations: settings.stations,
    dataDir: settings.dataDir,
    clock: monotonicClock(),
    plan: () => "none",
    onTap: () => {},
    log: () => {},
  });
  try {
    const deadline = Date.now() + READY_MS;
    while (Date.now() < deadline && taps.probe.linked().length === 0) await sleep(100);
    const status = taps.status().receiver;
    if (!status.open) throw new Error(`the receiver didn't open (${status.lastError ?? "no reason given"}); is the Box server holding it?`);
    return await runBench(taps, { count });
  } finally {
    await taps.close();
  }
}

const { values } = parseArgs({
  options: {
    count: { type: "string", default: "200" },
    // `--direct` alone takes EGB_RECEIVER's port; `--direct=<path|auto|fake>` names one.
    direct: { type: "string" },
  },
  allowNegative: false,
  strict: true,
});
const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
loadEnv(process.env, homedir(), repoRoot);
const settings = readSettings(process.env, homedir(), repoRoot);
const count = Number(values.count);
if (!Number.isInteger(count) || count < 1) throw new Error("--count takes a whole number");
try {
  let report: BenchReport;
  if (values.direct === undefined) {
    report = await viaServer(settings, count);
  } else {
    const configured = settings.receiver.kind === "serial" ? settings.receiver.path : settings.receiver.kind;
    const receiver = values.direct || configured;
    if (receiver === "none") throw new Error("EGB_RECEIVER is none: name a port, e.g. --direct=auto");
    report = await direct(settings, receiver, count);
  }
  console.log(formatReport(report));
} catch (e) {
  console.error(`taps bench: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
}
