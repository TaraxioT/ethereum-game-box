// The taps library's one entry: the receiver's port, the stations, their screens and motors, NFC and libhalo, the
// roster and the tap state machine, wired together. The Box server owns one; it is also the stations port the core
// shows and buzzes through, and what the test page and the bench call.
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { stationView, type Seat, type StationView } from "@egb/sdk";
import type { Clock, StationsPort, TapEvent, TapPlan } from "../core/ports.ts";
import type { Badge } from "../core/types.ts";
import { Acks, type Answer } from "./acks.ts";
import { Buzzer, type BuzzKind } from "./buzz.ts";
import { readKeys, rollRandom, type Roll } from "./chip-ops.ts";
import type { Address } from "./eth.ts";
import { FakeReceiver, type FakeOptions } from "./fake/fake-receiver.ts";
import { FreshIds } from "./fresh-ids.ts";
import { AidMemory, ChipSession } from "./halo-exec.ts";
import type { ReceiverEvent, StationId, TagLine } from "./lines.ts";
import { Nfc, type NfcReply } from "./nfc.ts";
import { Receiver, type ReceiverStats, type ReceiverStatus } from "./receiver.ts";
import { ReceiverClock } from "./receiver-clock.ts";
import { badgeOf, Roster, type RosterEntry } from "./roster.ts";
import { Screens, type ScreenStatus } from "./screens.ts";
import { serialOpener } from "./serial.ts";
import { Stations, type StationStatus } from "./stations.ts";
import { TapMachine, type TapCounts } from "./tap-machine.ts";

export interface TapsOptions {
  /** A /dev/serial/by-id path, `auto` (the receiver's own by-id entry) or `fake` (EGB_RECEIVER). */
  readonly receiver: string;
  /** The stations known before any link (EGB_STATIONS), which the fake receiver simulates. Seats go by link order: the
   *  first station to link is Player 1's, the second Player 2's (stations.ts). */
  readonly stations: readonly StationId[];
  /** $EGB_DATA: the roster is `badges.json` there (`badges.fake.json` for the fake's badges). */
  readonly dataDir: string;
  readonly clock: Clock;
  /** What the next tap at a seat should ask of the badge. Asked after `touch` goes out. */
  readonly plan: (seat: Seat) => TapPlan;
  /** Every tap's `touch`, then its `done` or `fail`. */
  readonly onTap: (event: TapEvent) => void;
  /** A station's link, reader or chip changed, or the receiver opened or closed (not on every ping). */
  readonly onStatus?: () => void;
  readonly log?: (line: string) => void;
  /** The fake receiver's timing, for `fake`. */
  readonly fake?: FakeOptions;
}

export interface TapsStatus {
  readonly receiver: ReceiverStatus;
  readonly stations: readonly (StationStatus & { readonly screen: ScreenStatus | null })[];
  /** Taps that sent `touch` and haven't ended yet. */
  readonly running: number;
}

export interface TapsStats {
  readonly receiver: ReceiverStats;
  readonly taps: TapCounts;
  readonly buzz: { readonly sent: number; readonly ok: number; readonly failed: number };
}

/** A badge read on the test page: get_pkeys, always (it also updates the roster). */
export interface IdentifyResult {
  readonly uid: string;
  readonly badge: Badge;
  readonly key1: Address;
  readonly ms: number;
}

export interface RollResult {
  readonly uid: string;
  readonly badge: Badge;
  readonly roll: Roll;
  readonly ms: number;
}

export interface PressResult {
  /** The station whose LED switched, or null when none acked. */
  readonly st: StationId | null;
  /** The receiver's round trip to the station, µs. */
  readonly rttUs: number | null;
  /** Pi ms from writing `press` to its `c3_press` line: the serial round trip alone. */
  readonly echoMs: number | null;
  /** Pi ms from the write to the station's ack. */
  readonly ackMs: number;
}

/** One measurement each, for the bench (bench.ts). */
export interface TapsProbe {
  /** Stations linked now. */
  linked(): StationId[];
  /** Recent ping round trips and station-press reports, µs. */
  pings(st: StationId): number[];
  reports(st: StationId): number[];
  press(): Promise<PressResult>;
  buzz(st: StationId): Promise<Answer>;
  screen(st: StationId): Promise<Answer>;
  list(st: StationId): Promise<NfcReply>;
}

export interface Taps extends StationsPort {
  status(): TapsStatus;
  /** Reads the badge on the station (get_pkeys) and records it. */
  identify(st: StationId): Promise<IdentifyResult>;
  /** A verified roll from the badge on the station (its keys read first if the roster doesn't know it). */
  roll(st: StationId): Promise<RollResult>;
  /** The chips on the station's reader. */
  list(st: StationId): Promise<readonly TagLine[]>;
  roster(): readonly RosterEntry[];
  /** `press`: toggles the first linked station's LED; the serial and radio round trips. */
  press(): Promise<PressResult>;
  stats(): TapsStats;
  /** Closes the port (every open tap fails), stops the timers, and waits for the roster's last write. */
  close(): Promise<void>;
  /** The fake receiver's controls, with `fake`; null on hardware. */
  readonly fake: FakeReceiver | null;
  readonly probe: TapsProbe;
}

/** The receiver gives up on a press after 25 sends 20 ms apart. */
const PRESS_MS = 1000;

/** A linked station with no seat: both are taken, and it gets the next one free. */
const BENCH_VIEW: StationView = stationView("", "NEXT", "both seats taken - you're next", { mode: "shut" });

export function createTaps(opts: TapsOptions): Taps {
  const log = opts.log ?? ((line: string) => console.error(line));
  const { clock } = opts;
  const fake = opts.receiver === "fake" ? new FakeReceiver(clock, opts.stations, opts.fake) : null;
  const roster = Roster.load(join(opts.dataDir, fake ? "badges.fake.json" : "badges.json"), log);
  const rxClock = new ReceiverClock();
  const acks = new Acks(clock);
  const aids = new AidMemory();
  const ids = new FreshIds();
  /** Presses in flight: when each was written, and when its c3_press came back (Pi ms after the write). */
  const echoes = new Map<number, { readonly started: number; echoMs: number | null }>();
  const changed = () => opts.onStatus?.();

  const receiver = new Receiver({
    open: fake ? fake.open : serialOpener(opts.receiver),
    clock,
    log,
    onEvent: (event, now) => route(event, now),
    onOpen: () => {
      rxClock.reset();
      changed();
    },
    onClose: () => {
      lostEverything();
      changed();
    },
  });
  const send = receiver.send.bind(receiver);
  const nextId = receiver.nextId.bind(receiver);
  const nfc = new Nfc({ clock, nextId, send });
  const buzzer = new Buzzer({ acks, nextId, send });
  /** What the core last showed at each seat: a station that takes a seat shows it at once. */
  const views: [StationView | null, StationView | null] = [null, null];
  const stations: Stations = new Stations(opts.stations, clock, {
    up(st) {
      if (stations.seatOf(st) === null) screens.show(st, BENCH_VIEW);
      screens.up(st);
    },
    down: (st) => screens.stale(st),
    lost: (st) => machine.lost(st),
    changed,
    seated() {
      for (const seat of [0, 1] as const) {
        const st = stations.stationAt(seat);
        const view = views[seat];
        if (st && view) screens.show(st, view);
      }
      for (const st of stations.bench()) screens.show(st, BENCH_VIEW);
      log(`taps: seats P1 ${stations.stationAt(0) ?? "-"}, P2 ${stations.stationAt(1) ?? "-"}${stations.bench().length ? `, bench ${stations.bench().join(" ")}` : ""}`);
    },
  });
  const screens = new Screens({ clock, acks, nextId, send, isUp: (st) => stations.isUp(st) });
  const machine = new TapMachine({ clock, roster, stations, nfc, aids, plan: opts.plan, emit: opts.onTap, log });

  /** Nothing in flight will be answered: the port closed, or the receiver rebooted. Taps fail first. */
  function lostEverything(): void {
    machine.closed();
    nfc.closed();
    acks.closed();
    stations.closed();
    echoes.clear();
  }

  function route(event: ReceiverEvent, now: number): void {
    if ((event.ev === "tap" || event.ev === "gone" || event.ev === "signed") && !ids.fresh(event.ev, event.st, event.id, now)) return;
    switch (event.ev) {
      case "tap":
        rxClock.observe(event.at_us, now);
        stations.apply(event, now);
        machine.tap(event, rxClock.touchedAt(event, stations.radioUs(event.st), now));
        return;
      case "gone":
        rxClock.observe(event.at_us, now);
        stations.apply(event, now);
        machine.gone(event);
        return;
      case "state":
      case "link":
      case "ping":
      case "nfc":
      case "s3_report":
        stations.apply(event, now);
        return;
      case "nfc_res":
      case "nfc_fail":
        nfc.answer(event);
        return;
      case "buzz_ok":
      case "buzz_fail":
      case "screen_ok":
      case "screen_fail":
      case "c3_ack":
      case "c3_fail":
        acks.answer(event);
        return;
      case "c3_press":
        rxClock.observe(event.at_us, now);
        {
          const echo = echoes.get(event.id);
          if (echo) echo.echoMs = performance.now() - echo.started;
        }
        return;
      case "s3_press":
      case "signed":
        rxClock.observe(event.at_us, now);
        return;
      case "ready":
        // The receiver rebooted under an open port: what it was doing is gone, and its clock restarted.
        log(`taps: receiver ready (firmware ${event.fw})`);
        rxClock.reset();
        lostEverything();
        send({ cmd: "state" });
        changed();
        return;
      case "bad":
        log(`taps: the receiver refused "${event.line}": ${event.why}`);
        return;
      case "button":
      case "stats":
        return;
    }
  }

  const seatStation = (seat: Seat): StationId | undefined => stations.stationAt(seat);

  /** A session with the chip resting on the station now, for the test page's reads. */
  function sessionAt(st: StationId): { session: ChipSession; uid: string } {
    const chip = stations.chip(st);
    if (!chip) throw new Error(`no badge on station ${st}`);
    const present = () => stations.chip(st)?.uid === chip.uid;
    const target = { st, uid: chip.uid, sak: "20", present, whenUp: () => stations.whenUp(st) };
    return { session: new ChipSession(nfc, aids, target, clock), uid: chip.uid };
  }

  async function press(): Promise<PressResult> {
    const id = nextId();
    const echo = { started: performance.now(), echoMs: null };
    echoes.set(id, echo);
    const answer = acks.wait(id, PRESS_MS);
    send({ cmd: "press", id });
    const a = await answer;
    echoes.delete(id);
    const ack = a.event?.ev === "c3_ack" ? a.event : null;
    return { st: ack?.st ?? null, rttUs: ack?.rtt_us ?? null, echoMs: echo.echoMs, ackMs: a.piMs };
  }

  receiver.start();

  return {
    show(seat, view: StationView) {
      views[seat] = view;
      const st = seatStation(seat);
      if (st) screens.show(st, view);
    },
    buzz(seat, kind: BuzzKind) {
      const st = seatStation(seat);
      if (st) buzzer.buzz(st, kind);
    },
    status: () => {
      const screenOf = new Map(screens.status().map((s) => [s.st, s]));
      return {
        receiver: receiver.status(),
        stations: stations.status().map((s) => ({ ...s, screen: screenOf.get(s.st) ?? null })),
        running: machine.running,
      };
    },
    async identify(st) {
      const started = performance.now();
      const { session, uid } = sessionAt(st);
      const keys = await readKeys(session.exec);
      const entry = roster.record(uid, keys, new Date(clock.now()));
      return { uid, badge: badgeOf(entry), key1: entry.key1, ms: performance.now() - started };
    },
    async roll(st) {
      const started = performance.now();
      const { session, uid } = sessionAt(st);
      const entry = roster.byUid(uid) ?? roster.record(uid, await readKeys(session.exec), new Date(clock.now()));
      const roll = await rollRandom(session.exec, entry.key2);
      return { uid, badge: badgeOf(entry), roll, ms: performance.now() - started };
    },
    list: async (st) => (await nfc.request(st, { op: "list" })).tags,
    roster: () => roster.entries(),
    press,
    stats: () => ({ receiver: receiver.stats(), taps: machine.counts, buzz: { ...buzzer.counts } }),
    async close() {
      await receiver.close();
      screens.stop();
      stations.stop();
      fake?.stop();
      await roster.flush();
    },
    fake,
    probe: {
      linked: () => stations.ids().filter((st) => stations.isUp(st)),
      pings: (st) => stations.pings(st),
      reports: (st) => stations.reports(st),
      press,
      buzz: (st) => buzzer.probe(st),
      screen: (st) => screens.probe(st),
      list: (st) => nfc.request(st, { op: "list" }),
    },
  };
}
