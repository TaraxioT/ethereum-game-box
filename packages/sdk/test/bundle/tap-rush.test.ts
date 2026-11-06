// @vitest-environment happy-dom
// Tap Rush, the sample: its folder packs, its instructions come out right worked by hand, and its page runs the race.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { packBundle, readBundle } from "../../src/bundle/index.ts";
import { logProblems, type LogEntry, type MatchLog } from "../../src/match-log.ts";

const folder = path.join(import.meta.dirname, "../../../../apps/store/sample/tap-rush/");
const files = () => new Map(readdirSync(folder).map((name): [string, Uint8Array] => [name, readFileSync(folder + name)]));

/**
 * The manifest's instructions to the letter, sentence by sentence. They decide the money, and `judgeByHand` below
 * follows them in this order, so changing a word here means working every row by hand again.
 */
const INSTRUCTIONS = [
  'Use only the log\'s entries with src "box": its taps, with t "tap", and its one end, with t "end".',
  'Ignore every entry with src "game": a game can claim anything.',
  'If the end\'s why is "lost", the verdict is cannot_judge.',
  "The clock starts at the earliest tap's at.",
  "If there are taps and the end's at is less than 10000 ms after the clock, the race was cut short and the verdict is cannot_judge.",
  "A tap counts only if its at is less than 10000 ms after the clock.",
  "Count each seat's taps.",
  "The pot is the header's amount times the number of players, in base units.",
  "The seat with the most taps gets the whole pot and the others get 0.",
  "If seats tie for the most, split the pot evenly between them in whole base units, give any remainder one unit at a time to the tied seats from the lowest seat up, and give the others 0.",
  "A match with no taps is a tie between every seat.",
].join(" ");

describe("Tap Rush's folder", () => {
  it("packs to one hash, every time", async () => {
    const first = await readBundle(packBundle(files()));
    const second = await readBundle(packBundle(files()));
    expect(first.hash).toBe(second.hash);
    expect([...first.files.keys()]).toEqual(["index.html", "manifest.json"]);
  });

  it("says what the plan says, and the instructions word for word", async () => {
    const { manifest } = await readBundle(packBundle(files()));
    expect(manifest).toEqual({
      format: 1,
      id: "tap-rush",
      title: "Tap Rush",
      blurb: "Most taps in ten seconds takes the pot.",
      players: { min: 2, max: 4 },
      minutes: 1,
      stakes: [5, 10, 25],
      taps: "identify",
      verifier: { instructions: INSTRUCTIONS },
    });
  });
});

const PLAYERS = [`0x${"aa".repeat(20)}`, `0x${"bb".repeat(20)}`, `0x${"cc".repeat(20)}`, `0x${"dd".repeat(20)}`] as const;
const START = 1_800_000_000_000;

type End = Extract<LogEntry, { t: "end" }>;

const tap = (seat: number, ms: number): LogEntry => ({ src: "box", t: "tap", seat, at: START + ms, roll: null });
const claim = (data: unknown): LogEntry => ({ src: "game", t: "event", at: START + 10_500, name: "score", data });
const closed = (ms: number, why: End["why"]): End => ({ src: "box", t: "end", at: START + ms, why });

function matchLog(players: number, amount: string, entries: readonly LogEntry[], end: End = closed(11_000, "game")): MatchLog {
  return {
    header: { v: 1, box: "mumbai-01", round: "7", bundle: `0x${"ab".repeat(32)}`, game: "tap-rush", players: PLAYERS.slice(0, players), amount, startedAt: START },
    entries: [...entries, end],
  };
}

/** `INSTRUCTIONS`, step by step, as a person would follow them. */
function judgeByHand({ header, entries }: MatchLog): readonly string[] | "cannot_judge" {
  const end = entries.at(-1) as End;
  if (end.why === "lost") return "cannot_judge";
  const taps = entries.filter((e) => e.src === "box" && e.t === "tap");
  const clock = Math.min(...taps.map((t) => t.at));
  if (taps.length > 0 && end.at - clock < 10_000) return "cannot_judge";
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
    ["a close at exactly ten seconds is a whole race", matchLog(2, "5000000", [tap(0, 0), tap(0, 1), tap(1, 2)], closed(10_000, "game")), ["10000000", "0"]],
    ["the time limit closing a whole race changes nothing", matchLog(2, "5000000", [tap(0, 49_500), tap(0, 49_600), tap(1, 49_700)], closed(60_000, "time")), ["10000000", "0"]],
    ["no taps by the time limit gives every stake back", matchLog(2, "5000000", [], closed(60_000, "time")), ["5000000", "5000000"]],
  ])("%s", (_, log, payouts) => {
    expect(logProblems(log)).toEqual([]);
    expect(judgeByHand(log)).toEqual(payouts);
    expect(payouts.reduce((sum, p) => sum + BigInt(p), 0n)).toBe(BigInt(log.header.amount) * BigInt(log.header.players.length));
  });

  it.each<[string, MatchLog]>([
    ["the frame lost mid-race with one seat ahead", matchLog(2, "5000000", [tap(0, 0), tap(0, 100), tap(1, 150)], closed(400, "lost"))],
    ["the frame lost before any tap", matchLog(2, "5000000", [], closed(3_000, "lost"))],
    ["the frame lost in the moment after the race", matchLog(2, "5000000", [tap(0, 0), tap(0, 100), tap(1, 150)], closed(10_500, "lost"))],
    ["a page that closes the race 50 ms in", matchLog(2, "5000000", [tap(0, 0)], closed(50, "game"))],
    ["a page that closes the race 1 ms short", matchLog(2, "5000000", [tap(0, 0), tap(1, 1)], closed(9_999, "game"))],
    ["a first tap 100 ms before the time limit", matchLog(2, "5000000", [tap(0, 59_900)], closed(60_000, "time"))],
  ])("can't judge %s, so each stake goes back", (_, log) => {
    expect(logProblems(log)).toEqual([]);
    expect(judgeByHand(log)).toBe("cannot_judge");
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
