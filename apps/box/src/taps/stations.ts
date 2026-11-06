// The tap stations as the receiver reports them: which seat each one is, and each one's live state (link, signal,
// ping round trip, reader, the chip on it) from `state`, `link`, `ping`, `nfc`, `tap` and `gone` lines. A dropped link
// gets LINK_GRACE_MS before it counts as lost: on a lossy radio the receiver can miss a few packets in a row, and
// failing a tap then would throw away a chip that is still being read.
import type { Seat } from "@egb/sdk";
import type { Clock, TimerHandle } from "../core/ports.ts";
import type { ReceiverEvent, StationId } from "./lines.ts";
import { DEFAULT_RADIO_US } from "./receiver-clock.ts";
import { Samples } from "./samples.ts";

/** How long a dropped link may stay down before an open tap on it fails. */
export const LINK_GRACE_MS = 2000;

export interface StationChip {
  readonly uid: string;
  /** The receiver's tap id; -1 for a chip `state` reported, already there when the port opened. */
  readonly tap: number;
  /** Pi ms when its tap line arrived. */
  readonly since: number;
}

export interface StationStatus {
  readonly st: StationId;
  /** Its seat from EGB_STATIONS, or null for a station no seat uses (its taps are ignored). */
  readonly seat: Seat | null;
  readonly up: boolean;
  readonly rssi: number | null;
  /** The last ping's round trip, µs. */
  readonly rttUs: number | null;
  /** Its PN532 answers; null before the station said. */
  readonly reader: boolean | null;
  readonly chip: StationChip | null;
  /** Pi ms of its last line. */
  readonly heardAt: number | null;
}

export interface StationHooks {
  /** The link came up (first sight, relink, or the receiver reopened). */
  up(st: StationId): void;
  /** The link went down; `lost` follows after the grace unless it comes back. */
  down(st: StationId): void;
  lost(st: StationId): void;
  /** Something a status page shows changed (not pings). */
  changed(): void;
}

/** The link stayed down past its grace (or the receiver closed). */
export class LinkLostError extends Error {}

interface Live {
  up: boolean;
  rssi: number | null;
  rttUs: number | null;
  reader: boolean | null;
  chip: StationChip | null;
  heardAt: number | null;
  grace: TimerHandle | null;
  waiters: { resolve(): void; reject(e: Error): void }[];
  readonly pings: Samples;
  readonly reports: Samples;
}

export class Stations {
  private readonly order: readonly StationId[];
  private readonly clock: Clock;
  private readonly hooks: StationHooks;
  private readonly live = new Map<StationId, Live>();

  /** `order[0]` is Player 1's station, `order[1]` Player 2's. */
  constructor(order: readonly StationId[], clock: Clock, hooks: StationHooks) {
    this.order = order;
    this.clock = clock;
    this.hooks = hooks;
    for (const st of order) this.station(st);
  }

  seatOf(st: StationId): Seat | null {
    const i = this.order.indexOf(st);
    return i === 0 || i === 1 ? i : null;
  }

  stationAt(seat: Seat): StationId | undefined {
    return this.order[seat];
  }

  isUp(st: StationId): boolean {
    return this.live.get(st)?.up ?? false;
  }

  /** Every station seen or configured. */
  ids(): StationId[] {
    return [...this.live.keys()];
  }

  /** The chip on the station's reader as its last tap/gone lines tell it. */
  chip(st: StationId): StationChip | null {
    return this.live.get(st)?.chip ?? null;
  }

  /** The station's one-way radio time, µs: half its last ping round trip. */
  radioUs(st: StationId): number {
    const rtt = this.live.get(st)?.rttUs;
    return rtt ? rtt / 2 : DEFAULT_RADIO_US;
  }

  /** Recent ping round trips (µs) and station-press reports (µs), oldest first. */
  pings(st: StationId): number[] {
    return this.live.get(st)?.pings.values() ?? [];
  }

  reports(st: StationId): number[] {
    return this.live.get(st)?.reports.values() ?? [];
  }

  /** Resolves once the station is linked; rejects with LinkLostError when its grace runs out first. */
  whenUp(st: StationId): Promise<void> {
    const s = this.station(st);
    if (s.up) return Promise.resolve();
    if (!s.grace) return Promise.reject(new LinkLostError(`station ${st} is not linked`));
    return new Promise((resolve, reject) => s.waiters.push({ resolve, reject }));
  }

  apply(event: ReceiverEvent, now: number): void {
    switch (event.ev) {
      case "state":
        for (const snap of event.stations) {
          const s = this.station(snap.st);
          s.reader = snap.nfc;
          s.heardAt = now;
          if (snap.rssi) s.rssi = snap.rssi;
          // A chip already resting on the reader when the port opened: its tap id is unknown (-1) until a new tap.
          if (!snap.uid) s.chip = null;
          else if (s.chip?.uid !== snap.uid.toUpperCase()) s.chip = { uid: snap.uid.toUpperCase(), tap: -1, since: now };
          this.link(snap.st, snap.up);
        }
        this.hooks.changed();
        return;
      case "link":
        this.station(event.st).heardAt = now;
        this.link(event.st, event.up);
        this.hooks.changed();
        return;
      case "ping": {
        const s = this.station(event.st);
        const changed = s.reader !== event.nfc || !s.up;
        s.heardAt = now;
        s.rssi = event.rssi;
        s.rttUs = event.rtt_us;
        s.reader = event.nfc;
        s.pings.push(event.rtt_us);
        // Any packet means the link is there, whatever the last `link` line said.
        this.link(event.st, true);
        if (changed) this.hooks.changed();
        return;
      }
      case "nfc":
        this.station(event.st).reader = event.ok;
        this.hooks.changed();
        return;
      case "tap": {
        const s = this.station(event.st);
        s.heardAt = now;
        s.chip = { uid: event.uid.toUpperCase(), tap: event.id, since: now };
        this.link(event.st, true);
        this.hooks.changed();
        return;
      }
      case "gone": {
        const s = this.station(event.st);
        s.heardAt = now;
        if (s.chip && (s.chip.tap === event.id || (s.chip.tap < 0 && s.chip.uid === event.uid.toUpperCase()))) s.chip = null;
        this.hooks.changed();
        return;
      }
      case "s3_report":
        this.station(event.st).reports.push(event.rtt_us);
        return;
      default:
        return;
    }
  }

  /** The receiver's port closed: every link is gone, at once (the taps fail without grace). */
  closed(): void {
    for (const [st, s] of this.live) {
      this.clock.cancel(s.grace);
      s.grace = null;
      const wasUp = s.up;
      s.up = false;
      s.chip = null;
      this.release(s, new LinkLostError("the receiver closed"));
      if (wasUp) this.hooks.down(st);
    }
    this.hooks.changed();
  }

  status(): StationStatus[] {
    return [...this.live].map(([st, s]) => ({
      st,
      seat: this.seatOf(st),
      up: s.up,
      rssi: s.rssi,
      rttUs: s.rttUs,
      reader: s.reader,
      chip: s.chip,
      heardAt: s.heardAt,
    }));
  }

  /** Cancels the grace timers (shutting down). */
  stop(): void {
    for (const s of this.live.values()) {
      this.clock.cancel(s.grace);
      s.grace = null;
      this.release(s, new LinkLostError("stopped"));
    }
  }

  private station(st: StationId): Live {
    let s = this.live.get(st);
    if (!s) {
      s = { up: false, rssi: null, rttUs: null, reader: null, chip: null, heardAt: null, grace: null, waiters: [], pings: new Samples(), reports: new Samples() };
      this.live.set(st, s);
    }
    return s;
  }

  private link(st: StationId, up: boolean): void {
    const s = this.station(st);
    if (s.up === up) return;
    s.up = up;
    if (up) {
      this.clock.cancel(s.grace);
      s.grace = null;
      for (const w of s.waiters.splice(0)) w.resolve();
      this.hooks.up(st);
      return;
    }
    s.grace = this.clock.after(LINK_GRACE_MS, () => {
      s.grace = null;
      // The station dropped its screen and may have lost the chip; the next tap line says what's there.
      s.chip = null;
      this.release(s, new LinkLostError(`station ${st} lost its link`));
      this.hooks.lost(st);
      this.hooks.changed();
    });
    this.hooks.down(st);
  }

  private release(s: Live, e: Error): void {
    for (const w of s.waiters.splice(0)) w.reject(e);
  }
}
