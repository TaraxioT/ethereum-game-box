import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { systemClock } from "../core/system-clock.ts";
import { formatReport, runBench } from "./bench.ts";
import { createTaps } from "./taps.ts";

it("measures every hop through a running Taps and prints a table", async () => {
  const taps = createTaps({
    receiver: "fake",
    stations: ["e4ba70", "df3d88"],
    dataDir: mkdtempSync(join(tmpdir(), "egb-bench-")),
    clock: systemClock(),
    plan: () => "none",
    onTap: () => {},
    log: () => {},
    fake: { timeScale: 0.1 },
  });
  try {
    await new Promise((r) => setTimeout(r, 50));
    const report = await runBench(taps, { count: 4, idleMs: 20 });
    const names = report.rows.map((r) => r.name);
    for (const part of ["event loop", "parse", "serial write", "press c3", "buzz", "screen", "nfc list", "ping"]) {
      expect(names.some((n) => n.includes(part))).toBe(true);
    }
    for (const row of report.rows.filter((r) => !r.name.startsWith("event loop") && !r.name.startsWith("parse"))) {
      expect(row).toMatchObject({ n: 4, failed: 0 });
    }
    expect(formatReport(report)).toContain("nfc list e4ba70");
  } finally {
    await taps.close();
  }
}, 15_000);
