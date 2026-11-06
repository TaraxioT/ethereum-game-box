// @vitest-environment happy-dom
// Tap Rush, the sample: its folder packs, its instructions come out right worked by hand, and its page runs the race.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { packBundle, readBundle } from "../../src/bundle/index.ts";
import { logProblems, type LogEntry, type MatchLog } from "../../src/match-log.ts";

const folder = path.join(import.meta.dirname, "../../../../apps/store/sample/tap-rush/");
const files = () => new Map(readdirSync(folder).map((name): [string, Uint8Array] => [name, readFileSync(folder + name)]));

describe("Tap Rush's folder", () => {
  it("packs to one hash, every time", async () => {
    const first = await readBundle(packBundle(files()));
    const second = await readBundle(packBundle(files()));
    expect(first.hash).toBe(second.hash);
    expect([...first.files.keys()]).toEqual(["index.html", "manifest.json"]);
  });

  it("says what the plan says", async () => {
    const { manifest } = await readBundle(packBundle(files()));
    expect(manifest).toMatchObject({ format: 1, id: "tap-rush", title: "Tap Rush", players: { min: 2, max: 4 }, minutes: 1, stakes: [5, 10, 25], taps: "identify" });
  });
});

const PLAYERS = [`0x${"aa".repeat(20)}`, `0x${"bb".repeat(20)}`, `0x${"cc".repeat(20)}`, `0x${"dd".repeat(20)}`] as const;
const START = 1_800_000_000_000;

const tap = (seat: number, ms: number): LogEntry => ({ src: "box", t: "tap", seat, at: START + ms, roll: null });
const claim = (data: unknown): LogEntry => ({ src: "game", t: "event", at: START + 10_500, name: "score", data });

function matchLog(players: number, amount: string, entries: readonly LogEntry[]): MatchLog {
  return {
    header: { v: 1, box: "mumbai-01", round: "7", bundle: `0x${"ab".repeat(32)}`, game: "tap-rush", players: PLAYERS.slice(0, players), amount, startedAt: START },
    entries: [...entries, { src: "box", t: "end", at: START + 11_000, why: "game" }],
  };
}

/** The manifest's instructions, step by step, as a person would follow them. */
function judgeByHand({ header, entries }: MatchLog): string[] {
  const taps = entries.filter((e) => e.src === "box" && e.t === "tap");
  const clock = Math.min(...taps.map((t) => t.at));
  const counted = taps.filter((t) => t.at - clock < 10_000);
  const counts = header.players.map((_, seat) => counted.filter((t) => t.seat === seat).length);
  const pot = BigInt(header.amount) * BigInt(header.players.length);
  const most = Math.max(...counts);
  const tied = counts.flatMap((count, seat) => (count === most ? [seat] : []));
  const share = pot / BigInt(tied.length);
  const spare = Number(pot % BigInt(tied.length));
  return counts.map((_, seat) => {
    const place = tied.indexOf(seat);
    if (place < 0) return "0";
    return String(share + (place < spare ? 1n : 0n));
  });
}

describe("Tap Rush's instructions, worked by hand", () => {
  it.each<[string, MatchLog, readonly string[]]>([
    ["most taps takes the pot", matchLog(2, "5000000", [tap(0, 0), tap(1, 100), tap(0, 200), tap(0, 300)]), ["10000000", "0"]],
    ["it doesn't matter who tapped first", matchLog(2, "5000000", [tap(0, 0), tap(1, 100), tap(1, 200)]), ["0", "10000000"]],
    ["a tie splits evenly", matchLog(2, "5000000", [tap(0, 0), tap(1, 100)]), ["5000000", "5000000"]],
    ["only the tied seats share", matchLog(4, "5000000", [tap(0, 0), tap(0, 1), tap(1, 2), tap(3, 3), tap(3, 4)]), ["10000000", "0", "0", "10000000"]],
    ["a remainder goes from the lowest seat up", matchLog(4, "5000000", [tap(1, 0), tap(2, 1), tap(3, 2)]), ["0", "6666667", "6666667", "6666666"]],
    ["no taps gives every stake back", matchLog(3, "5000000", []), ["5000000", "5000000", "5000000"]],
    ["a tap at 9999 ms counts", matchLog(2, "5000000", [tap(0, 0), tap(1, 100), tap(1, 9_999)]), ["0", "10000000"]],
    ["a tap at 10000 ms doesn't", matchLog(2, "5000000", [tap(0, 0), tap(1, 100), tap(1, 10_000), tap(1, 10_400)]), ["5000000", "5000000"]],
    ["the clock is the earliest touch, not the first line", matchLog(2, "5000000", [tap(1, 200), tap(0, 100), tap(0, 10_150)]), ["5000000", "5000000"]],
    ["a touch time can be fractional", matchLog(2, "5000000", [tap(0, 0.25), tap(1, 1.5), tap(1, 10_000.24)]), ["0", "10000000"]],
    ["a game's claim counts for nothing", matchLog(2, "5000000", [tap(0, 0), tap(0, 1), tap(1, 2), claim({ counts: [0, 999] })]), ["10000000", "0"]],
    ["the claim of a game that names itself the Box counts for nothing", matchLog(2, "5000000", [tap(0, 0), tap(0, 1), claim({ src: "box", t: "tap", seat: 1 })]), ["10000000", "0"]],
  ])("%s", (_, log, payouts) => {
    expect(logProblems(log)).toEqual([]);
    expect(judgeByHand(log)).toEqual(payouts);
    expect(payouts.reduce((sum, p) => sum + BigInt(p), 0n)).toBe(BigInt(log.header.amount) * BigInt(log.header.players.length));
  });
});

describe("Tap Rush's page", () => {
  const html = readFileSync(`${folder}index.html`, "utf8");
  const script = /<script>([\s\S]*)<\/script>/.exec(html)?.[1] as string;
  const body = /<body>([\s\S]*?)<script>/.exec(html)?.[1] as string;
  let tapped: (tap: { seat: number }) => void;
  const egb = { players: [] as unknown[], onTap: (fn: typeof tapped) => void (tapped = fn), event: vi.fn(), station: vi.fn(), buzz: vi.fn(), end: vi.fn() };

  function load(seats: number) {
    document.body.innerHTML = body;
    egb.players = Array.from({ length: seats }, () => ({}));
    Object.assign(window, { egb });
    new Function(script)();
  }
  const shown = () => [...document.querySelectorAll(".count")].map((count) => count.textContent);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([2, 3, 4])("draws a lane for each of %i seats and waits", (seats) => {
    load(seats);
    expect(shown()).toEqual(Array.from({ length: seats }, () => "0"));
    expect(document.getElementById("clock")?.textContent).toBe("TAP!");
    expect(egb.station.mock.calls).toEqual(Array.from({ length: seats }, (_, seat) => [seat, "TAP!"]));
    vi.advanceTimersByTime(60_000);
    expect(egb.end).not.toHaveBeenCalled();
  });

  it("starts on the first tap, counts for ten seconds, and leaves the match open a moment more", () => {
    load(2);
    tapped({ seat: 1 });
    vi.advanceTimersByTime(4_000);
    expect(document.getElementById("clock")?.textContent).toBe("6.0");
    tapped({ seat: 0 });
    tapped({ seat: 1 });
    expect(shown()).toEqual(["1", "2"]);
    expect(egb.station).toHaveBeenLastCalledWith(1, "2");
    vi.advanceTimersByTime(6_000);
    expect(document.getElementById("clock")?.textContent).toBe("TIME");
    expect(egb.event.mock.calls).toEqual([["score", { counts: [1, 2] }]]);
    expect(egb.station).toHaveBeenCalledWith(0, "TIME 1");
    expect(egb.station).toHaveBeenCalledWith(1, "TIME 2");
    expect(egb.buzz.mock.calls).toEqual([[0], [1]]);
    tapped({ seat: 0 });
    expect(shown()).toEqual(["1", "2"]);
    expect(egb.end).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(egb.end).toHaveBeenCalledOnce();
  });
});
