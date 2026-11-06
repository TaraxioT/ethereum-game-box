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

/**
 * A running tap's chip that the station counts gone and reads again within this long, on the same station, never
 * left: the same tap carries on. HaLos with SAK 28 answer the station's presence check only now and then, so a badge
 * held still on the reader reads as `gone` and then as a new `tap` a few ms later (the station logs it), which used to
 * fail every roll it interrupted as `lifted` (Stock Duel's pick, on the Box).
 */
export const REJOIN_MS = 500;

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
  /** The station's latest line for this chip: a rejoin moves it on to the new tap id. */
  line: TapLine;
  readonly uid: string;
  readonly at: number;
  readonly badge: Badge | null;
  gone: boolean;
  /** When the station last counted the chip gone (Pi ms). */
  goneAt: number;
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
    if (previous && this.rejoins(previous, line)) {
      this.deps.log(`taps: tap ${previous.tap} carries on: ${line.st} read the same chip again`);
      previous.line = line;
      previous.gone = false;
      this.newest.set(line.st, previous);
      return;
    }
    if (previous) {
      this.deps.log(`taps: tap ${previous.tap} failed lifted: a new tap began on ${line.st} before it finished`);
      this.fail(previous, "lifted", "Another tap began on this station before this one finished.");
    }
    const uid = line.uid.toUpperCase();
    const entry = this.deps.roster.byUid(uid);
    const t: OpenTap = { tap: ++this.last, seat, line, uid, at, badge: entry ? badgeOf(entry) : null, gone: false, goneAt: 0, settled: false };
    this.open.set(line.st, t);
    this.newest.set(line.st, t);
    this.counts.touch++;
    this.emit({ phase: "touch", tap: t.tap, seat, at, badge: t.badge });
    void this.run(t, this.planFor(seat), entry);
  }

  /** A `gone` line: the chip of that tap left the reader. */
  gone(line: Extract<ReceiverEvent, { ev: "gone" }>): void {
    const t = this.newest.get(line.st);
    if (t && t.line.id === line.id) {
      t.gone = true;
      t.goneAt = this.deps.clock.now();
    }
  }

  /** A new `tap` line on a station whose tap is still running is that tap's chip coming back, not a new tap. */
  private rejoins(t: OpenTap, line: TapLine): boolean {
    return t.uid === line.uid.toUpperCase() && (!t.gone || this.deps.clock.now() - t.goneAt <= REJOIN_MS);
  }

  /** The tap's chip was counted gone, and may yet be read again (`REJOIN_MS`). */
  private returning(t: OpenTap): boolean {
    return t.gone && !t.settled && this.newest.get(t.line.st) === t && this.deps.clock.now() - t.goneAt <= REJOIN_MS;
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
    const target = { st, uid: t.uid, sak, present: () => this.present(t), returning: () => this.returning(t), whenUp: () => stations.whenUp(st) };
    const session = new ChipSession(nfc, aids, target, clock);
    this.deps.log(`taps: tap ${t.tap} touched ${st} seat ${t.seat} uid ${t.uid} (${t.badge?.name ?? "unknown"}), plan ${plan}`);
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
      this.deps.log(`taps: tap ${t.tap} failed ${code} after ${Math.round(clock.now() - t.at)} ms: ${e instanceof Error ? e.message : String(e)}`);
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
    this.deps.log(`taps: tap ${t.tap} done after ${Math.round(this.deps.clock.now() - t.at)} ms${roll === null ? "" : ", rolled"}`);
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
