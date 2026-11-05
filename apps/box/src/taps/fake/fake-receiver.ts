// A receiver with no hardware: a duplex stream the Receiver owns instead of a serial port, speaking the exact serial
// lines of firmware/tap-station/protocol.md, with simulated stations (links, pings, taps and gones, buzz and screen
// acks, NFC answers) and simulated badges that answer real HaLo APDUs. Tests and the test page place and lift badges
// on stations, drop links and pull the USB cable.
import { Duplex } from "node:stream";
import type { Clock, TimerHandle } from "../../core/ports.ts";
import { parseCommand } from "../commands.ts";
import type { ReceiverCommand, ReceiverEvent, StationId, TagLine } from "../lines.ts";
import type { OpenPort } from "../receiver.ts";
import { SimBadge } from "./sim-badge.ts";

export interface FakeOptions {
  /** Multiplies every simulated delay; 0 answers at once (tests). Default 1. */
  readonly timeScale?: number;
  /** Stations select the HaLo applet themselves on detection and put the answer in the tap (`sel`). Default true. */
  readonly stationSelects?: boolean;
  /** The simulated stations. Default: the seats' stations. */
  readonly stations?: readonly StationId[];
}

/** Typical times on the hardware, ms (protocol.md and the plan's measurements). */
const MS = {
  radio: 1.5,
  ack: 3,
  read: 27.4,
  gone: 40,
  select: 45,
  apdu: 15,
  getPkeys: 110,
  signRandom: 800,
  reselect: 52,
  list: 35,
} as const;
const PING_MS = 250;
const PRESS_SENDS = 25;
const PRESS_RESEND_MS = 20;
/** Badge names, in the order the test page lists them. */
const BADGE_NAMES = ["ada", "bo", "cy", "di", "eve"] as const;
const HALO_TAG = { atqa: "0044", sak: "20", ats: "78807002" } as const;
/** Command lines kept for heard(). */
const HEARD_MAX = 200;

interface SimStation {
  readonly st: StationId;
  up: boolean;
  badge: SimBadge | null;
  tapId: number;
  /** The NFC request it's working on; a newer one replaces it. */
  nfcId: number;
  screen: string;
  ping: TimerHandle | null;
  readonly rttUs: number;
  readonly rssi: number;
}

export interface FakeStatus {
  readonly plugged: boolean;
  readonly stations: readonly { readonly st: StationId; readonly up: boolean; readonly badge: string | null; readonly screen: string }[];
  readonly badges: readonly { readonly name: string; readonly uid: string; readonly station: StationId | null }[];
}

export class FakeReceiver {
  readonly badges: readonly SimBadge[];
  private readonly clock: Clock;
  private readonly scale: number;
  private readonly stationSelects: boolean;
  private readonly stations = new Map<StationId, SimStation>();
  private stream: Duplex | null = null;
  private plugged = true;
  private pending = "";
  private readonly heardLines: string[] = [];
  private c3Led = 0;
  /** The receiver's micros() at Pi time 0: an arbitrary start, so the u32 wraps like the real one. */
  private readonly microsBase = Math.floor(Math.random() * 2 ** 32);

  constructor(clock: Clock, stations: readonly StationId[], opts: FakeOptions = {}) {
    this.clock = clock;
    this.scale = opts.timeScale ?? 1;
    this.stationSelects = opts.stationSelects ?? true;
    this.badges = BADGE_NAMES.map((name, i) => new SimBadge(name, i === BADGE_NAMES.length - 1 ? "legacy" : "arx"));
    (opts.stations ?? stations).forEach((st, i) => {
      const s: SimStation = { st, up: true, badge: null, tapId: 0, nfcId: 0, screen: "", ping: null, rttUs: 2700 + 150 * i, rssi: -40 - 3 * i };
      this.stations.set(st, s);
      this.startPings(s);
    });
  }

  /** The Receiver's opener: a fresh stream each time, refused while the cable is out. */
  readonly open: OpenPort = async () => {
    if (!this.plugged) throw new Error("the fake receiver is unplugged");
    this.pending = "";
    const stream = new Duplex({
      read() {},
      write: (chunk: Buffer, _encoding, done) => {
        this.onWrite(chunk.toString("latin1"));
        done();
      },
    });
    stream.once("close", () => {
      if (this.stream === stream) this.stream = null;
    });
    this.stream = stream;
    return { stream, path: "fake" };
  };

  badge(name: string): SimBadge {
    const badge = this.badges.find((b) => b.name === name);
    if (!badge) throw new Error(`no simulated badge ${name}`);
    return badge;
  }

  /** Puts a badge on a station's reader (taking it off any other first): the station sends `tap`. */
  place(name: string, st: StationId): void {
    const badge = this.badge(name);
    const s = this.station(st);
    this.lift(name);
    if (s.badge) this.lift(s.badge.name);
    s.badge = badge;
    s.tapId++;
    badge.powerUp();
    const id = s.tapId;
    const sel = this.stationSelects ? badge.reselect() : null;
    this.later(MS.read + MS.radio + (sel ? MS.select : 0), () => {
      if (!s.up || s.badge !== badge || s.tapId !== id) return;
      const at = this.micros();
      this.emit({
        ev: "tap", st, id, uid: badge.uid, ...HALO_TAG, read_us: MS.read * 1000, gap_us: 20_000,
        ...(sel ? { sel, sel_us: MS.select * 1000 } : {}), tries: 1, at_us: at,
      });
    });
  }

  /** Takes a badge off whichever reader it is on: the station sends `gone` after two empty reads. */
  lift(name: string): void {
    for (const s of this.stations.values()) {
      if (s.badge?.name !== name) continue;
      const { uid } = s.badge;
      const id = s.tapId;
      s.badge = null;
      this.later(MS.gone, () => {
        if (s.up) this.emit({ ev: "gone", st: s.st, id, uid, at_us: this.micros() });
      });
    }
  }

  /** The station goes silent: the receiver reports its link down (after 2.5 s on the hardware). */
  linkDown(st: StationId): void {
    const s = this.station(st);
    if (!s.up) return;
    s.up = false;
    this.clock.cancel(s.ping);
    s.ping = null;
    this.later(2500, () => {
      if (!s.up) this.emit({ ev: "link", st, up: false });
    });
  }

  linkUp(st: StationId): void {
    const s = this.station(st);
    if (s.up) return;
    s.up = true;
    // A station that dropped off shows its own defaults until the Pi sends its screen again.
    s.screen = "";
    this.emit({ ev: "link", st, up: true });
    this.startPings(s);
  }

  /** The USB cable comes out: the port closes, and opening it fails until plug(). */
  unplug(): void {
    this.plugged = false;
    this.stream?.destroy();
  }

  plug(): void {
    this.plugged = true;
  }

  /** The latest command lines the Pi sent, oldest first. */
  heard(): readonly string[] {
    return [...this.heardLines];
  }

  status(): FakeStatus {
    const where = (b: SimBadge) => [...this.stations.values()].find((s) => s.badge === b)?.st ?? null;
    return {
      plugged: this.plugged,
      stations: [...this.stations.values()].map((s) => ({ st: s.st, up: s.up, badge: s.badge?.name ?? null, screen: s.screen })),
      badges: this.badges.map((b) => ({ name: b.name, uid: b.uid, station: where(b) })),
    };
  }

  stop(): void {
    for (const s of this.stations.values()) this.clock.cancel(s.ping);
    this.stream?.destroy();
  }

  private station(st: StationId): SimStation {
    const s = this.stations.get(st);
    if (!s) throw new Error(`no simulated station ${st}`);
    return s;
  }

  private micros(): number {
    return (this.microsBase + Math.round(this.clock.now() * 1000)) % 2 ** 32;
  }

  private later(ms: number, run: () => void): void {
    const delay = ms * this.scale;
    if (delay <= 0) queueMicrotask(run);
    else this.clock.after(delay, run);
  }

  private emit(event: ReceiverEvent): void {
    this.stream?.push(`${JSON.stringify(event)}\n`);
  }

  private startPings(s: SimStation): void {
    s.ping = this.clock.every(PING_MS, () => {
      if (s.up) this.emit({ ev: "ping", st: s.st, rtt_us: s.rttUs, rssi: s.rssi, nfc: true, s3_led: 0, c3_led: this.c3Led });
    });
  }

  private onWrite(text: string): void {
    this.pending += text;
    for (let nl = this.pending.indexOf("\n"); nl >= 0; nl = this.pending.indexOf("\n")) {
      const line = this.pending.slice(0, nl);
      this.pending = this.pending.slice(nl + 1);
      this.heardLines.push(line);
      if (this.heardLines.length > HEARD_MAX) this.heardLines.shift();
      const cmd = parseCommand(line);
      if (cmd) this.run(cmd);
      else this.emit({ ev: "bad", why: "unknown command", line: line.replace(/\r$/, "") });
    }
  }

  private linked(): SimStation[] {
    return [...this.stations.values()].filter((s) => s.up);
  }

  private run(cmd: ReceiverCommand): void {
    switch (cmd.cmd) {
      case "state":
        this.emit({
          ev: "state",
          stations: [...this.stations.values()].map((s) => ({ st: s.st, up: s.up, nfc: true, uid: s.badge?.uid ?? null, rssi: s.up ? s.rssi : 0 })),
        });
        return;
      case "press": {
        this.emit({ ev: "c3_press", id: cmd.id, at_us: this.micros() });
        const s = this.linked()[0];
        if (!s) {
          this.later(PRESS_SENDS * PRESS_RESEND_MS, () => this.emit({ ev: "c3_fail", id: cmd.id, tries: PRESS_SENDS }));
          return;
        }
        this.later(2 * MS.radio, () => this.emit({ ev: "c3_ack", st: s.st, id: cmd.id, rtt_us: s.rttUs - 300, tries: 1, s3_led: (this.c3Led ^= 1) }));
        return;
      }
      case "buzz":
      case "screen": {
        const targets = cmd.st === "all" ? this.linked() : [this.station(cmd.st)].filter((s) => s.up);
        if (targets.length === 0) {
          const why = "no such station linked";
          if (cmd.cmd === "buzz") this.emit({ ev: "buzz_fail", st: cmd.st, id: cmd.id, why });
          else if (cmd.st !== "all") this.emit({ ev: "screen_fail", st: cmd.st, id: cmd.id, why });
          return;
        }
        for (const s of targets) {
          if (cmd.cmd === "screen") s.screen = cmd.payload;
          this.later(MS.ack, () => this.emit({ ev: cmd.cmd === "buzz" ? "buzz_ok" : "screen_ok", st: s.st, id: cmd.id, tries: 1, rtt_us: s.rttUs }));
        }
        return;
      }
      case "nfc":
        this.nfc(cmd);
        return;
      case "stats":
        this.emit({ ev: "stats", board: cmd.st ? "s3" : "c3", ...(cmd.st ? { st: cmd.st } : {}), stack: { loop: 2200 }, dropped: 0, send_fails: 0, up_ms: Math.round(this.clock.now()) });
        return;
    }
  }

  private nfc(cmd: Extract<ReceiverCommand, { cmd: "nfc" }>): void {
    const s = this.stations.get(cmd.st);
    if (!s?.up) {
      this.emit({ ev: "nfc_fail", st: cmd.st, id: cmd.id, why: "no such station linked" });
      return;
    }
    s.nfcId = cmd.id;
    const badge = s.badge;
    const cost = cmd.op === "apdu" || cmd.op === "sign" ? apduMs(cmd.hex) : cmd.op === "reselect" ? MS.reselect : MS.list;
    this.later(cost + 2 * MS.radio, () => {
      // Replaced by a newer request, or the station dropped off: no answer, as on the hardware.
      if (s.nfcId !== cmd.id || !s.up) return;
      const here = s.badge === badge ? badge : null;
      const us = cost * 1000;
      const timing = { us, wait_us: Math.round(us * 0.7), rtt_us: us + s.rttUs, tries: 1 };
      const fail = (err: number) => this.emit({ ev: "nfc_res", st: s.st, id: cmd.id, op: cmd.op, ok: false, err, ...(err === 2 ? { pn532: 1 } : {}), ...timing });
      switch (cmd.op) {
        case "apdu":
        case "sign": {
          // A chip lifted mid-exchange is an RF error; one that was never there, an APDU with no chip.
          if (!here) return fail(badge ? 2 : 3);
          this.emit({ ev: "nfc_res", st: s.st, id: cmd.id, op: cmd.op, ok: true, err: 0, hex: here.apdu(cmd.hex), ...timing });
          if (cmd.op === "sign") {
            this.emit({ ev: "signed", st: s.st, id: cmd.id, tap: s.tapId, uid: here.uid, ok: true, chip_us: Math.round(us * 0.9), total_us: us + 60_000, at_us: this.micros() });
          }
          return;
        }
        case "reselect": {
          if (!here) return fail(1);
          const sel = here.reselect();
          this.emit({ ev: "nfc_res", st: s.st, id: cmd.id, op: "reselect", ok: true, err: 0, tags: [tagOf(here)], sel, ...timing });
          return;
        }
        case "select":
          if (!here || here.uid !== cmd.uid.toUpperCase()) return fail(1);
          here.powerUp();
          this.emit({ ev: "nfc_res", st: s.st, id: cmd.id, op: "select", ok: true, err: 0, tags: [tagOf(here)], ...timing });
          return;
        case "list":
          this.emit({ ev: "nfc_res", st: s.st, id: cmd.id, op: "list", ok: true, err: 0, tags: here ? [tagOf(here)] : [], ...timing });
          return;
      }
    });
  }
}

const tagOf = (badge: SimBadge): TagLine => ({ uid: badge.uid, ...HALO_TAG });

/** How long the chip takes over an APDU: a select, get_pkeys, sign_random, or anything else. */
function apduMs(hex: string): number {
  const upper = hex.toUpperCase();
  if (upper.startsWith("00A40400")) return MS.select;
  if (upper.startsWith("B0510000")) {
    const cmd = upper.slice(10, 12);
    if (cmd === "02") return MS.getPkeys;
    if (cmd === "08") return MS.signRandom;
  }
  return MS.apdu;
}
