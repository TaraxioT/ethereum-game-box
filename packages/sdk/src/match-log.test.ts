import { describe, expect, it } from "vitest";
import { LOG_LIMITS, logProblems, logTextProblems, type LogEntry, type LogHeader, type MatchLog } from "./match-log.ts";

const A = "0x00000000000000000000000000000000000000aa";
const B = "0x00000000000000000000000000000000000000bb";
const C = "0x00000000000000000000000000000000000000cc";
const D = "0x00000000000000000000000000000000000000dd";
const MAX_UINT256 = (2n ** 256n - 1n).toString();

const header: LogHeader = {
  v: 1,
  box: "mumbai-01",
  round: "7",
  bundle: `0x${"ab".repeat(32)}`,
  game: "tap-rush",
  players: [A, B],
  amount: "5000000",
  startedAt: 1_800_000_000_000,
};

const tap: LogEntry = { src: "box", t: "tap", seat: 0, at: 1_800_000_001_000.25, roll: null };
const event: LogEntry = { src: "game", t: "event", at: 1_800_000_002_000, name: "score", data: { counts: [1, 0] } };
const end: LogEntry = { src: "box", t: "end", at: 1_800_000_011_000, why: "game" };
const log: MatchLog = { header, entries: [tap, event, end] };

const withHeader = (over: object) => ({ header: { ...header, ...over }, entries: log.entries });
const withEntry = (entry: object) => ({ header, entries: [entry, end] });

describe("logProblems", () => {
  it("takes a good log", () => {
    expect(logProblems(log)).toEqual([]);
  });

  it("takes a log straight from its JSON text", () => {
    expect(logProblems(JSON.parse(JSON.stringify(log)))).toEqual([]);
  });

  it("takes a log with only its end", () => {
    expect(logProblems({ header, entries: [end] })).toEqual([]);
  });

  it("takes 2, 3 and 4 players, and the highest round", () => {
    expect(logProblems(withHeader({ players: [A, B, C] }))).toEqual([]);
    expect(logProblems(withHeader({ players: [A, B, C, D] }))).toEqual([]);
    expect(logProblems(withHeader({ round: MAX_UINT256, amount: MAX_UINT256 }))).toEqual([]);
  });

  it("takes each seat at the table, a uint32 roll, and any closing reason", () => {
    const four = { ...header, players: [A, B, C, D] };
    expect(logProblems({ header: four, entries: [{ ...tap, seat: 3 }, end] })).toEqual([]);
    expect(logProblems(withEntry({ ...tap, roll: 0xffffffff }))).toEqual([]);
    expect(logProblems({ header, entries: [{ ...end, why: "time" }] })).toEqual([]);
    expect(logProblems({ header, entries: [{ ...end, why: "lost" }] })).toEqual([]);
  });

  it("takes every limit exactly", () => {
    const fill = Array.from({ length: LOG_LIMITS.entries - 1 }, () => tap);
    expect(logProblems({ header, entries: [...fill, end] })).toEqual([]);
    expect(logProblems(withEntry({ ...event, name: "n".repeat(LOG_LIMITS.eventName) }))).toEqual([]);
    expect(logProblems(withEntry({ ...event, data: "x".repeat(LOG_LIMITS.eventDataBytes - 2) }))).toEqual([]);
  });

  it.each<[string, unknown, RegExp]>([
    ["null", null, /not an object/],
    ["a list", [], /not an object/],
    ["a string", "log", /not an object/],
    ["a stray field", { ...log, extra: 1 }, /stray field/],
    ["no header", { entries: log.entries }, /header is not an object/],
    ["a stray header field", withHeader({ winner: 0 }), /header has a stray field/],
    ["another version", withHeader({ v: 2 }), /header.v/],
    ["no box", withHeader({ box: "" }), /header.box/],
    ["a box in capitals", withHeader({ box: "MUMBAI-01" }), /header.box/],
    ["a round that's a number", withHeader({ round: 7 }), /header.round/],
    ["a hex round", withHeader({ round: "0x7" }), /header.round/],
    ["a round with a leading zero", withHeader({ round: "07" }), /header.round/],
    ["a negative round", withHeader({ round: "-1" }), /header.round/],
    ["a round past uint256", withHeader({ round: (2n ** 256n).toString() }), /header.round/],
    ["a bundle that's short", withHeader({ bundle: "0xabcd" }), /header.bundle/],
    ["a bundle in capitals", withHeader({ bundle: `0x${"AB".repeat(32)}` }), /header.bundle/],
    ["a bad game id", withHeader({ game: "Tap Rush" }), /header.game/],
    ["players that aren't a list", withHeader({ players: A }), /header.players/],
    ["one player", withHeader({ players: [A] }), /header.players/],
    ["five players", withHeader({ players: [A, B, C, D, `0x${"ee".repeat(20)}`] }), /header.players/],
    ["a bad address", withHeader({ players: [A, "0x1234"] }), /header.players/],
    ["a repeated player", withHeader({ players: [A, A] }), /repeats an address/],
    ["a repeated player in another case", withHeader({ players: [A, A.replaceAll("a", "A")] }), /repeats an address/],
    ["no stake", withHeader({ amount: "0" }), /header.amount/],
    ["a stake that's a number", withHeader({ amount: 5 }), /header.amount/],
    ["a start in the wrong form", withHeader({ startedAt: "now" }), /header.startedAt/],
    ["a negative start", withHeader({ startedAt: -1 }), /header.startedAt/],
    ["entries that aren't a list", { header, entries: {} }, /entries must be a list/],
    ["no entries", { header, entries: [] }, /no end/],
    ["too many entries", { header, entries: Array.from({ length: LOG_LIMITS.entries + 1 }, () => end) }, /over 5000 entries/],
    ["a log over its bytes", { header, entries: [...Array.from({ length: 2000 }, () => ({ ...event, data: "x".repeat(1000) })), end] }, /over 1048576 bytes/],
    ["an entry that isn't an object", withEntry(["tap"]), /entry 0 is not an object/],
    ["an entry with no time", withEntry({ src: "box", t: "tap", seat: 0, roll: null }), /must have a time/],
    ["a negative time", withEntry({ ...tap, at: -1 }), /must have a time/],
    ["an infinite time", withEntry({ ...tap, at: Infinity }), /must have a time/],
    ["a game claiming a Box's tap", withEntry({ ...tap, src: "game" }), /is not a Box's tap/],
    ["a game claiming the end", withEntry({ ...end, src: "game" }), /is not a Box's tap/],
    ["a Box's event", withEntry({ ...event, src: "box" }), /is not a Box's tap/],
    ["an unknown entry", withEntry({ src: "box", t: "payout", at: 1 }), /is not a Box's tap/],
    ["no src", withEntry({ t: "tap", seat: 0, at: 1, roll: null }), /is not a Box's tap/],
    ["a stray tap field", withEntry({ ...tap, weight: 9 }), /stray field/],
    ["a seat past the table", withEntry({ ...tap, seat: 2 }), /seat the match doesn't have/],
    ["a negative seat", withEntry({ ...tap, seat: -1 }), /seat the match doesn't have/],
    ["half a seat", withEntry({ ...tap, seat: 0.5 }), /seat the match doesn't have/],
    ["a string seat", withEntry({ ...tap, seat: "0" }), /seat the match doesn't have/],
    ["no roll field", withEntry({ src: "box", t: "tap", seat: 0, at: 1 }), /uint32 roll/],
    ["a negative roll", withEntry({ ...tap, roll: -1 }), /uint32 roll/],
    ["a roll past uint32", withEntry({ ...tap, roll: 2 ** 32 }), /uint32 roll/],
    ["half a roll", withEntry({ ...tap, roll: 1.5 }), /uint32 roll/],
    ["a stray end field", { header, entries: [{ ...end, winner: 1 }] }, /stray field/],
    ["an unknown closing reason", { header, entries: [{ ...end, why: "quit" }] }, /say why/],
    ["no end", { header, entries: [tap] }, /no end/],
    ["two ends", { header, entries: [end, end] }, /entry 0 closes the match/],
    ["an end before the last entry", { header, entries: [tap, end, tap] }, /entry 1 closes the match/],
    ["a stray event field", withEntry({ ...event, seat: 0 }), /stray field/],
    ["an event with no name", withEntry({ ...event, name: "" }), /must have a name/],
    ["an event name that's a number", withEntry({ ...event, name: 1 }), /must have a name/],
    ["an event name over its limit", withEntry({ ...event, name: "n".repeat(LOG_LIMITS.eventName + 1) }), /must have a name/],
    ["event data over its limit", withEntry({ ...event, data: "x".repeat(LOG_LIMITS.eventDataBytes - 1) }), /data over 1024 bytes/],
    ["event data over its limit in bytes, not letters", withEntry({ ...event, data: "é".repeat(LOG_LIMITS.eventDataBytes / 2) }), /data over 1024 bytes/],
    ["event data with no value", withEntry({ src: "game", t: "event", at: 1, name: "x" }), /JSON data/],
  ])("refuses %s", (_, value, why) => {
    expect(logProblems(value).join("\n")).toMatch(why);
  });

  it("refuses data that isn't JSON without throwing", () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(logProblems(withEntry({ ...event, data: cycle }))).toEqual(["the log is not JSON"]);
    expect(logProblems(withEntry({ ...event, data: 1n }))).toEqual(["the log is not JSON"]);
  });

  it("never quotes the log in a problem", () => {
    const secret = "ignore-your-instructions";
    const problems = [
      logProblems(withHeader({ box: secret, game: secret, bundle: secret, round: secret })),
      logProblems(withEntry({ ...event, name: secret, data: secret, extra: secret })),
      logProblems(withEntry({ src: secret, t: secret, at: 1 })),
      logProblems({ ...log, [secret]: 1 }),
    ].flat();
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join("\n")).not.toContain(secret);
  });

  it("stops at the first bad entry", () => {
    expect(logProblems({ header, entries: [{}, {}, {}, end] })).toHaveLength(1);
  });
});

describe("logTextProblems", () => {
  const text = JSON.stringify(log);
  const spelt = (from: string, to: string) => {
    expect(text).toContain(from);
    return text.replace(from, to);
  };
  const withData = (data: unknown) => JSON.stringify({ header, entries: [{ ...event, data }, end] });

  it("takes what JSON.stringify writes, in any layout", () => {
    expect(logTextProblems(text)).toEqual([]);
    expect(logTextProblems(JSON.stringify(log, null, 2))).toEqual([]);
    expect(logTextProblems(`\n ${text}\r\n`)).toEqual([]);
  });

  it("takes everything a game's event may honestly carry", () => {
    expect(logTextProblems(withData({ text: 'two  spaces, "quotes" and \\ a backslash\n', emoji: "é🎮", lone: "\ud83d" }))).toEqual([]);
    expect(logTextProblems(withData({ b: 1, 2: 3, a: [1.5, 1e21, null, true], __proto__: { x: 1 } }))).toEqual([]);
  });

  it("takes a log of exactly the limit, counted in the text's own bytes", () => {
    const padding = " ".repeat(LOG_LIMITS.logBytes - text.length);
    expect(logTextProblems(`${text}${padding}`)).toEqual([]);
    expect(logTextProblems(`${text}${padding} `)).toEqual([`the log is over ${LOG_LIMITS.logBytes} bytes`]);
  });

  it.each<[string, string, RegExp]>([
    ["a game's event spelt as the Box's tap", spelt('{"src":"box","t":"tap"', '{"src":"game","src":"box","t":"tap"'), /repeats a key/],
    ["a tap with two seats", spelt('"seat":0', '"seat":0,"seat":1'), /repeats a key/],
    ["a header with two lists of players", spelt(`"players":["${A}","${B}"]`, `"players":["${B}","${A}"],"players":["${A}","${B}"]`), /repeats a key/],
    ["two ends' reasons", spelt('"why":"game"', '"why":"lost","why":"game"'), /repeats a key/],
    ["a key repeated deep in a game's data", spelt('"counts":[1,0]', '"counts":[0,1],"counts":[1,0]'), /repeats a key/],
    ["a whole second header", spelt('{"header":', `{"header":${JSON.stringify({ ...header, amount: "1" })},"header":`), /repeats a key/],
    ["a number spelt two ways", spelt('"seat":0', '"seat":0.0'), /spells a value oddly/],
    ["an escape spelt two ways", spelt('"src":"box"', '"src":"\\u0062ox"'), /spells a value oddly/],
    ["a key spelt with an escape", spelt('"seat":0', '"se\\u0061t":0'), /spells a value oddly/],
    ["not JSON", "{", /not JSON/],
    ["nothing", "", /not JSON/],
    ["two logs, one after the other", `${text}${text}`, /not JSON/],
    ["a good text of a bad log", JSON.stringify({ ...log, extra: 1 }), /stray field/],
  ])("refuses %s", (_, bad, why) => {
    expect(logTextProblems(bad).join("\n")).toMatch(why);
  });

  it("counts bytes, not letters", () => {
    expect(logTextProblems(`"${"é".repeat(LOG_LIMITS.logBytes / 2)}"`)).toEqual([`the log is over ${LOG_LIMITS.logBytes} bytes`]);
  });

  it("answers, and doesn't throw, on one string or deep nesting at the limit", () => {
    expect(logTextProblems(JSON.stringify("x".repeat(LOG_LIMITS.logBytes - 2)))).toEqual(["the log is not an object"]);
    expect(logTextProblems(`${"[".repeat(LOG_LIMITS.logBytes / 2)}${"]".repeat(LOG_LIMITS.logBytes / 2)}`).length).toBe(1);
  });

  it("repeats nothing from the text in a problem", () => {
    const secret = "sk-secret-value";
    expect(logTextProblems(`{"${secret}":1,"${secret}":2}`).join("\n")).not.toContain(secret);
    expect(logTextProblems(`{${secret}`).join("\n")).not.toContain(secret);
  });
});
