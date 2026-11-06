import { appendFile, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Transcript } from "@egb/sdk";
import { createSessionLog, dayOf } from "./sessions.ts";

const A = `0x${"aa".repeat(20)}`;
const B = `0x${"bb".repeat(20)}`;
const C = `0x${"cc".repeat(20)}`;
const END = Date.parse("2026-11-06T15:00:00Z");

function transcript(winner: 0 | 1 | null, patch: Partial<Transcript> = {}): Transcript {
  return {
    v: 1, match: 1, game: "quick-draw", seed: 7, badges: [A, B], stake: 10, startedAt: END - 20_000, endedAt: END,
    taps: [{ seat: 0, at: END - 1_000, roll: null, accepted: true }], result: { winner }, counts: true, ...patch,
  };
}

let dir = "";
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "egb-sessions-"));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe("the session log", () => {
  it("reads back a match of four, and counts those four as one group", async () => {
    const D = `0x${"dd".repeat(20)}`;
    const log = createSessionLog(dir, () => {});
    log.record(transcript(null, { badges: [A, B, C, D], result: { winner: null } }));
    await log.flush();
    const again = createSessionLog(dir, () => {});
    await again.load();
    expect(again.records()[D]).toEqual({ wins: 0, losses: 0, draws: 1 });
    expect(again.countedSince([D, C, B, A], END - 1)).toBe(1);
    expect(again.countedSince([A, B], END - 1)).toBe(0);
  });

  it("writes one line per match into the day's file, and rebuilds the records from it at start", async () => {
    const log = createSessionLog(dir, () => {});
    log.record(transcript(0));
    log.record(transcript(null, { endedAt: END + 1 }));
    log.record(transcript(1, { badges: [C, A], endedAt: END + 2 }));
    log.record(transcript(1, { counts: false, endedAt: END + 3 }));
    await log.flush();
    expect(await readdir(join(dir, "sessions"))).toEqual([`${dayOf(END)}.jsonl`]);
    const lines = (await readFile(join(dir, "sessions", `${dayOf(END)}.jsonl`), "utf8")).trim().split("\n");
    expect(lines).toHaveLength(4);
    expect(JSON.parse(lines[0] ?? "")).toEqual(transcript(0));

    // A line torn by a power cut is skipped.
    await appendFile(join(dir, "sessions", `${dayOf(END)}.jsonl`), '{"v":1,"match":');
    const again = createSessionLog(dir, () => {});
    const expected = { [A]: { wins: 2, losses: 0, draws: 1 }, [B]: { wins: 0, losses: 1, draws: 1 }, [C]: { wins: 0, losses: 1, draws: 0 } };
    expect(again.records()).toEqual({});
    await again.load();
    expect(again.records()).toEqual(expected);
    expect(log.records()).toEqual(expected);
  });

  it("starts a new line after a torn one, so the next transcript isn't lost with it", async () => {
    const file = join(dir, "sessions", `${dayOf(END)}.jsonl`);
    const first = createSessionLog(dir, () => {});
    await first.load();
    first.record(transcript(0));
    await first.flush();
    await appendFile(file, '{"v":1,"match":');

    const second = createSessionLog(dir, () => {});
    await second.load();
    second.record(transcript(1, { endedAt: END + 1 }));
    await second.flush();
    const lines = (await readFile(file, "utf8")).split("\n");
    expect(lines).toHaveLength(4);
    expect(JSON.parse(lines[2] ?? "")).toEqual(transcript(1, { endedAt: END + 1 }));

    const third = createSessionLog(dir, () => {});
    await third.load();
    expect(third.records()).toEqual({ [A]: { wins: 1, losses: 1, draws: 0 }, [B]: { wins: 1, losses: 1, draws: 0 } });
  });

  it("counts a match recorded before the log was read back once, not twice", async () => {
    const first = createSessionLog(dir, () => {});
    first.record(transcript(0));
    await first.flush();

    const second = createSessionLog(dir, () => {});
    second.record(transcript(1, { endedAt: END + 1 }));
    await second.load();
    await second.flush();
    expect(second.records()).toEqual({ [A]: { wins: 1, losses: 1, draws: 0 }, [B]: { wins: 1, losses: 1, draws: 0 } });
    expect(second.countedSince([A, B], 0)).toBe(2);
  });

  it("counts a pair's counted results since a time, in either seat order", async () => {
    const log = createSessionLog(dir, () => {});
    log.record(transcript(0, { endedAt: END - 7_200_000 }));
    log.record(transcript(0));
    log.record(transcript(1, { badges: [B, A], endedAt: END + 10 }));
    log.record(transcript(1, { counts: false, endedAt: END + 20 }));
    expect(log.countedSince([A, B], END - 3_600_000)).toBe(2);
    expect(log.countedSince([B, A], 0)).toBe(3);
    expect(log.countedSince([A, C], 0)).toBe(0);
    await log.flush();
  });
});
