// Receiver → Pi: one line of JSON into a typed ReceiverEvent (firmware/tap-station/protocol.md, Events). Every field
// the types promise is checked; a line that fails is dropped and counted, never thrown. Fields the Pi doesn't know are
// left alone (new firmware fields need no server change). The parsed object is the event itself: no copy is made.
import type { ReceiverEvent } from "./lines.ts";

/** Why a line was dropped. */
export type DropReason = "noise" | "json" | "shape" | "unknown";

type Check = (v: unknown) => boolean;

const str: Check = (v) => typeof v === "string";
const num: Check = (v) => typeof v === "number" && Number.isFinite(v);
const bool: Check = (v) => typeof v === "boolean";
/** A caller's or the receiver's id, or `at_us`: a u32. */
const u32: Check = (v) => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 0xffff_ffff;
const HEX = /^(?:[0-9A-Fa-f]{2})*$/;
const hex: Check = (v) => typeof v === "string" && HEX.test(v);
const STATION = /^[0-9a-f]{6}$/;
const station: Check = (v) => typeof v === "string" && STATION.test(v);
const stationOrAll: Check = (v) => v === "all" || station(v);
const board: Check = (v) => v === "s3" || v === "c3";
const op: Check = (v) => v === "apdu" || v === "sign" || v === "reselect" || v === "select" || v === "list";
const opt = (check: Check): Check => (v) => v === undefined || check(v);
const uidOrNull: Check = (v) => v === null || hex(v);

const tagLine: Check = (v) => {
  if (typeof v !== "object" || v === null) return false;
  const t = v as Record<string, unknown>;
  return hex(t.uid) && hex(t.atqa) && hex(t.sak) && hex(t.ats);
};
const tagLines: Check = (v) => Array.isArray(v) && v.every(tagLine);
const stationSnap: Check = (v) => {
  if (typeof v !== "object" || v === null) return false;
  const s = v as Record<string, unknown>;
  return station(s.st) && bool(s.up) && bool(s.nfc) && uidOrNull(s.uid) && num(s.rssi);
};
const stationSnaps: Check = (v) => Array.isArray(v) && v.every(stationSnap);
const stack: Check = (v) => typeof v === "object" && v !== null && !Array.isArray(v) && Object.values(v).every(num);

/** Each event's fields, as the protocol's example lines carry them. */
const SHAPES: Readonly<Record<ReceiverEvent["ev"], Readonly<Record<string, Check>>>> = {
  ready: { mac: str, fw: str },
  state: { stations: stationSnaps },
  link: { st: station, up: bool },
  ping: { st: station, rtt_us: num, rssi: num, nfc: bool, s3_led: num, c3_led: num },
  nfc: { st: station, ok: bool },
  bad: { why: str, line: str },
  tap: {
    st: station,
    id: u32,
    uid: hex,
    atqa: hex,
    sak: hex,
    ats: hex,
    read_us: num,
    gap_us: num,
    tries: num,
    at_us: u32,
  },
  gone: { st: station, id: u32, uid: hex, at_us: u32 },
  signed: { st: station, id: u32, tap: u32, uid: hex, ok: bool, chip_us: num, total_us: num, at_us: u32 },
  buzz_ok: { st: station, id: u32, tries: num, rtt_us: num },
  buzz_fail: { st: stationOrAll, id: u32, why: str },
  screen_ok: { st: station, id: u32, tries: num, rtt_us: num },
  screen_fail: { st: station, id: u32, why: str },
  nfc_res: {
    st: station,
    id: u32,
    op,
    ok: bool,
    err: num,
    pn532: opt(num),
    hex: opt(hex),
    tags: opt(tagLines),
    sel: opt(hex),
    us: num,
    wait_us: num,
    rtt_us: num,
    tries: num,
  },
  nfc_fail: { st: station, id: u32, why: str },
  c3_press: { id: u32, at_us: u32 },
  c3_ack: { st: station, id: u32, rtt_us: num, tries: num, s3_led: num },
  c3_fail: { id: u32, tries: num },
  s3_press: { st: station, id: u32, tries: num, c3_led: num, at_us: u32 },
  s3_report: { st: station, id: u32, rtt_us: num, tries: num },
  button: { board, st: opt(station), down: bool },
  stats: { board, st: opt(station), stack, dropped: num, send_fails: num, up_ms: num },
};

const hasShape = (ev: string): ev is ReceiverEvent["ev"] => Object.hasOwn(SHAPES, ev);

/** A line as the receiver wrote it (no `\n`; a trailing `\r` is fine), or why it was dropped. */
export function parseEvent(line: string): ReceiverEvent | DropReason {
  // Anything that isn't a JSON object (boot chatter from the C3's ROM, a half line after a replug) is noise.
  if (line.charCodeAt(0) !== 0x7b /* { */) return "noise";
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return "json";
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "json";
  const event = value as Record<string, unknown>;
  const ev = event.ev;
  if (typeof ev !== "string" || !hasShape(ev)) return "unknown";
  const shape = SHAPES[ev];
  for (const field in shape) if (!shape[field]!(event[field])) return "shape";
  return value as ReceiverEvent;
}
