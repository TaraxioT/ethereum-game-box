// The taps bench (plan §9): measures the ESP ↔ Pi link through a running Taps — pings, press round trips both ways,
// buzz → buzz_ok, screen → screen_ok, nfc list, the Pi's serial write → reply — plus the event loop's delay at idle
// and what parsing a line costs. Each measurement runs one at a time, so none waits behind another. It measures
// only: the caller (the server's POST /api/taps/bench, or bench-cli.ts) decides what to do with the report.
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { setTimeout as sleep } from "node:timers/promises";
import { parseEvent } from "./events.ts";
import type { ReceiverEvent, StationId } from "./lines.ts";
import type { Taps } from "./taps.ts";

export interface BenchRow {
  readonly name: string;
  readonly unit: "ms" | "µs";
  /** Samples taken, and how many of the tries got no answer. */
  readonly n: number;
  readonly failed: number;
  readonly median: number;
  readonly p95: number;
  readonly p99: number;
  readonly max: number;
  /** The plan's target for it, when it has one. */
  readonly target: string | null;
}

export interface BenchReport {
  readonly at: string;
  readonly count: number;
  readonly rows: readonly BenchRow[];
  readonly notes: readonly string[];
}

export interface BenchOptions {
  /** Samples of each (≥ 200 for the plan's numbers). Default 200. */
  readonly count?: number;
  /** How long the idle event loop is watched. Default 2000 ms. */
  readonly idleMs?: number;
}

/** Lines like the ones a game's taps produce, for the parse cost (a tap, a ping and an APDU answer). */
const SAMPLE_EVENTS: readonly ReceiverEvent[] = [
  { ev: "tap", st: "e4ba70", id: 5, uid: "04A1B2C3D4E5F6", atqa: "0044", sak: "20", ats: "78807002", read_us: 27400, gap_us: 20500, tries: 1, at_us: 4012399000 },
  { ev: "ping", st: "e4ba70", rtt_us: 2760, rssi: -37, nfc: true, s3_led: 0, c3_led: 1 },
  { ev: "nfc_res", st: "e4ba70", id: 12, op: "apdu", ok: true, err: 0, hex: "9000", us: 21500, wait_us: 12900, rtt_us: 24800, tries: 1 },
];
const PARSE_BATCHES = 40;
const PARSE_BATCH = 500;

function summarize(name: string, unit: BenchRow["unit"], values: readonly number[], failed = 0, target: string | null = null): BenchRow {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? Number.NaN;
  return { name, unit, n: sorted.length, failed, median: at(0.5), p95: at(0.95), p99: at(0.99), max: sorted.at(-1) ?? Number.NaN, target };
}

/** Runs `count` tries of `once`, one after another; null answers count as failed. */
async function repeat(count: number, once: () => Promise<number | null>): Promise<{ values: number[]; failed: number }> {
  const values: number[] = [];
  let failed = 0;
  for (let i = 0; i < count; i++) {
    const v = await once().catch(() => null);
    if (v === null) failed++;
    else values.push(v);
  }
  return { values, failed };
}

async function idleLoop(ms: number): Promise<BenchRow> {
  const h = monitorEventLoopDelay({ resolution: 1 });
  h.enable();
  await sleep(ms);
  h.disable();
  const toMs = (ns: number) => ns / 1e6;
  return {
    name: "event loop delay, idle",
    unit: "ms",
    n: h.count,
    failed: 0,
    median: toMs(h.percentile(50)),
    p95: toMs(h.percentile(95)),
    p99: toMs(h.percentile(99)),
    max: toMs(h.max),
    target: "p99 < 5",
  };
}

/** µs a line to parse the sample lines, per batch of PARSE_BATCH of each. */
function parseCost(): BenchRow {
  const lines = SAMPLE_EVENTS.map((e) => JSON.stringify(e));
  const perLine: number[] = [];
  for (let b = 0; b < PARSE_BATCHES; b++) {
    const started = performance.now();
    for (let i = 0; i < PARSE_BATCH; i++) for (const line of lines) parseEvent(line);
    perLine.push(((performance.now() - started) * 1000) / (PARSE_BATCH * lines.length));
  }
  return summarize("parse a line (tap, ping, nfc_res)", "µs", perLine, 0, "≤ 100");
}

/** Waits for `count` pings from each station (four a second each), or gives up after long enough for them. */
async function pings(taps: Taps, stations: readonly StationId[], count: number): Promise<BenchRow[]> {
  const deadline = performance.now() + (count / 4) * 1100 + 5000;
  while (performance.now() < deadline && stations.some((st) => taps.probe.pings(st).length < count)) await sleep(250);
  return stations.map((st) => summarize(`ping rtt ${st}`, "ms", taps.probe.pings(st).slice(-count).map((us) => us / 1000), 0, "median ≤ 3.1"));
}

export async function runBench(taps: Taps, opts: BenchOptions = {}): Promise<BenchReport> {
  const count = opts.count ?? 200;
  const rows: BenchRow[] = [];
  const notes: string[] = [];
  const before = taps.stats().receiver;
  rows.push(await idleLoop(opts.idleMs ?? 2000));
  rows.push(parseCost());

  const stations = taps.probe.linked();
  if (stations.length === 0) notes.push("No station is linked: only the Pi side was measured.");

  // A press with no station linked waits out the receiver's 25 sends: only press when one can answer.
  const press = { rtt: [] as number[], echo: [] as number[], ack: [] as number[], failed: 0 };
  for (let i = 0; i < (stations.length > 0 ? count : 0); i++) {
    const r = await taps.probe.press();
    if (r.echoMs !== null) press.echo.push(r.echoMs);
    if (r.rttUs === null) press.failed++;
    else {
      press.rtt.push(r.rttUs / 1000);
      press.ack.push(r.ackMs);
    }
  }
  if (stations.length > 0) {
    rows.push(summarize("serial write → reply (press → c3_press)", "ms", press.echo, count - press.echo.length));
    rows.push(summarize("press c3 → s3 (receiver round trip)", "ms", press.rtt, press.failed, "median ≤ 2.4–2.8"));
    rows.push(summarize("press c3 → s3 (Pi write → ack)", "ms", press.ack, press.failed));
  }

  for (const st of stations) {
    const reports = taps.probe.reports(st).slice(-count).map((us) => us / 1000);
    if (reports.length > 0) rows.push(summarize(`press s3 → c3 ${st} (station round trip)`, "ms", reports, 0, "median ≤ 2.8"));
    if (reports.length < count) notes.push(`${st}: ${reports.length} station presses seen; press its BOOT for the s3 → c3 numbers.`);
  }

  for (const st of stations) {
    const buzz = await repeat(count, async () => {
      const a = await taps.probe.buzz(st);
      return a.event?.ev === "buzz_ok" ? a.event.rtt_us / 1000 : null;
    });
    rows.push(summarize(`buzz → buzz_ok ${st} (radio round trip)`, "ms", buzz.values, buzz.failed, "median ≤ 3"));
    const screen = await repeat(count, async () => {
      const a = await taps.probe.screen(st);
      return a.event?.ev === "screen_ok" ? a.event.rtt_us / 1000 : null;
    });
    rows.push(summarize(`screen → screen_ok ${st} (radio round trip)`, "ms", screen.values, screen.failed, "median ≤ 3"));
    const list = await repeat(count, async () => (await taps.probe.list(st)).piMs);
    rows.push(summarize(`nfc list ${st} (Pi round trip)`, "ms", list.values, list.failed, "~35"));
  }

  rows.push(...(await pings(taps, stations, count)));
  // The live cost over the bench's own lines: scan, decode and parse, on a warmed-up server.
  const after = taps.stats().receiver;
  const lines = after.lines - before.lines;
  const liveUs = lines > 0 ? (after.parseUsPerLine * after.lines - before.parseUsPerLine * before.lines) / lines : 0;
  notes.push(`Live scan and parse: ${liveUs.toFixed(2)} µs a line over the bench's ${lines} lines (binary framing only if > 100 µs).`);
  const dropped = Object.entries(after.dropped).filter(([, n]) => n > 0);
  if (dropped.length) notes.push(`Dropped lines: ${dropped.map(([why, n]) => `${why} ${n}`).join(", ")}.`);
  return { at: new Date().toISOString(), count, rows, notes };
}

/** The report as a plain-text table. */
export function formatReport(report: BenchReport): string {
  const head = ["", "unit", "n", "failed", "median", "p95", "p99", "max", "target"];
  const num = (v: number) => (Number.isNaN(v) ? "-" : v < 10 ? v.toFixed(3) : v.toFixed(1));
  const body = report.rows.map((r) => [r.name, r.unit, String(r.n), String(r.failed), num(r.median), num(r.p95), num(r.p99), num(r.max), r.target ?? ""]);
  const widths = head.map((h, i) => Math.max(h.length, ...body.map((row) => row[i]!.length)));
  const line = (cells: string[]) => cells.map((c, i) => (i === 0 ? c.padEnd(widths[i]!) : c.padStart(widths[i]!))).join("  ").trimEnd();
  return [`taps bench, ${report.at}, ${report.count} each`, "", line(head), ...body.map(line), "", ...report.notes].join("\n");
}
