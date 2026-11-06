// One physical tap, from its `tap` line to its last event: `touch` at once (with the touch time and the badge if the
// roster knows the UID), then the seat's plan (identify | random | none), then exactly one `done` or `fail`. Every
// touch ends in done or fail, even when the link or the whole receiver drops.
//
// - An unknown chip is read (get_pkeys) whatever the plan, so a stranger's chip can never pass as a seated player.
// - A known chip's identify or none tap costs no chip command: it is done the moment its line arrives.
// - After such a tap the applet is selected anyway, off the tap's clock: the station selects it itself right after
//   the tap and answers this SELECT from its kept answer (~3 ms), and if the station's own select failed this one
//   leaves the chip selected for the next tap's commands. Its errors are dropped: the tap is already done.
// - A roll is key 2's sign_random, verified against the roster's key-2 identity.
// - Nothing is recorded or rolled for a tap that ended while its chip was being read (a newer tap, the link, the
//   receiver): the answer may have come from another chip.
import { HaloLogicError, HaloTagError } from "@arx-research/libhalo/api/common";
import type { Seat } from "@egb/sdk";
import type { Clock, TapErrorCode, TapEvent, TapPlan } from "../core/ports.ts";
import type { Badge } from "../core/types.ts";
import { readKeys, rollRandom } from "./chip-ops.ts";
import { NfcError, NotHaloError, VerifyError } from "./errors.ts";
import { ChipSession, type AidMemory } from "./halo-exec.ts";
import type { ReceiverEvent, StationId } from "./lines.ts";
import type { Nfc } from "./nfc.ts";
import { badgeOf, type Roster, type RosterEntry } from "./roster.ts";
import { LinkLostError, type Stations } from "./stations.ts";

type TapLine = Extract<ReceiverEvent, { ev: "tap" }>;

export interface TapMachineDeps {
  readonly clock: Clock;
  readonly roster: Roster;
  readonly stations: Stations;
  readonly nfc: Nfc;
  readonly aids: AidMemory;
  readonly plan: (seat: Seat) => TapPlan;
  readonly emit: (event: TapEvent) => void;
  readonly log: (line: string) => void;
}

interface OpenTap {
  readonly tap: number;
  readonly seat: Seat;
  readonly line: TapLine;
  readonly uid: string;
  readonly at: number;
  readonly badge: Badge | null;
  gone: boolean;
  settled: boolean;
}

export interface TapCounts {
  touch: number;
  done: number;
  fail: Record<TapErrorCode, number>;
}

export class TapMachine {
  private readonly deps: TapMachineDeps;
  /** The tap each station is running, by station. */
  private readonly open = new Map<StationId, OpenTap>();
  /** Each station's latest tap, running or not: its chip is the one on the reader until a `gone`. */
  private readonly newest = new Map<StationId, OpenTap>();
  private last = 0;
  readonly counts: TapCounts = { touch: 0, done: 0, fail: { lifted: 0, radio: 0, "not-halo": 0, refused: 0, verify: 0, link: 0 } };

  constructor(deps: TapMachineDeps) {
    this.deps = deps;
  }

  /** Taps not yet done or failed. */
  get running(): number {
    return this.open.size;
  }

  /** A `tap` line, with the touch time already estimated (Pi ms). Stations no seat uses are ignored. */
  tap(line: TapLine, at: number): void {
    const seat = this.deps.stations.seatOf(line.st);
    if (seat === null) return;
    const previous = this.open.get(line.st);
    if (previous) this.fail(previous, "lifted", "Another tap began on this station before this one finished.");
    const uid = line.uid.toUpperCase();
    const entry = this.deps.roster.byUid(uid);
    const t: OpenTap = { tap: ++this.last, seat, line, uid, at, badge: entry ? badgeOf(entry) : null, gone: false, settled: false };
    this.open.set(line.st, t);
    this.newest.set(line.st, t);
    this.counts.touch++;
    this.emit({ phase: "touch", tap: t.tap, seat, at, badge: t.badge });
    void this.run(t, this.planFor(seat), entry);
  }

  /** A `gone` line: the chip of that tap left the reader. */
  gone(line: Extract<ReceiverEvent, { ev: "gone" }>): void {
    const t = this.newest.get(line.st);
    if (t && t.line.id === line.id) t.gone = true;
  }

  /** The station's link stayed down past its grace. */
  lost(st: StationId): void {
    const t = this.open.get(st);
    if (t) this.fail(t, "link", "The station lost its link to the Box.");
  }

  /** The receiver's port closed (or it rebooted): every open tap fails at once. */
  closed(): void {
    for (const t of [...this.open.values()]) this.fail(t, "link", "The Box lost the receiver.");
  }

  private planFor(seat: Seat): TapPlan {
    try {
      return this.deps.plan(seat);
    } catch (e) {
      this.deps.log(`taps: the plan for seat ${seat} failed, identifying instead: ${e instanceof Error ? e.message : String(e)}`);
      return "identify";
    }
  }

  /** The tap's chip is still on the reader: no `gone` for it, and no newer tap on its station. */
  private present(t: OpenTap): boolean {
    return !t.gone && this.newest.get(t.line.st) === t;
  }

  private async run(t: OpenTap, plan: TapPlan, known: RosterEntry | undefined): Promise<void> {
    const { st, sak } = t.line;
    const { clock, nfc, aids, stations, roster } = this.deps;
    const session = new ChipSession(nfc, aids, { st, uid: t.uid, sak, present: () => this.present(t), whenUp: () => stations.whenUp(st) }, clock);
    if (known && plan !== "random") {
      this.done(t, known, null);
      session.select().catch(() => {});
      return;
    }
    try {
      let entry = known;
      if (!entry) {
        const keys = await readKeys(session.exec);
        if (!this.unchanged(t)) return;
        entry = roster.record(t.uid, keys, new Date(clock.now()));
      }
      const roll = plan === "random" ? await rollRandom(session.exec, entry.key2) : null;
      if (!this.unchanged(t)) return;
      this.done(t, entry, roll?.value ?? null);
    } catch (e) {
      const [code, text] = this.classify(e, t);
      this.fail(t, code, text);
    }
  }

  /**
   * After an await: false when the tap already ended (nothing more for it), and throws when its chip left (the
   * answer just read may not be its chip's).
   */
  private unchanged(t: OpenTap): boolean {
    if (t.settled) return false;
    if (!this.present(t)) throw new NfcError("no-chip", "the chip left the reader");
    return true;
  }

  private classify(e: unknown, t: OpenTap): [TapErrorCode, string] {
    if (e instanceof NotHaloError) return ["not-halo", "That isn't a HaLo badge."];
    if (e instanceof VerifyError) return ["verify", `The badge's answer didn't check out: ${e.message}`];
    if (e instanceof HaloTagError) return ["refused", `The badge refused: ${e.message}`];
    if (e instanceof HaloLogicError) return ["verify", `The badge's answer didn't parse: ${e.message}`];
    if (e instanceof LinkLostError) return ["link", "The station lost its link to the Box."];
    if (e instanceof NfcError) {
      switch (e.kind) {
        case "link":
        case "closed":
          return ["link", "The station lost its link to the Box."];
        case "reader-dead":
          return ["radio", "The station's reader stopped answering."];
        case "bad-request":
          return ["radio", `The station refused the request: ${e.message}`];
        default:
          return !this.present(t)
            ? ["lifted", "Lifted too early. Hold the badge on the station until it buzzes."]
            : ["radio", "Weak connection to the badge. Hold it flat on the station."];
      }
    }
    this.deps.log(`taps: tap ${t.tap} failed unexpectedly: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
    return ["radio", "The tap failed; try again."];
  }

  private done(t: OpenTap, entry: RosterEntry, roll: number | null): void {
    if (!this.settle(t)) return;
    this.counts.done++;
    this.emit({ phase: "done", tap: t.tap, seat: t.seat, at: t.at, badge: badgeOf(entry), roll });
  }

  private fail(t: OpenTap, code: TapErrorCode, text: string): void {
    if (!this.settle(t)) return;
    this.counts.fail[code]++;
    this.emit({ phase: "fail", tap: t.tap, seat: t.seat, at: t.at, badge: t.badge, error: { code, text } });
  }

  /** Marks the tap finished; false when it already was. */
  private settle(t: OpenTap): boolean {
    if (t.settled) return false;
    t.settled = true;
    if (this.open.get(t.line.st) === t) this.open.delete(t.line.st);
    return true;
  }

  private emit(event: TapEvent): void {
    try {
      this.deps.emit(event);
    } catch (e) {
      this.deps.log(`taps: the ${event.phase} listener failed: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
    }
  }
}
