// Pi → receiver: a ReceiverCommand as the exact command text (firmware/tap-station/protocol.md, Commands), and back
// again for the fake receiver. Words are separated by single spaces; the line ends in `\n` when it is written.
import type { NfcOp, ReceiverCommand, StationId } from "./lines.ts";

/** The motor time the receiver applies to a `buzz` that names none. */
const BUZZ_DEFAULT_MS = 80;

/** The command's text, without the newline. Screen hex is lower case; APDU hex upper case (the receiver takes both). */
export function formatCommand(cmd: ReceiverCommand): string {
  switch (cmd.cmd) {
    case "state":
      return "state";
    case "press":
      return `press ${cmd.id}`;
    case "buzz":
      return `buzz ${cmd.st} ${cmd.id} ${cmd.ms}${cmd.pulses === 1 ? "" : ` ${cmd.pulses}`}`;
    case "screen":
      return `screen ${cmd.st} ${cmd.id} ${Buffer.from(cmd.payload, "latin1").toString("hex")}`;
    case "nfc":
      switch (cmd.op) {
        case "apdu":
        case "sign":
          return `nfc ${cmd.st} ${cmd.id} ${cmd.op} ${cmd.hex.toUpperCase()}`;
        case "select":
          return `nfc ${cmd.st} ${cmd.id} select ${cmd.uid.toUpperCase()}`;
        default:
          return `nfc ${cmd.st} ${cmd.id} ${cmd.op}`;
      }
    case "stats":
      return cmd.st ? `stats ${cmd.st}` : "stats";
  }
}

const STATION = /^[0-9a-f]{6}$/;
const HEX = /^(?:[0-9A-Fa-f]{2})+$/;
const ID = /^[1-9][0-9]{0,9}$/;

const stationWord = (w: string | undefined): StationId | null => (w !== undefined && STATION.test(w) ? w : null);
const idWord = (w: string | undefined): number | null => {
  if (w === undefined || !ID.test(w)) return null;
  const n = Number(w);
  return n <= 0xffff_ffff ? n : null;
};
const intIn = (w: string | undefined, fallback: number, min: number, max: number): number | null => {
  if (w === undefined) return fallback;
  if (!/^[0-9]{1,5}$/.test(w)) return null;
  const n = Number(w);
  return n >= min && n <= max ? n : null;
};

/** A command line as the receiver reads it (the fake receiver's parser), or null for one it answers with `bad`. */
export function parseCommand(line: string): ReceiverCommand | null {
  const words = line.replace(/\r$/, "").split(" ");
  const [word, a, b, c, d] = words;
  switch (word) {
    case "state":
      return words.length === 1 ? { cmd: "state" } : null;
    case "press": {
      const id = idWord(a);
      return id !== null && words.length === 2 ? { cmd: "press", id } : null;
    }
    case "buzz": {
      const st = a === "all" ? "all" : stationWord(a);
      const id = idWord(b);
      const ms = intIn(c, BUZZ_DEFAULT_MS, 1, 2000);
      const pulses = intIn(d, 1, 1, 3);
      if (st === null || id === null || ms === null || pulses === null || words.length > 5) return null;
      return { cmd: "buzz", st, id, ms, pulses: pulses as 1 | 2 | 3 };
    }
    case "screen": {
      const st = a === "all" ? "all" : stationWord(a);
      const id = idWord(b);
      if (st === null || id === null || c === undefined || !HEX.test(c) || c.length > 400 || words.length !== 4) return null;
      return { cmd: "screen", st, id, payload: Buffer.from(c, "hex").toString("latin1") };
    }
    case "nfc": {
      const st = stationWord(a);
      const id = idWord(b);
      if (st === null || id === null) return null;
      const nfcOp = c as NfcOp | undefined;
      if ((nfcOp === "apdu" || nfcOp === "sign") && words.length === 5 && d !== undefined && HEX.test(d) && d.length <= 510) {
        return { cmd: "nfc", st, id, op: nfcOp, hex: d };
      }
      if (nfcOp === "select" && words.length === 5 && d !== undefined && HEX.test(d)) return { cmd: "nfc", st, id, op: "select", uid: d };
      if ((nfcOp === "reselect" || nfcOp === "list") && words.length === 4) return { cmd: "nfc", st, id, op: nfcOp };
      return null;
    }
    case "stats": {
      if (words.length === 1) return { cmd: "stats" };
      const st = stationWord(a);
      return st !== null && words.length === 2 ? { cmd: "stats", st } : null;
    }
    default:
      return null;
  }
}
