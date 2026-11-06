// The line codec against firmware/tap-station/protocol.md itself: every example line in its code blocks, verbatim.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { formatCommand, parseCommand } from "./commands.ts";
import { parseEvent } from "./events.ts";
import { screenPayload } from "./screen-payload.ts";

const spec = readFileSync(new URL("../../../../firmware/tap-station/protocol.md", import.meta.url), "utf8");
const blockLines = [...spec.matchAll(/```\n([\s\S]*?)```/g)].flatMap((m) => m[1]!.split("\n").filter(Boolean));
const eventLines = blockLines.filter((l) => l.startsWith("{"));
const commandLines = blockLines.filter((l) => !l.startsWith("{"));

describe("protocol.md's example lines", () => {
  it("has examples of both kinds", () => {
    expect(eventLines.length).toBeGreaterThan(30);
    expect(commandLines.length).toBeGreaterThan(5);
  });

  it.each(eventLines)("parses %s", (line) => {
    const event = parseEvent(line);
    expect(typeof event).toBe("object");
    expect(event).toEqual(JSON.parse(line));
  });

  it("covers every event type the receiver sends", () => {
    const seen = new Set(eventLines.map((l) => (JSON.parse(l) as { ev: string }).ev));
    for (const ev of ["ready", "state", "link", "ping", "nfc", "bad", "tap", "gone", "signed", "buzz_ok", "buzz_fail", "screen_ok", "screen_fail", "nfc_res", "nfc_fail", "c3_press", "c3_ack", "c3_fail", "s3_press", "s3_report", "button", "stats"]) {
      expect(seen).toContain(ev);
    }
  });

  it.each(commandLines)("round-trips %s", (line) => {
    const cmd = parseCommand(line);
    expect(cmd).not.toBeNull();
    expect(formatCommand(cmd!)).toBe(line);
  });

  it("encodes the Screens example payload to its hex", () => {
    const [, text, hex] = /Example: `([^`]+)` is `([0-9a-f]+)`/.exec(spec)!;
    const payload = screenPayload({ tag: "P1", big: "TAP", small: "NOVA" }, 0);
    expect(payload).toBe(text!.replaceAll("\\n", "\n"));
    expect(formatCommand({ cmd: "screen", st: "e4ba70", id: 6, payload })).toBe(`screen e4ba70 6 ${hex}`);
  });
});

describe("parseEvent drops what it can't trust, without throwing", () => {
  it.each([
    ["ESP-ROM:esp32c3-api1-20210207", "noise"],
    ["{\"ev\":\"tap\",", "json"],
    ["[1,2]", "noise"],
    ['{"ev":"warp","st":"e4ba70"}', "unknown"],
    ['{"st":"e4ba70"}', "unknown"],
    ['{"ev":"tap","st":"e4ba70","id":5,"uid":"04A1","atqa":"0044","sak":"20","ats":"","read_us":"27400","gap_us":1,"tries":1,"at_us":4}', "shape"],
    ['{"ev":"tap","st":"E4BA7","id":5,"uid":"04A1","atqa":"0044","sak":"20","ats":"","read_us":1,"gap_us":1,"tries":1,"at_us":4}', "shape"],
    ['{"ev":"gone","st":"e4ba70","id":5,"uid":"04A1","at_us":4294967296}', "shape"],
    ['{"ev":"nfc_res","st":"e4ba70","id":1,"op":"read","ok":true,"err":0,"us":1,"wait_us":1,"rtt_us":1,"tries":1}', "shape"],
    ['{"ev":"ping","st":"e4ba70","rtt_us":2760,"rssi":-37,"nfc":"yes","s3_led":0,"c3_led":1}', "shape"],
  ])("%s → %s", (line, why) => {
    expect(parseEvent(line)).toBe(why);
  });

  it("keeps fields it doesn't know", () => {
    const event = parseEvent('{"ev":"link","st":"e4ba70","up":true,"since_ms":12}');
    expect(event).toMatchObject({ ev: "link", st: "e4ba70", up: true, since_ms: 12 });
  });
});

describe("commands", () => {
  it("formats each command as the receiver reads it", () => {
    expect(formatCommand({ cmd: "buzz", st: "e4ba70", id: 3, ms: 80, pulses: 2 })).toBe("buzz e4ba70 3 80 2");
    expect(formatCommand({ cmd: "nfc", st: "e4ba70", id: 9, op: "sign", hex: "b051000002080200" })).toBe("nfc e4ba70 9 sign B051000002080200");
    expect(formatCommand({ cmd: "nfc", st: "e4ba70", id: 9, op: "select", uid: "04a1b2" })).toBe("nfc e4ba70 9 select 04A1B2");
  });

  it.each(["bogus 1", "press 0", "press 4294967296", "buzz e4ba70 3 0", "buzz e4ba70 3 80 4", "screen e4ba70 6 7", "nfc e4ba70 1 apdu", "nfc e4ba70 1 list x", "state now"])(
    "refuses %s",
    (line) => expect(parseCommand(line)).toBeNull(),
  );
});
