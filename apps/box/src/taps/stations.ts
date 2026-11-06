// The tap stations as the receiver reports them: which seat each one is, and each one's live state (link, signal,
// ping round trip, reader, the chip on it) from `state`, `link`, `ping`, `nfc`, `tap` and `gone` lines. A dropped link
// gets LINK_GRACE_MS before it counts as lost: on a lossy radio the receiver can miss a few packets in a row, and
// failing a tap then would throw away a chip that is still being read.
//
// There's a seat for each known station, up to four, and seats go by link order: the first station to link is Player
// 1's, the second Player 2's, and one linked with every seat taken waits on the bench. A seat is kept through a dropped
// link's grace. Once its station is lost, the seat goes to the bench's earliest-linked station, and with the bench empty
// to a station on a seat not in use: the third station while a two-seat game plays, or a seat left empty in a store
// match. The receiver's `state` lists stations in the order they first reached it, so a reopened port seats them as
// before.
import { SEATS, type Seat } from "@egb/sdk";
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
  /** Its seat, by link order; null for a station on the bench (its taps are ignored). */
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
  /** A seat changed hands: a station took it, or gave it up. */
  seated(): void;
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
  /** When it last linked, as a count: the seats go to the lowest. */
  linkedSeq: number;
  grace: TimerHandle | null;
  waiters: { resolve(): void; reject(e: Error): void }[];
  readonly pings: Samples;
  readonly reports: Samples;
}

export class Stations {
  private readonly clock: Clock;
  private readonly hooks: StationHooks;
  private readonly live = new Map<StationId, Live>();
  /** Each seat's station, Player 1's first. */
  private readonly seats: (StationId | null)[];
  /** The seats that need a station now. Until the core says, all of them: no station moves. */
  private used: readonly Seat[] = SEATS;
  private linkCount = 0;

  /** `known`: stations listed before any links (the fake's), a seat each; seats still go by link order. */
  constructor(known: readonly StationId[], clock: Clock, hooks: StationHooks) {
    this.clock = clock;
    this.hooks = hooks;
    this.seats = known.slice(0, SEATS.length).map(() => null);
    for (const st of known) this.station(st);
  }

  seatOf(st: StationId): Seat | null {
    return SEATS.find((seat) => this.seats[seat] === st) ?? null;
  }

  stationAt(seat: Seat): StationId | undefined {
    return this.seats[seat] ?? undefined;
  }

  /** The seats that need a station now. One left without gets another's at once, as when a table shrinks past a gap. */
  inUse(seats: readonly Seat[]): void {
    this.used = seats;
    this.fillSeats();
  }

  /** Linked stations no seat uses. */
  bench(): StationId[] {
    return [...this.live].filter(([st, s]) => s.up && this.seatOf(st) === null).map(([st]) => st);
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
    const hadSeats = this.seats.some((st) => st !== null);
    this.seats.fill(null);
    for (const [st, s] of this.live) {
      this.clock.cancel(s.grace);
      s.grace = null;
      const wasUp = s.up;
      s.up = false;
      s.chip = null;
      this.release(s, new LinkLostError("the receiver closed"));
      if (wasUp) this.hooks.down(st);
    }
    if (hadSeats) this.hooks.seated();
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
      s = { up: false, rssi: null, rttUs: null, reader: null, chip: null, heardAt: null, linkedSeq: 0, grace: null, waiters: [], pings: new Samples(), reports: new Samples() };
      this.live.set(st, s);
    }
    return s;
  }

  private link(st: StationId, up: boolean): void {
    const s = this.station(st);
    if (s.up === up) return;
    s.up = up;
    if (up) {
      // Back within its grace, it keeps its seat and its place in the line; otherwise it joins the end.
      if (!s.grace) s.linkedSeq = ++this.linkCount;
      this.clock.cancel(s.grace);
      s.grace = null;
      for (const w of s.waiters.splice(0)) w.resolve();
      this.fillSeats();
      this.hooks.up(st);
      return;
    }
    s.grace = this.clock.after(LINK_GRACE_MS, () => {
      s.grace = null;
      // The station dropped its screen and may have lost the chip; the next tap line says what's there.
      s.chip = null;
      this.release(s, new LinkLostError(`station ${st} lost its link`));
      this.hooks.lost(st);
      const seat = this.seatOf(st);
      if (seat !== null) {
        this.seats[seat] = null;
        if (!this.fillSeats()) this.hooks.seated();
      }
      this.hooks.changed();
    });
    this.hooks.down(st);
  }

  /**
   * Gives every empty seat to the bench's earliest-linked station, the seats in use first. With the bench empty, a seat
   * in use takes a station from a seat that isn't. Says whether a seat changed hands.
   */
  private fillSeats(): boolean {
    const waiting = this.bench().sort((a, b) => this.station(a).linkedSeq - this.station(b).linkedSeq);
    let moved = false;
    for (const seat of [...this.used, ...this.seatsNotInUse()]) {
      if (this.seats[seat] !== null) continue;
      const st = waiting.shift() ?? (this.used.includes(seat) ? this.takeSpare() : undefined);
      if (!st) continue;
      this.seats[seat] = st;
      moved = true;
    }
    if (moved) this.hooks.seated();
    return moved;
  }

  private seatsNotInUse(): Seat[] {
    return SEATS.filter((seat) => !this.used.includes(seat));
  }

  /** Takes a linked station off a seat not in use, the last seat first. */
  private takeSpare(): StationId | undefined {
    for (const seat of this.seatsNotInUse().reverse()) {
      const st = this.stationAt(seat);
      if (!st || !this.isUp(st)) continue;
      this.seats[seat] = null;
      return st;
    }
    return undefined;
  }

  private release(s: Live, e: Error): void {
    for (const w of s.waiters.splice(0)) w.reject(e);
  }
}
